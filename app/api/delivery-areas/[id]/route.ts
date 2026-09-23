import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { deleteArea, serializeArea, updateArea } from "@/lib/services/delivery-areas";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/delivery-areas/[id] — name / shift / time / charge / shape.
// Ownership enforced in the service (SA any, BM own branch only), and every
// change is written to the activity log.
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    estimated_delivery_minutes?: unknown;
    delivery_charge?: unknown;
    shape?: unknown;
    is_active?: unknown;
    coverage_window?: unknown;
  };
  const area = await updateArea(me, Number(id), {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.estimated_delivery_minutes !== undefined
      ? { estimatedDeliveryMinutes: body.estimated_delivery_minutes }
      : {}),
    ...(body.delivery_charge !== undefined ? { deliveryCharge: body.delivery_charge } : {}),
    ...(body.shape !== undefined ? { shape: body.shape } : {}),
    ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
    ...(body.coverage_window !== undefined ? { coverageWindow: body.coverage_window } : {}),
  });
  return json(serializeArea(area));
});

// DELETE /api/delivery-areas/[id] — remove the area outright.
//
// A real delete, not a deactivation: an order never reads its area back (the
// name, charge and estimate are snapshotted onto the order at checkout and the
// link is SetNull), so removing a shape cannot rewrite a single invoice.
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const area = await deleteArea(me, Number(id));
  return json({ deleted: true, id: area.id, name: area.name });
});
