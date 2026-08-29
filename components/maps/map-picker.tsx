"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

import type { GMap, GMarker, GMapsListener } from "./google-maps-types";
import { mapsApiKey, useGoogleMaps } from "./use-google-maps";

/**
 * WS-4.1 — THE location picker. One component, three call sites: checkout, the
 * customer address book and the branch manager's zone editor. Before this, a
 * customer in Dhaka was asked to type decimal latitude and longitude into two
 * text boxes; nobody can do that.
 *
 * What it gives the customer:
 *   · a search box backed by the SERVER-side geocoder (`/api/geo/search`), so
 *     the billable Google key never reaches the browser;
 *   · a draggable pin on a real map, reverse-geocoded to a readable Bangladeshi
 *     address (`/api/geo/reverse`);
 *   · "use my current location" straight from the browser's GPS.
 *
 * DEMO FALLBACK (.env.example promises "polished map placeholder + raw
 * coordinates" without a key): with NEXT_PUBLIC_GOOGLE_MAPS_API_KEY empty — or
 * when Google rejects the key at runtime — no map is mounted at all. Search
 * (offline locality table), GPS and clearly-labelled manual coordinate entry all
 * keep working. There is never a broken or blank map.
 *
 * 3G: the Maps SDK is only fetched once the picker is OPENED, never on page load.
 */

/** Where a coordinate came from — mirrors Order.deliveryCoordSource. */
export type PickerSource = "device_gps" | "saved_address" | "map_pin" | "unverified";

export interface PickedPoint {
  /** Decimal strings, so the surrounding forms keep their string state. */
  lat: string;
  lng: string;
  source: PickerSource;
  /** Resolved address text ("" when unknown — never guessed). */
  address: string;
  /** Locality / thana ("" when unknown). */
  area: string;
}

interface Suggestion {
  label: string;
  address: string;
  area: string;
  lat: number;
  lng: number;
  demo: boolean;
}

/** Six decimals ≈ 0.1 m — more than a delivery pin ever needs. */
function coord(value: number): string {
  return value.toFixed(6);
}

const DEFAULT_ZOOM = 15;

