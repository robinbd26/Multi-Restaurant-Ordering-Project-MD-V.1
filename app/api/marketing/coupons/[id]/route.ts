import { requireApiRole } from "@/lib/auth/current-user";
import { handle, notFound } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { archiveOrDeleteCoupon, parseCouponBody, serializeCoupon } from "@/lib/services/marketing";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/marketing/coupons/[id]
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiRole("marketing", "super_admin");
  const { id } = await ctx.params;
  const coupon = await prisma.coupon.findUnique({ where: { id: Number(id) } });
  if (!coupon) throw notFound();
  return json(serializeCoupon(coupon));
});

// PATCH /api/marketing/coupons/[id]
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireApiRole("marketing", "super_admin");
  const { id } = await ctx.params;
  const existing = await prisma.coupon.findUnique({ where: { id: Number(id) } });
  if (!existing) throw notFound();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const merged = {
    code: existing.code,
    discount_type: existing.discountType,
    value: existing.value.toString(),
    min_order: existing.minOrder.toString(),
    max_uses: existing.maxUses,
    // WS-7.2 — carried through so a PATCH that never mentions the per-customer
    // cap cannot silently drop it.
    per_customer_limit: existing.perCustomerLimit ?? 0,
    starts_at: existing.startsAt?.toISOString(),
    ends_at: existing.endsAt?.toISOString(),
    is_active: existing.isActive,
    ...body,
  };
  const data = parseCouponBody(merged);
  const coupon = await prisma.coupon.update({ where: { id: existing.id }, data });
  return json(serializeCoupon(coupon));
});

// DELETE /api/marketing/coupons/[id]
// WS-7.2 — a redeemed coupon is ARCHIVED, never hard-deleted: the Order relation
// is onDelete: SetNull, so a real delete quietly nulled couponId on every
// historical order and destroyed the record of why they were discounted. The
// SERVER decides which happened and says so, like the branch delete verdict.
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiRole("marketing", "super_admin");
  const { id } = await ctx.params;
  const existing = await prisma.coupon.findUnique({ where: { id: Number(id) } });
  if (!existing) throw notFound();
  const action = await archiveOrDeleteCoupon(existing.id);
  return json({ action });
});
