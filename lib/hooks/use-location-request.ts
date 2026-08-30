"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

/**
 * ONE client-side live-location flow, shared by everything that lets a customer
 * share their GPS (the location card, the homepage branch bar, the branches-page
 * gate). Before this hook the exact same getCurrentPosition → POST
 * /api/customer/location → router.refresh() sequence was copy-pasted in two
 * places and drifting; §22 forbids a second competing location system, so the
 * sequence lives here and callers only map the resulting `phase` to their own
 * wording. No client-side distance/branch maths: the server re-resolves on refresh.
 *
 * WS-4.9 adds `savePin` for a point the customer placed by hand on the map.
 * It is deliberately the same save path — a second fetch + refresh sequence
 * living in the location card is exactly what §22 exists to prevent.
 */

export type LocationPhase =
  | "idle"
  | "requesting"
  | "saving"
  | "saved"
  | "lowaccuracy"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported"
  | "error";

export interface LocationFix {
  lat: number;
  lng: number;
  /** Metres, from the device. Always null for a hand-placed pin. */
  accuracy: number | null;
  /** WS-4.9 — a dragged pin is not a device reading and never claims to be. */
  source: "device_gps" | "map_pin";
}

/** Above this (metres) the fix is still saved but flagged coarse (req #12). */
export const LOW_ACCURACY_M = 100;

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 };

export interface UseLocationRequest {
  /** Kick off a location request. Safe to call from an effect or a click. */
  request: () => void;
  /**
   * WS-4.9 — save a point the customer placed by hand (dragged pin, tapped map,
   * chosen search result, typed coordinates in the no-key fallback). Same
   * endpoint, same phases; no geolocation call and no accuracy.
   */
  savePin: (lat: number, lng: number) => void;
  phase: LocationPhase;
  /** requesting || saving — for disabling buttons. */
  busy: boolean;
  /** Parsed save/permission error text when phase === "error"; null otherwise. */
  saveError: string | null;
  /** The most recent successfully-saved fix, for status display. */
  fix: LocationFix | null;
}

export function useLocationRequest(opts?: {
  /** Runs after a fix is saved (before the route refresh), for local UI state. */
  onSaved?: (fix: LocationFix) => void;
  /** Refresh the current route on success so the server re-resolves. Default true. */
  refresh?: boolean;
}): UseLocationRequest {
  const router = useRouter();
  const { t } = useTranslation();
  const [phase, setPhase] = useState<LocationPhase>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fix, setFix] = useState<LocationFix | null>(null);
  // Latest opts without making `request` identity depend on them (so an auto-fire
  // effect keyed on `request` doesn't re-run when a parent re-renders). The ref is
  // seeded with the initial opts and refreshed AFTER each render (never written
  // during render — that would violate react-hooks/refs); `request`'s async
  // callbacks always run post-commit, so they read the current opts.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  /**
   * The POST + phase mapping, shared by the GPS flow and the hand-placed pin so
   * §22 still holds: one endpoint, one error path, one refresh. `capturedAt` is
   * the browser's own reading time — a pin has none, and the server stamps its
   * own time in that case.
   */
  async function persist(saved: LocationFix, capturedAt: number | null) {
    setPhase("saving");
    try {
      const res = await fetch("/api/customer/location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lat: saved.lat,
          lng: saved.lng,
          accuracy: saved.accuracy,
          captured_at: capturedAt,
          source: saved.source,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSaveError(parseFieldErrors(body, t("location.errSave")).formError);
        setPhase("error");
        return;
      }
      setFix(saved);
      optsRef.current?.onSaved?.(saved);
      setPhase(saved.accuracy != null && saved.accuracy > LOW_ACCURACY_M ? "lowaccuracy" : "saved");
      if (optsRef.current?.refresh !== false) router.refresh();
    } catch {
      setSaveError(t("location.errSave"));
      setPhase("error");
    }
  }

  function savePin(lat: number, lng: number) {
    setSaveError(null);
    // No accuracy: a pin the customer dragged has no metre-precision to quote,
    // and inventing one would let it masquerade as a device reading.
    void persist({ lat, lng, accuracy: null, source: "map_pin" }, null);
  }

  function request() {
    setSaveError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setPhase("unsupported");
      return;
    }
    setPhase("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        void persist(
          { lat: latitude, lng: longitude, accuracy: accuracy ?? null, source: "device_gps" },
          pos.timestamp,
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setPhase("denied");
        else if (err.code === err.POSITION_UNAVAILABLE) setPhase("unavailable");
        else if (err.code === err.TIMEOUT) setPhase("timeout");
        else setPhase("error");
      },
      GEO_OPTIONS,
    );
  }

  return { request, savePin, phase, busy: phase === "requesting" || phase === "saving", saveError, fix };
}
