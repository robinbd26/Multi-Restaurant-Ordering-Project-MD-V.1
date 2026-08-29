import { requireApproved } from "@/lib/auth/current-user";
import { forbidden, handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { branchForManager } from "@/lib/selectors";
import { serializeRiderProfile } from "@/lib/serializers";

// GET /api/riders/branch — riders for the branch manager's (or super admin's)
// branch, with AUTHORITATIVE online state (req #11). Online = the rider has an
// ACTIVE duty session for THIS branch — never the stale RiderProfile.isOnline
// flag. Riders on active duty here plus riders permanently assigned here are
// returned; a rider on duty at another branch is not shown as online here.
//
// WS-3.4 — the roster and the POSITIONS are two different disclosures. This
// payload used to carry `latitude`/`longitude` for every profile it returned,
// so an off-duty rider whose home branch matched was locatable from a list
// nobody thought of as a tracking endpoint. Coordinates are now attached ONLY to
// riders with an active duty session at THIS branch; everyone else comes back as
// a roster row with a null position. Mirrors `riderLocationVisibility`, which
// decides the same thing for the per-rider endpoint.
export const GET = handle(async () => {
  const me = await requireApproved();
  if (me.role !== "branch_manager" && me.role !== "super_admin") throw forbidden();
  const branch = await branchForManager(me.id);
  if (!branch) return json([]);

  const activeSessions = await prisma.riderBranchDutySession.findMany({
    where: { branchId: branch.id, status: "active" },
    select: { riderId: true, startedAt: true },
  });
  const online = new Map(activeSessions.map((s) => [s.riderId, s.startedAt]));
  const riderIds = activeSessions.map((s) => s.riderId);

  const profiles = await prisma.riderProfile.findMany({
    where: { OR: [{ assignedBranchId: branch.id }, { userId: { in: riderIds } }] },
    include: { user: true, assignedBranch: true },
  });

  const result = profiles.map((p) => {
    const startedAt = online.get(p.userId);
    const onDuty = startedAt !== undefined; // authoritative — active session at this branch
    return {
      ...serializeRiderProfile(p),
      is_online: onDuty,
      on_duty_branch: onDuty ? branch.id : null,
      on_duty_since: startedAt?.toISOString() ?? null,
      // Position + its freshness are duty-scoped. Clocking out really does stop
      // the tracking, rather than merely freezing the last known pin in place.
      last_ping_at: onDuty ? p.lastPingAt?.toISOString() ?? null : null,
      latitude: onDuty && p.currentLat != null ? Number(p.currentLat) : null,
      longitude: onDuty && p.currentLng != null ? Number(p.currentLng) : null,
      current_accuracy: onDuty && p.currentAccuracy != null ? Number(p.currentAccuracy) : null,
    };
  });
  return json(result);
});
