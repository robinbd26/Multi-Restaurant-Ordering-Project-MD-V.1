import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { flagReview } from "@/lib/services/product-reviews";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/reviews/[id]/flag { reason? } — a branch manager flags a review of
// their OWN branch's product for marketing to look at. It cannot hide it.
// Enforced in the service; logged; marketing is notified.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const review = await flagReview(me, Number(id), body.reason);
  return json({ id: review.id, flagged: review.flaggedAt != null });
});
