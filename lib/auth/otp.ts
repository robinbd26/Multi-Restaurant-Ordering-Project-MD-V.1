import "server-only";

import { normalizeBdPhone } from "@/lib/auth/phone";
import { rateLimit, clearRateLimit } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/auth/request-info";
import { sendSms } from "@/lib/auth/sms";
import { digestsMatch, generateNumericCode, hashToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";

/**
 * Login by one-time code sent to the customer's mobile number — the sign-in
 * method the requirements promise and BD customers expect.
 *
 * SECRET HANDLING follows the same discipline as PasswordResetToken: the code
 * is generated with a CSPRNG, only its SHA-256 is kept, comparison is
 * constant-time, the challenge dies after 5 minutes or 5 wrong tries, and a
 * correct code is consumed immediately so it can never be replayed.
 *
 * STORAGE — the frozen schema has no OTP model (PasswordResetToken carries no
 * attempt counter and no purpose column, and overloading it would corrupt the
 * meaning of a security table), so the challenges live in this process. That is
 * a deliberate, documented limitation, not an oversight:
 *   • a restart invalidates in-flight codes (5-minute blast radius), and
 *   • on a multi-instance deploy a code must be verified by the instance that
 *     issued it — move this Map to Redis, or add an OtpChallenge model, before
 *     scaling out horizontally.
 */

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** Abuse guards on top of the per-phone cooldown. */
const REQUEST_LIMIT = 5;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_IP_LIMIT = 20;
const REQUEST_IP_WINDOW_MS = 60 * 60 * 1000;
const VERIFY_IP_LIMIT = 30;
const VERIFY_IP_WINDOW_MS = 15 * 60 * 1000;

/** Ceiling on live challenges so a flood cannot grow the map without limit. */
const MAX_CHALLENGES = 5000;

interface OtpChallenge {
  userId: number;
  /** SHA-256 of the code — the code itself is never held after it is sent. */
  codeHash: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
}

const challenges = new Map<string, OtpChallenge>();

const isProduction = () => process.env.NODE_ENV === "production";

function sweep(now: number): void {
  for (const [phone, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(phone);
  }
}

export interface OtpRequestResult {
  status: "sent" | "invalid_phone" | "cooldown" | "rate_limited";
  /** Seconds to wait before retrying (cooldown / rate limit). */
  retryAfter: number;
  /** Seconds the code stays valid; 0 unless `status === "sent"`. */
  expiresIn: number;
  /**
   * NON-PRODUCTION ONLY — the code itself, so the flow is testable with no SMS
   * gateway (the repo's demo-fallback rule). Never populated in production.
   */
  demoCode?: string;
}

/**
 * Send a login code to `rawPhone`.
 *
 * `status: "sent"` is returned whether or not an account holds that number: a
 * response that differed would turn this endpoint into a customer-database
 * oracle. A code is only ever minted and delivered for a real, active, approved
 * account, so an attacker also cannot use it to pump SMS at arbitrary numbers.
 */
export async function requestOtp(rawPhone: string): Promise<OtpRequestResult> {
  const phone = normalizeBdPhone(rawPhone);
  if (!phone) return { status: "invalid_phone", retryAfter: 0, expiresIn: 0 };

  const ip = await clientIp();
  const perPhone = rateLimit(`otp:req:${phone}|${ip}`, REQUEST_LIMIT, REQUEST_WINDOW_MS);
  const perIp = rateLimit(`otp:req-ip:${ip}`, REQUEST_IP_LIMIT, REQUEST_IP_WINDOW_MS);
  if (!perPhone.ok || !perIp.ok) {
    return {
      status: "rate_limited",
      retryAfter: Math.max(perPhone.retryAfter, perIp.retryAfter),
      expiresIn: 0,
    };
  }

  const now = Date.now();
  const existing = challenges.get(phone);
  if (existing && now - existing.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
    return {
      status: "cooldown",
      retryAfter: Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000),
      expiresIn: Math.max(0, Math.ceil((existing.expiresAt - now) / 1000)),
    };
  }

  const user = await prisma.user.findFirst({
    where: { phone, isActive: true, status: "approved" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!user) {
    // Same shape as success on purpose. Nothing is minted and nothing is sent.
    return { status: "sent", retryAfter: 0, expiresIn: Math.ceil(OTP_TTL_MS / 1000) };
  }

  const code = generateNumericCode(OTP_CODE_LENGTH);
  if (challenges.size >= MAX_CHALLENGES) sweep(now);
  challenges.set(phone, {
    userId: user.id,
    codeHash: hashToken(code),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    lastSentAt: now,
  });

  const sent = await sendSms({
    to: phone,
    purpose: "login_otp",
    body: `MAD Delivery: your login code is ${code}. It expires in ${Math.round(OTP_TTL_MS / 60000)} minutes. Never share it.`,
  });
  if (!sent.ok) console.error("[otp] SMS delivery failed:", sent.error);

  return {
    status: "sent",
    retryAfter: 0,
    expiresIn: Math.ceil(OTP_TTL_MS / 1000),
    // Dev convenience only — this branch cannot run in production.
    demoCode: isProduction() ? undefined : code,
  };
}

export type OtpVerifyStatus =
  | "ok"
  | "invalid_phone"
  /** Wrong code, or no challenge for this number (deliberately not told apart). */
  | "invalid"
  | "expired"
  | "too_many_attempts"
  | "rate_limited";

export interface OtpVerifyResult {
  status: OtpVerifyStatus;
  /** Present only when `status === "ok"`. */
  userId?: number;
  /** Tries left before the challenge is destroyed; 0 when it already was. */
  attemptsLeft: number;
}

/**
 * Check a code, and by default CONSUME it.
 *
 * A consumed code is destroyed before this returns, so it can never be
 * replayed. `consume: false` is the browser flow's first pass: the server
 * action needs the precise status to tell the customer what went wrong ("that
 * code expired" vs "3 tries left"), and the NextAuth `otp` provider then does
 * the consuming pass a moment later. A WRONG code costs an attempt either way,
 * so the peek is not a free brute-force oracle.
 */
export async function verifyOtp(
  rawPhone: string,
  rawCode: string,
  { consume = true }: { consume?: boolean } = {},
): Promise<OtpVerifyResult> {
  const phone = normalizeBdPhone(rawPhone);
  if (!phone) return { status: "invalid_phone", attemptsLeft: 0 };

  const ip = await clientIp();
  const perIp = rateLimit(`otp:verify-ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_IP_WINDOW_MS);
  if (!perIp.ok) return { status: "rate_limited", attemptsLeft: 0 };

  const code = String(rawCode ?? "").replace(/\D+/g, "");
  const challenge = challenges.get(phone);
  // No challenge is reported as a plain wrong code: "you never asked for one"
  // would confirm which numbers have accounts.
  if (!challenge) return { status: "invalid", attemptsLeft: 0 };

  if (challenge.expiresAt <= Date.now()) {
    challenges.delete(phone);
    return { status: "expired", attemptsLeft: 0 };
  }

  if (!code || !digestsMatch(challenge.codeHash, hashToken(code))) {
    challenge.attempts += 1;
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      challenges.delete(phone); // burned — the user must request a fresh code
      return { status: "too_many_attempts", attemptsLeft: 0 };
    }
    return { status: "invalid", attemptsLeft: OTP_MAX_ATTEMPTS - challenge.attempts };
  }

  if (consume) {
    challenges.delete(phone); // single use
    clearRateLimit(`otp:req:${phone}|${ip}`);
  }
  return { status: "ok", userId: challenge.userId, attemptsLeft: 0 };
}

/** Test/ops helper — drop every live challenge (e.g. between test cases). */
export function clearOtpChallenges(): void {
  challenges.clear();
}
