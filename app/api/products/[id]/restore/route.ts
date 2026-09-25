import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { restoreProduct } from "@/lib/services/product-removal";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/products/[id]/restore — Super Admin only. Un-archives a product; it
// comes back unavailable, to be switched on deliberately. Logged.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  const product = await restoreProduct(me, Number(id));
  return json({ action: "restored", id: product.id });
});
