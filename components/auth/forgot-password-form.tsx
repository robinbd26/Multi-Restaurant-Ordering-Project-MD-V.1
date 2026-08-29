"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { forgotPasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { required } from "@/lib/validation/rules";
import { useFormValidation } from "@/lib/validation/use-form-validation";

const initialState: AuthFormState = { error: null, fieldErrors: {} };

/**
 * STEP 1 of the reset — request a link. No new password is collected here: the
 * password can only be changed from the link's own page, by someone who
 * received it. See the note on forgotPasswordAction.
 */
const RULES = {
  identifier: [required],
};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);
  const { t } = useTranslation();
  const { errors, formProps } = useFormValidation(RULES, {
    serverErrors: state.fieldErrors,
    submissionId: state.submissionId,
    pending,
  });

  const sent = state.code === "sent";

  return (
    <form action={formAction} {...formProps} className="space-y-4">
      <Alert tone="error" message={state.error} />
      <Alert tone="success" message={state.notice} />

      {/* Demo fallback: with no SMS gateway configured the link cannot be
          delivered, so outside production it is shown here instead. The server
          never populates this in production. */}
      {state.demoHint ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/25">
          <p className="font-medium text-amber-800 dark:text-amber-300">{t("auth.resetDemoHint")}</p>
          <a href={state.demoHint} className="mt-1 block break-all font-mono text-xs text-amber-900 underline dark:text-amber-200">
            {state.demoHint}
          </a>
        </div>
      ) : null}

      <Field label={t("auth.identifierLabelAny")} required error={errors.identifier} name="identifier">
        <Input
          name="identifier"
          autoComplete="username"
          inputMode="text"
          required
          aria-invalid={!!errors.identifier}
        />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Spinner className="size-4 border-white/40 border-t-white" /> : null}
        {sent ? t("auth.resetResendButton") : t("auth.resetSendButton")}
      </Button>

      <p className="text-center text-sm text-slate-500">
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          {t("auth.backToLogin")}
        </Link>
      </p>
    </form>
  );
}
