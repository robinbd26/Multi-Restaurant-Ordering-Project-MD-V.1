import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { archiveBrand, serializeBrand } from "@/lib/services/brands";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/brands/[id]/archive — hide a brand everywhere, keeping its history.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  return json(serializeBrand(await archiveBrand(me, Number(id))));
});
