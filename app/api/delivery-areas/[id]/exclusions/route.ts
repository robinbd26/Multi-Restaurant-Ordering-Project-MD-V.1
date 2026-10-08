import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { created } from "@/lib/http/respond";
import { addExclusion, serializeExclusion } from "@/lib/services/delivery-areas";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/delivery-areas/[id]/exclusions { shape, reason?, ends_at? }
// Temporarily block part of the area (road closed, flooding, an event). The
// area's own shape is never touched; removing the block restores it exactly.
// SA any branch / BM own branch, enforced and logged in the service.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { shape?: unknown; reason?: unknown; ends_at?: unknown };
  const exclusion = await addExclusion(me, Number(id), {
    shape: body.shape,
    reason: body.reason,
    endsAt: body.ends_at,
  });
  return created(serializeExclusion(exclusion));
});
