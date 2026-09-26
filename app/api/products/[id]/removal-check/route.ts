import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { productRemovalCheck } from "@/lib/services/product-removal";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/products/[id]/removal-check — Super Admin only. Whether the product
// was ever ordered or reviewed, i.e. whether a permanent delete is allowed.
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  const check = await productRemovalCheck(me, Number(id));
  return json({ order_lines: check.orderLines, reviews: check.reviews, deletable: check.deletable });
});
