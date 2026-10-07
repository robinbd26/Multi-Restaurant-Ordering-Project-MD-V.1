import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { restoreBrand, serializeBrand } from "@/lib/services/brands";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/brands/[id]/restore — bring an archived brand back (inactive).
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  return json(serializeBrand(await restoreBrand(me, Number(id))));
});
