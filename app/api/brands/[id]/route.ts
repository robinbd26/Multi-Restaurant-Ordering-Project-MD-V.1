import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { parseBody } from "@/lib/http/form";
import { json, noContent } from "@/lib/http/respond";
import { deleteBrand, serializeBrand, updateBrand } from "@/lib/services/brands";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/brands/[id] — super admin edits a brand (multipart or JSON). The
// slug is immutable; activate/deactivate is `is_active`.
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  const { fields, file } = await parseBody(req);
  const brand = await updateBrand(me, Number(id), fields, file("logo"));
  return json(serializeBrand(brand));
});

// DELETE /api/brands/[id] — permanent delete, ONLY for a brand nothing refers
// to (no products, categories or order lines). Anything else answers 409 and
// must be archived instead (POST ./archive).
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  await deleteBrand(me, Number(id));
  return noContent();
});
