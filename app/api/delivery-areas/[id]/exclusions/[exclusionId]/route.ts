import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { removeExclusion } from "@/lib/services/delivery-areas";

type Ctx = { params: Promise<{ id: string; exclusionId: string }> };

// DELETE /api/delivery-areas/[id]/exclusions/[exclusionId] — lift a temporary
// block; the area is back exactly as drawn. SA any / BM own branch; logged.
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id, exclusionId } = await ctx.params;
  const exclusion = await removeExclusion(me, Number(id), Number(exclusionId));
  return json({ deleted: true, id: exclusion.id });
});
