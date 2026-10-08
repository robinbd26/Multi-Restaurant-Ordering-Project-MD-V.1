import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { restoreReview } from "@/lib/services/product-reviews";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/reviews/[id]/restore — marketing / super admin only (enforced in
// the service). The review is published and counts again. Logged.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const review = await restoreReview(me, Number(id));
  return json({ id: review.id, is_hidden: review.isHidden });
});
