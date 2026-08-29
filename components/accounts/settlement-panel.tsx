"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors, type FieldErrors } from "@/lib/validation/contract";
import { date as dateRule, notFuture, required, selectRequired } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

export interface SettlementBranchOption {
  id: number;
  name: string;
}

/** The create response of POST /api/accounts/settlements. */
interface SettlementResult {
  date: string;
  orders: number;
  net: string;
  breakdown: {
    gross_sales: string;
    food_revenue: string;
    delivery_revenue: string;
    refunds: string;
    commission: string;
    expenses: string;
    adjustments_net: string;
    net_revenue: string;
  };
  cash: {
    collected: string;
    cash_collected: string;
    digital_collected: string;
    refunded: string;
    expected_in_hand: string;
  };
}

const RULES: FieldRules = {
  branch_id: [selectRequired],
  date: [required, dateRule, notFuture],
};

/**
 * WS-2.7 — generate an end-of-day settlement and SHOW what it is made of.
 *
 * A stored settlement carries four numbers (orders, sales, commission,
 * expenses) and a net that is none of them added up: the net also subtracts
 * refunds paid out and applies authorised adjustments, and BranchSettlement has
 * no column for either (the schema is frozen). Printing only the net would leave
 * an unexplained figure on screen, so the full derivation and the cash position
 * come back with the create response and are shown here.
 *
 * The day's takings are bucketed by DELIVERY time, not by when the order was
 * placed, over the DHAKA business day — which is what finally lets
 * "expected in hand" be checked against the cash the branch physically hands in.
 */
export function SettlementPanel({ branches }: { branches: SettlementBranchOption[] }) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  const [branchId, setBranchId] = useState(branches[0] ? String(branches[0].id) : "");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SettlementResult | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);

  const submit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setResult(null);
      setBusy(true);
      void (async () => {
        const res = await fetch("/api/accounts/settlements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch_id: Number(branchId), date: day }),
        });
        const data = await res.json().catch(() => null);
        setBusy(false);
        setSubmissionId((n) => n + 1);
        if (!res.ok) {
          const { fieldErrors, formError } = parseFieldErrors(data, t("errors.generic"));
          setServerErrors(fieldErrors);
          setError(Object.keys(fieldErrors).length ? null : formError);
          return;
        }
        setServerErrors({});
        setResult(data as SettlementResult);
        router.refresh();
      })();
    },
    [branchId, day, router, t],
  );

  const { errors, formProps } = useFormValidation(RULES, {
    onSubmitValid: submit,
    serverErrors,
    submissionId,
    pending: busy,
  });

  const line = (label: string, value: string, tone?: string) => (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className={tone ?? "font-medium text-fg-base"}>{fmt.money(value)}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <form {...formProps} className="space-y-3">
        <Alert tone="error" message={error} />
        <Field label={t("financials.branchLabel")} name="branch_id" required error={errors.branch_id}>
          <Select name="branch_id" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("financials.dateLabel")} name="date" required error={errors.date}>
          <Input name="date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? t("common.saving") : t("financials.generate")}
        </Button>
      </form>

      {result ? (
        <div className="space-y-3 rounded-xl border border-border-base bg-surface-muted p-4">
          <Alert tone="success" message={t("financials.settlementGenerated")} />
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t("financials.settlementBreakdown")}
          </p>
          {line(t("accounts.colSales"), result.breakdown.gross_sales)}
          {line(t("accounts.deliveryRevenue"), result.breakdown.delivery_revenue)}
          {line(t("accounts.refundsLabel"), result.breakdown.refunds, "font-medium text-red-600")}
          {line(t("wallet.totalCommission"), result.breakdown.commission)}
          {line(t("financials.expensesLabel"), result.breakdown.expenses)}
          {line(t("accounts.adjustmentsNet"), result.breakdown.adjustments_net)}
          <div className="flex justify-between gap-4 border-t border-border-base pt-2 text-sm font-bold">
            <span>{t("financials.netRevenue")}</span>
            <span className="text-emerald-600">{fmt.money(result.breakdown.net_revenue)}</span>
          </div>

          {/* What the branch should physically be holding for the day. */}
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t("financials.cashPosition")}
          </p>
          {line(t("accounts.cashCollected"), result.cash.cash_collected)}
          {line(t("accounts.digitalCollected"), result.cash.digital_collected)}
          {line(t("accounts.refundedOut"), result.cash.refunded, "font-medium text-red-600")}
          <div className="flex justify-between gap-4 border-t border-border-base pt-2 text-sm font-bold">
            <span>{t("accounts.expectedInHand")}</span>
            <span>{fmt.money(result.cash.expected_in_hand)}</span>
          </div>
          <p className="text-xs text-fg-subtle">{t("financials.deliveredBasisNote")}</p>
        </div>
      ) : null}
    </div>
  );
}
