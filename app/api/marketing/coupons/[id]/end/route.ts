import { requireApiRole } from "@/lib/auth/current-user";
import { handle, notFound } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { couponScopeForUser, serializeCoupon } from "@/lib/services/marketing";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/marketing/coupons/[id]/end — PHASE 5 "End now".
//
// Ends a coupon immediately by stamping its end time to NOW. Using the schedule
// field (rather than a separate flag) means there is exactly one rule for
// "ended", shared by validation, the list and reports. A coupon that has already
// ended keeps its original end time, so the record says when it really ended.
// Orders that already used it keep their discount.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("marketing", "super_admin", "branch_manager");
  const { id } = await ctx.params;
  const scope = await couponScopeForUser(me);
  const couponId = Number(id);
  const existing = Number.isSafeInteger(couponId)
    ? await prisma.coupon.findFirst({ where: { id: couponId, ...scope.where } })
    : null;
  if (!existing) throw notFound();

  const now = new Date();
  const alreadyEnded = existing.endsAt != null && existing.endsAt <= now;
  const coupon = alreadyEnded
    ? await prisma.coupon.findUniqueOrThrow({
        where: { id: existing.id },
        include: { branch: { select: { name: true } } },
      })
    : await prisma.coupon.update({
        where: { id: existing.id },
        data: { endsAt: now },
        include: { branch: { select: { name: true } } },
      });
  return json(serializeCoupon(coupon));
});
