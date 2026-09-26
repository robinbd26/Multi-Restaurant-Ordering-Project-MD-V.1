import { requireApiRole } from "@/lib/auth/current-user";
import { forbidden, handle, notFound, sk } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { confirmReceive, isReceiveConfirmed } from "@/lib/services/rider-duty";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/rider/orders/[id]/confirm-receive — { confirmed }: has the assigned
// rider already confirmed physically receiving this order? Only that rider may ask.
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("rider");
  const { id } = await ctx.params;
  const order = await prisma.order.findUnique({ where: { id: Number(id) }, select: { id: true, riderId: true } });
  if (!order) throw notFound(sk("errors.orders.orderNotFound"));
  if (order.riderId !== me.id) throw forbidden(sk("errors.orders.orderNotAssignedToYou"));
  return json({ confirmed: await isReceiveConfirmed(order.id, me.id) });
});

// POST /api/rider/orders/[id]/confirm-receive — the assigned rider confirms
// physically receiving the order (idempotent, server-verified).
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("rider");
  const { id } = await ctx.params;
  const c = await confirmReceive(me, Number(id));
  return json({ order: c.orderId, rider: c.riderId, branch: c.branchId, status: c.status, confirmed_at: c.confirmedAt.toISOString() });
});
