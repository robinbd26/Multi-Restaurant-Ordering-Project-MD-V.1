"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { updateOrderStatusAction } from "@/lib/api/actions";
import { DELAY_MINUTE_OPTIONS } from "@/lib/constants/orders";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/types";

const NEXT_LABEL_KEYS: Partial<Record<OrderStatus, string>> = {
  accepted: "orders.nextAccepted",
  preparing: "orders.nextPreparing",
  ready: "orders.nextReady",
  picked_up: "orders.nextPickedUp",
  on_the_way: "orders.nextOnTheWay",
  delivered: "orders.nextDelivered",
  delayed: "orders.nextDelayed",
};

/**
 * Buttons for the valid next statuses of an order.
 * `nextStatuses` is computed on the server per role; the server re-validates
 * both the transition and the role, so nothing here is trusted.
 *
 * Two statuses need more than a click, because the service REFUSES them
 * otherwise (WS-5.1/5.2):
 *   • `cancelled` — a manager's or rider's cancellation must carry a reason, so
 *     it opens the shared confirm dialog in its `withReason` mode. The dialog
 *     keeps the server's message next to the action when the reason is missing.
 *   • `delayed` — the rider has to say how much extra time is needed, so it
 *     opens an inline panel with quick-pick minutes plus an optional note.
 */
export function OrderStatusActions({
  orderId,
  nextStatuses,
  pickup = false,
}: {
  orderId: number;
  nextStatuses: OrderStatus[];
  /**
   * ITEM 6 — a pickup order's "delivered" transition IS its "Picked Up
   * (Done)" step (lib/services/orders.ts allows ready → delivered directly
   * for pickup orders), so the button needs pickup wording rather than the
   * delivery-flow "Mark as Delivered".
   */
  pickup?: boolean;
}) {
  const { t, fmt } = useTranslation();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [delayOpen, setDelayOpen] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState<number>(DELAY_MINUTE_OPTIONS[1]);
  const [delayNote, setDelayNote] = useState("");

  const forward = nextStatuses.filter((s) => s !== "cancelled" && s !== "delayed");
  const canCancel = nextStatuses.includes("cancelled");
  const canDelay = nextStatuses.includes("delayed");

  function advance(status: OrderStatus) {
    startTransition(async () => {
      const result = await updateOrderStatusAction(orderId, status);
      setError(result.error);
    });
  }

  function closeDelay() {
    setDelayOpen(false);
    setDelayNote("");
    setError(null);
  }

  function submitDelay() {
    startTransition(async () => {
      // The note is optional; the MINUTES are what the customer is told about.
      const result = await updateOrderStatusAction(orderId, "delayed", {
        delayMinutes,
        reason: delayNote,
      });
      setError(result.error);
      if (!result.error) {
        setDelayOpen(false);
        setDelayNote("");
      }
    });
  }

  if (nextStatuses.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error ? <p className="w-full text-sm text-red-600">{error}</p> : null}
      {forward.map((status) => (
        <Button
          key={status}
          size="sm"
          variant={status === "delivered" ? "success" : "primary"}
          disabled={pending}
          onClick={() => advance(status)}
        >
          {pending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : null}
          {pickup && status === "delivered"
            ? t("orders.nextPickedUpDone")
            : NEXT_LABEL_KEYS[status]
              ? t(NEXT_LABEL_KEYS[status]!)
              : t(`orderStatus.${status}`)}
        </Button>
      ))}
      {canDelay && !delayOpen ? (
        <Button
          size="sm"
          variant="outline"
          className="text-amber-700 dark:text-amber-300"
          disabled={pending}
          onClick={() => {
            setError(null);
            setDelayOpen(true);
          }}
        >
          {t("orders.nextDelayed")}
        </Button>
      ) : null}
      {canCancel ? (
        <ConfirmModal
          trigger={
            <Button size="sm" variant="outline" className="text-red-600" disabled={pending}>
              {t("orders.cancelOrder")}
            </Button>
          }
          title={t("orders.cancelOrderConfirmTitle")}
          description={t("orders.cancelOrderConfirmDesc")}
          confirmLabel={t("orders.cancelOrderConfirmLabel")}
          // The service rejects a reasonless staff cancellation, so the dialog
          // has to collect one — this is what made Cancel impossible before.
          withReason
          reasonPlaceholder={t("orders.cancelReasonPlaceholder")}
          action={async (reason) => updateOrderStatusAction(orderId, "cancelled", { reason })}
        />
      ) : null}
      {canDelay && delayOpen ? (
        <div className="w-full rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-semibold text-fg-base">{t("orders.delayTitle")}</p>
          <p className="mt-1 text-xs text-fg-muted">{t("orders.delayDesc")}</p>
          <fieldset className="mt-3">
            <legend className="text-xs font-medium text-fg-muted">
              {t("orders.delayMinutesLabel")}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DELAY_MINUTE_OPTIONS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={minutes === delayMinutes}
                  disabled={pending}
                  onClick={() => setDelayMinutes(minutes)}
                  className={cn(
                    // min-h-10 keeps every chip a comfortable touch target on the
                    // phones riders actually use.
                    "min-h-10 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
                    minutes === delayMinutes
                      ? "bg-amber-500 text-white"
                      : "bg-surface-card text-fg-muted ring-1 ring-border-base hover:bg-surface-hover",
                  )}
                >
                  {t("orders.delayMinutesOption", { minutes: fmt.num(minutes) })}
                </button>
              ))}
            </div>
          </fieldset>
          <Textarea
            className="mt-3"
            rows={2}
            value={delayNote}
            disabled={pending}
            aria-label={t("orders.delayNoteLabel")}
            placeholder={t("orders.delayNotePlaceholder")}
            onChange={(e) => setDelayNote(e.target.value)}
          />
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button size="sm" variant="outline" disabled={pending} onClick={closeDelay}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" disabled={pending} onClick={submitDelay}>
              {pending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : null}
              {t("orders.delayConfirm")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
