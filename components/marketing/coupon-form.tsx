"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Field, Input, Select } from "@/components/ui/input";
import { deleteCouponAction, saveCouponAction } from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors, type FieldErrors } from "@/lib/validation/contract";
import { LIMITS } from "@/lib/validation/limits";
import { afterField, integer, max, maxLength, min, money, oneOf, positive, required } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

export interface CouponInitial {
  id: number;
  code: string;
  discount_type: string;
  value: string;
  min_order: string;
  max_uses: number;
  per_customer_limit: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  branch_id: number | null;
  branch_name?: string | null;
  state?: string;
}

export interface CouponBranchOption {
  id: number;
  name: string;
}

/** ISO instant → what a datetime-local input shows, in the viewer's own clock. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * datetime-local value → an absolute instant. Converted in the BROWSER, which
 * knows the operator's timezone; a bare "2026-09-16T23:59" sent as-is would be
 * read in whatever zone the server happens to run in (UTC in most deployments,
 * six hours away from Dhaka).
 */
function fromLocalInput(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * PHASE 5 — the ONE coupon form, used by marketing, super admin and branch
 * managers alike.
 *
 * Scope: super admin and marketing choose "all branches" or one branch; a branch
 * manager's coupon is locked to their own branch (the server enforces this too,
 * so the locked display is a courtesy, not the guard).
 *
 * Limits: one use per customer by default, editable (0 = no per-customer cap),
 * plus an optional total cap across all customers.
 *
 * Expiry: a scheduled start and end, date AND time, and a separate "End now"
 * action — both, not one or the other.
 */
