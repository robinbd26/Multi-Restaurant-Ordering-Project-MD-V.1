import "server-only";

import { rateLimit, type RateLimitResult } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/auth/request-info";

/**
 * Per-IP throttling for PUBLIC customer registration (SECURITY.md §9 gap #3),
 * enforced at two layers because they see DIFFERENT client IPs:
 *
 *   • `registerAction` (lib/auth/actions.ts) — the browser form's server
 *     action. Its request scope carries the REAL client IP, so this is where
 *     the genuine per-visitor budget lives. It also covers bots that drive the
 *     server-action endpoint directly.
 *   • `app/api/auth/register/customer/route.ts` — the public REST route. A
 *     direct POST arrives with the caller's real IP (via the trusted proxy),
 *     but the browser flow reaches this route through an INTERNAL
 *     server-to-server fetch (lib/api/client `sendForm`), which does not
 *     forward the original client address — every form registration therefore
 *     aliases to the server's own IP at this layer. The route budget is sized
 *     so that shared bucket doubles as a sane GLOBAL flood ceiling while still
 *     capping direct-POST bots per address. Forwarding the real client IP on
 *     internal fetches would let this tighten — noted as a follow-up.
 *
 * Registration has no account to enumerate, so unlike login an honest 429
 * "try again in n seconds" is safe at both layers. Every attempt counts,
 * including invalid ones, and the check runs before any database work.
 *
 * Per-instance like every limiter in lib/auth/rate-limit.ts (documented Redis
 * swap point there); with N instances the effective allowance is limit × N.
 */

/**
 * 10 attempts / hour per real client IP: a family — or a shared-office NAT in
 * Dhaka signing up a handful of people over lunch — fits comfortably, while a
 * bot farming accounts from one address is capped at ~240 attempts/day.
 */
const FORM_IP_LIMIT = 10;
const FORM_IP_WINDOW_MS = 60 * 60 * 1000;

/**
 * 30 attempts / 15 min per observed IP at the route: caps a direct-POST bot at
 * ~120 attempts/hour/address, and — because form traffic aliases to one bucket
 * here (see header) — bounds GLOBAL form registrations at ~120/hour, well
 * above any legitimate signup rate this single-VPS deployment will see.
 */
const ROUTE_IP_LIMIT = 30;
const ROUTE_IP_WINDOW_MS = 15 * 60 * 1000;

/** Count one registration attempt at the server-action layer (real client IP). */
export async function throttleRegistrationForm(): Promise<RateLimitResult> {
  const ip = await clientIp();
  return rateLimit(`register:form:${ip}`, FORM_IP_LIMIT, FORM_IP_WINDOW_MS);
}

/** Count one registration attempt at the public-route layer (observed IP). */
export async function throttleRegistrationRoute(): Promise<RateLimitResult> {
  const ip = await clientIp();
  return rateLimit(`register:ip:${ip}`, ROUTE_IP_LIMIT, ROUTE_IP_WINDOW_MS);
}
