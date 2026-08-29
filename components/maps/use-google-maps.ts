"use client";

import { useEffect, useState } from "react";

import type { GoogleMapsApi } from "./google-maps-types";

/**
 * WS-4.1 — lazy loader for the Google Maps JS SDK.
 *
 * 3G RULE: the SDK is ~500 KB of JavaScript and is NEVER part of the page load.
 * The script tag is injected the first time a picker is actually opened, and the
 * injected script is then shared by every picker on the page (one module-level
 * promise), so opening a second picker costs nothing.
 *
 * `enabled` is what gates the load — pass `false` until the customer taps
 * "choose on map". With no key, or when Google rejects the key, the hook
 * reports "unavailable"/"error" and the caller falls back to manual entry
 * (the .env.example promise: a polished fallback, never a blank grey box).
 */

export type MapsStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

/** The browser-side tile key. Empty string = maps not configured (demo mode). */
export function mapsApiKey(): string {
  // Must stay a full static reference — Next inlines NEXT_PUBLIC_* only when it
  // can see the whole expression at build time.
  return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "").trim();
}

const CALLBACK_NAME = "__madGoogleMapsReady";
const SCRIPT_ID = "mad-google-maps-sdk";

let loader: Promise<GoogleMapsApi> | null = null;

function loadSdk(key: string, language: string): Promise<GoogleMapsApi> {
  if (loader) return loader;
  loader = new Promise<GoogleMapsApi>((resolve, reject) => {
    const existing = window.google?.maps;
    if (existing) {
      resolve(existing);
      return;
    }
    window[CALLBACK_NAME] = () => {
      const api = window.google?.maps;
      if (api) resolve(api);
      else reject(new Error("maps-callback-without-api"));
    };
    // An invalid/unauthorised key does not fail the request — Google loads and
    // then calls gm_authFailure. Without this hook the customer would stare at
    // a grey rectangle forever instead of getting the manual fallback.
    window.gm_authFailure = () => reject(new Error("maps-auth-failure"));

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    const params = new URLSearchParams({
      key,
      v: "weekly",
      language,
      region: "BD",
      loading: "async",
      callback: CALLBACK_NAME,
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.onerror = () => reject(new Error("maps-script-error"));
    document.head.appendChild(script);
  }).catch((err) => {
    // Let a later attempt retry from scratch (e.g. the customer regained
    // connectivity) instead of caching the failure for the whole session.
    loader = null;
    document.getElementById(SCRIPT_ID)?.remove();
    throw err;
  });
  return loader;
}

export function useGoogleMaps(enabled: boolean, language: string): { status: MapsStatus; maps: GoogleMapsApi | null } {
  const key = mapsApiKey();
  const [status, setStatus] = useState<MapsStatus>(key ? "idle" : "unavailable");
  const [maps, setMaps] = useState<GoogleMapsApi | null>(null);

  useEffect(() => {
    // No key and nothing to load: the initial state is already "unavailable".
    if (!key || !enabled || maps) return;
    let alive = true;
    // Synchronising with an EXTERNAL system (the injected SDK) — the sanctioned
    // use of an effect; the flag has to flip before the network request starts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    loadSdk(key, language)
      .then((api) => {
        if (!alive) return;
        setMaps(api);
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [enabled, key, language, maps]);

  return { status, maps };
}
