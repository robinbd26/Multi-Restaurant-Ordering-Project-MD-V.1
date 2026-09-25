/**
 * Above this many metres a DEVICE fix is only a guess at the neighbourhood.
 * Desktop browsers without GPS locate by network, and report ±5 km, ±50 km or
 * worse. That can sit in another city entirely, which picked the wrong nearest
 * branch and the wrong coverage verdict.
 *
 * Such a fix is still stored, and shown to the customer as "approximate", but
 * the server does not use it to pick a branch or check coverage until the
 * customer confirms it or moves the pin (which saves a hand-placed pin with
 * no accuracy figure). Shared by server and client so both draw the line at
 * the same place.
 */
export const APPROXIMATE_FIX_M = 1000;

/** True for a device reading too coarse to decide anything with. */
export function isApproximateFix(accuracyM: number | null | undefined): boolean {
  return accuracyM != null && Number.isFinite(accuracyM) && accuracyM > APPROXIMATE_FIX_M;
}

/** Metres → whole kilometres for the "±N km" wording (never below 1). */
export function accuracyKm(accuracyM: number): number {
  return Math.max(1, Math.round(accuracyM / 1000));
}
