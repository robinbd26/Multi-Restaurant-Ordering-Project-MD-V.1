import { requireApproved } from "@/lib/auth/current-user";
import { handle, notFound, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { ORDER_FLOW_STATUSES } from "@/lib/constants/orders";
import { ORDER_INCLUDE } from "@/lib/selectors";
import { serializeOrder } from "@/lib/serializers";
import { overrideOrderStatus } from "@/lib/services/orders";
import type { OrderStatus } from "@/types";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/override-status { status, reason } — the emergency
// override (rider's phone died, rider forgot to tap Delivered). Branch manager
// (own branch) or super admin only, written reason required, logged to Activity
// Logs. Every rule is enforced in overrideOrderStatus, server-side.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { status?: string; reason?: string };
  const newStatus = body.status as OrderStatus;
  if (!newStatus || !(ORDER_FLOW_STATUSES as readonly string[]).includes(newStatus)) {
    throw validationError({ status: sk("errors.orders.selectValidStatus") });
  }
  const order = await prisma.order.findUnique({
    where: { id: Number(id) },
    include: { branch: { select: { managerId: true } } },
  });
  if (!order) throw notFound(sk("errors.orders.orderNotFound"));
  await overrideOrderStatus({ order, newStatus, user: me, reason: body.reason ?? "" });
  const full = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
  return json(serializeOrder(full, me));
});
