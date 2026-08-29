"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, Td } from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors, type FieldErrors } from "@/lib/validation/contract";
import { money } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

/** One branch's rule as /api/accounts/commissions/rules serializes it. */
export interface CommissionRuleRow {
  branch: number;
  branch_name: string;
  /** null = inherits the default rate. */
  override: string | null;
  effective_rate: string;
  updated_at: string | null;
  updated_by_name: string | null;
}

// The rate may be left blank — that is how an override is CLEARED — so `money`
// is the only rule, and it passes on an empty value.
const RULES: FieldRules = { rate: [money] };

/**
 * WS-2.8 — the commission rule book Accounts is permitted to maintain.
 *
 * The global per-delivery rate stays super-admin owned (it is shown here, read
 * only, because the team that answers for every payout has to be able to see
 * what it is paying). The BRANCH rule is the part Accounts sets: an outlet that
 * pays a different rate — a longer average route, a harder area — no longer
 * needs a super admin for every adjustment.
 *
 * Changing a rule never revalues an existing RiderCommission: the amount was
 * snapshotted when the delivery completed, and rewriting history to match a new
 * rule would be a restatement, not a rate change.
 */
export function CommissionRulesPanel({
  defaultRate,
  rows,
}: {
  defaultRate: string;
  rows: CommissionRuleRow[];
}) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  const [branchId, setBranchId] = useState(rows[0] ? String(rows[0].branch) : "");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);

  const save = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);
      setBusy(true);
      void (async () => {
        const res = await fetch("/api/accounts/commissions/rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch_id: Number(branchId), rate: rate.trim() }),
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
        setSuccess(t("wallet.feeSaved"));
        setRate("");
        router.refresh();
      })();
    },
    [branchId, rate, router, t],
  );

  const { errors, formProps } = useFormValidation(RULES, {
    onSubmitValid: save,
    serverErrors,
    submissionId,
    pending: busy,
  });

  return (
    <div className="space-y-4">
      <form {...formProps} className="space-y-3">
        <Alert tone="error" message={error} />
        {Object.keys(errors).length === 0 ? <Alert tone="success" message={success} /> : null}
        <Field label={t("financials.branchLabel")} name="branch_id" required error={errors.branch_id}>
          <Select name="branch_id" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {rows.map((r) => (
              <option key={r.branch} value={r.branch}>{r.branch_name}</option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("wallet.feeLabel")}
          name="rate"
          error={errors.rate}
          hint={t("financials.commissionOverrideHint", { rate: fmt.money(defaultRate) })}
        >
          <Input
            name="rate"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={defaultRate}
          />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? t("common.saving") : t("wallet.setRate")}
        </Button>
      </form>

      <Table
        headers={[
          t("pages.colBranch"),
          t("financials.overrideLabel"),
          t("wallet.ratePerDelivery"),
          t("financials.recordedBy"),
        ]}
      >
        {rows.map((r) => (
          <tr key={r.branch} className="hover:bg-surface-hover/70">
            <Td><span className="font-medium text-fg-base">{r.branch_name}</span></Td>
            <Td>
              {r.override ? (
                <Badge tone="brand">{fmt.money(r.override)}</Badge>
              ) : (
                <span className="text-xs text-fg-subtle">{t("financials.inheritsDefault")}</span>
              )}
            </Td>
            <Td mono><span className="font-semibold">{fmt.money(r.effective_rate)}</span></Td>
            <Td>
              <span className="text-xs text-fg-muted">{r.updated_by_name ?? "—"}</span>
              {r.updated_at ? (
                <span className="block text-xs text-fg-subtle">{fmt.dateTime(r.updated_at)}</span>
              ) : null}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
