import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RamadanReservationActions } from "@/components/ramadan/reservation-actions";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { param, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import { getRamadanReservation, serializeReservation } from "@/lib/services/ramadan";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("ramadan.details") };
}

const STATUS_TONE: Record<string, "amber" | "green" | "red" | "blue" | "slate"> = {
  pending_payment: "amber", pending: "amber", confirmed: "green", rejected: "red", cancelled: "red", completed: "blue",
};
const PAYMENT_TONE: Record<string, "amber" | "green" | "red" | "blue" | "slate"> = {
  unpaid: "slate", pending: "amber", paid: "green", failed: "red", refunded: "blue",
};

/**
 * /customer/ramadan-bookings/[id] — one canonical Ramadan booking.
 *
 * Every advance notification and the gateway callback already deep-linked here
 * (`/customer/ramadan-bookings/{id}?payment=…`), but the page did not exist, so
 * a customer who followed "your advance is required" or came back from bKash
 * landed on a 404. Access is decided server-side by `getRamadanReservation`,
 * which applies the same role scope as the list — a guessed id shows nothing.
 */
export default async function CustomerRamadanBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("customer");
  const me = (await getSessionUser())!;
  const { id } = await params;
  const sp = await searchParams;

  const found = await getRamadanReservation(me, Number(id)).catch(() => null);
  if (!found) notFound();
  const r = serializeReservation(found);

  // Outcome of a gateway return trip. It is only a HINT for the banner — the
  // booking's real state is whatever the verified callback already wrote.
  const outcome = param(sp, "payment");
  const paymentNotice =
    outcome === "paid" || outcome === "already_paid"
      ? { tone: "green" as const, text: t("ramadan.paymentOk") }
      : outcome === "mismatch"
        ? { tone: "red" as const, text: t("ramadan.paymentMismatchNotice") }
        : outcome
          ? { tone: "amber" as const, text: t("ramadan.paymentFailedNotice") }
          : null;

  const paid = r.payment ? Number(r.payment.paid_amount) : 0;
  const remaining = (Number(r.total_amount) - paid).toFixed(2);

  return (
    <>
      <PageHeader
        title={r.guest_name || t("ramadan.details")}
        subtitle={`${r.branch_name} · ${r.booking_date}${r.slot_label ? ` · ${r.slot_label}` : ""}`}
        breadcrumbs={[{ label: t("ramadan.myBookings"), href: "/customer/ramadan-bookings" }, { label: t("ramadan.details") }]}
        action={<Badge tone={STATUS_TONE[r.status] ?? "slate"}>{t(`ramadanStatus.${r.status}`)}</Badge>}
      />

      {paymentNotice ? (
        <p
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            paymentNotice.tone === "green"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
              : paymentNotice.tone === "red"
                ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
          }`}
          role="status"
          data-testid="ramadan-payment-notice"
        >
          {paymentNotice.text}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("ramadan.bookingSummary")} />
          <CardContent className="space-y-2.5 text-sm">
            <Row label={t("ramadan.selectMenu")} value={r.menu_name || "—"} />
            {r.menu_items.length > 0 ? <Row label={t("ramadan.items")} value={r.menu_items.join(" · ")} /> : null}
            <Row label={t("ramadan.quantity")} value={fmt.num(r.menu_quantity)} />
            <Row label={t("ramadan.total")} value={fmt.money(r.total_amount)} />
            <Row label={t("ramadan.advanceRequired")} value={fmt.money(r.advance_required)} />
            <Row label={t("ramadan.paid")} value={fmt.money(paid.toFixed(2))} />
            <Row label={t("ramadan.remaining")} value={fmt.money(remaining)} />
            {r.payment ? (
              <div className="flex justify-between gap-3">
                <span className="text-fg-muted">{t("ramadan.paymentStatus")}</span>
                <Badge tone={PAYMENT_TONE[r.payment.status] ?? "slate"}>
                  {t(`ramadanPaymentStatus.${r.payment.status}`)}
                </Badge>
              </div>
            ) : null}
            <p className="pt-2 text-xs text-fg-subtle">{t("ramadan.terms")}</p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t("ramadan.details")} />
            <CardContent className="space-y-2.5 text-sm">
              <Row label={t("ramadan.selectBranch")} value={r.branch_name} />
              <Row label={t("ramadan.bookingDate")} value={r.booking_date} />
              <Row label={t("ramadan.selectSlot")} value={r.slot_label || "—"} />
              <Row label={t("ramadan.selectTable")} value={r.table_name ?? "—"} />
              <Row label={t("ramadan.guests")} value={fmt.num(r.party_size)} />
              <Row label={t("bmExtras.guestName")} value={r.guest_name} />
              <Row label={t("bmExtras.guestPhone")} value={r.guest_phone} />
              {r.special_request ? <Row label={t("ramadan.specialRequest")} value={r.special_request} /> : null}
              {r.rejection_reason ? <Row label={t("ramadan.rejectReason")} value={r.rejection_reason} /> : null}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-5">
              <RamadanReservationActions
                reservationId={r.id}
                status={r.status}
                paymentStatus={r.payment?.status ?? null}
                advanceRequired={r.advance_required}
                bookingDate={r.booking_date}
                slotLabel={r.slot_label}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right font-medium text-fg-base">{value}</span>
    </div>
  );
}
