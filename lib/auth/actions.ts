"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";

import { auth, signIn, signOut } from "@/auth";
import { ApiError, sendForm } from "@/lib/api/client";
import { parseFieldErrors, type FieldErrors } from "@/lib/validation/contract";
import { LIMITS } from "@/lib/validation/limits";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { findUserByIdentifier } from "@/lib/auth/identity";
import { loginDestination } from "@/lib/auth/login-destination";
import { noteLoginSuccess, registerLoginAttempt } from "@/lib/auth/login-rate-limit";
import { throttleRegistrationForm } from "@/lib/auth/register-rate-limit";
import { requestOtp, verifyOtp } from "@/lib/auth/otp";
import {
  confirmPasswordReset,
  requestPasswordReset,
  RESET_TOKEN_TTL_MINUTES,
} from "@/lib/auth/password-reset";
import type { Role } from "@/types";

export interface AuthFormState {
  /** Form-level message (bad credentials, blocked account, unexpected error). */
  error: string | null;
  /** field name → message, rendered under that field by useFormValidation. */
  fieldErrors?: FieldErrors;
  code?: string;
  /**
   * Form-level SUCCESS message for the flows that stay on the page instead of
   * redirecting (reset-link request, OTP sent).
   */
  notice?: string | null;
  /**
   * DEMO FALLBACK — the reset link or OTP code, surfaced only when no SMS
   * gateway is configured AND NODE_ENV !== "production" (enforced in
   * lib/auth/password-reset + lib/auth/otp, never here). Rendered verbatim by
   * the form under its own explanatory label.
   */
  demoHint?: string | null;
  /** Changes on every server response so repeat failures re-trigger effects. */
  submissionId?: number;
}

/** Failure carrying per-field messages. */
function authFieldErrors(fieldErrors: FieldErrors, formError: string | null = null): AuthFormState {
  return { error: formError, fieldErrors, submissionId: Date.now() };
}

/** Failure that belongs to the form as a whole, not to one field. */
function authFormError(message: string, code?: string): AuthFormState {
  return { error: message, fieldErrors: {}, code, submissionId: Date.now() };
}

/**
 * Login: validate credentials + approval status ourselves (so we can surface
 * pending/rejected reasons), then establish the NextAuth session via signIn.
 *
 * The single `identifier` field accepts a BD mobile number, an email address OR
 * a username — registration mandates an email and enforces a unique phone "as a
 * login identifier", so all three are legitimate ways in, and BD customers
 * expect the phone one. Resolution lives in lib/auth/identity so this action and
 * the Credentials provider can never disagree about which account an input names.
 */
export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const remember = String(formData.get("remember") ?? "") === "on";
  const callbackUrl = String(formData.get("callbackUrl") ?? "");
  const { t } = await getT();

  // Missing values are the user's own field mistakes — reported under the field.
  const missing: FieldErrors = {};
  if (!identifier) missing.identifier = t("validation.required");
  if (!password) missing.password = t("validation.required");
  if (Object.keys(missing).length > 0) return authFieldErrors(missing);

  // Rate limit BEFORE the lookup, and answer with the SAME generic
  // invalid-credentials message a wrong password gets: a distinct "slow down"
  // reply — or a limiter that skips unknown identifiers — would let an
  // attacker sort real accounts from invented ones. This action needs its own
  // check because its bcrypt pre-check below runs before signIn() ever reaches
  // the throttled provider. Budgets: lib/auth/login-rate-limit.ts.
  if (!(await registerLoginAttempt(identifier))) {
    return authFormError(t("errors.invalidCredentials"));
  }

  // Mobile number → email → username, in that order (see findUserByIdentifier).
  const user = await findUserByIdentifier(identifier);

  const passwordOk = user ? await bcrypt.compare(password, user.password) : false;
  // Deliberately form-level: never reveal WHICH of the two was wrong.
  if (!user || !passwordOk || !user.isActive) {
    return authFormError(t("errors.invalidCredentials"));
  }
  if (user.status === "pending") {
    return authFormError(t("errors.auth.accountPending"), "pending");
  }
  if (user.status === "rejected") {
    return authFormError(
      t("errors.auth.accountRejected", {
        reason: user.rejectionReason || t("errors.auth.notSpecified"),
      }),
      "rejected",
    );
  }

  try {
    // Always sign in by the resolved username — the provider's lookup key.
    await signIn("credentials", {
      username: user.username,
      password,
      remember: remember ? "1" : "0",
      redirect: false,
    });
  } catch {
    return authFormError(t("errors.invalidCredentials"));
  }
  // Success — forget the typo-count under the identifier AS TYPED (the
  // provider settled its own bucket, which is keyed by resolved username) and
  // refund this attempt's per-IP count.
  await noteLoginSuccess(identifier);
  // PHASE O — land the user where they were going, or on their role's home.
  redirect(loginDestination(user.role as Role, callbackUrl));
}


