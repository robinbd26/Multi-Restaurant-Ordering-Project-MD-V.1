import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { myReview } from "@/lib/services/product-reviews";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/products/[id]/reviews/mine — the customer's own review of this
// product (even if hidden) and whether they are allowed to write one.
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("customer");
  const { id } = await ctx.params;
  return json(await myReview(me, Number(id)));
});
