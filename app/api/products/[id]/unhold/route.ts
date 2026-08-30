import { requireApiRole } from "@/lib/auth/current-user";
import { handle, notFound, sk } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { revalidateCatalog } from "@/lib/cache/catalog";
import { prisma } from "@/lib/db";
import { serializeProduct } from "@/lib/serializers";
import { setCrossBranchProductHold } from "@/lib/services/catalog";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/products/[id]/unhold — lifts the super-admin cross-branch hold.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiRole("super_admin");
  const params = await ctx.params;
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw notFound(sk("errors.catalog.productNotFound"));
  }
  // WS-8.10 — same normalized match as the hold, so releasing frees every copy
  // the hold caught (including the case/whitespace variants).
  const { product, branchIds } = await setCrossBranchProductHold(id, false);
  const updated = await prisma.product.findUniqueOrThrow({
    where: { id: product.id },
    include: { branch: true, category: true },
  });
  // Resuming restores ordering across every branch the hold covered.
  for (const branchId of branchIds) revalidateCatalog({ branchId });
  revalidateCatalog({ productId: updated.id });
  return json(serializeProduct(updated));
});
