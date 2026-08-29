/**
 * Canonical Bangladeshi mobile number for AUTHENTICATION.
 *
 * Customers type the same number many ways — `01711111111`, `8801711111111`,
 * `+880 1711-111111`, `1711111111`. `User.phone` stores exactly one shape, the
 * local `01XXXXXXXXX` form validated by BD_PHONE_RE, so every login lookup and
 * every write of a phone number must pass through this function or the two
 * sides silently disagree and the account becomes unreachable by phone.
 *
 * `lib/validation/server.ts` already exports `normalizeBdPhoneForSearch`, but
 * that one reduces a number to its national significant digits for a `contains`
 * search — deliberately lossy and unusable as an exact lookup key. This is its
 * exact-match counterpart.
 *
 * CLIENT-SAFE: pure string work, no database access, no secrets.
 */

import { BD_PHONE_RE } from "@/lib/validation/limits";

/**
 * Reduce any written form of a BD mobile number to `01XXXXXXXXX`.
 * Returns "" when the input is not a valid BD mobile number — callers must
 * treat "" as "not a phone number" and never as a lookup value, because
 * `User.phone` defaults to "" for the many accounts that have none.
 */
export function normalizeBdPhone(raw: string): string {
  // Digits only — drops +, spaces, dashes, parentheses.
  let digits = String(raw ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  // Strip the country code in either written form.
  if (digits.startsWith("00880")) digits = digits.slice(5);
  else if (digits.startsWith("880")) digits = digits.slice(3);
  // Give back the trunk zero when the number was typed without it.
  if (!digits.startsWith("0")) digits = `0${digits}`;
  return BD_PHONE_RE.test(digits) ? digits : "";
}

/** True when the raw input is a BD mobile number in any accepted written form. */
export function isBdPhone(raw: string): boolean {
  return normalizeBdPhone(raw) !== "";
}
