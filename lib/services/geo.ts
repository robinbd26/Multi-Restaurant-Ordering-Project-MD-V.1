// Pure geographic helpers (no DB). Distances use the Haversine great-circle
// formula — the reliable server-side basis for delivery coverage and nearest
// pickup. Google Maps only replaces coordinate ACQUISITION (geocoding); the math
// here is authoritative and never trusts client-submitted distances.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Round a distance to a friendly precision (2 decimals). */
export function roundKm(km: number): number {
  return Math.round(km * 100) / 100;
}

/** A valid finite coordinate pair within earth bounds. */
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;
}

/** Google Maps directions deep-link to a destination coordinate. */
export function directionsUrl(dest: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`;
}

/**
 * PHASE E — a coordinate the client actually SENT, as a number.
 *
 * `Number(null)` is 0 and `Number("")` is 0, so a missing latitude would
 * otherwise be silently accepted as the equator rather than rejected. Anything
 * that is not a finite number — including null, empty string and booleans —
 * comes back as NaN, which every range check already refuses.
 */
export function coordinateOrNaN(value: unknown): number {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return Number.NaN;
  return Number(value);
}

// ── WS-4.1 · Bangladesh framing ─────────────────────────────────────────
// Every map in this product opens on Bangladesh and every geocode is biased to
// it: a customer in Mirpur searching "Bank Colony" must not be offered a match
// in another country.

/** Dhaka — the map centre used when nothing better is known yet. */
export const BD_CENTER: LatLng = { lat: 23.8103, lng: 90.4125 };

/** Rough national bounding box (south/west → north/east). */
export const BD_BOUNDS = { south: 20.55, west: 88.0, north: 26.7, east: 92.7 } as const;

/** Whether a point falls inside the Bangladesh bounding box. */
export function isInBangladesh(p: LatLng): boolean {
  return (
    p.lat >= BD_BOUNDS.south && p.lat <= BD_BOUNDS.north && p.lng >= BD_BOUNDS.west && p.lng <= BD_BOUNDS.east
  );
}

// ── WS-4.1 · Server-side geocoding ──────────────────────────────────────
/**
 * Address → coordinates and pin → address, called ONLY from the server
 * (`app/api/geo/*`). The key never reaches the browser: the public
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY only renders tiles, while these HTTP calls —
 * the billable ones an attacker would want — use a key that stays in the
 * process environment.
 *
 * DEMO FALLBACK (the .env.example promise): with no key configured nothing
 * throws. Search falls back to the small table of well-known Bangladeshi
 * localities below and reverse-lookup names the nearest of them, so a customer
 * can still pick a place by name instead of typing decimal degrees. Every such
 * result is flagged `demo: true` so the UI can label it as approximate.
 */

/** Server geocoding key, falling back to the public one when only that is set. */
export function geocodingKey(): string {
  return (process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
}

/** True when live geocoding is configured; false means the demo table is used. */
export function geocodingAvailable(): boolean {
  return geocodingKey().length > 0;
}

export interface GeoSuggestion {
  /** Short label for the suggestion list. */
  label: string;
  /** Full formatted address — what gets stored on the address/order row. */
  address: string;
  /** Locality / thana when the provider supplies one; "" otherwise. */
  area: string;
  /** Locality / city (Dhaka, Chattogram) when available; "" otherwise. */
  city: string;
  /** Postal code when the provider supplies one; "" otherwise. */
  postalCode: string;
  /** Country name when available; "" otherwise. */
  country: string;
  /** Google place_id for the resolved place ("" when unavailable). Kept so the
   *  customer's saved address can be re-opened on Google Maps by id and so a
   *  future checkout can pin the exact place without re-geocoding. */
  placeId: string;
  lat: number;
  lng: number;
  /** True when this came from the offline table rather than a live geocoder. */
  demo: boolean;
}

/**
 * Well-known Bangladeshi localities with approximate centres, used only when no
 * geocoding key is configured. Deliberately small and city-level: it is a
 * usable demo affordance, never a substitute for a real geocoder — which is why
 * results built from it are flagged `demo`.
 */
const BD_DEMO_PLACES: readonly { en: string; bn: string; city_en: string; city_bn: string; lat: number; lng: number }[] = [
  { en: "Dhanmondi", bn: "ধানমন্ডি", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.7461, lng: 90.376 },
  { en: "Gulshan", bn: "গুলশান", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.7925, lng: 90.4078 },
  { en: "Banani", bn: "বনানী", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.7936, lng: 90.4066 },
  { en: "Uttara", bn: "উত্তরা", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.8759, lng: 90.3795 },
  { en: "Mirpur", bn: "মিরপুর", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.8223, lng: 90.3654 },
  { en: "Mohammadpur", bn: "মোহাম্মদপুর", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.7657, lng: 90.3588 },
  { en: "Bashundhara R/A", bn: "বসুন্ধরা আ/এ", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.8203, lng: 90.4288 },
  { en: "Motijheel", bn: "মতিঝিল", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.7331, lng: 90.4171 },
  { en: "Badda", bn: "বাড্ডা", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.7806, lng: 90.4267 },
  { en: "Mohakhali", bn: "মহাখালী", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.7784, lng: 90.4033 },
  { en: "Old Dhaka", bn: "পুরান ঢাকা", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.7104, lng: 90.4074 },
  { en: "Savar", bn: "সাভার", city_en: "Dhaka", city_bn: "ঢাকা", lat: 23.8583, lng: 90.2667 },
  { en: "Narayanganj", bn: "নারায়ণগঞ্জ", city_en: "Narayanganj", city_bn: "নারায়ণগঞ্জ", lat: 23.6238, lng: 90.5 },
  { en: "GEC Circle", bn: "জিইসি মোড়", city_en: "Chattogram", city_bn: "চট্টগ্রাম", lat: 22.3586, lng: 91.8214 },
  { en: "Agrabad", bn: "আগ্রাবাদ", city_en: "Chattogram", city_bn: "চট্টগ্রাম", lat: 22.3269, lng: 91.8123 },
  { en: "Zindabazar", bn: "জিন্দাবাজার", city_en: "Sylhet", city_bn: "সিলেট", lat: 24.8949, lng: 91.8687 },
  { en: "Zero Point", bn: "জিরো পয়েন্ট", city_en: "Khulna", city_bn: "খুলনা", lat: 22.8098, lng: 89.5403 },
  { en: "Zero Point", bn: "জিরো পয়েন্ট", city_en: "Rajshahi", city_bn: "রাজশাহী", lat: 24.3745, lng: 88.6042 },
];

/** Localized "Locality, City" label for a demo-table row. */
function demoLabel(place: (typeof BD_DEMO_PLACES)[number], bangla: boolean): string {
  return bangla ? `${place.bn}, ${place.city_bn}` : `${place.en}, ${place.city_en}`;
}

function demoSearch(query: string, bangla: boolean, limit: number): GeoSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return BD_DEMO_PLACES.filter(
    (p) =>
      p.en.toLowerCase().includes(needle) ||
      p.city_en.toLowerCase().includes(needle) ||
      p.bn.includes(query.trim()) ||
      p.city_bn.includes(query.trim()),
  )
    .slice(0, limit)
    .map((p) => ({
      label: demoLabel(p, bangla),
      address: demoLabel(p, bangla),
      area: bangla ? p.bn : p.en,
      city: bangla ? p.city_bn : p.city_en,
      postalCode: "",
      country: "Bangladesh",
      placeId: "",
      lat: p.lat,
      lng: p.lng,
      demo: true,
    }));
}

/** Google's response shapes, narrowed to the fields actually read below. */
interface GoogleAddressComponent {
  long_name?: string;
  types?: string[];
}
interface GoogleGeocodeResult {
  /** Google's stable identifier for this place (e.g. "ChIJ0V1o4V..."). */
  place_id?: string;
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: { location?: { lat?: number; lng?: number } };
}
interface GoogleGeocodeResponse {
  status?: string;
  results?: GoogleGeocodeResult[];
}

/** The most specific locality-ish component Google returned, or "". */
function areaOf(result: GoogleGeocodeResult): string {
  const wanted = ["sublocality_level_1", "sublocality", "locality", "administrative_area_level_3", "administrative_area_level_2"];
  for (const type of wanted) {
    const hit = result.address_components?.find((c) => c.types?.includes(type));
    if (hit?.long_name) return hit.long_name;
  }
  return "";
}

/** The locality / city ("Dhaka", "Chattogram") Google returned, or "". */
function cityOf(result: GoogleGeocodeResult): string {
  const wanted = ["locality", "administrative_area_level_1", "administrative_area_level_2"];
  for (const type of wanted) {
    const hit = result.address_components?.find((c) => c.types?.includes(type));
    if (hit?.long_name) return hit.long_name;
  }
  return "";
}

/** The postal code ("1207") Google returned, or "". */
function postalCodeOf(result: GoogleGeocodeResult): string {
  return result.address_components?.find((c) => c.types?.includes("postal_code"))?.long_name ?? "";
}

/** The short or long country name Google returned, or "". */
function countryOf(result: GoogleGeocodeResult): string {
  return result.address_components?.find((c) => c.types?.includes("country"))?.long_name ?? "";
}

/** Shorten a formatted address to a list-friendly label (first two parts). */
function shortLabel(formatted: string): string {
  const parts = formatted.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 2).join(", ") || formatted;
}

