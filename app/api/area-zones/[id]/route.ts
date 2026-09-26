import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json, noContent } from "@/lib/http/respond";
import { deleteZone, updateZone } from "@/lib/services/area-master-admin";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/area-zones/[id] — rename, or deactivate/reactivate.
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    is_active?: unknown;
  };
  const zone = await updateZone(me, Number(id), {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
  });
  return json({ id: zone.id, name: zone.name, is_active: zone.isActive });
});

// DELETE /api/area-zones/[id] — Super Admin only. Removes a zone no branch
// uses (orders and addresses keep area names as their own text). A zone in use
// is refused with 409 naming the branches to reassign first.
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  await deleteZone(me, Number(id));
  return noContent();
});
