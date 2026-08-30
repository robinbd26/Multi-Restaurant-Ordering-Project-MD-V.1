import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { releaseBranchHold } from "@/lib/services/branch-ops";

/**
 * Take the branch off its branch-manager hold. A reason is REQUIRED here — the
 * client's spec puts the explanation on REACTIVATION, not on entry — and it is
 * validated in the service (non-empty, bounded), so a missing reason comes back
 * as a `hold_release_reason` field error rather than being silently accepted.
 *
 * Releasing clears ONLY the manager's hold. The super admin's own hold
 * (`Branch.isActive` / `holdReason`) is a separate state and survives this call.
 */

// POST /api/branch-manager/hold/release  { reason, branch_id? }
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("branch_manager", "super_admin");
  const body = (await req.json().catch(() => ({}))) as { reason?: string; branch_id?: number | string };
  const id = Number(body.branch_id);
  const branchId = Number.isFinite(id) && id > 0 ? id : undefined;
  return json(await releaseBranchHold(me, body.reason, branchId));
});