export function MapPicker({
  lat,
  lng,
  onChange,
  label,
  hint,
  latName = "lat",
  lngName = "lng",
  latTestId,
  lngTestId,
  latError,
  lngError,
  persistGps = false,
  testId = "map-picker",
  className,
}: {
  /** Current coordinate as decimal strings; "" when nothing is chosen yet. */
  lat: string;
  lng: string;
  onChange: (point: PickedPoint) => void;
  label: string;
  hint?: string;
  /** Field names for the manual inputs, so existing form rules keep matching. */
  latName?: string;
  lngName?: string;
  /** Test ids for the manual inputs — default `${testId}-lat` / `-lng`. */
  latTestId?: string;
  lngTestId?: string;
  latError?: string;
  lngError?: string;
  /**
   * Save a device GPS fix to the customer's account as well. Only for CUSTOMER
   * screens: that endpoint is customer-only, and the stored fix is what
   * WS-4.2 later reconciles a submitted delivery coordinate against.
   */
  persistGps?: boolean;
  testId?: string;
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const hasKey = mapsApiKey().length > 0;

  const [open, setOpen] = useState(false);
  const { status, maps } = useGoogleMaps(open && hasKey, locale === "en" ? "en" : "bn");
  const mapFailed = status === "error" || status === "unavailable";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const markerRef = useRef<GMarker | null>(null);
  const listenersRef = useRef<GMapsListener[]>([]);
  /** Guards the "external value changed" sync against our own commits. */
  const lastCommitted = useRef<string>("");
  /** Only the newest reverse-geocode answer may write the address. */
  const reverseSeq = useRef(0);

  const [address, setAddress] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [demoResults, setDemoResults] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  // Manual decimal entry is the DEGRADED path: shown by default only when there
  // is no usable map, otherwise tucked behind a toggle for power users.
  const [manual, setManual] = useState(false);

  const hasPoint = lat.trim() !== "" && lng.trim() !== "";
  const numLat = Number(lat);
  const numLng = Number(lng);
  const pointValid = hasPoint && Number.isFinite(numLat) && Number.isFinite(numLng);

  /** Push a new point to the parent and remember it as ours. */
  const commit = useCallback(
    (nextLat: number, nextLng: number, source: PickerSource, nextAddress: string, nextArea: string) => {
      const value = { lat: coord(nextLat), lng: coord(nextLng) };
      lastCommitted.current = `${value.lat},${value.lng}`;
      setAddress(nextAddress);
      onChange({ ...value, source, address: nextAddress, area: nextArea });
    },
    [onChange],
  );

  /**
   * Ask the SERVER what address sits at this pin. Failure is silent on purpose:
   * the coordinate is what the delivery actually needs, the text is a courtesy.
   */
  const resolveAddress = useCallback(
    async (pLat: number, pLng: number, source: PickerSource) => {
      const seq = ++reverseSeq.current;
      try {
        const res = await fetch("/api/geo/reverse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: pLat, lng: pLng }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { result: Suggestion | null };
        if (seq !== reverseSeq.current || !data.result) return;
        commit(pLat, pLng, source, data.result.address, data.result.area);
      } catch {
        /* keep the coordinate; the address stays blank */
      }
    },
    [commit],
  );

  /** A pin the customer placed by hand — committed first, named afterwards. */
  const setPin = useCallback(
    (pLat: number, pLng: number, source: PickerSource) => {
      commit(pLat, pLng, source, "", "");
      markerRef.current?.setPosition({ lat: pLat, lng: pLng });
      mapRef.current?.panTo({ lat: pLat, lng: pLng });
      void resolveAddress(pLat, pLng, source);
    },
    [commit, resolveAddress],
  );

  // Latest point + pin handler, read by the map-construction effect below.
  // Kept in refs (written AFTER render, never during) so that effect can depend
  // on the SDK alone — otherwise every coordinate change, or a parent that
  // passes an inline onChange, would tear the whole map down and rebuild it.
  const pointRef = useRef<{ lat: number; lng: number } | null>(null);
  const setPinRef = useRef(setPin);
  // `t` is a fresh closure on every render; keeping it in a ref stops the
  // debounced search effect from restarting its timer whenever the PARENT
  // re-renders (typing in the address box would otherwise cancel the search).
  const tRef = useRef(t);
  useEffect(() => {
    pointRef.current = pointValid ? { lat: numLat, lng: numLng } : null;
    setPinRef.current = setPin;
    tRef.current = t;
  });

  // Build the map ONCE the SDK is ready and the container is mounted.
  useEffect(() => {
    if (!maps || !containerRef.current || mapRef.current) return;
    const start = pointRef.current;
    const center = start ?? { lat: 23.8103, lng: 90.4125 };
    const map = new maps.Map(containerRef.current, {
      center,
      zoom: start ? DEFAULT_ZOOM : 12,
      // A phone map needs a clean, finger-friendly surface: no street view peg,
      // no map-type switcher, gestures that never fight the page scroll.
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: "greedy",
      clickableIcons: false,
    });
    const marker = new maps.Marker({ position: center, map, draggable: true });
    mapRef.current = map;
    markerRef.current = marker;
    listenersRef.current = [
      map.addListener("click", (e) => {
        const p = e.latLng;
        if (p) setPinRef.current(p.lat(), p.lng(), "map_pin");
      }),
      marker.addListener("dragend", () => {
        const p = markerRef.current?.getPosition();
        if (p) setPinRef.current(p.lat(), p.lng(), "map_pin");
      }),
    ];
    return () => {
      for (const listener of listenersRef.current) listener.remove();
      listenersRef.current = [];
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
    };
  }, [maps]);

  // Keep the pin in sync when the PARENT changes the coordinates (e.g. the
  // customer picked a different saved address at checkout).
  useEffect(() => {
    if (!pointValid || !mapRef.current || !markerRef.current) return;
    const key = `${coord(numLat)},${coord(numLng)}`;
    if (key === lastCommitted.current) return;
    lastCommitted.current = key;
    markerRef.current.setPosition({ lat: numLat, lng: numLng });
    mapRef.current.panTo({ lat: numLat, lng: numLng });
    mapRef.current.setZoom(Math.max(mapRef.current.getZoom() ?? DEFAULT_ZOOM, DEFAULT_ZOOM));
  }, [numLat, numLng, pointValid]);

  // Debounced address search against our own endpoint (the Google key stays on
  // the server). 450 ms is deliberately unhurried — every keystroke on a metered
  // prepaid connection costs the customer money.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      // Clearing a stale suggestion list is part of syncing with the external
      // search; nothing is rendered from it until the next answer arrives.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await fetch("/api/geo/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
        });
        if (!alive) return;
        if (!res.ok) {
          setResults([]);
          setSearchError(tRef.current("mapPicker.searchError"));
          return;
        }
        const data = (await res.json()) as { results: Suggestion[]; demo: boolean };
        if (!alive) return;
        setResults(data.results ?? []);
        setDemoResults(Boolean(data.demo));
      } catch {
        if (alive) setSearchError(tRef.current("mapPicker.searchError"));
      } finally {
        if (alive) setSearching(false);
      }
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  function chooseSuggestion(s: Suggestion) {
    commit(s.lat, s.lng, "map_pin", s.address, s.area);
    markerRef.current?.setPosition({ lat: s.lat, lng: s.lng });
    mapRef.current?.panTo({ lat: s.lat, lng: s.lng });
    mapRef.current?.setZoom(DEFAULT_ZOOM);
    setResults([]);
    setQuery(s.label);
  }

  /**
   * Browser GPS. On a customer screen the fix is ALSO saved to the account
   * (`/api/customer/location`), which is what makes a `device_gps` delivery
   * coordinate verifiable server-side later — the failure is swallowed because
   * a rejected fix must not stop the customer choosing a place.
   */
  function useMyLocation() {
    setGeoError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoError(t("location.errUnsupported"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude, accuracy } = pos.coords;
        setPin(latitude, longitude, "device_gps");
        if (persistGps) {
          void fetch("/api/customer/location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: latitude, lng: longitude, accuracy, captured_at: pos.timestamp }),
          }).catch(() => {});
        }
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) setGeoError(t("location.errDenied"));
        else if (err.code === err.POSITION_UNAVAILABLE) setGeoError(t("location.errUnavailable"));
        else if (err.code === err.TIMEOUT) setGeoError(t("location.errTimeout"));
        else setGeoError(t("location.errSave"));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  /** Manual decimal entry — the documented degraded path, never the default. */
  function onManualChange(nextLat: string, nextLng: string) {
    const a = Number(nextLat);
    const b = Number(nextLng);
    const valid = nextLat.trim() !== "" && nextLng.trim() !== "" && Number.isFinite(a) && Number.isFinite(b);
    lastCommitted.current = valid ? `${coord(a)},${coord(b)}` : "";
    // Typed digits vouch for nothing, so the claim is "unverified" — the server
    // still re-derives the real provenance and may well upgrade it. Callers also
    // use this source to tell hand-typing apart from a deliberate pin (checkout
    // does not re-run its coverage call on every keystroke).
    onChange({ lat: nextLat, lng: nextLng, source: "unverified", address: "", area: "" });
    if (valid) {
      markerRef.current?.setPosition({ lat: a, lng: b });
      mapRef.current?.panTo({ lat: a, lng: b });
    }
  }

  // Manual entry appears when the customer asks for it, and ALWAYS when there
  // is no usable map — in that case it is the primary control, so it is visible
  // without opening anything (a collapsed picker with no map behind it would be
  // a dead end on an installation with no Maps key).
  const showManual = manual || mapFailed;
  const manualVisible = showManual && (open || mapFailed);
  const manualBlock = (
    <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid={`${testId}-manual`}>
      <Field label={t("addresses.latField")} name={latName} error={latError}>
        <Input
          name={latName}
          inputMode="decimal"
          value={lat}
          onChange={(e) => onManualChange(e.target.value, lng)}
          placeholder="23.79"
          data-testid={latTestId ?? `${testId}-lat`}
        />
      </Field>
      <Field label={t("addresses.lngField")} name={lngName} error={lngError}>
        <Input
          name={lngName}
          inputMode="decimal"
          value={lng}
          onChange={(e) => onManualChange(lat, e.target.value)}
          placeholder="90.41"
          data-testid={lngTestId ?? `${testId}-lng`}
        />
      </Field>
    </div>
  );

  return (
    <div className={cn("rounded-xl border border-border-strong p-4", className)} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-base">{label}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          data-testid={`${testId}-toggle`}
        >
          {open ? t("mapPicker.close") : t("mapPicker.open")}
        </Button>
      </div>
      {hint ? <p className="mt-1 text-xs text-fg-subtle">{hint}</p> : null}

      {/* The chosen place, always visible — this is what the customer is
          confirming, so it must not hide inside the collapsed picker. */}
      <div className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-sm" role="status" aria-live="polite" data-testid={`${testId}-selected`}>
        {pointValid ? (
          <>
            <p className="font-medium text-fg-base">{address || t("mapPicker.selected")}</p>
            <p className="text-xs text-fg-subtle">{t("mapPicker.coordinates", { lat: coord(numLat), lng: coord(numLng) })}</p>
          </>
        ) : (
          <p className="text-fg-muted">{t("mapPicker.noneSelected")}</p>
        )}
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          {/* Search — server-geocoded, so it works with or without a map. */}
          <div>
            <Field label={t("mapPicker.searchLabel")} name={`${testId}-search`}>
              <Input
                type="search"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // The picker lives INSIDE a form; Enter must pick a place, not
                // submit the order. The list updates on its own as you type.
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (results[0]) chooseSuggestion(results[0]);
                }}
                placeholder={t("mapPicker.searchPlaceholder")}
                data-testid={`${testId}-search`}
              />
            </Field>
            {searching ? <p className="mt-1 text-xs text-fg-subtle">{t("mapPicker.searching")}</p> : null}
            <FieldError id={`${testId}-search-error`} message={searchError} />
            {results.length > 0 ? (
              <ul className="mt-2 divide-y divide-border-base overflow-hidden rounded-lg border border-border-base" data-testid={`${testId}-results`}>
                {results.map((s) => (
                  <li key={`${s.lat},${s.lng},${s.label}`}>
                    {/* min-h-11: a real finger target, not an 18px text link. */}
                    <button
                      type="button"
                      onClick={() => chooseSuggestion(s)}
                      className="flex min-h-11 w-full flex-col justify-center px-3 py-2 text-left hover:bg-surface-hover"
                    >
                      <span className="text-sm font-medium text-fg-base">{s.label}</span>
                      <span className="truncate text-xs text-fg-subtle">{s.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {demoResults && results.length > 0 ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t("mapPicker.demoResults")}</p>
            ) : null}
            {!searching && query.trim().length >= 3 && results.length === 0 && !searchError ? (
              <p className="mt-1 text-xs text-fg-subtle">{t("mapPicker.noResults")}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={useMyLocation} disabled={locating} data-testid={`${testId}-gps`}>
              {locating ? <Spinner className="size-4" /> : null}
              {locating ? t("mapPicker.locating") : t("location.enable")}
            </Button>
            {!mapFailed ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setManual((v) => !v)} data-testid={`${testId}-manual-toggle`}>
                {manual ? t("mapPicker.manualHide") : t("mapPicker.manualToggle")}
              </Button>
            ) : null}
          </div>
          <FieldError id={`${testId}-geo-error`} message={geoError} />

          {/* The map itself — mounted only when the SDK actually loaded. */}
          {hasKey && !mapFailed ? (
            <div className="relative">
              <div
                ref={containerRef}
                className="h-64 w-full rounded-xl border border-border-base sm:h-80"
                data-testid={`${testId}-canvas`}
              />
              {status !== "ready" ? (
                <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-surface-muted text-sm text-fg-muted">
                  <Spinner className="size-4" /> {t("mapPicker.loading")}
                </div>
              ) : null}
              <p className="mt-1 text-xs text-fg-subtle">{t("mapPicker.dragHint")}</p>
            </div>
          ) : (
            // The polished placeholder .env.example promises: an explanation and
            // working alternatives, never a blank grey box.
            <div className="rounded-xl bg-surface-muted p-4 text-center" data-testid={`${testId}-fallback`}>
              <span className="text-2xl" aria-hidden="true">🗺️</span>
              <p className="mt-1 text-sm text-fg-muted">
                {status === "error" ? t("mapPicker.loadError") : t("mapPicker.demoNotice")}
              </p>
            </div>
          )}

          {open && manualVisible ? manualBlock : null}
        </div>
      ) : null}

      {/* No map on this installation: the degraded path is the MAIN control and
          stays on screen, clearly labelled, instead of hiding behind a toggle. */}
      {!open && manualVisible ? (
        <>
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400" data-testid={`${testId}-degraded`}>
            {t("mapPicker.manualNotice")}
          </p>
          {manualBlock}
        </>
      ) : null}

      {/* The coordinates stay in the form payload even while the manual inputs
          are hidden, so the surrounding validation rules keep seeing them. */}
      {!manualVisible ? (
        <>
          <input type="hidden" name={latName} value={lat} />
          <input type="hidden" name={lngName} value={lng} />
        </>
      ) : null}
      {/* With the manual inputs hidden the coordinate error has no field to sit
          under, so it is shown once here instead — never twice. */}
      {!manualVisible && (latError || lngError) ? (
        <FieldError id={`${testId}-error`} message={latError ?? lngError ?? null} />
      ) : null}
    </div>
  );
}
