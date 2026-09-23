import { NIGHT_END_MINUTES, NIGHT_START_MINUTES, coverageWindowAt } from "@/lib/services/coverage-window";
import { nowMinutesInDhaka } from "@/lib/services/branch-hours";

/**
 * BRANCH-LEVEL "PAUSE DELIVERY" — the branch manager's short-term brake.
 *
 * Distinct from both existing holds: the super admin's `isActive` closes the
 * branch, the manager's `isOnHold` stops every new order, and this stops
 * DELIVERY ONLY. Pickup stays open throughout, because "our riders are swamped"
 * is not "we are closed".
 *
 * IT EXPIRES BY ITSELF. A pause carries the instant it runs out and every read
 * compares that instant to now, so nothing has to run on a schedule and a pause
 * cannot get stuck on because a worker died. `until_resumed` is the one mode
 * with no end: a human has to lift it.
 */

export const DELIVERY_PAUSE_MODES = ["30m", "1h", "shift", "until_resumed"] as const;
export type DeliveryPauseMode = (typeof DELIVERY_PAUSE_MODES)[number];

export function isDeliveryPauseMode(value: unknown): value is DeliveryPauseMode {
  return typeof value === "string" && (DELIVERY_PAUSE_MODES as readonly string[]).includes(value);
}

/** The minimum a branch row must expose for the pause question. */
export interface DeliveryPauseState {
  deliveryPauseMode: string;
  deliveryPausedUntil: Date | null;
}

/**
 * Is delivery paused at `now`?
 *
 * An elapsed `deliveryPausedUntil` reads as NOT paused without anything being
 * written back — the row is tidied the next time the manager touches it. An
 * unrecognised mode reads as not paused: a pause that nothing can lift would
 * strand a branch on pickup forever.
 */
export function isDeliveryPaused(branch: DeliveryPauseState, now: Date = new Date()): boolean {
  if (!isDeliveryPauseMode(branch.deliveryPauseMode)) return false;
  if (branch.deliveryPauseMode === "until_resumed") return branch.deliveryPausedUntil == null;
  if (branch.deliveryPausedUntil == null) return false;
  return branch.deliveryPausedUntil.getTime() > now.getTime();
}

/**
 * When a pause started now would end. Null means "until a human resumes it".
 *
 * "Rest of the current shift" uses the SAME day/night boundaries coverage does
 * (lib/services/coverage-window.ts), so a pause and the coverage lists it
 * suspends can never disagree about when the shift ends: the night shift ends
 * at 04:00, the day shift at 22:45.
 *
 * Note the quiet stretch: 04:00–11:00 resolves to the DAY shift (that is the
 * list a customer browses before opening time), so a pause started at, say,
 * 05:00 runs to 22:45. That is long on the clock but not in practice — the
 * whole platform refuses orders until 11:00 anyway, so the only hours it
 * actually suspends are the day shift's own.
 */
export function pauseEndsAt(mode: DeliveryPauseMode, now: Date = new Date()): Date | null {
  if (mode === "until_resumed") return null;
  if (mode === "30m") return new Date(now.getTime() + 30 * 60_000);
  if (mode === "1h") return new Date(now.getTime() + 60 * 60_000);

  // "shift": run to the end of the shift running right now, in Dhaka.
  const minutes = nowMinutesInDhaka(now);
  const endMinutes = coverageWindowAt(minutes) === "night" ? NIGHT_END_MINUTES : NIGHT_START_MINUTES;
  // Minutes until that boundary, wrapping past midnight when it is behind us.
  let delta = endMinutes - minutes;
  if (delta <= 0) delta += 24 * 60;
  return new Date(now.getTime() + delta * 60_000);
}
