import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { branchHoldState, holdBranchOrders } from "@/lib/services/branch-ops";

/**
 * "Hold Orders" — a branch manager pauses NEW order intake for their own
 * branch. Entering the hold needs no reason (only the confirmation dialog);
 * the REQUIRED reason is collected on release by ./release.
 *
 * AUTHORIZATION lives entirely in the service (`resolveConfigurableBranch`):
 * a branch_manager always acts on their OWN assigned branch and a submitted
 * foreign `branch_id` is a 403, so this route never trusts a client-supplied
 * branch. A super_admin must name the branch explicitly. No other role reaches
 * either handler.
 *
 * This is NOT the enforcement point — the hold is enforced in
 * lib/services/orders.ts on every path that can create an order.
 */

/** A super admin names the branch; a manager's own id is resolved server-side. */
function submittedBranchId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

// GET /api/branch-manager/hold[?branch_id=] — current hold state.
export const GET = handle(async (req: Request) => {
  const me = await requireApiRole("branch_manager", "super_admin");
  const url = new URL(req.url);
  return json(await branchHoldState(me, submittedBranchId(url.searchParams.get("branch_id"))));
});

// POST /api/branch-manager/hold  { branch_id? } — put the branch on hold.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("branch_manager", "super_admin");
  const body = (await req.json().catch(() => ({}))) as { branch_id?: number | string };
  return json(await holdBranchOrders(me, submittedBranchId(body.branch_id)));
});
