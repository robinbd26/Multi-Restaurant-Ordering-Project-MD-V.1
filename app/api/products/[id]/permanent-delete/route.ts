import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { permanentlyDeleteProduct } from "@/lib/services/product-removal";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/products/[id]/permanent-delete — Super Admin only. Deletes a product
// that was never ordered or reviewed (409 otherwise). Logged.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  await permanentlyDeleteProduct(me, Number(id));
  return json({ action: "deleted" });
});
