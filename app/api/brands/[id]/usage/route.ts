import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { brandUsage } from "@/lib/services/brands";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/brands/[id]/usage — what refers to a brand, and whether it may be
// deleted outright (nothing does) or only archived.
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiRole("super_admin");
  const { id } = await ctx.params;
  return json(await brandUsage(Number(id)));
});
