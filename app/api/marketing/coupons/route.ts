import { requireApiRole } from "@/lib/auth/current-user";
import { handle, sk, validationError } from "@/lib/http/errors";
import { created, paginated } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import {
  LIVE_COUPON_WHERE,
  couponBranchFor,
  couponScopeForUser,
  parseCouponBody,
  serializeCoupon,
} from "@/lib/services/marketing";

// GET /api/marketing/coupons — live coupons by default. WS-7.2: archived ones
// are excluded from the list customers can still be offered, but stay readable
// for reporting via ?archived=1 (their orders keep pointing at them either way).
//
// PHASE 5 — one coupon system for every role. A branch manager sees only the
// coupons scoped to their own branch; everyone else sees them all.
export const GET = handle(async (req: Request) => {
  const me = await requireApiRole("marketing", "super_admin", "management", "branch_manager");
  const scope = await couponScopeForUser(me);
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  const items = await prisma.coupon.findMany({
    where: { AND: [includeArchived ? {} : LIVE_COUPON_WHERE, scope.where] },
    include: { branch: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return paginated(items.map(serializeCoupon));
});

// POST /api/marketing/coupons
// ITEM 3 — creation is SUPER ADMIN and MARKETING only. A branch manager is
// read-only on coupons (sees what applies to their branch; cannot create,
// edit, end or delete) — couponScopeForUser still exists for their GET, but
// write access no longer includes the role at all.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("marketing", "super_admin");
  const scope = await couponScopeForUser(me);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data = parseCouponBody(body);
  const branchId = await couponBranchFor(data.branchId, scope);
  const exists = await prisma.coupon.findUnique({ where: { code: data.code } });
  if (exists) throw validationError({ code: sk("errors.ops.couponCodeExists") });
  const coupon = await prisma.coupon.create({
    data: { ...data, branchId, createdById: me.id },
    include: { branch: { select: { name: true } } },
  });
  return created(serializeCoupon(coupon));
});
