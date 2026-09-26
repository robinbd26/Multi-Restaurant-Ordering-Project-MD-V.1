import type { User } from "@prisma/client";

import { requireApiRole } from "@/lib/auth/current-user";
import { handle, notFound } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/services/audit";
import {
  archiveOrDeleteCoupon,
  couponBranchFor,
  couponScopeForUser,
  parseCouponBody,
  serializeCoupon,
} from "@/lib/services/marketing";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PHASE 5 — load a coupon the caller may act on. Outside their scope reads as
 * NOT FOUND, so a branch manager cannot even learn that another branch's coupon
 * id exists.
 */
async function scopedCoupon(me: User, rawId: string) {
  const scope = await couponScopeForUser(me);
  const id = Number(rawId);
  const coupon = Number.isSafeInteger(id)
    ? await prisma.coupon.findFirst({
        where: { id, ...scope.where },
        include: { branch: { select: { name: true } } },
      })
    : null;
  if (!coupon) throw notFound();
  return { coupon, scope };
}

// GET /api/marketing/coupons/[id]
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("marketing", "super_admin", "branch_manager");
  const { id } = await ctx.params;
  const { coupon } = await scopedCoupon(me, id);
  return json(serializeCoupon(coupon));
});

// PATCH /api/marketing/coupons/[id]
// ITEM 3 — edit is super admin / marketing only; a branch manager is read-only.
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApiRole("marketing", "super_admin");
  const { id } = await ctx.params;
  const { coupon: existing, scope } = await scopedCoupon(me, id);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const merged = {
    code: existing.code,
    discount_type: existing.discountType,
    value: existing.value.toString(),
    min_order: existing.minOrder.toString(),
    max_uses: existing.maxUses,
    // WS-7.2 — carried through so a PATCH that never mentions the per-customer
    // cap cannot silently drop it (null round-trips as 0 = uncapped).
    per_customer_limit: existing.perCustomerLimit ?? 0,
    starts_at: existing.startsAt?.toISOString(),
    ends_at: existing.endsAt?.toISOString(),
    is_active: existing.isActive,
    branch_id: existing.branchId,
    ...body,
  };
  const data = parseCouponBody(merged);
  const branchId = await couponBranchFor(data.branchId, scope, existing.branchId);
  const coupon = await prisma.coupon.update({
    where: { id: existing.id },
    data: { ...data, branchId },
    include: { branch: { select: { name: true } } },
  });
  return json(serializeCoupon(coupon));
});

// DELETE /api/marketing/coupons/[id]
// WS-7.2 — a redeemed coupon is ARCHIVED, never hard-deleted: the Order relation
// is onDelete: SetNull, so a real delete quietly nulled couponId on every
// historical order and destroyed the record of why they were discounted. The
// SERVER decides which happened and says so, like the branch delete verdict.
// ITEM 3 — delete is super admin / marketing only; a branch manager is read-only.
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("marketing", "super_admin");
  const { id } = await ctx.params;
  const { coupon } = await scopedCoupon(me, id);
  const action = await archiveOrDeleteCoupon(coupon.id);
  await logAdminAction(
    me.id,
    action === "archived" ? "archive" : "delete",
    action === "archived"
      ? `Archived coupon ${coupon.code} (#${coupon.id}); it has been used, so its history is kept`
      : `Permanently deleted coupon ${coupon.code} (#${coupon.id}); it was never used`,
    { branchId: action === "archived" ? coupon.branchId : null },
  );
  return json({ action });
});
