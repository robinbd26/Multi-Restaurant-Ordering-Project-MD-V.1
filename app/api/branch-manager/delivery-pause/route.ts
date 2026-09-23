import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { deliveryPauseState, pauseDelivery, resumeDelivery } from "@/lib/services/branch-pause";

// Branch-manager "Pause delivery" — DELIVERY only; pickup stays open.
//
// Authorization lives in the service: a branch manager always acts on their own
// branch (a submitted branch_id is ignored), a super admin must name one, and
// everyone else is refused. Distinct from /api/branch-manager/hold, which stops
// every new order on both rails, and from the super admin's branch deactivate.

// GET — is delivery paused right now, and until when?
export const GET = handle(async (req: Request) => {
  const me = await requireApproved();
  const branchId = Number(new URL(req.url).searchParams.get("branch_id"));
  return json(await deliveryPauseState(me, Number.isSafeInteger(branchId) && branchId > 0 ? branchId : undefined));
});

// POST { mode: "30m" | "1h" | "shift" | "until_resumed" } — start a pause.
// Every mode except "until_resumed" carries its own end instant and lifts
// itself, so no scheduled job is involved.
export const POST = handle(async (req: Request) => {
  const me = await requireApproved();
  const body = (await req.json().catch(() => ({}))) as { mode?: unknown; branch_id?: unknown };
  const branchId = Number(body.branch_id);
  return json(
    await pauseDelivery(me, body.mode, Number.isSafeInteger(branchId) && branchId > 0 ? branchId : undefined),
  );
});

// DELETE — resume delivery now.
export const DELETE = handle(async (req: Request) => {
  const me = await requireApproved();
  const branchId = Number(new URL(req.url).searchParams.get("branch_id"));
  return json(await resumeDelivery(me, Number.isSafeInteger(branchId) && branchId > 0 ? branchId : undefined));
});
