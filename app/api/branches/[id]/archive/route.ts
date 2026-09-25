import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { archiveBranch } from "@/lib/services/branch-removal";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/branches/[id]/archive — Super Admin only. Always allowed: the
// branch stops taking orders and leaves customer surfaces and the default
// admin list; every record is kept. Logged.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  const branch = await archiveBranch(me, Number(id));
  return json({ action: "archived", id: branch.id });
});
