"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { submitBkashPaymentAction } from "@/lib/api/payment-actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import type { FieldErrors } from "@/lib/validation/contract";
import { LIMITS } from "@/lib/validation/limits";
import { maxLength, phone, required, type Rule } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

/**
 * bKash transaction ids are short alphanumeric tokens. This mirrors
 * `normalizeTransactionId` in `lib/services/payments.ts` EXACTLY (6–32
 * alphanumeric characters, case-folded on the server), so a value this form
 * accepts can never be refused by the service — and vice versa.
 */
const trxId: Rule = (v) =>
  !v.trim() || /^[A-Za-z0-9]{6,32}$/.test(v.trim()) ? null : { key: "payments.errTransactionId" };

const RULES: FieldRules = {
  transaction_id: [required, trxId, maxLength(LIMITS.shortTextMax)],
  // BD mobile (01XXXXXXXXX) — the same BD_PHONE_RE the server's validatePhone uses.
  payer_phone: [required, phone],
};

/**
 * WS-1.2 — the customer's manual bKash submission.
 *
 * Everything the customer needs to act is on ONE screen: the number to send to,
 * the exact amount, and the two fields the branch verifies against. The number
 * shown is the one this order carries, never a live lookup — see
 * `PaymentStatusCard`, which resolves the snapshot.
 *
 * Nothing here decides anything: the service re-validates the TrxID shape, the
 * payer phone, whether the branch still accepts bKash and whether the id was
 * already used on another order, and it alone moves the order to
 * `pending_verification`.
 */
export function PaymentSubmitForm({
  orderId,
  destinationNumber,
  instructions,
  amount,
  defaultPayerPhone = "",
  resubmit = false,
}: {
  orderId: number;
  destinationNumber: string;
  instructions: string;
  /** Formatted, ready to display — the money itself is never recomputed here. */
  amount: string;
  defaultPayerPhone?: string;
  /** True after a rejection: the customer is paying again, not for the first time. */
  resubmit?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [transactionId, setTransactionId] = useState("");
  const [payerPhone, setPayerPhone] = useState(defaultPayerPhone);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);
  const [copied, setCopied] = useState(false);

  const copyNumber = useCallback(() => {
    // Clipboard access is permission-gated and absent on older Android
    // browsers; the number stays selectable on screen either way.
    navigator.clipboard
      ?.writeText(destinationNumber)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  }, [destinationNumber]);

  const submit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      start(async () => {
        const res = await submitBkashPaymentAction(orderId, {
          transaction_id: transactionId.trim(),
          payer_phone: payerPhone.trim(),
        });
        setSubmissionId((n) => n + 1);
        setServerErrors(res.fieldErrors ?? {});
        if (res.error || Object.keys(res.fieldErrors ?? {}).length > 0) {
          setError(res.error);
          return;
        }
        setTransactionId("");
        // The card re-renders from the server, so the pending-verification
        // state the customer now sees is the DB's, not an optimistic guess.
        router.refresh();
      });
    },
    [orderId, payerPhone, router, transactionId],
  );

  const { errors, formProps } = useFormValidation(RULES, {
    onSubmitValid: submit,
    serverErrors,
    submissionId,
    pending,
  });

  return (
    <div className="space-y-4" data-testid="bkash-submit">
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-500/25 dark:bg-brand-500/10">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {t("payments.payTo")}
        </p>
        <p
          className="mt-1 font-mono text-2xl font-bold tabular-nums text-fg-base"
          data-testid="bkash-destination"
        >
          {destinationNumber}
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          {t("payments.amountDue")}: <span className="font-semibold text-fg-base">{amount}</span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={copyNumber}
          aria-live="polite"
        >
          {copied ? t("payments.copied") : t("payments.copyNumber")}
        </Button>
      </div>

      <div>
        <p className="text-sm font-semibold text-fg-base">{t("payments.howToPayTitle")}</p>
        <ol className="mt-1.5 list-decimal space-y-1 ps-5 text-sm text-fg-muted">
          <li>{t("payments.howToPayStep1")}</li>
          <li>{t("payments.howToPayStep2", { amount })}</li>
          <li>{t("payments.howToPayStep3")}</li>
        </ol>
        {/* Branch-specific instructions are optional; an empty value simply
            leaves the standard steps above on their own. */}
        {instructions ? (
          <p className="mt-2 rounded-xl bg-surface-muted px-3.5 py-2.5 text-sm text-fg-base">
            {instructions}
          </p>
        ) : null}
      </div>

      <form {...formProps} className="space-y-4">
        <Alert tone="error" message={error} />
        <Field
          label={t("payments.transactionId")}
          name="transaction_id"
          required
          error={errors.transaction_id}
        >
          <Input
            name="transaction_id"
            value={transactionId}
            autoComplete="off"
            autoCapitalize="characters"
            inputMode="text"
            placeholder={t("payments.transactionIdPlaceholder")}
            disabled={pending}
            onChange={(e) => setTransactionId(e.target.value)}
          />
        </Field>
        <Field
          label={t("payments.payerPhone")}
          name="payer_phone"
          required
          hint={t("payments.payerPhoneHint")}
          error={errors.payer_phone}
        >
          <Input
            name="payer_phone"
            value={payerPhone}
            // Phones are the primary device here: a numeric keypad and the
            // platform's own phone autofill save the customer typing.
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="01712345678"
            disabled={pending}
            onChange={(e) => setPayerPhone(e.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
          {pending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : null}
          {pending ? t("common.saving") : resubmit ? t("payments.resubmit") : t("payments.submit")}
        </Button>
      </form>
    </div>
  );
}
