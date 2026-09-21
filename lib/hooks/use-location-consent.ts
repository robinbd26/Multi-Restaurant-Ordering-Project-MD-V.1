"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The visitor's answer to OUR location card — not the browser's permission.
 *
 * A page cannot force the native geolocation prompt, and a browser that already
 * holds a denial will not show it again, so the site asks first in its own
 * words and only calls the real API after "Accept". The answer is remembered so
 * the card is never shown twice and nothing auto-fires the native prompt for a
 * visitor who never agreed to it.
 *
 * Kept in localStorage (per browser, like the cart) — it is a UX preference,
 * not a security decision: the server never trusts it.
 */
export type LocationConsent = "unknown" | "accepted" | "rejected";

const KEY = "mad-location-consent";
const EVENT = "mad-location-consent-change";

function read(): LocationConsent {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "accepted" || raw === "rejected" ? raw : "unknown";
  } catch {
    return "unknown"; // storage blocked — behave as "never asked"
  }
}

export function writeLocationConsent(value: Exclude<LocationConsent, "unknown">): void {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* storage blocked — the answer simply is not remembered */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** The stored answer; "unknown" during SSR and until the browser has been read. */
export function useLocationConsent(): { consent: LocationConsent; accept: () => void; reject: () => void } {
  const consent = useSyncExternalStore(subscribe, read, () => "unknown" as const);
  const accept = useCallback(() => writeLocationConsent("accepted"), []);
  const reject = useCallback(() => writeLocationConsent("rejected"), []);
  return { consent, accept, reject };
}

/**
 * What the browser itself currently holds for geolocation. "denied" means the
 * native prompt can never be shown again from script — the caller must fall
 * back (saved address / manual pick). "unknown" covers browsers without the
 * Permissions API (older Safari): the prompt is then simply attempted.
 */
export async function browserGeolocationPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}
