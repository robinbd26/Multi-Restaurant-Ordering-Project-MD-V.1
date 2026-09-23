import "server-only";

import { isInBangladesh, isValidLatLng, type LatLng } from "@/lib/services/geo";

/**
 * Address search and reverse lookup, powered by Barikoi (Bangladesh provider).
 *
 * SERVER ONLY. `BARIKOI_API_KEY` is read here and nowhere else; the browser only
 * ever talks to our own `/api/geo/*` routes, so the key never leaves the process.
 *
 * COVERAGE NEVER DEPENDS ON THIS FILE. Delivery is decided from the customer's
 * pin against drawn shapes (lib/coverage). Geocoding only supplies display text
 * and search convenience, so every failure mode below resolves to "no results"
 * rather than an error: no key, quota exhausted, network down, provider outage.
 * The customer can still drop a pin and type the address by hand.
 *
 * QUOTA: the free tier is small. Protection is layered:
 *   1. the client debounces typing (components/maps/map-picker.tsx) and the
 *      route rate-limits per user;
 *   2. results are cached in memory (identical searches / nearby pins are free);
 *   3. identical in-flight requests share one upstream call;
 *   4. after a quota/auth style failure the provider is left alone for a while
 *      instead of being hit by every keystroke.
 */

const BASE_URL = "https://barikoi.xyz/v2/api/search";

const SEARCH_TTL_MS = 10 * 60_000;
const REVERSE_TTL_MS = 60 * 60_000;
const NEGATIVE_TTL_MS = 60_000;
/** Back-off after the provider says "no more quota" / "bad key". */
const QUOTA_COOLDOWN_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 500;

export function geocodingKey(): string {
  return (process.env.BARIKOI_API_KEY ?? "").trim();
}

/** True when a key is configured. False = pin + typed address only. */
export function geocodingAvailable(): boolean {
  return geocodingKey().length > 0;
}

export interface GeoSuggestion {
  /** Short label for the suggestion list. */
  label: string;
  /** Full address text — prefills the address box (display only, never a gate). */
  address: string;
  /** Locality / neighbourhood when the provider supplies one; "" otherwise. */
  area: string;
  /** City ("Dhaka"); "" when unknown. */
  city: string;
  postalCode: string;
  country: string;
  /** Barikoi place code (uCode) for the place; "" when unavailable. */
  placeId: string;
  lat: number;
  lng: number;
}

// ── tiny TTL cache ────────────────────────────────────────────────────────
interface CacheEntry {
  value: unknown;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
let cooldownUntil = 0;

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown, ttl: number) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Map iterates in insertion order: drop the oldest entry.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + ttl });
}

/**
 * One upstream GET. Any failure resolves to null (never throws). A 401/402/403/429
 * starts the cool-down so an exhausted quota is not retried on every keystroke.
 */
async function fetchJson(path: string, params: Record<string, string>): Promise<unknown | null> {
  if (Date.now() < cooldownUntil) return null;
  const search = new URLSearchParams({ ...params, api_key: geocodingKey() });
  try {
    const res = await fetch(`${BASE_URL}/${path}?${search.toString()}`, {
      // A checkout must not wait on a slow third party on a 3G connection.
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
      cooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
      console.error(`[geo] Barikoi refused the request (${res.status}); pausing lookups for 5 minutes`);
      return null;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("[geo] Barikoi request failed:", err);
    return null;
  }
}

/** Cache + de-duplicate one lookup. `load` returns null on failure. */
async function cached<T>(key: string, ttl: number, empty: T, load: () => Promise<T | null>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const run = (async () => {
    const value = await load();
    // A failed call is remembered briefly so a stuck client cannot loop on it.
    if (value === null) {
      cacheSet(key, empty, NEGATIVE_TTL_MS);
      return empty;
    }
    cacheSet(key, value, ttl);
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

// ── Barikoi shapes, narrowed to what is read ──────────────────────────────
interface BarikoiPlace {
  id?: number;
  uCode?: string;
  latitude?: number | string;
  longitude?: number | string;
  address?: string;
  address_bn?: string;
  area?: string;
  area_bn?: string;
  city?: string;
  city_bn?: string;
  postCode?: number | string;
  country?: string;
}

function shortLabel(address: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 2).join(", ") || address;
}

function toSuggestion(place: BarikoiPlace, bangla: boolean, pin?: LatLng): GeoSuggestion | null {
  const lat = pin?.lat ?? Number(place.latitude);
  const lng = pin?.lng ?? Number(place.longitude);
  if (!isValidLatLng(lat, lng) || !isInBangladesh({ lat, lng })) return null;
  const address = ((bangla && place.address_bn) || place.address || "").trim();
  if (!address) return null;
  return {
    label: shortLabel(address),
    address,
    area: ((bangla && place.area_bn) || place.area || "").trim(),
    city: ((bangla && place.city_bn) || place.city || "").trim(),
    postalCode: place.postCode != null ? String(place.postCode) : "",
    country: place.country?.trim() || "Bangladesh",
    placeId: place.uCode ? String(place.uCode) : "",
    lat,
    lng,
  };
}

/**
 * A typed address → candidate places, restricted to Bangladesh. Empty on any
 * failure (or with no key) — the caller just shows "no suggestions".
 */
export async function geocodeAddress(
  query: string,
  opts: { locale?: string; limit?: number } = {},
): Promise<GeoSuggestion[]> {
  const trimmed = query.trim().slice(0, 200);
  const limit = Math.min(Math.max(1, opts.limit ?? 5), 10);
  const bangla = opts.locale !== "en";
  if (trimmed.length < 2 || !geocodingAvailable()) return [];

  const key = `s:${bangla ? "bn" : "en"}:${trimmed.toLowerCase()}`;
  const all = await cached<GeoSuggestion[]>(key, SEARCH_TTL_MS, [], async () => {
    const data = (await fetchJson("autocomplete/place", {
      q: trimmed,
      bangla: bangla ? "true" : "false",
    })) as { places?: BarikoiPlace[] } | null;
    if (!data) return null;
    return (data.places ?? [])
      .map((p) => toSuggestion(p, bangla))
      .filter((s): s is GeoSuggestion => s !== null);
  });
  return all.slice(0, limit);
}

/**
 * A dropped pin → readable address text. The returned coordinates are the PIN
 * the customer placed, never the geocoder's street centroid, so the marker can
 * not jump. Null when nothing resolves; the caller keeps the pin.
 */
export async function reverseGeocode(
  point: LatLng,
  opts: { locale?: string } = {},
): Promise<GeoSuggestion | null> {
  if (!isValidLatLng(point.lat, point.lng) || !geocodingAvailable()) return null;
  const bangla = opts.locale !== "en";
  // ~11 m grid: a pin nudged by a metre reuses the cached answer.
  const key = `r:${bangla ? "bn" : "en"}:${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
  const result = await cached<GeoSuggestion | { none: true }>(key, REVERSE_TTL_MS, { none: true }, async () => {
    const data = (await fetchJson("reverse/geocode", {
      latitude: String(point.lat),
      longitude: String(point.lng),
      district: "true",
      post_code: "true",
      country: "true",
      area: "true",
      address: "true",
      bangla: bangla ? "true" : "false",
    })) as { place?: BarikoiPlace | null } | null;
    if (!data) return null;
    if (!data.place) return { none: true };
    return toSuggestion(data.place, bangla, point) ?? { none: true };
  });
  return "none" in result ? null : { ...result, lat: point.lat, lng: point.lng };
}
