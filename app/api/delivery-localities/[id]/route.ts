import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { updateLocality } from "@/lib/services/area-master-admin";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/delivery-localities/[id] — rename, or deactivate/reactivate.
// Deactivating stops the name being offered to customers and stops branches
// covering it; the addresses and orders that already reference it are untouched.
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    is_active?: unknown;
  };
  const locality = await updateLocality(me, Number(id), {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
  });
  return json({ id: locality.id, name: locality.name, is_active: locality.isActive });
});