/**
 * Forgot password, STEP 1 — ask for a reset link.
 *
 * This used to accept username + email + a new password and rewrite the hash on
 * the spot, which made knowledge of two semi-public identifiers equivalent to
 * owning the account (the seeded super admin's pair is printed in
 * .env.example). It now only REQUESTS a link; possession of the emailed/texted
 * token is what authorizes the change, in resetPasswordAction below.
 *
 * The response is identical whether or not the account exists — a "no such
 * user" message here is a free customer-database oracle.
 */
export async function forgotPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { t } = await getT();
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (!identifier) return authFieldErrors({ identifier: t("validation.required") });

  const result = await requestPasswordReset(identifier);
  if (!result.accepted) {
    return authFormError(t("auth.resetTooManyRequests", { n: result.retryAfter }));
  }

  return {
    error: null,
    fieldErrors: {},
    code: "sent",
    notice: t("auth.resetLinkSent", { n: RESET_TOKEN_TTL_MINUTES }),
    demoHint: result.demoLink ?? null,
    submissionId: Date.now(),
  };
}

/**
 * Forgot password, STEP 2 — spend the token and set the new password.
 *
 * The token arrives from the link's query string via a hidden field. Password
 * rules are checked here for the message, and AGAIN inside
 * confirmPasswordReset, which is the actual boundary.
 */
export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { t } = await getT();
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  // Same rules the client runs — each failure lands under its own field.
  const fieldErrors: FieldErrors = {};
  if (!password) fieldErrors.password = t("validation.required");
  else if (password.length < LIMITS.passwordMin) {
    fieldErrors.password = t("validation.passwordShort", { n: LIMITS.passwordMin });
  } else if (/^\d+$/.test(password)) {
    fieldErrors.password = t("validation.passwordNumeric");
  }
  if (!fieldErrors.password && password !== confirm) {
    fieldErrors.confirm_password = t("validation.passwordMatch");
  }
  if (Object.keys(fieldErrors).length > 0) return authFieldErrors(fieldErrors);

  if (!token) return authFormError(t("auth.resetTokenMissing"), "token");

  // `code` is set so the form can offer "request a new link" instead of a dead end.
  const outcome = await confirmPasswordReset(token, password);
  switch (outcome) {
    case "ok":
      break;
    case "expired":
      return authFormError(t("auth.resetTokenExpired"), "token");
    case "used":
      return authFormError(t("auth.resetTokenUsed"), "token");
    case "rate_limited":
      return authFormError(t("auth.resetTooManyAttempts"));
    case "weak":
      return authFieldErrors({
        password: t("validation.passwordShort", { n: LIMITS.passwordMin }),
      });
    default:
      return authFormError(t("auth.resetTokenInvalid"), "token");
  }

  redirect("/login?reset=1");
}

/**
 * OTP login, STEP 1 — text a one-time code to a mobile number.
 *
 * Enumeration-safe like the reset request: "sent" comes back for any
 * well-formed BD number, and a code is only minted for a real, approved account
 * (so this cannot be used to pump SMS at arbitrary numbers either).
 */
export async function otpRequestAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { t } = await getT();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!phone) return authFieldErrors({ phone: t("validation.required") });

  const result = await requestOtp(phone);
  switch (result.status) {
    case "sent":
      break;
    case "invalid_phone":
      return authFieldErrors({ phone: t("validation.phone") });
    case "cooldown":
      return authFormError(t("auth.otpCooldown", { n: result.retryAfter }), "cooldown");
    default:
      return authFormError(t("auth.otpRateLimited", { n: result.retryAfter }), "rate_limited");
  }

  return {
    error: null,
    fieldErrors: {},
    code: "sent",
    notice: t("auth.otpSent", { n: Math.max(1, Math.round(result.expiresIn / 60)) }),
    demoHint: result.demoCode ?? null,
    submissionId: Date.now(),
  };
}

/**
 * OTP login, STEP 2 — verify the code and establish the session.
 *
 * The first `verifyOtp` call deliberately does NOT consume: it exists to tell
 * the customer exactly what went wrong. The `signIn("otp", …)` below runs the
 * real, consuming verification inside the provider, so a code is spent exactly
 * once and only when a session is actually created.
 */
