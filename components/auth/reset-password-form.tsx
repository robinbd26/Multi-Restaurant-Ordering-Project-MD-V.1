"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/forms/password-input";
import { Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { resetPasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { matches, password as passwordRule, required } from "@/lib/validation/rules";
import { useFormValidation } from "@/lib/validation/use-form-validation";

const initialState: AuthFormState = { error: null, fieldErrors: {} };

/** Identical to the checks resetPasswordAction runs server-side. */
const RULES = {
  password: [required, passwordRule],
  confirm_password: [required, matches("password")],
};

/**
 * STEP 2 of the reset. The token comes from the link's query string and rides
 * along in a hidden field — it is the ONLY thing authorizing this change, so it
 * is never echoed anywhere the user can read it back off the page.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  const { t } = useTranslation();
  const { errors, formProps } = useFormValidation(RULES, {
    serverErrors: state.fieldErrors,
    submissionId: state.submissionId,
    pending,
  });

  // A dead token is a dead end unless the user can start over from here.
  const tokenDead = state.code === "token" || !token;

  return (
    <form action={formAction} {...formProps} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <Alert tone="error" message={state.error ?? (token ? null : t("auth.resetTokenMissing"))} />

      {tokenDead ? (
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="font-semibold text-brand-600 hover:underline">
            {t("auth.requestNewResetLink")}
          </Link>
        </p>
      ) : null}

      <Field label={t("auth.newPassword")} required error={errors.password} name="password">
        <PasswordInput
          name="password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
          aria-invalid={!!errors.password}
        />
      </Field>
      <Field
        label={t("auth.confirmPassword")}
        required
        error={errors.confirm_password}
        name="confirm_password"
      >
        <PasswordInput
          name="confirm_password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
          aria-invalid={!!errors.confirm_password}
        />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending || !token}>
        {pending ? <Spinner className="size-4 border-white/40 border-t-white" /> : null}
        {t("auth.resetButton")}
      </Button>

      <p className="text-center text-sm text-slate-500">
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          {t("auth.backToLogin")}
        </Link>
      </p>
    </form>
  );
}
