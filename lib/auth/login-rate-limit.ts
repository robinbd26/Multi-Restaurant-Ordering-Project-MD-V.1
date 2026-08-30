import "server-only";

import { rateLimit, clearRateLimit, refundRateLimit } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/auth/request-info";

/**
 * Rate limiting for the PASSWORD login path (SECURITY.md §9 gap #2).
 *
 * One shared implementation, enforced at BOTH layers a password guess can
 * reach:
 *
 *   1. `loginAction` (lib/auth/actions.ts) — the browser form. Its own
 *      `bcrypt.compare` pre-check runs BEFORE `signIn()`, so throttling only
 *      the provider would leave the action an unthrottled guessing oracle.
 *   2. The Credentials `authorize` in auth.ts — the true boundary, which a
 *      direct POST to /api/auth/callback/credentials reaches without ever
 *      touching the server action.
 *
 * The check must run BEFORE the account lookup and must count EVERY attempt,
 * including ones for identifiers that name no account — a limiter that only
 * counts real accounts is itself an account-existence oracle. For the same
 * reason a limited attempt is reported to the caller as a plain
 * invalid-credentials failure, never as a distinct "slow down for THIS
 * account" message.
 *
 * SUCCESS IS FREE: `noteLoginSuccess` clears the identifier bucket and refunds
 * the per-IP count, so only FAILED guesses spend budget. That is what lets the
 * per-IP ceiling stay tight without starving a shared-office NAT (or the e2e
 * suite, which performs hundreds of legitimate logins from one address).
 *
 * NO LOCKOUT, by design: an attacker who can lock an account by guessing at it
 * has a free denial-of-service against any customer whose phone number they
 * know. Throttling caps the guess rate without handing that weapon over.
 *
 * Same per-instance constraint as every limiter in lib/auth/rate-limit.ts:
 * counters are per Node process — swap the Map for Redis before scaling out.
 */

/**
 * 10 attempts / 5 min per identifier+IP: a real person mistyping a password
 * retries a handful of times; 10 in five minutes absorbs that (and a success
 * clears the bucket) while capping an online brute force of ONE account from
 * ONE address at ~120 guesses/hour — useless against the 8+ character policy.
 */
const IDENTIFIER_LIMIT = 10;
const IDENTIFIER_WINDOW_MS = 5 * 60 * 1000;

/**
 * 100 FAILED attempts / 15 min per IP (successes are refunded — see header):
 * the wider net for an attacker cycling identifiers from one address, capping
 * a spray-across-accounts attack at ~400 guesses/hour/IP. Deliberately
 * generous because a shared-office or campus NAT in Dhaka presents dozens of
 * users as ONE IP — 100 genuine typos per 15 minutes across a whole office is
 * far beyond normal, so real users behind the NAT never feel this ceiling.
 */
const IP_LIMIT = 100;
const IP_WINDOW_MS = 15 * 60 * 1000;

/** One canonical key so the action and the provider share a bucket shape. */
function identifierKey(identifier: string, ip: string): string {
  return `login:${identifier.trim().toLowerCase()}|${ip}`;
}

/**
 * Count one password-login attempt for `identifier` from the calling request's
 * IP. Returns false when the attempt must be refused (report that refusal as a
 * generic invalid-credentials failure — see header note).
 */
export async function registerLoginAttempt(identifier: string): Promise<boolean> {
  const ip = await clientIp();
  const perIdentifier = rateLimit(identifierKey(identifier, ip), IDENTIFIER_LIMIT, IDENTIFIER_WINDOW_MS);
  const perIp = rateLimit(`login:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  return perIdentifier.ok && perIp.ok;
}

/**
 * A login SUCCEEDED: forget the identifier-scoped bucket (a household of
 * forgetful-but-legitimate users must not stay locked behind their own typos)
 * and hand back the one per-IP count this attempt spent, so the per-IP ceiling
 * meters failures only. Callers invoke this once per attempt they counted.
 */
export async function noteLoginSuccess(identifier: string): Promise<void> {
  const ip = await clientIp();
  clearRateLimit(identifierKey(identifier, ip));
  refundRateLimit(`login:ip:${ip}`);
}
