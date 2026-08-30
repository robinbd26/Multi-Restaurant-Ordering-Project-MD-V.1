import { Prisma } from "@prisma/client";

import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json, pageParams } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { ledgerStatusFor } from "@/lib/services/financials";
import { PAYMENT_STATUSES } from "@/lib/services/payments";
import { dhakaDayEndFromKey, dhakaDayStartFromKey } from "@/lib/utils/dates";

const ZERO = new Prisma.Decimal(0);

/** Refund filter values: any refund at all, or none. */
const REFUND_FILTERS = ["yes", "no"];

// GET /api/accounts/transactions — the order money ledger.
//   ?status= &payment_status= &method= &branch= &rider= &customer= &refunded=yes|no
//   &from=YYYY-MM-DD &to=YYYY-MM-DD &q=<order id or order number>
//   &page= &page_size=
//
// WS-2.9 — rider and customer are first-class ledger filters (a disputed COD
// hand-in is traced by WHO delivered it, not by order number), and `totals`
// covers the WHOLE filtered set as a database-side Decimal sum — a page total
// tells an accountant nothing about what the filter is actually worth. The
// envelope is hand-rolled rather than `paginated()` for exactly that reason,
// mirroring /api/accounts/commissions; results/count/next/previous are identical.
//
// WS-2.4 — `Order.paymentStatus` was read by no accounts route at all, so the
// ledger could show WHAT was ordered but never whether it had been paid for.
// It is now both a column and a filter.
//
// WS-2.6 — refunds are first-class here: every row carries the amount refunded,
// the net that remains, and a ledger status that says `refunded` /
// `partially_refunded` outright. The row shape is deliberately this route's own
// rather than the shared order serializer: an accounts ledger needs money
// columns (refunded, net, settled) that an order screen has no use for.
export const GET = handle(async (req: Request) => {
  await requireApiRole("accounts", "super_admin", "management");
  const url = new URL(req.url);
  const { skip, take } = pageParams(url);

  const where: Prisma.OrderWhereInput = {};
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("payment_status");
  const method = url.searchParams.get("method");
  const branch = url.searchParams.get("branch");
  const rider = url.searchParams.get("rider");
  const customer = (url.searchParams.get("customer") ?? "").trim();
  const refunded = url.searchParams.get("refunded");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const q = (url.searchParams.get("q") ?? "").trim();

  if (status) where.status = status;
  // Only a real lifecycle value may reach Prisma; anything else is ignored
  // rather than silently returning zero rows.
  if (paymentStatus && (PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) {
    where.paymentStatus = paymentStatus;
  }
  if (method) where.paymentMethod = method;
  if (branch && Number.isInteger(Number(branch))) where.branchId = Number(branch);
  // WS-2.9 — the rider who carried the order; unassigned orders never match.
  if (rider && Number.isInteger(Number(rider))) where.riderId = Number(rider);
  // WS-2.9 — customer lookup by what an accountant actually has in hand: the
  // name on the complaint, the @username, or the phone number on the order call.
  if (customer) {
    where.customer = {
      OR: [
        { firstName: { contains: customer } },
        { lastName: { contains: customer } },
        { username: { contains: customer } },
        { phone: { contains: customer } },
      ],
    };
  }
  if (refunded && REFUND_FILTERS.includes(refunded)) {
    where.refunds = refunded === "yes" ? { some: {} } : { none: {} };
  }
  // The customer-facing reference is the order NUMBER (#15); the internal id is
  // still accepted because that is what the older accounts screens linked to.
  if (q) {
    where.OR = Number.isNaN(Number(q))
      ? [{ orderNumber: { contains: q } }]
      : [{ id: Number(q) }, { orderNumber: { contains: q } }];
  }
  // A ledger day is a DHAKA day. `new Date("…T00:00:00")` is the server's
  // midnight, which on a UTC host shifted every filter by six hours.
  const fromAt = from ? dhakaDayStartFromKey(from) : null;
  const toAt = to ? dhakaDayEndFromKey(to) : null;
  if (fromAt || toAt) {
    where.createdAt = { ...(fromAt ? { gte: fromAt } : {}), ...(toAt ? { lte: toAt } : {}) };
  }

  const [count, grossAgg, refundAgg, orders] = await Promise.all([
    prisma.order.count({ where }),
    // Whole-filtered-set money, summed database-side as exact Decimals.
    prisma.order.aggregate({ where, _sum: { totalAmount: true } }),
    // Refunds ATTACHED to the matching orders — the same semantics as the
    // per-row `refunded_amount` column, so the card always ties to the table.
    prisma.refund.aggregate({ where: { order: where }, _sum: { amount: true } }),
    prisma.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        paidAmount: true,
        totalAmount: true,
        deliveryCharge: true,
        discountAmount: true,
        coinDiscountAmount: true,
        createdAt: true,
        paymentVerifiedAt: true,
        branch: { select: { id: true, name: true } },
        customer: { select: { firstName: true, lastName: true, username: true } },
        rider: { select: { firstName: true, lastName: true, username: true } },
        refunds: { select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  const gross = grossAgg._sum.totalAmount ?? ZERO;
  const refundedTotal = refundAgg._sum.amount ?? ZERO;

  return json({
    count,
    next: null,
    previous: null,
    totals: {
      gross: gross.toFixed(2),
      refunded: refundedTotal.toFixed(2),
      net: gross.minus(refundedTotal).toFixed(2),
    },
    results: orders.map((o) => {
      const refundedAmount = o.refunds.reduce((acc, r) => acc.plus(r.amount), ZERO);
      return {
        id: o.id,
        order_number: o.orderNumber ?? null,
        branch: o.branch.id,
        branch_name: o.branch.name,
        customer_name:
          `${o.customer.firstName} ${o.customer.lastName}`.trim() || o.customer.username,
        rider_name: o.rider
          ? `${o.rider.firstName} ${o.rider.lastName}`.trim() || o.rider.username
          : null,
        status: o.status,
        payment_method: o.paymentMethod,
        payment_status: o.paymentStatus,
        // What a gateway actually settled; null until one does.
        paid_amount: o.paidAmount ? o.paidAmount.toFixed(2) : null,
        payment_verified_at: o.paymentVerifiedAt ? o.paymentVerifiedAt.toISOString() : null,
        total_amount: o.totalAmount.toFixed(2),
        delivery_charge: o.deliveryCharge.toFixed(2),
        discount_amount: o.discountAmount.toFixed(2),
        coin_discount_amount: o.coinDiscountAmount.toFixed(2),
        refunded_amount: refundedAmount.toFixed(2),
        // What the business kept on this order after money handed back.
        net_amount: o.totalAmount.minus(refundedAmount).toFixed(2),
        ledger_status: ledgerStatusFor(o.totalAmount, refundedAmount, o.paymentStatus),
        created_at: o.createdAt.toISOString(),
      };
    }),
  });
});
