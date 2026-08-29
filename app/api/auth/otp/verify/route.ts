import { ApiError, handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { verifyOtp } from "@/lib/auth/otp";

/** Read a field from either multipart form-data or a JSON body. */
async function readBody(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v == null ? "" : String(v)]));
  }
  const form = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * POST /api/auth/otp/verify — PUBLIC. Checks a login code and CONSUMES it.
 *
 * This does NOT create a session: session issuance belongs to Auth.js, and the
 * browser flow signs in through the `otp` Credentials provider (which runs its
 * own consuming verification). Because a code is single-use, exactly ONE of the
 * two paths may be used per code — this route is for non-browser clients that
 * only need to confirm possession of the number.
 *
 * The reply never says which account the number belongs to, and never
 * distinguishes "wrong code" from "no code was requested".
 */
export const POST = handle(async (req: Request) => {
  const b = await readBody(req);
  const result = await verifyOtp(b.phone ?? "", b.code ?? "");

  switch (result.status) {
    case "ok":
      return json({ verified: true });
    case "invalid_phone":
      throw validationError({ phone: sk("errors.validation.phone") });
    case "expired":
      throw validationError({ code: sk("auth.otpExpired") });
    case "too_many_attempts":
      throw new ApiError(429, { detail: sk("auth.otpTooManyAttempts") });
    case "rate_limited":
      throw new ApiError(429, { detail: sk("auth.otpRateLimited", { n: 60 }) });
    default:
      throw validationError({ code: sk("auth.otpInvalidCode", { n: result.attemptsLeft }) });
  }
});