export function CouponForm({
  initial,
  branches = [],
  lockedBranch = null,
  listPath = "/marketing/coupons",
}: {
  initial: CouponInitial | null;
  branches?: CouponBranchOption[];
  lockedBranch?: CouponBranchOption | null;
  listPath?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState(initial?.code ?? "");
  const [discountType, setDiscountType] = useState(initial?.discount_type ?? "percent");
  const [value, setValue] = useState(initial?.value ?? "");
  const [minOrder, setMinOrder] = useState(initial?.min_order ?? "0");
  const [maxUses, setMaxUses] = useState(initial ? String(initial.max_uses) : "0");
  // A new coupon starts at the one-per-customer default; an existing uncapped one shows 0.
  const [perCustomer, setPerCustomer] = useState(initial ? String(initial.per_customer_limit ?? 0) : "1");
  const [branchId, setBranchId] = useState(initial?.branch_id != null ? String(initial.branch_id) : "");
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial?.ends_at ?? null));
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);

  /** A percentage discount can never exceed 100. */
  const validatePercent = useCallback((): FieldErrors => {
    const v = Number(value);
    if (discountType === "percent" && Number.isFinite(v) && v > LIMITS.percentMax) {
      return { value: t("marketingX.errPercent") };
    }
    return {};
  }, [discountType, t, value]);

  const RULES: FieldRules = {
    code: [required, maxLength(24)],
    discount_type: [required, oneOf(["percent", "fixed"])],
    value: [required, money, positive],
    min_order: [required, money],
    max_uses: [required, integer, min(0), max(LIMITS.pointsMax)],
    per_customer_limit: [required, integer, min(0), max(LIMITS.pointsMax)],
    // datetime-local values are fixed-width, so a string comparison orders them.
    ends_at: [afterField("starts_at")],
  };

  const submit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      start(async () => {
        const res = await saveCouponAction(
          initial?.id ?? null,
          {
            code: code.trim().toUpperCase(),
            discount_type: discountType,
            value,
            min_order: minOrder || "0",
            max_uses: Number(maxUses),
            per_customer_limit: Number(perCustomer),
            // "" clears a schedule on edit; the form is the source of truth.
            starts_at: fromLocalInput(startsAt),
            ends_at: fromLocalInput(endsAt),
            is_active: isActive,
            ...(lockedBranch ? {} : { branch_id: branchId === "" ? null : Number(branchId) }),
          },
          listPath,
        );
        setSubmissionId((n) => n + 1);
        setServerErrors(res?.fieldErrors ?? {});
        if (res?.error) setError(res.error);
      });
    },
    [branchId, code, discountType, endsAt, initial, isActive, listPath, lockedBranch, maxUses, minOrder, perCustomer, startsAt, value],
  );

  const { errors, formProps } = useFormValidation(RULES, {
    validate: validatePercent,
    onSubmitValid: submit,
    serverErrors,
    submissionId,
    pending,
  });

  // A coupon scoped to a branch that has since been archived still shows that
  // branch, rather than falling back to the first option ("all branches") and
  // silently widening the coupon on save.
  const scopeOptions =
    initial?.branch_id != null && !branches.some((b) => b.id === initial.branch_id)
      ? [...branches, { id: initial.branch_id, name: initial.branch_name ?? `#${initial.branch_id}` }]
      : branches;

  const canEnd = initial != null && initial.state !== "ended" && initial.state !== "archived";

  return (
    <form {...formProps} className="space-y-4">
      <Alert tone="error" message={error} />

      <Field label={t("marketingX.scopeLabel")} name="branch_id" error={errors.branch_id}>
        {lockedBranch ? (
          <p className="rounded-xl border border-border-base bg-surface-muted px-4 py-2.5 text-sm font-medium text-fg-base" data-testid="coupon-scope-locked">
            {t("marketingX.scopeBranchOnly", { branch: lockedBranch.name })}
          </p>
        ) : (
          <Select name="branch_id" value={branchId} onChange={(e) => setBranchId(e.target.value)} data-testid="coupon-scope">
            <option value="">{t("marketingX.scopeAll")}</option>
            {scopeOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("marketingX.codeLabel")} name="code" required error={errors.code}>
          <Input name="code" className="uppercase" value={code} onChange={(e) => setCode(e.target.value)} maxLength={24} data-testid="coupon-code" />
        </Field>
        <Field label={t("marketingX.discountTypeLabel")} name="discount_type" required error={errors.discount_type}>
          <Select name="discount_type" value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
            <option value="percent">{t("marketingX.percent")}</option>
            <option value="fixed">{t("marketingX.fixed")}</option>
          </Select>
        </Field>
        <Field label={t("marketingX.valueLabel")} name="value" required error={errors.value}>
          <Input name="value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label={t("marketingX.minOrderLabel")} name="min_order" required error={errors.min_order}>
          <Input name="min_order" inputMode="decimal" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
        </Field>
        <Field label={t("marketingX.maxUsesLabel")} name="max_uses" required hint={t("marketingX.totalCapHint")} error={errors.max_uses}>
          <Input name="max_uses" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </Field>
        <Field
          label={t("marketingX.perCustomerLabel")}
          name="per_customer_limit"
          required
          hint={t("marketingX.perCustomerHint")}
          error={errors.per_customer_limit}
        >
          <Input
            name="per_customer_limit"
            inputMode="numeric"
            value={perCustomer}
            onChange={(e) => setPerCustomer(e.target.value)}
            data-testid="coupon-per-customer"
          />
        </Field>
        <Field label={t("marketingX.startsLabel")} name="starts_at" error={errors.starts_at}>
          <Input name="starts_at" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label={t("marketingX.endsLabel")} name="ends_at" hint={t("marketingX.scheduleHint")} error={errors.ends_at}>
          <Input name="ends_at" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="size-4 rounded border-border-strong text-brand-500"
        />
        {t("marketingX.activeLabel")}
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canEnd ? (
          <ConfirmModal
            trigger={
              <Button type="button" variant="outline" className="text-red-600" data-testid="coupon-end-now">
                {t("marketingX.endNow")}
              </Button>
            }
            title={t("marketingX.endNowTitle", { code: initial.code })}
            description={t("marketingX.endNowBody")}
            confirmLabel={t("marketingX.endNow")}
            action={async () => {
              const res = await fetch(`/api/marketing/coupons/${initial.id}/end`, { method: "POST" });
              if (!res.ok) {
                const payload: unknown = await res.json().catch(() => ({}));
                const parsed = parseFieldErrors(payload, t("common.error"));
                return { error: parsed.formError ?? t("common.error") };
              }
              router.push(listPath);
              router.refresh();
              return { error: null };
            }}
          />
        ) : (
          <span />
        )}
        <span className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={pending} data-testid="coupon-save">
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </span>
      </div>
    </form>
  );
}

export function CouponDeleteButton({
  couponId,
  listPath = "/marketing/coupons",
}: {
  couponId: number;
  listPath?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <ConfirmModal
      trigger={
        <Button size="sm" variant="ghost" className="text-red-600">
          {t("common.delete")}
        </Button>
      }
      title={t("marketingX.deleteCouponTitle")}
      description={t("marketingX.deleteCouponDesc")}
      confirmLabel={t("common.delete")}
      action={async () => {
        const res = await deleteCouponAction(couponId, listPath);
        router.refresh();
        return res;
      }}
    />
  );
}