export async function otpVerifyAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { t } = await getT();
  const phone = String(formData.get("phone") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const remember = String(formData.get("remember") ?? "") === "on";
  const callbackUrl = String(formData.get("callbackUrl") ?? "");

  const missing: FieldErrors = {};
  if (!phone) missing.phone = t("validation.required");
  if (!code) missing.code = t("validation.required");
  if (Object.keys(missing).length > 0) return authFieldErrors(missing);

  const check = await verifyOtp(phone, code, { consume: false });
  switch (check.status) {
    case "ok":
      break;
    case "invalid_phone":
      return authFieldErrors({ phone: t("validation.phone") });
    case "expired":
      return authFormError(t("auth.otpExpired"), "expired");
    case "too_many_attempts":
      return authFormError(t("auth.otpTooManyAttempts"), "expired");
    case "rate_limited":
      return authFormError(t("auth.otpRateLimited", { n: 60 }), "rate_limited");
    default:
      return authFieldErrors({ code: t("auth.otpInvalidCode", { n: check.attemptsLeft }) });
  }

  // Read the account for its landing destination and for the same
  // pending/rejected messages the password path surfaces.
  const user = check.userId
    ? await prisma.user.findUnique({ where: { id: check.userId } })
    : null;
  if (!user || !user.isActive) return authFormError(t("errors.invalidCredentials"));
  if (user.status === "pending") {
    return authFormError(t("errors.auth.accountPending"), "pending");
  }
  if (user.status === "rejected") {
    return authFormError(
      t("errors.auth.accountRejected", {
        reason: user.rejectionReason || t("errors.auth.notSpecified"),
      }),
      "rejected",
    );
  }

  try {
    await signIn("otp", {
      phone,
      code,
      remember: remember ? "1" : "0",
      redirect: false,
    });
  } catch {
    return authFormError(t("auth.otpVerifyFailed"));
  }
  // PHASE O — land the user where they were going, or on their role's home.
  redirect(loginDestination(user.role as Role, callbackUrl));
}

/** Logout: clear the NextAuth session and return to /login. */
export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

/**
 * Registration — PUBLIC path is customer-only. Other role paths are rejected
 * (staff accounts are created by a Super Admin). On success customers are
 * auto-approved and logged straight in.
 */
export async function registerAction(
  rolePath: string,
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { t } = await getT();

  if (rolePath !== "customer") {
    return authFormError(t("errors.auth.staffCreatedBySuperAdminOnly"));
  }

  // Per-IP registration throttle at the layer that sees the REAL client IP —
  // the internal fetch below presents the server's own address to the route,
  // so the route's limiter cannot meter individual visitors for form traffic.
  // Budgets + the two-layer design: lib/auth/register-rate-limit.ts.
  const limited = await throttleRegistrationForm();
  if (!limited.ok) {
    return authFormError(t("errors.auth.registerRateLimited", { n: limited.retryAfter }));
  }

  const body = new FormData();
  for (const [key, value] of formData.entries()) {
    if (value instanceof File && value.size === 0) continue;
    if (key.startsWith("$")) continue;
    body.append(key, value);
  }

  try {
    await sendForm("/auth/register/customer/", "POST", body);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    // Duplicate username/email/phone come back keyed by field — show them there.
    const { fieldErrors, formError } = parseFieldErrors(err.data);
    const hasFields = Object.keys(fieldErrors).length > 0;
    return {
      error: formError ?? (hasFields ? null : t("errors.generic")),
      fieldErrors,
      submissionId: Date.now(),
    };
  }

  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("credentials", { username, password, redirect: false });
  } catch {
    redirect("/login");
  }
  // Registration signs the new account in, so it is a login and must land where
  // every other login lands — through the one helper, never its own rule. A
  // registration has no callbackUrl, so this resolves to ROLE_HOME.customer ("/").
  redirect(loginDestination("customer", ""));
}

/**
 * Delete My Account (customer). Soft-deletes: the account is deactivated and
 * personal data anonymized so it can never log in again and PII is removed,
 * while order/payment history stays referentially intact for accounting.
 * Then the session is cleared and the user is sent to /login.
 */
export async function deleteAccountAction(): Promise<AuthFormState> {
  const session = await auth();
  const userId = Number(session?.user?.id);
  if (!userId) {
    const { t } = await getT();
    return authFormError(t("errors.sessionExpired"));
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "customer") {
    const { t } = await getT();
    return authFormError(t("errors.permissionDenied"));
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      status: "deleted",
      username: `deleted_${userId}`,
      email: `deleted_${userId}@deleted.local`,
      firstName: "",
      lastName: "",
      phone: "",
      address: "",
      profilePhoto: null,
      notificationsEnabled: false,
    },
  });

  await signOut({ redirectTo: "/login" });
  return { error: null };
}
