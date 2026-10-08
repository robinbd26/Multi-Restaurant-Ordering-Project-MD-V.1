import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { complaintPhotoKey } from "@/lib/services/complaints";
import { PHOTO_THUMB_WIDTH } from "@/lib/upload/photos";
import { imageResponse, readStoredImage } from "@/lib/upload/read";

type Ctx = { params: Promise<{ id: string; n: string }> };

// GET /api/complaints/[id]/photos/[n][?w=320] — a complaint photo, for anyone
// who may read the complaint (the complainant, its recipient side, super
// admin and the oversight roles). /api/uploads refuses the folder itself.
export const GET = handle(async (req: Request, ctx: Ctx): Promise<Response> => {
  const me = await requireApproved();
  const { id, n } = await ctx.params;
  const key = await complaintPhotoKey(me, Number(id), Number(n));
  const w = Number(new URL(req.url).searchParams.get("w") ?? 0);
  const image = await readStoredImage(key, w === PHOTO_THUMB_WIDTH ? w : null);
  // no-cache: the browser must ask again each time, so a shared device never
  // shows one user's cached complaint photo to the next user.
  return imageResponse(image, "private, no-cache");
});
