import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { updateZone } from "@/lib/services/area-master-admin";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/area-zones/[id] — rename, or deactivate/reactivate.
// Never deletes: saved addresses and placed orders reference these names, so a
// retired zone is deactivated and simply stops being offered.
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
