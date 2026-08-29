import "server-only";
import { headers } from "next/headers";

/**
 * Caller identity taken from the REQUEST, never from the form body — an IP or
 * origin supplied by the client is an attacker-controlled value and would make
 * both the rate limiter and the reset link trivially bypassable/forgeable.
 */

/** Best-effort client IP for rate-limit keys and the reset-token audit column. */
export function clientIpFromHeaders(h: Headers): string {
  // The left-most X-Forwarded-For entry is the original client when the reverse
  // proxy in front of the app is the one appending it (see AUTH_TRUST_HOST /
  // the proxy notes in .env.example).
  const forwarded = h.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || h.get("x-real-ip") || "";
}

/**
 * Same, for server actions / server components (no Request object in hand).
 *
 * Falls back to "" rather than throwing when there is no request scope (Auth.js
 * can invoke a provider's `authorize` outside one): a missing IP degrades the
 * rate-limit key to a shared bucket, which is stricter, never looser.
 */
export async function clientIp(): Promise<string> {
  try {
    return clientIpFromHeaders(await headers());
  } catch {
    return "";
  }
}

/** Absolute origin of this deployment, derived the same way lib/api/client does. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
