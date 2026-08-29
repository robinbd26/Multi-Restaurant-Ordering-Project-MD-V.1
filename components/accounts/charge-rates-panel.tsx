"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors, type FieldErrors } from "@/lib/validation/contract";
import { max, min, number, required } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

const RULES: FieldRules = {
  tax_percent: [required, number, min(0), max(100)],
  service_charge_percent: [required, number, min(0), max(100)],
};

/**
 * WS-2.3 — the tax and service-charge rates the deductions report is built on.
 *
 * Both are EXTRACTION rates, not surcharges: the order pipeline never adds tax
 * or a service charge on top of a total (a Bangladeshi menu price is inclusive),
 * so these say what proportion of money already recorded is tax and service
 * charge. Changing them re-cuts how past takings are PRESENTED; not one recorded
 * amount changes, and no customer is ever charged more.
 *
 * Rendered only for a super admin — the API refuses the write to anyone else, so
 * hiding it is a courtesy, never the control.
 */
export function ChargeRatesPanel({
  taxPercent,
  servicePercent,
}: {
  taxPercent: string;
  servicePercent: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [tax, setTax] = useState(taxPercent);
  const [service, setService] = useState(servicePercent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);

  const submit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);
      setBusy(true);
      void (async () => {
        const res = await fetch("/api/admin/settings/charges", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tax_percent: tax.trim(),
            service_charge_percent: service.trim(),
          }),
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
        setSuccess(t("common.saved"));
        router.refresh();
      })();
    },
    [router, service, t, tax],
  );

  const { errors, formProps } = useFormValidation(RULES, {
    onSubmitValid: submit,
    serverErrors,
    submissionId,
    pending: busy,
  });

  return (
    <form {...formProps} className="space-y-3">
      <Alert tone="error" message={error} />
      {Object.keys(errors).length === 0 ? <Alert tone="success" message={success} /> : null}
      <Field
        label={t("financials.taxRateLabel")}
        name="tax_percent"
        required
        error={errors.tax_percent}
        hint={t("financials.chargesInclusiveHint")}
      >
        <Input name="tax_percent" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
      </Field>
      <Field
        label={t("financials.serviceChargeRateLabel")}
        name="service_charge_percent"
        required
        error={errors.service_charge_percent}
      >
        <Input
          name="service_charge_percent"
          inputMode="decimal"
          value={service}
          onChange={(e) => setService(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? t("common.saving") : t("common.save")}
      </Button>
    </form>
  );
}
