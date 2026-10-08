import { getSessionUser } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { imageResponse, readStoredImage } from "@/lib/upload/read";
import { PHOTO_THUMB_WIDTH } from "@/lib/upload/photos";
import { reviewPhotoKey } from "@/lib/services/product-reviews";

type Ctx = { params: Promise<{ id: string; n: string }> };

// GET /api/reviews/[id]/photos/[n][?w=320] — a review photo. Public while the
// review is visible (the storefront modal shows it to logged-out visitors);
// once hidden, only marketing / super admin, the branch's manager and the
// author can open it. The generic /api/uploads route refuses this folder.
export const GET = handle(async (req: Request, ctx: Ctx): Promise<Response> => {
  const viewer = await getSessionUser();
  const { id, n } = await ctx.params;
  const key = await reviewPhotoKey(viewer, Number(id), Number(n));
  const w = Number(new URL(req.url).searchParams.get("w") ?? 0);
  const image = await readStoredImage(key, w === PHOTO_THUMB_WIDTH ? w : null);
  // Short cache: a hidden review must stop serving soon after it is hidden.
  return imageResponse(image, "public, max-age=300");
});
