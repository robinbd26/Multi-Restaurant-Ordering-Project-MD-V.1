import { Prisma } from "@prisma/client";

import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { REPORTED_PAYMENT_METHODS } from "@/lib/services/financials";
import { PAYMENT_STATUSES } from "@/lib/services/payments";

const ZERO = new Prisma.Decimal(0);

/**
 * WS-2.4 — the payment lifecycle statuses that mean MONEY IS STILL OWED.
 *
 * `unpaid` covers cash-on-delivery that nobody has settled yet and any digital
 * order the customer never paid; `pending_verification` is a manual bKash claim
 * waiting on a staff decision (real money may or may not exist behind it);
 * `rejected` is a claim that was refused, so the order is unpaid again.
 */
const OWED_PAYMENT_STATUSES = ["unpaid", "pending_verification", "rejected"];

/** Statuses where a human or a gateway confirmed the money arrived. */
const SETTLED_PAYMENT_STATUSES = ["verified", "paid"];

// GET /api/accounts/payments — collections, the payment-method breakdown and
// (WS-2.4) the payment-STATUS position.
//
// WS-2.2 — Order.deliveryCharge is snapshotted immutably on every order but was
// referenced by zero finance code, so delivery-charge collections were invisible.
// totalAmount ALREADY contains the delivery charge (orders.ts: items + delivery −
// discounts), so delivery revenue is reported as a SLICE of sales — food revenue
// is sales − delivery revenue — and is never added on top of it.
//
// WS-2.4 — `Order.paymentStatus` was read by no accounts page or route at all.
// The "pending" stat counted UNDELIVERED orders, which is a kitchen metric, not
// a money one: an order can be delivered and still unpaid (that is exactly what
// cash on delivery is), and an order can be paid days before it ships. Accounts
// needs the money position, so the outstanding figures below are driven by
// paymentStatus over every live (non-cancelled) order, whatever its kitchen
// status. A cancelled order is excluded — nobody owes anything on it.
export const GET = handle(async () => {
  await requireApiRole("accounts", "super_admin", "management");

  const live: Prisma.OrderWhereInput = { status: { not: "cancelled" } };

  const [byMethod, byStatus, cancelledCount] = await Promise.all([
    prisma.order.groupBy({
      by: ["paymentMethod"],
      where: { status: "delivered" },
      _count: { _all: true },
      _sum: { totalAmount: true, deliveryCharge: true },
    }),
    prisma.order.groupBy({
      by: ["paymentStatus"],
      where: live,
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.count({ where: { status: "cancelled" } }),
  ]);

  const rows = new Map(
    // The methods the accounts requirements name are always present, even at
    // zero, so a missing row is never mistaken for missing money.
    REPORTED_PAYMENT_METHODS.map((payment_method) => [
      payment_method as string,
      { payment_method: payment_method as string, orders: 0, sales: ZERO, delivery: ZERO },
    ]),
  );
  for (const r of byMethod) {
    const row = rows.get(r.paymentMethod)
      ?? { payment_method: r.paymentMethod, orders: 0, sales: ZERO, delivery: ZERO };
    row.orders += r._count._all;
    row.sales = row.sales.plus(r._sum.totalAmount ?? ZERO);
    row.delivery = row.delivery.plus(r._sum.deliveryCharge ?? ZERO);
    rows.set(r.paymentMethod, row);
  }

  const collected = [...rows.values()].reduce((acc, r) => acc.plus(r.sales), ZERO);
  const deliveryCollected = [...rows.values()].reduce((acc, r) => acc.plus(r.delivery), ZERO);

  // Every lifecycle value is rendered even at zero, so an empty bucket reads as
  // "nothing is sitting there" instead of vanishing from the screen.
  const statusRows = new Map(
    PAYMENT_STATUSES.map((s) => [s as string, { payment_status: s as string, orders: 0, amount: ZERO }]),
  );
  for (const r of byStatus) {
    const row = statusRows.get(r.paymentStatus)
      ?? { payment_status: r.paymentStatus, orders: 0, amount: ZERO };
    row.orders += r._count._all;
    row.amount = row.amount.plus(r._sum.totalAmount ?? ZERO);
    statusRows.set(r.paymentStatus, row);
  }

  const sumOver = (statuses: string[]) =>
    [...statusRows.values()]
      .filter((r) => statuses.includes(r.payment_status))
      .reduce(
        (acc, r) => ({ orders: acc.orders + r.orders, amount: acc.amount.plus(r.amount) }),
        { orders: 0, amount: ZERO },
      );

  const owed = sumOver(OWED_PAYMENT_STATUSES);
  const settled = sumOver(SETTLED_PAYMENT_STATUSES);
  const awaitingVerification = sumOver(["pending_verification"]);

  return json({
    total_collected: collected.toFixed(2),
    // Split of the same money, not extra money: food + delivery === collected.
    food_collected: collected.minus(deliveryCollected).toFixed(2),
    delivery_collected: deliveryCollected.toFixed(2),
    cancelled_orders: cancelledCount,
    // WS-2.4 — the money position, by payment lifecycle status.
    outstanding_orders: owed.orders,
    outstanding_amount: owed.amount.toFixed(2),
    awaiting_verification_orders: awaitingVerification.orders,
    awaiting_verification_amount: awaitingVerification.amount.toFixed(2),
    settled_orders: settled.orders,
    settled_amount: settled.amount.toFixed(2),
    by_payment_status: [...statusRows.values()].map((r) => ({
      payment_status: r.payment_status,
      orders: r.orders,
      amount: r.amount.toFixed(2),
      /** Whether this bucket is money the business is still waiting for. */
      outstanding: OWED_PAYMENT_STATUSES.includes(r.payment_status),
    })),
    by_method: [...rows.values()]
      .sort((a, b) => (a.sales.greaterThan(b.sales) ? -1 : 1))
      .map((r) => ({
        payment_method: r.payment_method,
        orders: r.orders,
        sales: r.sales.toFixed(2),
        food_revenue: r.sales.minus(r.delivery).toFixed(2),
        delivery_revenue: r.delivery.toFixed(2),
      })),
  });
});
