import { getSessionUser } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { imageResponse, readStoredImage } from "@/lib/upload/read";
import { reviewAvatarKey } from "@/lib/services/product-reviews";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/reviews/[id]/avatar — the reviewer's profile picture, shown next to
// their review. Profile photos are otherwise private (/api/uploads requires an
// approved session); this exposes ONE photo only for a visible review its owner
// chose to publish, never a lookup by user.
export const GET = handle(async (_req: Request, ctx: Ctx): Promise<Response> => {
  const viewer = await getSessionUser();
  const { id } = await ctx.params;
  const key = await reviewAvatarKey(viewer, Number(id));
  const image = await readStoredImage(key, 128);
  return imageResponse(image, "public, max-age=300");
});
