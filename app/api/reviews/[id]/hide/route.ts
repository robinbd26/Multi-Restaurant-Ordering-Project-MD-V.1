import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { hideReview } from "@/lib/services/product-reviews";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/reviews/[id]/hide { reason? } — marketing / super admin only
// (enforced in the service). Hidden reviews stop counting toward the rating
// and disappear from the storefront. Logged to Activity Logs.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const review = await hideReview(me, Number(id), body.reason);
  return json({ id: review.id, is_hidden: review.isHidden });
});
