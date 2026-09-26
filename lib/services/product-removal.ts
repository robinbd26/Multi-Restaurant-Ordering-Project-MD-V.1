import "server-only";

import type { User } from "@prisma/client";

import { revalidateCatalog } from "@/lib/cache/catalog";
import { prisma } from "@/lib/db";
import { conflict, forbidden, notFound, sk } from "@/lib/http/errors";
import { logAdminAction } from "@/lib/services/audit";
import { productForManage } from "@/lib/services/catalog";

/**
 * Removing a product, under the rule every admin list follows:
 * ANYTHING WITH HISTORY IS ARCHIVED, ONLY PURE SETUP IS DELETED.
 *
 * ARCHIVE is the long-standing soft delete (softDeleteProduct: deletedAt is
 * set, the product leaves the menu, search and checkout, the row stays), now
 * called "Archived" and reversible with RESTORE.
 *
 * A product's HISTORY is its order lines (OrderItem has no onDelete, so the
 * database refuses the delete) and its food reviews (they cascade). A product
 * with neither was never ordered or reviewed: it is setup data, and a super
 * admin may DELETE it for good, taking its size variations with it.
 *
 * WHO: archive and restore are the super admin's (any branch) and the
 * assigned branch manager's (own branch only, and never a product under an
 * admin hold, the same rule as archiving). Permanent delete is super admin
 * only.
 */

function assertSuperAdmin(user: User): void {
  if (user.role !== "super_admin") throw forbidden(sk("errors.productRemoval.superAdminOnly"));
}

async function productOrThrow(productId: number) {
  if (!Number.isSafeInteger(productId) || productId <= 0) throw notFound(sk("errors.catalog.productNotFound"));
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { branch: true } });
  if (!product) throw notFound(sk("errors.catalog.productNotFound"));
  return product;
}

export interface ProductRemovalCheck {
  orderLines: number;
  reviews: number;
  /** True when it was never ordered nor reviewed: a permanent delete is allowed. */
  deletable: boolean;
}

export async function productRemovalCheck(user: User, productId: number): Promise<ProductRemovalCheck> {
  assertSuperAdmin(user);
  await productOrThrow(productId);
  const [orderLines, reviews] = await Promise.all([
    prisma.orderItem.count({ where: { productId } }),
    prisma.foodReview.count({ where: { productId } }),
  ]);
  return { orderLines, reviews, deletable: orderLines === 0 && reviews === 0 };
}

/**
 * Bring an archived product back. It returns UNAVAILABLE: it was taken off the
 * menu on purpose, so going back on sale is a separate, deliberate switch.
 * Super admin: any branch. Branch manager: own branch only (productForManage
 * enforces it), and not a product the super admin is holding.
 */
export async function restoreProduct(user: User, productId: number) {
  if (!Number.isSafeInteger(productId) || productId <= 0) throw notFound(sk("errors.catalog.productNotFound"));
  await productForManage(user, productId);
  const product = await productOrThrow(productId);
  if (user.role === "branch_manager" && product.heldByAdmin) {
    throw forbidden(sk("errors.productRemoval.heldByAdmin"));
  }
  if (!product.deletedAt) return product;
  const restored = await prisma.$transaction(async (tx) => {
    const row = await tx.product.update({
      where: { id: productId },
      data: { deletedAt: null, deletedById: null, isAvailable: false },
    });
    await logAdminAction(
      user.id,
      "action",
      `Restored archived product "${product.name}" (#${product.id}) at ${product.branch.name}; it stays unavailable until switched on`,
      { branchId: product.branchId, tx },
    );
    return row;
  });
  revalidateCatalog({ productId, branchId: product.branchId });
  return restored;
}

/** Delete a never-ordered, never-reviewed product for good. 409 otherwise. */
export async function permanentlyDeleteProduct(user: User, productId: number) {
  assertSuperAdmin(user);
  const product = await productOrThrow(productId);
  const check = await productRemovalCheck(user, productId);
  if (!check.deletable) {
    throw conflict(sk("errors.productRemoval.hasHistory", { orders: check.orderLines, reviews: check.reviews }));
  }
  await prisma.$transaction(async (tx) => {
    await tx.product.delete({ where: { id: productId } });
    await logAdminAction(
      user.id,
      "delete",
      `Permanently deleted product "${product.name}" (#${product.id}) at ${product.branch.name}; it was never ordered or reviewed`,
      { branchId: product.branchId, tx },
    );
  });
  revalidateCatalog({ productId, branchId: product.branchId });
}
