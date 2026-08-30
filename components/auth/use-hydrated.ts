"use client";

import { useSyncExternalStore } from "react";

/** The value flips exactly once, at hydration, so there is nothing to notify. */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * False on the server and during the hydration pass, true afterwards.
 *
 * The check a PROGRESSIVE-ENHANCEMENT control uses to decide whether it can do
 * anything at all: a "suggest a password" button that cannot fill a field is
 * worse than no button, so the enhanced UI is not rendered until the code
 * behind it is actually running.
 *
 * Deliberately not setState-in-an-effect — "has this tree hydrated?" is state
 * outside React, which is exactly what useSyncExternalStore is for (the same
 * reason components/providers/theme-provider reads the DOM through it).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
