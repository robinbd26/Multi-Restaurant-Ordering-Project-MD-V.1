import { requireApproved } from "@/lib/auth/current-user";
import { forbidden, handle, notFound, sk } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { riderLocationVisibility } from "@/lib/services/rider-location";

type Ctx = { params: Promise<{ userId: string }> };

// GET /api/riders/[userId]/location — track a rider's live position.
//
// WS-3.4 — authorization is decided by `riderLocationVisibility` (see the note
// at the top of lib/services/rider-location.ts), never inline here, so the list
// endpoint and this one can never drift apart. In short: the rider themself, the
// branch manager of the branch the rider is ON DUTY AT right now, the customer
// of an in-flight delivery assigned to them, and super admin — and an OFF-DUTY
// rider is not locatable by anyone but themself.
//
// A viewer who is entitled to the roster row but not to the position (a branch
// manager whose rider is off duty) gets a 200 with null coordinates rather than
// a 403: the tracker then renders "offline" instead of an error, and nothing
// about where that rider is has been disclosed either way.
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { userId } = await ctx.params;
  const riderId = Number(userId);
  if (!Number.isInteger(riderId) || riderId <= 0) throw notFound(sk("errors.money.riderNotFound"));

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: riderId },
    include: { user: true },
  });
  if (!profile) throw notFound(sk("errors.money.riderNotFound"));

  const access = await riderLocationVisibility(me, riderId);
  if (!access.allowed) throw forbidden();

  const onDuty = access.session !== null;
  return json({
    rider: riderId,
    rider_name: `${profile.user.firstName} ${profile.user.lastName}`.trim() || profile.user.username,
    // AUTHORITATIVE online state — an active duty session, never the
    // RiderProfile.isOnline flag, which can go stale after a crashed session.
    is_online: onDuty,
    on_duty_branch: access.session?.branchId ?? null,
    on_duty_since: access.session?.startedAt.toISOString() ?? null,
    // Coordinates are withheld — not merely hidden in the UI — whenever the
    // viewer is not entitled to them for THIS rider at THIS moment.
    latitude: access.coordinates ? profile.currentLat?.toString() ?? null : null,
    longitude: access.coordinates ? profile.currentLng?.toString() ?? null : null,
    last_ping_at: access.coordinates ? profile.lastPingAt?.toISOString() ?? null : null,
  });
});
