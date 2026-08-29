"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { otpRequestAction, otpVerifyAction, type AuthFormState } from "@/lib/auth/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { phone as phoneRule, required } from "@/lib/validation/rules";
import { useFormValidation } from "@/lib/validation/use-form-validation";

const initialState: AuthFormState = { error: null, fieldErrors: {} };

const REQUEST_RULES = { phone: [required, phoneRule] };
const VERIFY_RULES = { code: [required] };

/**
 * Sign in with an SMS one-time code.
 *
 * Two server actions, two `useActionState` hooks, one screen: the form swaps to
 * the code step once a request comes back "sent". The phone number is carried
 * into the verify step in a hidden field AND re-validated server-side — the
 * challenge is keyed by the number, so a tampered value simply fails to match.
 */
export function OtpLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const { t } = useTranslation();
  const [requestState, requestAction, requestPending] = useActionState(otpRequestAction, initialState);
  const [verifyState, verifyAction, verifyPending] = useActionState(otpVerifyAction, initialState);

  const [phoneValue, setPhoneValue] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  const requestForm = useFormValidation(REQUEST_RULES, {
    serverErrors: requestState.fieldErrors,
    submissionId: requestState.submissionId,
    pending: requestPending,
  });
  const verifyForm = useFormValidation(VERIFY_RULES, {
    serverErrors: verifyState.fieldErrors,
    submissionId: verifyState.submissionId,
    pending: verifyPending,
  });

  // Reveal the code step once the server confirms a send, and keep it revealed
  // — a later cooldown/rate-limit reply must not yank away a field holding a
  // still-valid code. The action result is the external signal being
  // synchronized here, the same pattern useFormValidation uses for its own
  // server responses.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (requestState.code === "sent") setCodeSent(true);
  }, [requestState]);

  return (
    <div className="space-y-4">
      <Alert tone="error" message={verifyState.error ?? requestState.error} />
      <Alert tone="success" message={requestState.notice} />

      {/* Demo fallback: with no SMS gateway configured nothing is texted, so
          outside production the code is shown here. Never set in production. */}
      {requestState.demoHint ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/25">
          <p className="font-medium text-amber-800 dark:text-amber-300">{t("auth.otpDemoHint")}</p>
          <p className="mt-1 font-mono text-lg tracking-[0.3em] text-amber-900 dark:text-amber-200">
            {requestState.demoHint}
          </p>
        </div>
      ) : null}

      {/* ── Step 1: mobile number ── */}
      <form action={requestAction} {...requestForm.formProps} className="space-y-4">
        <Field
          label={t("auth.otpPhoneLabel")}
          required
          hint={t("auth.phoneHint")}
          error={requestForm.errors.phone}
          name="phone"
        >
          <Input
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phoneValue}
            onChange={(e) => setPhoneValue(e.target.value)}
            required
            aria-invalid={!!requestForm.errors.phone}
          />
        </Field>

        <Button
          type="submit"
          size="lg"
          variant={codeSent ? "outline" : "primary"}
          className="w-full"
          disabled={requestPending}
        >
          {requestPending ? <Spinner className="size-4" /> : null}
          {codeSent ? t("auth.otpResendButton") : t("auth.otpSendButton")}
        </Button>
      </form>

      {/* ── Step 2: the code ── */}
      {codeSent ? (
        <form action={verifyAction} {...verifyForm.formProps} className="space-y-4">
          <input type="hidden" name="phone" value={phoneValue} />
          {/* Re-validated server-side by loginDestination — an off-site or
              out-of-section value is discarded. */}
          <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />

          <Field label={t("auth.otpCodeLabel")} required error={verifyForm.errors.code} name="code">
            <Input
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              className="text-center font-mono text-lg tracking-[0.4em]"
              required
              aria-invalid={!!verifyForm.errors.code}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input type="checkbox" name="remember" className="size-4" />
            {t("auth.rememberMe")}
          </label>

          <Button type="submit" size="lg" className="w-full" disabled={verifyPending}>
            {verifyPending ? <Spinner className="size-4 border-white/40 border-t-white" /> : null}
            {t("auth.otpVerifyButton")}
          </Button>
        </form>
      ) : null}

      <p className="text-center text-sm text-slate-500">
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          {t("auth.loginWithPassword")}
        </Link>
      </p>
    </div>
  );
}
