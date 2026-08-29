import { ApiError, handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { requestOtp, OTP_CODE_LENGTH } from "@/lib/auth/otp";

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
 * POST /api/auth/otp/request — PUBLIC. Texts a one-time login code.
 *
 * The browser flow uses the server action (lib/auth/actions.otpRequestAction);
 * this route is the same service behind an HTTP seam for non-form clients.
 *
 * The response is IDENTICAL for numbers that have an account and numbers that
 * do not — only the malformed-number case differs, because that is a property
 * of the input, not of the customer database. Rate limiting, the resend
 * cooldown and the attempt cap all live in lib/auth/otp.
 */
export const POST = handle(async (req: Request) => {
  const b = await readBody(req);
  const result = await requestOtp(b.phone ?? "");

  switch (result.status) {
    case "invalid_phone":
      throw validationError({ phone: sk("errors.validation.phone") });
    case "cooldown":
      throw new ApiError(429, { detail: sk("auth.otpCooldown", { n: result.retryAfter }) });
    case "rate_limited":
      throw new ApiError(429, { detail: sk("auth.otpRateLimited", { n: result.retryAfter }) });
    default:
      break;
  }

  return json({
    status: "sent",
    code_length: OTP_CODE_LENGTH,
    expires_in: result.expiresIn,
    // Non-production only — see the demo-fallback note in lib/auth/otp.
    ...(result.demoCode ? { demo_code: result.demoCode } : {}),
  });
});
