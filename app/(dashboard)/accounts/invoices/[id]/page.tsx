import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Prisma } from "@prisma/client";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PaymentStatusBadge } from "@/components/accounts/ledger-badges";
import { PrintButton } from "@/components/accounts/print-button";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { splitCharges } from "@/lib/services/financials";
import { chargeRates } from "@/lib/services/settings";
import { getT } from "@/lib/i18n/server";

const ZERO = new Prisma.Decimal(0);

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("financials.invoicesTitle") };
}

type Params = { params: Promise<{ id: string }> };

/** /accounts/invoices/[id] — printable invoice (browser print = PDF download). */
export default async function InvoicePage({ params }: Params) {
  const { t, fmt } = await getT();
  await requireRole("accounts", "super_admin");
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id: Number(id) },
    include: {
      customer: true,
      branch: true,
      items: { include: { product: true } },
      refunds: true,
      // The coupon that produced discountAmount, so the discount line can name
      // it. Archived coupons stay joinable (WS-7.2), so this never goes blank on
      // a historical invoice.
      coupon: true,
    },
  });
  if (!order) notFound();

  // WS-2.5 — THE INVOICE DID NOT ADD UP. `order.totalAmount` is the GRAND total
  // (items + delivery − coupon − coin discount); it was printed above the item
  // lines labelled "Subtotal", so the arithmetic on the page was visibly wrong
  // to any customer or auditor: line items that did not sum to the stated
  // subtotal, no delivery charge, no discount, and a total that ignored both.
  //
  // Every figure below is a real computed Decimal, and the ladder sums exactly:
  //   subtotal + delivery + platform fee − coupon − coins (± rounding) = grand total.
  const itemsSubtotal = order.items.reduce(
    (acc, i) => acc.plus(i.unitPrice.times(i.quantity)),
    ZERO,
  );
  const deliveryCharge = order.deliveryCharge;
  // PHASE 4 — the platform fee is part of the grand total (0 on older orders).
  const platformFee = order.platformFee;
  const couponDiscount = order.discountAmount;
  // WS-7.1 — coins are a real Taka discount of their own, kept apart from the
  // coupon's so the invoice can show what each one paid for.
  const coinDiscount = order.coinDiscountAmount;
  const grandTotal = order.totalAmount;

  // The order pipeline clamps a total at zero and rounds to the paisa, so the
  // stored grand total can differ from the ladder by a hair. Showing that
  // residual as its own line is what keeps the printed page self-consistent
  // instead of quietly disagreeing with itself.
  const computed = itemsSubtotal
    .plus(deliveryCharge)
    .plus(platformFee)
    .minus(couponDiscount)
    .minus(coinDiscount);
  const rounding = grandTotal.minus(computed);

  // Tax and the service charge are INCLUDED in the prices above — the order
  // pipeline never adds them on top — so they are extracted from the food slice
  // and shown as a memo under the total, never added to it. splitCharges() is
  // the same helper the deductions report uses, so an invoice and the report can
  // never disagree about a single order.
  const rates = await chargeRates();
  // Neither the delivery charge nor the platform fee is food, so tax and service
  // charge are never extracted from them.
  const foodSlice = grandTotal.minus(deliveryCharge).minus(platformFee);
  const charges = splitCharges(foodSlice.lessThan(0) ? ZERO : foodSlice, rates);
  const hasCharges = charges.tax.greaterThan(0) || charges.serviceCharge.greaterThan(0);

  const refunded = order.refunds.reduce((acc, r) => acc.plus(r.amount), ZERO);
  const netPayable = grandTotal.minus(refunded);

  return (
    <>
      <PageHeader
        title={`INV-${String(order.id).padStart(5, "0")}`}
        subtitle={t("financials.invoiceFor", { id: fmt.num(order.id) })}
        breadcrumbs={[
          { label: t("financials.invoicesTitle"), href: "/accounts/invoices" },
          { label: `INV-${String(order.id).padStart(5, "0")}` },
        ]}
        action={<PrintButton />}
      />
      <Card className="max-w-3xl print:border-0 print:shadow-none">
        <CardContent className="space-y-6 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-lg font-bold text-fg-base">MAD Delivery</p>
              <p className="text-sm text-fg-muted">{order.branch.name}</p>
              <p className="text-sm text-fg-muted">{order.branch.address}</p>
              <p className="text-sm text-fg-muted">{order.branch.phone}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-fg-muted">{t("financials.billedTo")}</p>
              <p className="font-semibold text-fg-base">
                {`${order.customer.firstName} ${order.customer.lastName}`.trim() || order.customer.username}
              </p>
              <p className="text-sm text-fg-muted">{order.customer.phone}</p>
              <p className="max-w-56 text-sm text-fg-muted">{order.deliveryAddress}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-1 rounded-xl bg-surface-muted px-4 py-3 text-sm">
            <span>
              <span className="text-fg-muted">{t("financials.invoiceNo")}: </span>
              <span className="font-semibold">INV-{String(order.id).padStart(5, "0")}</span>
            </span>
            <span>
              <span className="text-fg-muted">{t("pages.colDate")}: </span>
              <span className="font-semibold">{fmt.dateTime(order.createdAt.toISOString())}</span>
            </span>
            <span>
              <span className="text-fg-muted">{t("pages.colMethod")}: </span>
              <span className="font-semibold">{t(`payment.${order.paymentMethod}`)}</span>
            </span>
            <span>
              <span className="text-fg-muted">{t("pages.colStatus")}: </span>
              <span className="font-semibold">{t(`orderStatus.${order.status}`)}</span>
            </span>
            {/* WS-2.4 — an invoice that shows the kitchen status but not the
                payment status cannot tell anyone whether it has been paid. */}
            <span className="inline-flex items-center gap-1.5">
              <span className="text-fg-muted">{t("financials.paymentStatusLabel")}: </span>
              <PaymentStatusBadge status={order.paymentStatus} />
            </span>
          </div>

          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-base text-xs uppercase tracking-wide text-fg-muted">
                <th className="py-2">{t("adminExtras.colProduct")}</th>
                <th className="py-2 text-right">{t("financials.qty")}</th>
                <th className="py-2 text-right">{t("financials.unitPrice")}</th>
                <th className="py-2 text-right">{t("financials.lineTotal")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-base">
              {order.items.map((i) => (
                <tr key={i.id}>
                  {/* The immutable order-time snapshot first: renaming a product
                      must never rewrite what a printed invoice said. */}
                  <td className="py-2.5 font-medium text-fg-base">
                    {i.productName || i.product?.name || `#${i.productId}`}
                    {i.variationName ? <span className="text-fg-muted"> · {i.variationName}</span> : null}
                  </td>
                  <td className="py-2.5 text-right">{fmt.num(i.quantity)}</td>
                  <td className="py-2.5 text-right">{fmt.money(i.unitPrice.toFixed(2))}</td>
                  <td className="py-2.5 text-right font-semibold">
                    {fmt.money(i.unitPrice.times(i.quantity).toFixed(2))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ml-auto w-64 space-y-1.5 text-sm">
            {/* The real sum of the item lines above — not the grand total. */}
            <div className="flex justify-between">
              <span className="text-fg-muted">{t("financials.subtotal")}</span>
              <span className="font-semibold">{fmt.money(itemsSubtotal.toFixed(2))}</span>
            </div>
            {deliveryCharge.greaterThan(0) ? (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t("accounts.deliveryRevenue")}</span>
                <span>{fmt.money(deliveryCharge.toFixed(2))}</span>
              </div>
            ) : null}
            {platformFee.greaterThan(0) ? (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t("home.order.platformFee")}</span>
                <span>{fmt.money(platformFee.toFixed(2))}</span>
              </div>
            ) : null}
            {couponDiscount.greaterThan(0) ? (
              <div className="flex justify-between text-emerald-600">
                <span>
                  {t("financials.couponDiscount")}
                  {order.coupon ? ` (${order.coupon.code})` : ""}
                </span>
                <span>-{fmt.money(couponDiscount.toFixed(2))}</span>
              </div>
            ) : null}
            {coinDiscount.greaterThan(0) ? (
              <div className="flex justify-between text-emerald-600">
                <span>{t("financials.coinDiscount", { coins: fmt.num(order.coinsRedeemed) })}</span>
                <span>-{fmt.money(coinDiscount.toFixed(2))}</span>
              </div>
            ) : null}
            {/* Only ever non-zero when the pipeline clamped or rounded the total;
                printed rather than hidden so the column always foots. */}
            {!rounding.equals(0) ? (
              <div className="flex justify-between text-fg-muted">
                <span>{t("financials.roundingAdjustment")}</span>
                <span>{rounding.isNegative() ? "-" : "+"}{fmt.money(rounding.abs().toFixed(2))}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-border-base pt-1.5 text-base font-bold text-fg-base">
              <span>{t("financials.total")}</span>
              <span>{fmt.money(grandTotal.toFixed(2))}</span>
            </div>

            {/* Memo: tax and service charge are already inside the total above. */}
            {hasCharges ? (
              <div className="space-y-1 border-t border-dashed border-border-base pt-1.5 text-xs text-fg-muted">
                <p>{t("financials.chargesIncluded")}</p>
                {charges.tax.greaterThan(0) ? (
                  <div className="flex justify-between">
                    <span>{t("financials.taxLabel", { rate: rates.taxPercent.toFixed(2) })}</span>
                    <span>{fmt.money(charges.tax.toFixed(2))}</span>
                  </div>
                ) : null}
                {charges.serviceCharge.greaterThan(0) ? (
                  <div className="flex justify-between">
                    <span>{t("financials.serviceChargeLabel", { rate: rates.servicePercent.toFixed(2) })}</span>
                    <span>{fmt.money(charges.serviceCharge.toFixed(2))}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {refunded.greaterThan(0) ? (
              <>
                <div className="flex justify-between border-t border-border-base pt-1.5 text-red-600">
                  <span>{t("financials.refunded")}</span>
                  <span>-{fmt.money(refunded.toFixed(2))}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-fg-base">
                  <span>{t("financials.netPayable")}</span>
                  <span>{fmt.money(netPayable.toFixed(2))}</span>
                </div>
              </>
            ) : null}
          </div>

          <p className="text-center text-xs text-fg-subtle">{t("financials.invoiceFooter")}</p>
        </CardContent>
      </Card>
    </>
  );
}
