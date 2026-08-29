import type { Prisma } from "@prisma/client";

import { requireApproved } from "@/lib/auth/current-user";
import { forbidden, handle, sk } from "@/lib/http/errors";
import { pageParams, paginated } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { ordersWhereForUser } from "@/lib/selectors";
import type { PendingPaymentRow } from "@/components/orders/payment-verification-queue";

/** Staff who may even SEE the queue. Deciding is re-checked by the verify route. */
const QUEUE_ROLES = ["super_admin", "management", "accounts", "branch_manager"];

// GET /api/orders/pending-payments — WS-1.2.
// The manual-bKash verification queue: every order whose submission is waiting
// on a decision, scoped by the SAME rule the orders list uses, so a branch
// manager can only ever see (and therefore decide) their own branch. The branch
// board polls this, so the payload is deliberately lean — only what a decision
// is actually made on, never the full order with its items.
export const GET = handle(async (req: Request) => {
  const me = await requireApproved();
  if (!QUEUE_ROLES.includes(me.role)) throw forbidden(sk("errors.payments.verifyForbidden"));

  const scope = await ordersWhereForUser(me);
  const url = new URL(req.url);
  const { skip, take, page, pageSize } = pageParams(url);
  if (scope === null) return paginated([], { page, pageSize, count: 0 });

  const where: Prisma.OrderWhereInput = { ...scope, paymentStatus: "pending_verification" };
  const [count, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        branchId: true,
        branch: { select: { name: true } },
        customer: { select: { firstName: true, lastName: true, phone: true } },
        totalAmount: true,
        bkashTransactionId: true,
        bkashPayerPhone: true,
        bkashDestinationNumber: true,
        paymentSubmittedAt: true,
      },
      // Oldest submission first: a customer who has been waiting longest is
      // the one the branch has to answer next.
      orderBy: { paymentSubmittedAt: "asc" },
      skip,
      take,
    }),
  ]);

  const results: PendingPaymentRow[] = orders.map((o) => ({
    id: o.id,
    order_number: o.orderNumber ?? null,
    branch: o.branchId,
    branch_name: o.branch?.name ?? "",
    customer_name: o.customer ? `${o.customer.firstName} ${o.customer.lastName}`.trim() : "",
    customer_phone: o.customer?.phone ?? "",
    total_amount: o.totalAmount.toFixed(2),
    bkash_transaction_id: o.bkashTransactionId,
    bkash_payer_phone: o.bkashPayerPhone,
    bkash_destination_number: o.bkashDestinationNumber,
    payment_submitted_at: o.paymentSubmittedAt ? o.paymentSubmittedAt.toISOString() : null,
  }));
  return paginated(results, { page, pageSize, count });
});
