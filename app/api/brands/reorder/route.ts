import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { noContent } from "@/lib/http/respond";
import { reorderBrands } from "@/lib/services/brands";

// POST /api/brands/reorder { ids: number[] } — the display order, first first.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("super_admin");
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  await reorderBrands(me, ids);
  return noContent();
});
