import "server-only";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { branchForManager } from "@/lib/selectors";
import { haversineKm } from "@/lib/services/geo";

// ────────────────────────────────────────────────────────────────────────
// WS-3.4 · Who may locate a rider
// ────────────────────────────────────────────────────────────────────────
// A rider's live position is sensitive personal data about a named individual,
// not operational telemetry. Before this pass it leaked two ways: the branch
// list handed out `currentLat/currentLng` for every rider whose *home branch*
// matched — including riders who were off duty and therefore not working for
// anyone — and the per-rider endpoint authorised a branch manager from the same
// stale `assignedBranchId` while letting any `management` account track anybody.
//
// The rule is now narrow and duty-scoped:
//
//   · the rider themself — always, on or off duty (it is their own data);
//   · the branch manager of the branch the rider is CURRENTLY ON DUTY AT — a
//     home-branch assignment is a roster fact, not a live shift, so it grants
//     the roster row (name/phone/vehicle) and nothing else;
//   · the customer of an in-flight delivery assigned to that rider, and only
//     while it is in flight;
//   · super admin.
//
// And, independently of the viewer: an OFF-DUTY rider is not locatable at all.
// Nobody but the rider gets coordinates when there is no active duty session,
// so clocking out really does stop the tracking.

/**
 * Order states in which a delivery is still IN FLIGHT for its customer. Mirrors
 * OPEN_DELIVERY_STATES in lib/services/rider-duty.ts (which decides when a rider
 * may go offline) so "the rider is still carrying my food" means one thing.
 */
const IN_FLIGHT_DELIVERY_STATES = ["accepted", "preparing", "ready", "picked_up", "on_the_way", "delayed"];

/** A rider's active duty session, reduced to what an authorization check needs. */
export interface RiderDutyContext {
  id: number;
  branchId: number;
  startedAt: Date;
}

export interface RiderLocationVisibility {
  /** May the viewer read this rider's row at all? False → 403. */
  allowed: boolean;
  /** May the viewer read the live COORDINATES? False → the row without a position. */
  coordinates: boolean;
  /**
   * The duty session the viewer is entitled to know about, or null. A branch
   * manager holding only a roster entry gets null even when the rider is on duty
   * at ANOTHER branch — matching /api/riders/branch, which never reports a rider
   * on duty elsewhere as online here.
   */
  session: RiderDutyContext | null;
}

const DENIED: RiderLocationVisibility = { allowed: false, coordinates: false, session: null };

/**
 * Decide what `viewer` may see of rider `riderId`'s live location. Pure read; it
 * never throws, so callers choose between 403 and a position-less row.
 */
export async function riderLocationVisibility(viewer: User, riderId: number): Promise<RiderLocationVisibility> {
  const session = await prisma.riderBranchDutySession.findFirst({
    where: { riderId, status: "active" },
    select: { id: true, branchId: true, startedAt: true },
  });
  const onDuty = session !== null;

  // The rider's own position — theirs whether they are working or not.
  if (viewer.id === riderId) return { allowed: true, coordinates: true, session };

  // Super admin. Still duty-gated: an off-duty rider is off the clock, and the
  // platform has no business following them home.
  if (viewer.role === "super_admin") return { allowed: true, coordinates: onDuty, session };

  if (viewer.role === "branch_manager") {
    const branch = await branchForManager(viewer.id);
    if (!branch) return DENIED;
    // On duty HERE, right now: the manager is responsible for this shift.
    if (session && session.branchId === branch.id) return { allowed: true, coordinates: true, session };
    // Otherwise only a roster relationship, which never carries a position.
    const profile = await prisma.riderProfile.findUnique({
      where: { userId: riderId },
      select: { assignedBranchId: true },
    });
    if (profile && profile.assignedBranchId === branch.id) {
      return { allowed: true, coordinates: false, session: null };
    }
    return DENIED;
  }

  if (viewer.role === "customer") {
    // Their own order, assigned to this rider, still in flight. `findFirst` on
    // customerId + riderId — a customer can never name a rider they are not
    // waiting on.
    const linked = await prisma.order.findFirst({
      where: {
        customerId: viewer.id,
        riderId,
        fulfillmentType: "delivery",
        status: { in: IN_FLIGHT_DELIVERY_STATES },
      },
      select: { id: true },
    });
    if (!linked) return DENIED;
    return { allowed: true, coordinates: onDuty, session };
  }

  // management / marketing / accounts / another rider — no business case, and
  // these accounts are exactly the broad-access ones the old check let through.
  return DENIED;
}

/** Set a rider online/offline. Going offline stops location updates. */
export async function setRiderOnline(riderId: number, online: boolean) {
  return prisma.riderProfile.update({
    where: { userId: riderId },
    data: { isOnline: online, lastPingAt: online ? new Date() : undefined },
  });
}

/**
 * Record a live location ping while online: updates the current position and
 * appends a route point (skipping near-duplicate points < ~10m to limit noise).
 */
export async function pushRiderLocation(
  riderId: number,
  lat: number,
  lng: number,
  accuracy?: number | null,
  orderId?: number | null,
) {
  const profile = await prisma.riderProfile.findUnique({ where: { userId: riderId } });
  const last = await prisma.riderRoutePoint.findFirst({
    where: { riderId },
    orderBy: { recordedAt: "desc" },
  });

  const movedEnough =
    !last || haversineKm({ lat: Number(last.lat), lng: Number(last.lng) }, { lat, lng }) > 0.01;

  await prisma.riderProfile.update({
    where: { userId: riderId },
    data: {
      currentLat: new Prisma.Decimal(lat.toFixed(7)),
      currentLng: new Prisma.Decimal(lng.toFixed(7)),
      currentAccuracy: accuracy != null && Number.isFinite(accuracy) ? new Prisma.Decimal(Number(accuracy).toFixed(2)) : null,
      lastPingAt: new Date(),
      isOnline: true,
    },
  });

  if (movedEnough) {
    await prisma.riderRoutePoint.create({
      data: {
        riderId,
        lat: new Prisma.Decimal(lat.toFixed(7)),
        lng: new Prisma.Decimal(lng.toFixed(7)),
        orderId: orderId ?? null,
      },
    });
  }
  return profile;
}

/** Total travelled distance (km) over a rider's route points since `since`. */
export async function riderTravelDistanceKm(riderId: number, since?: Date): Promise<number> {
  const points = await prisma.riderRoutePoint.findMany({
    where: { riderId, ...(since ? { recordedAt: { gte: since } } : {}) },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true },
  });
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(
      { lat: Number(points[i - 1].lat), lng: Number(points[i - 1].lng) },
      { lat: Number(points[i].lat), lng: Number(points[i].lng) },
    );
  }
  return Math.round(total * 100) / 100;
}
