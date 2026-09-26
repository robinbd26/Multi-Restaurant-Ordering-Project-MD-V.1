import { requireApiRole } from "@/lib/auth/current-user";
import { handle, notFound } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/services/audit";
import { archiveOrDeleteCampaign, parseCampaignBody, serializeCampaign } from "@/lib/services/marketing";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/marketing/campaigns/[id]
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiRole("marketing", "super_admin");
  const { id } = await ctx.params;
  const campaign = await prisma.campaign.findUnique({
    where: { id: Number(id) },
    include: { coupon: true },
  });
  if (!campaign) throw notFound();
  return json(serializeCampaign(campaign));
});

// PATCH /api/marketing/campaigns/[id]
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireApiRole("marketing", "super_admin");
  const { id } = await ctx.params;
  const existing = await prisma.campaign.findUnique({ where: { id: Number(id) } });
  if (!existing) throw notFound();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const merged = {
    title: existing.title,
    description: existing.description,
    type: existing.type,
    starts_at: existing.startsAt.toISOString(),
    ends_at: existing.endsAt.toISOString(),
    is_active: existing.isActive,
    coupon_id: existing.couponId,
    ...body,
  };
  const data = parseCampaignBody(merged);
  const campaign = await prisma.campaign.update({
    where: { id: existing.id },
    data,
    include: { coupon: true },
  });
  return json(serializeCampaign(campaign));
});

// DELETE /api/marketing/campaigns/[id]
// A campaign that has ever sent owns history (its CampaignEvent rows cascade
// on delete, its notifications would lose their campaign), so it is ARCHIVED;
// only a never-sent campaign is removed. This route used to hard-delete every
// campaign, bypassing archiveOrDeleteCampaign, which existed for exactly this.
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("marketing", "super_admin");
  const { id } = await ctx.params;
  const existing = await prisma.campaign.findUnique({ where: { id: Number(id) } });
  if (!existing) throw notFound();
  const action = await archiveOrDeleteCampaign(existing.id);
  await logAdminAction(
    me.id,
    action === "archived" ? "archive" : "delete",
    action === "archived"
      ? `Archived campaign "${existing.title}" (#${existing.id}); it has been sent, so its history is kept`
      : `Permanently deleted campaign "${existing.title}" (#${existing.id}); it was never sent`,
  );
  return json({ action });
});
