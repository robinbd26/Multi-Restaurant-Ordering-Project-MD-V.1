import { handle, notFound, sk } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { BRANCH_HOURS_INCLUDE, branchBrandStatuses } from "@/lib/hours/availability";
import { dhakaMoment } from "@/lib/hours/clock";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/branches/[id]/availability — which of this branch's live brands take
// delivery / pickup orders right now, and when a closed one opens. Computed on
// the server's Asia/Dhaka clock, never the visitor's. Public: it is what the
// storefront shows anyway. Display only — placing an order re-checks the same
// rules (lib/services/orders.ts assertBrandsOpen).
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const branchId = Number(id);
  const branch = Number.isSafeInteger(branchId)
    ? await prisma.branch.findFirst({ where: { id: branchId, isActive: true, isArchived: false }, include: BRANCH_HOURS_INCLUDE })
    : null;
  if (!branch) throw notFound(sk("errors.catalog.branchNotFound"));
  const names = new Map(branch.brands.map((b) => [b.brand.slug, b.brand.name]));
  const statuses = branchBrandStatuses(branch, dhakaMoment());
  const view = (s: (typeof statuses)[number]["delivery"]) => ({
    open: s.open,
    reason: s.reason,
    opens_at: s.opensAt,
    closes_in_minutes: s.closesInMinutes,
  });
  return json({
    branch_id: branch.id,
    on_hold: branch.isOnHold,
    brands: statuses.map((s) => ({ slug: s.slug, name: names.get(s.slug) ?? s.slug, delivery: view(s.delivery), pickup: view(s.pickup) })),
  });
});
