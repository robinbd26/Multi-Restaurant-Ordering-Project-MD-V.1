import { requireApiRole } from "@/lib/auth/current-user";
import { handle, notFound, sk } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { revalidateCatalog } from "@/lib/cache/catalog";
import { prisma } from "@/lib/db";
import { serializeProduct } from "@/lib/serializers";
import { setCrossBranchProductHold } from "@/lib/services/catalog";
import { notifyBranchManagers } from "@/lib/services/notifications";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/products/[id]/hold — super admin holds a product (blocks sale
// everywhere; per PDF an SA hold applies across all branches).
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiRole("super_admin");
  const params = await ctx.params;
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw notFound(sk("errors.catalog.productNotFound"));
  }
  // WS-8.10 — the cross-branch match is case/whitespace-insensitive (see
  // setCrossBranchProductHold), so "beef burger " no longer escapes the hold.
  const { product, branchIds } = await setCrossBranchProductHold(id, true);

  // Alert the managers of every branch that carries this product.
  for (const branchId of branchIds) {
    await notifyBranchManagers(branchId, {
      type: "catalog",
      titleKey: "notifications.catalog.productHeld.title",
      bodyKey: "notifications.catalog.productHeld.body",
      params: { name: product.name },
      link: "/branch-manager/orders",
    });
  }
  const updated = await prisma.product.findUniqueOrThrow({
    where: { id: product.id },
    include: { branch: true, category: true },
  });
  // A hold is CROSS-BRANCH (every same-named row), so every catalogue surface
  // is affected, not just this product's own pages.
  for (const branchId of branchIds) revalidateCatalog({ branchId });
  revalidateCatalog({ productId: updated.id });
  return json(serializeProduct(updated));
});
