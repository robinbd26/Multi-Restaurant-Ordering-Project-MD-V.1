import "server-only";

/**
 * Fixed-window rate limiter for the UNAUTHENTICATED auth endpoints (password
 * reset request/confirm, OTP request/verify).
 *
 * In-process on purpose: the app ships with zero infrastructure dependencies
 * (the demo-fallback philosophy documented in .env.example) and the default
 * deployment is a single Node process. On a MULTI-INSTANCE deploy each instance
 * keeps its own counters, so the effective allowance becomes `limit ×
 * instances` — replace the Map with Redis/Upstash there. Counters are also lost
 * on restart, which is acceptable for a UX/abuse guard but is not a security
 * boundary on its own: the token/OTP checks below it are.
 */

interface Window {
  count: number;
  /** Epoch ms at which the window rolls over. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Hard ceiling so a flood of unique keys cannot grow the map without limit. */
const MAX_KEYS = 5000;

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in the current window (0 once limited). */
  remaining: number;
  /** Seconds until the window resets — 0 when the request was allowed. */
  retryAfter: number;
}

/**
 * Count one attempt against `key` and report whether it is allowed.
 *
 * IMPORTANT for the enumeration-safe flows: callers must count EVERY attempt,
 * including ones for accounts that do not exist. A limiter that only counts
 * real accounts is itself an account-existence oracle.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_KEYS) sweep(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, limit - 1), retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { ok: true, remaining: Math.max(0, limit - existing.count), retryAfter: 0 };
}

/** Forget a key — e.g. after a successful verification, so a user is not punished. */
export function clearRateLimit(key: string): void {
  windows.delete(key);
}

/**
 * Give back ONE previously counted attempt — for wide shared buckets (e.g. a
 * per-IP ceiling) where a SUCCESSFUL attempt should not consume the budget but
 * clearing the whole bucket would also forgive every failure in it. If the
 * window rolled over in between, the refund lands in the fresh window (or
 * nowhere); that slight looseness only ever makes the limiter more permissive
 * by a single count, never stricter.
 */
export function refundRateLimit(key: string): void {
  const existing = windows.get(key);
  if (existing && existing.count > 0) existing.count -= 1;
}

/** Drop expired windows; if they were all live, drop the soonest-expiring slice. */
function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  if (windows.size < MAX_KEYS) return;
  const oldest = [...windows.entries()]
    .sort((a, b) => a[1].resetAt - b[1].resetAt)
    .slice(0, Math.ceil(MAX_KEYS / 10));
  for (const [key] of oldest) windows.delete(key);
}
