"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { redeemCoinsAction } from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import type { FieldErrors } from "@/lib/validation/contract";
import { integer, positive, required } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

const RULES: FieldRules = { coins: [required, integer, positive] };

export function RedeemForm({
  balance,
  minRedeem,
  coinValueTk,
}: {
  balance: number;
  minRedeem: number;
  coinValueTk: string;
}) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [coins, setCoins] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // WS-7.1 — the voucher the burned coins actually minted. Shown verbatim,
  // because this code is what the customer spends at checkout.
  const [voucher, setVoucher] = useState<{ code: string; value: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);

  const value = Math.floor(Number(coins) || 0);
  const tk = (value * Number(coinValueTk)).toFixed(2);

  /** Minimum and balance ceilings — both re-checked by the server. */
  const validateCoins = useCallback(
    (values: Record<string, string>): FieldErrors => {
      const n = Number(values.coins);
      if (!values.coins || !Number.isFinite(n)) return {};
      if (n < minRedeem) return { coins: t("rewards.errMin", { min: fmt.num(minRedeem) }) };
      if (n > balance) return { coins: t("rewards.errBalance", { balance: fmt.num(balance) }) };
      return {};
    },
    [balance, minRedeem, fmt, t],
  );

  const submit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);
      setVoucher(null);
      start(async () => {
        const res = await redeemCoinsAction(Math.floor(Number(coins)));
        setSubmissionId((n) => n + 1);
        setServerErrors(res.fieldErrors ?? {});
        if (res.error || Object.keys(res.fieldErrors ?? {}).length > 0) {
          setError(res.error);
          return;
        }
        setSuccess(res.success ?? null);
        setVoucher(res.voucherCode ? { code: res.voucherCode, value: res.voucherValue ?? "0" } : null);
        setCoins(""); // cleared only after a confirmed redemption
        router.refresh();
      });
    },
    [coins, router],
  );

  const { errors, formProps } = useFormValidation(RULES, {
    validate: validateCoins,
    onSubmitValid: submit,
    serverErrors,
    submissionId,
    pending,
  });

  return (
    <form {...formProps} className="space-y-4">
      <Alert tone="error" message={error} />
      {Object.keys(errors).length === 0 ? <Alert tone="success" message={success} /> : null}
      {voucher ? (
        <div
          className="rounded-xl border border-emerald-500/30 bg-emerald-50 p-3 dark:bg-emerald-500/10"
          data-testid="reward-voucher"
        >
          <p className="text-sm text-fg-muted">
            {t("rewards.voucherIssued", { value: fmt.money(Number(voucher.value)) })}
          </p>
          <p className="mt-1 font-mono text-base font-bold tracking-wider text-fg-base">
            {voucher.code}
          </p>
        </div>
      ) : null}
      <Field
        label={t("rewards.coinsToRedeem")}
        name="coins"
        required
        hint={t("rewards.redeemHint", { min: fmt.num(minRedeem), value: fmt.money(tk) })}
        error={errors.coins}
      >
        <Input
          name="coins"
          inputMode="numeric"
          value={coins}
          onChange={(e) => setCoins(e.target.value)}
          placeholder="0"
        />
      </Field>
      <Button type="submit" disabled={pending || balance < minRedeem} className="w-full">
        {pending ? t("common.saving") : t("rewards.redeem")}
      </Button>
    </form>
  );
}