/**
 * One Geocoding API call. A network failure, a quota error or any non-OK status
 * resolves to an EMPTY list rather than throwing: a geocoder outage must never
 * take checkout down — the customer can still drop a pin or type coordinates.
 */
async function callGeocoder(params: URLSearchParams): Promise<GoogleGeocodeResult[]> {
  params.set("key", geocodingKey());
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`, {
      // A checkout must not wait on a slow third party on a 3G connection.
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as GoogleGeocodeResponse;
    // ZERO_RESULTS is a legitimate empty answer, not an error worth logging.
    if (data.status !== "OK") {
      if (data.status && data.status !== "ZERO_RESULTS") console.error("[geo] geocode status:", data.status);
      return [];
    }
    return data.results ?? [];
  } catch (err) {
    console.error("[geo] geocode request failed:", err);
    return [];
  }
}

function toSuggestion(result: GoogleGeocodeResult): GeoSuggestion | null {
  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  if (!isValidLatLng(lat, lng)) return null;
  const formatted = result.formatted_address ?? "";
  return {
    label: shortLabel(formatted),
    address: formatted,
    area: areaOf(result),
    city: cityOf(result),
    postalCode: postalCodeOf(result),
    country: countryOf(result),
    placeId: result.place_id ?? "",
    lat: Number(lat),
    lng: Number(lng),
    demo: false,
  };
}

/**
 * A typed address → candidate coordinates, restricted to Bangladesh.
 * `components=country:BD` is a HARD filter (not a hint), so a forged query can
 * never geocode its way to a point outside the country's delivery footprint.
 */
export async function geocodeAddress(
  query: string,
  opts: { locale?: string; limit?: number } = {},
): Promise<GeoSuggestion[]> {
  const trimmed = query.trim().slice(0, 200);
  const limit = Math.min(Math.max(1, opts.limit ?? 5), 10);
  const bangla = opts.locale !== "en";
  if (!trimmed) return [];
  if (!geocodingAvailable()) return demoSearch(trimmed, bangla, limit);

  const params = new URLSearchParams({
    address: trimmed,
    components: "country:BD",
    region: "bd",
    language: bangla ? "bn" : "en",
    bounds: `${BD_BOUNDS.south},${BD_BOUNDS.west}|${BD_BOUNDS.north},${BD_BOUNDS.east}`,
  });
  const results = await callGeocoder(params);
  const suggestions = results
    .map(toSuggestion)
    .filter((s): s is GeoSuggestion => s !== null && isInBangladesh(s))
    .slice(0, limit);
  // A live geocoder that returned nothing still beats a dead search box.
  return suggestions.length > 0 ? suggestions : demoSearch(trimmed, bangla, limit);
}

/**
 * A dropped pin → a human-readable Bangladeshi address. Returns null when
 * nothing can be resolved; callers keep the coordinates and let the customer
 * type the address themselves.
 */
export async function reverseGeocode(
  point: LatLng,
  opts: { locale?: string } = {},
): Promise<GeoSuggestion | null> {
  if (!isValidLatLng(point.lat, point.lng)) return null;
  const bangla = opts.locale !== "en";
  if (!geocodingAvailable()) return nearestDemoPlace(point, bangla);

  const params = new URLSearchParams({
    latlng: `${point.lat},${point.lng}`,
    region: "bd",
    language: bangla ? "bn" : "en",
  });
  const results = await callGeocoder(params);
  for (const result of results) {
    const suggestion = toSuggestion(result);
    if (suggestion) {
      // Keep the pin the customer actually dropped; only the TEXT comes from
      // Google, so the map marker never jumps to a street centroid.
      return { ...suggestion, lat: point.lat, lng: point.lng };
    }
  }
  return nearestDemoPlace(point, bangla);
}

/** Demo reverse-lookup: the nearest known locality within 8 km, else null. */
function nearestDemoPlace(point: LatLng, bangla: boolean): GeoSuggestion | null {
  let best: { place: (typeof BD_DEMO_PLACES)[number]; dist: number } | null = null;
  for (const place of BD_DEMO_PLACES) {
    const dist = haversineKm(place, point);
    if (!best || dist < best.dist) best = { place, dist };
  }
  if (!best || best.dist > 8) return null;
  const label = demoLabel(best.place, bangla);
  return {
    label,
    address: label,
    area: bangla ? best.place.bn : best.place.en,
    city: bangla ? best.place.city_bn : best.place.city_en,
    postalCode: "",
    country: "Bangladesh",
    placeId: "",
    lat: point.lat,
    lng: point.lng,
    demo: true,
  };
}
