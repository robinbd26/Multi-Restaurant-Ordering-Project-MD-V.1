import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { branchRemovalCheck } from "@/lib/services/branch-removal";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/branches/[id]/removal-check — Super Admin only. What a permanent
// delete would be blocked by (history) or would remove (setup), for the
// confirmation dialog. Reads only.
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  await requireApiRole("super_admin");
  const { id } = await ctx.params;
  const check = await branchRemovalCheck(Number(id));
  return json({
    branch: { id: check.branch.id, name: check.branch.name, is_archived: check.branch.isArchived },
    deletable: check.deletable,
    history: check.history,
    setup: check.setup,
    riders_assigned: check.ridersAssigned,
  });
});
