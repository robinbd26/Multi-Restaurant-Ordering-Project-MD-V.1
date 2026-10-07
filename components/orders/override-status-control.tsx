"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { OVERRIDE_REASON_MIN, orderStatusLabelKey, overrideTargets, type Fulfillment } from "@/lib/constants/orders";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";
import type { OrderStatus } from "@/types";

/**
 * "Override status" — the emergency lever for the branch manager and the super
 * admin (the rider's phone died, the rider forgot to tap Delivered). Styled as
 * a small, quiet link on purpose: it is not part of the normal flow. Needs a
 * written reason; the server (POST /api/orders/[id]/override-status) checks the
 * role, the branch, the target and the reason, and logs it to Activity Logs.
 */
export function OverrideStatusControl({
  orderId,
  status,
  fulfillment,
}: {
  orderId: number;
  status: OrderStatus;
  fulfillment?: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const channel: Fulfillment = fulfillment === "pickup" ? "pickup" : "delivery";
  const targets = overrideTargets(status, channel);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<OrderStatus | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (targets.length === 0) return null;

  async function submit() {
    setError(null);
    if (!target) return setError(t("orders.overridePickStatus"));
    if (reason.trim().length < OVERRIDE_REASON_MIN) {
      return setError(t("errors.orders.overrideReasonRequired", { min: OVERRIDE_REASON_MIN }));
    }
    setPending(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/override-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: target, reason: reason.trim() }),
      });
      if (!res.ok) {
        const parsed = parseFieldErrors(await res.json().catch(() => ({})), t("common.error"));
        setError(parsed.formError ?? Object.values(parsed.fieldErrors)[0] ?? t("common.error"));
        return;
      }
      setOpen(false);
      setTarget("");
      setReason("");
      router.refresh();
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs font-medium text-fg-subtle underline-offset-2 hover:text-fg-muted hover:underline"
        onClick={() => setOpen(true)}
        data-testid="override-open"
      >
        ⚠ {t("orders.overrideOpen")}
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-dashed border-border-strong bg-surface-muted p-3" data-testid="override-panel">
      <p className="text-sm font-semibold text-fg-base">{t("orders.overrideTitle")}</p>
      <p className="mt-0.5 text-xs text-fg-muted">{t("orders.overrideHint")}</p>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <Select
          value={target}
          aria-label={t("orders.overrideTarget")}
          onChange={(e) => setTarget(e.target.value as OrderStatus)}
          data-testid="override-target"
        >
          <option value="">{t("orders.overridePickStatus")}</option>
          {targets.map((s) => (
            <option key={s} value={s}>
              {t(orderStatusLabelKey(s, channel))}
            </option>
          ))}
        </Select>
        <Textarea
          rows={2}
          value={reason}
          aria-label={t("orders.overrideReason")}
          placeholder={t("orders.overrideReasonPlaceholder")}
          onChange={(e) => setReason(e.target.value)}
          data-testid="override-reason"
        />
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void submit()} data-testid="override-submit">
          {t("orders.overrideConfirm")}
        </Button>
      </div>
    </div>
  );
}
