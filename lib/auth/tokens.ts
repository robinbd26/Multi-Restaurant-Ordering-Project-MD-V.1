import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secret material for the unauthenticated auth flows (password reset, login
 * OTP).
 *
 * ONE rule governs this module: a secret we hand to a user is never stored.
 * Only its SHA-256 digest is persisted, so a leaked database backup cannot be
 * replayed into an account takeover. SHA-256 (not bcrypt) is correct here
 * precisely because these secrets carry full entropy — a 256-bit token or a
 * server-generated code with a 5-minute life and a 5-attempt cap — so there is
 * no dictionary to slow an attacker down through.
 */

/** `bytes` of CSPRNG entropy, hex-encoded (32 bytes → 64 chars). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** SHA-256 hex digest of a token/code. The only form we ever write down. */
export function hashToken(secret: string): string {
  return createHash("sha256").update(String(secret ?? ""), "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex digests, so a wrong code cannot be
 * narrowed down by timing the reply.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Numeric one-time code, uniformly distributed.
 *
 * Bytes ≥ 250 are rejected instead of reduced, because 256 is not a multiple of
 * 10: plain `byte % 10` would make the digits 0–5 measurably more likely and
 * shrink the search space. `Math.random()` is never acceptable here — it is not
 * a CSPRNG.
 */
export function generateNumericCode(length = 6): string {
  const digits: string[] = [];
  while (digits.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= 250) continue; // 250 = 25 × 10 → keep only the unbiased range
      digits.push(String(byte % 10));
      if (digits.length === length) break;
    }
  }
  return digits.join("");
}
