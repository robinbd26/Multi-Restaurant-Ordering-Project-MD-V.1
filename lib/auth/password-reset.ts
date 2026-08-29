import "server-only";
import bcrypt from "bcryptjs";

import { findUserByIdentifier } from "@/lib/auth/identity";
import { rateLimit } from "@/lib/auth/rate-limit";
import { clientIp, requestOrigin } from "@/lib/auth/request-info";
import { sendSms } from "@/lib/auth/sms";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/validation/limits";

/**
 * Two-step self-service password reset.
 *
 * This REPLACES the original single-step flow, which set a new password after
 * checking only that the submitted username and email matched an existing row —
 * i.e. anyone who knew a username and an email owned that account, including
 * the seeded super admin whose credentials are published in .env.example. There
 * is no way to make knowledge of two public-ish identifiers into an
 * authentication factor, so the reset now requires possession of a secret the
 * server sent out of band:
 *
 *   request → mint a 256-bit token, store ONLY its SHA-256, deliver the link
 *   confirm → present the token, prove possession, set the password once
 *
 * Two properties are load-bearing and must survive any future edit:
 *   • the request step returns the SAME response whether or not the account
 *     exists (no account enumeration), and
 *   • the raw token is never persisted and never logged in production.
 */

/** A reset link is useful for half an hour; after that the user asks again. */
export const RESET_TOKEN_TTL_MINUTES = 30;

/** Per identifier+IP, then a wider per-IP net for someone cycling identifiers. */
const REQUEST_LIMIT = 5;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_IP_LIMIT = 20;
const REQUEST_IP_WINDOW_MS = 60 * 60 * 1000;
/** The token is 256-bit, so this only blunts noise — not the real defence. */
const CONFIRM_LIMIT = 20;
const CONFIRM_WINDOW_MS = 15 * 60 * 1000;

const isProduction = () => process.env.NODE_ENV === "production";

export interface ResetRequestResult {
  /** Generic-success shape: true unless the caller was rate limited. */
  accepted: boolean;
  /** Seconds to wait when `accepted` is false. */
  retryAfter: number;
  /**
   * NON-PRODUCTION ONLY — the ready-to-open reset link, so the flow is testable
   * with no SMS gateway configured (the repo's demo-fallback rule). Always
   * undefined when NODE_ENV === "production", whatever else is true.
   */
  demoLink?: string;
}

/** Build the absolute link the user opens. Origin comes from the request. */
async function resetLink(token: string): Promise<string> {
  const origin = await requestOrigin();
  return `${origin}/forgot-password/reset?token=${encodeURIComponent(token)}`;
}

/**
 * STEP 1 — mint and deliver a reset token.
 *
 * `identifier` is a username, email or mobile number, resolved through the same
 * helper login uses. Every call is rate limited BEFORE the account lookup, so
 * the limiter itself cannot be used as an existence oracle.
 */
export async function requestPasswordReset(identifier: string): Promise<ResetRequestResult> {
  const value = String(identifier ?? "").trim();
  const ip = await clientIp();

  const perIdentifier = rateLimit(
    `pwreset:req:${value.toLowerCase()}|${ip}`,
    REQUEST_LIMIT,
    REQUEST_WINDOW_MS,
  );
  const perIp = rateLimit(`pwreset:req-ip:${ip}`, REQUEST_IP_LIMIT, REQUEST_IP_WINDOW_MS);
  if (!perIdentifier.ok || !perIp.ok) {
    return { accepted: false, retryAfter: Math.max(perIdentifier.retryAfter, perIp.retryAfter) };
  }

  const user = value ? await findUserByIdentifier(value) : null;
  // Unknown, deactivated and deleted accounts all fall out here — with exactly
  // the same return value a real one produces. Do not add a branch that changes
  // the response shape, message, or timing profile in a caller-visible way.
  if (!user || !user.isActive || user.status === "deleted") {
    return { accepted: true, retryAfter: 0 };
  }

  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction([
    // Requesting a new link retires every earlier one. The schema has no
    // `revokedAt`, so a superseded token is stamped `usedAt` — the confirm step
    // treats that as spent, which is exactly the behaviour we want.
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt, requestedIp: ip },
    }),
  ]);

  const link = await resetLink(token);
  if (user.phone) {
    // Delivery is best-effort: a gateway failure must not tell the caller
    // whether the account existed, so the result is logged, not returned.
    const sent = await sendSms({
      to: user.phone,
      purpose: "password_reset",
      body: `MAD Delivery: reset your password within ${RESET_TOKEN_TTL_MINUTES} minutes — ${link}`,
    });
    if (!sent.ok) console.error("[password-reset] SMS delivery failed:", sent.error);
  }
  // Always leave a server-side trail so an operator can recover an account even
  // with no gateway configured. Production gets the link in the LOG only.
  console.info(`[password-reset] link issued for user #${user.id} (expires ${expiresAt.toISOString()})`);
  if (!isProduction()) console.info(`[password-reset] demo link: ${link}`);

  return { accepted: true, retryAfter: 0, demoLink: isProduction() ? undefined : link };
}

export type ResetConfirmOutcome =
  | "ok"
  /** No such token, or it belongs to an account that can no longer sign in. */
  | "invalid"
  | "expired"
  | "used"
  /** Fails the shared password policy (LIMITS.passwordMin / not all digits). */
  | "weak"
  | "rate_limited";

/**
 * STEP 2 — spend the token and set the new password.
 *
 * The password policy is re-applied here even though the form checks it: the
 * form is UX, this is the boundary.
 */
export async function confirmPasswordReset(
  token: string,
  password: string,
): Promise<ResetConfirmOutcome> {
  const ip = await clientIp();
  if (!rateLimit(`pwreset:confirm:${ip}`, CONFIRM_LIMIT, CONFIRM_WINDOW_MS).ok) {
    return "rate_limited";
  }

  const raw = String(token ?? "").trim();
  if (!raw) return "invalid";
  if (password.length < LIMITS.passwordMin || /^\d+$/.test(password)) return "weak";

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!record) return "invalid";
  if (record.usedAt) return "used";
  if (record.expiresAt.getTime() <= Date.now()) return "expired";

  const user = record.user;
  if (!user.isActive || user.status === "deleted") return "invalid";

  const hashed = await bcrypt.hash(password, 10);
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { password: hashed } }),
    // Spends THIS token and every other outstanding one for the account in a
    // single statement — a reset must not leave a second live link behind.
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    }),
  ]);

  return "ok";
}
