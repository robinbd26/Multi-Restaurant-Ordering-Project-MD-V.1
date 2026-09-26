import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { permanentlyDeleteBranch } from "@/lib/services/branch-removal";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/branches/[id]/permanent-delete { confirm_name } — Super Admin only.
// Deletes the branch and its setup data for good, only when it has no history
// (409 otherwise) and only when confirm_name is the branch's exact name (400
// otherwise). Logged with what was removed.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { confirm_name?: unknown };
  await permanentlyDeleteBranch(me, Number(id), body.confirm_name);
  return json({ action: "deleted" });
});
