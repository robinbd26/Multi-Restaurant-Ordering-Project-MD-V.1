import { requireApproved } from "@/lib/auth/current-user";
import { forbidden, handle, notFound, sk } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { ordersWhereForUser } from "@/lib/selectors";

type Ctx = { params: Promise<{ id: string }> };

// The lean snapshot the customer tracking poll compares against. Mirrored by
// the local interface in components/customer/live-order-refresh.tsx — keep the
// two in step (route files must only export HTTP methods).
interface OrderStatusSnapshot {
  id: number;
  status: string;
  payment_status: string;
  rider: number | null;
  updated_at: string;
}

// GET /api/orders/[id]/status — WS-5.8.
// The order-tracking poll: a customer watching their order must see "preparing"
// become "on the way" without reloading. Scoped by the SAME rule as the full
// order route, but the payload is deliberately tiny — one row, five fields, no
// items, no joins — because it rides a 10-second-ish interval on prepaid mobile
// data. `updated_at` is the change detector: any write to the order (a status
// transition, a payment verdict, a rider assignment) bumps it, and the client
// only re-renders the page when something actually moved.
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const orderId = Number(id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw notFound(sk("errors.orders.orderNotFound"));
  }
  const scope = await ordersWhereForUser(me);
  if (scope === null) throw forbidden();

  const order = await prisma.order.findFirst({
    where: { id: orderId, ...scope },
    select: { id: true, status: true, paymentStatus: true, riderId: true, updatedAt: true },
  });
  if (!order) throw notFound(sk("errors.orders.orderNotFound"));
  const snapshot: OrderStatusSnapshot = {
    id: order.id,
    status: order.status,
    payment_status: order.paymentStatus,
    rider: order.riderId ?? null,
    updated_at: order.updatedAt.toISOString(),
  };
  return json(snapshot);
});
