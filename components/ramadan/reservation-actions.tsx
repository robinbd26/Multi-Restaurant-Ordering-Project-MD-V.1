"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import type { ActionState } from "@/lib/api/action-state";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

/**
 * Pay / cancel controls for ONE canonical Ramadan reservation, used by the
 * booking-detail page every advance notification deep-links to.
 *
 * WS-1.3 rules are unchanged and deliberately re-stated here: this component
 * never asserts a payment outcome. `pay` only asks the server to START a
 * gateway payment and hands the customer to the URL it returns; the advance is
 * settled by the verified gateway callback alone. With no gateway configured
 * the route answers with a translated field error ("settle at the branch"),
 * which is rendered instead of crashing.
 */
export function RamadanReservationActions({
  reservationId,
  status,
  paymentStatus,
  advanceRequired,
  bookingDate,
  slotLabel,
}: {
  reservationId: number;
  status: string;
  paymentStatus: string | null;
  advanceRequired: string;
  bookingDate: string;
  slotLabel: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsAdvance = Number(advanceRequired) > 0 && paymentStatus !== "paid" && paymentStatus !== "refunded";
  const cancellable = status !== "cancelled" && status !== "rejected" && status !== "completed";

  async function pay() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/ramadan/reservations/${reservationId}/pay`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { redirect_url?: string | null } | null;
      if (!res.ok) {
        setError(parseFieldErrors(data, t("errors.generic")).formError);
        return;
      }
      if (data?.redirect_url) {
        // The gateway is a THIRD-PARTY origin, so the app router cannot push it.
        window.location.assign(data.redirect_url);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<ActionState> {
    setError(null);
    const res = await fetch(`/api/ramadan/reservations/${reservationId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const { formError } = parseFieldErrors(data, t("errors.generic"));
      setError(formError);
      return { error: formError };
    }
    router.refresh();
    return { error: null };
  }

  if (!needsAdvance && !cancellable) return <Alert tone="error" message={error} />;

  return (
    <div className="space-y-3">
      <Alert tone="error" message={error} />
      <div className="flex flex-wrap gap-3">
        {needsAdvance ? (
          <Button type="button" onClick={pay} disabled={busy} data-testid="ramadan-detail-pay">
            {t("ramadan.payNow")}
          </Button>
        ) : null}
        {cancellable ? (
          <ConfirmModal
            trigger={
              <Button type="button" variant="ghost" size="sm" className="text-red-600">
                {t("ramadan.cancel")}
              </Button>
            }
            title={t("ramadan.cancelTitle")}
            description={t("ramadan.cancelDesc", { date: bookingDate, slot: slotLabel })}
            confirmLabel={t("ramadan.cancel")}
            action={cancel}
          />
        ) : null}
      </div>
    </div>
  );
}
