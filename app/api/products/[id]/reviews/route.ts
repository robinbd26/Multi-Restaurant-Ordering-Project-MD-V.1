import { requireApiRole } from "@/lib/auth/current-user";
import { handle, notFound } from "@/lib/http/errors";
import { created, json } from "@/lib/http/respond";
import { productReviewsPage, saveReview } from "@/lib/services/product-reviews";

type Ctx = { params: Promise<{ id: string }> };

function productIdOf(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
}

// GET /api/products/[id]/reviews?page=&page_size= — PUBLIC (the product modal is
// on the logged-out storefront). Visible reviews only, newest first, with the
// average, the star breakdown and, per review, the author's FIRST NAME only.
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? 1) || 1;
  const pageSize = Number(url.searchParams.get("page_size") ?? 5) || 5;
  return json(await productReviewsPage(productIdOf(id), page, pageSize));
});

// POST /api/products/[id]/reviews — multipart: rating, comment, photos (0-3
// files), keep (JSON array of current photo indexes to keep, when editing).
// Creates the customer's review or edits it (one per customer per product).
// Eligibility (a Delivered/Collected order containing the product) is
// enforced in the service.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApiRole("customer");
  const { id } = await ctx.params;
  const form = await req.formData();
  const photos = form.getAll("photos").filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
  let keep: number[] | null = null;
  const rawKeep = form.get("keep");
  if (typeof rawKeep === "string" && rawKeep) {
    try {
      const parsed = JSON.parse(rawKeep) as unknown;
      keep = Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isInteger(n) && n >= 0) : [];
    } catch {
      keep = [];
    }
  }
  const { review, created: isNew } = await saveReview(me, productIdOf(id), {
    rating: form.get("rating"),
    comment: form.get("comment"),
    photos,
    keep,
  });
  return isNew ? created(review) : json(review);
});
