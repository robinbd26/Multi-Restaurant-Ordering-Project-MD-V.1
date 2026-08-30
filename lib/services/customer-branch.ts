import "server-only";

import { prisma } from "@/lib/db";
import { effectiveDeliveryFor } from "@/lib/services/delivery";
import { isBranchCoveredForCustomer, nearestEligibleBranch } from "@/lib/services/customer-location";

export { isBranchCoveredForCustomer };

/**
 * THE resolved delivery branch for an authenticated customer.
 * Supports choosing any branch that currently covers the customer's coordinates (Foodpanda model),
 * with fallback to the nearest covered branch.
 */

export type CustomerBranchState =
  /** A single eligible branch was resolved. */
  | "ok"
  /** No usable coordinates at all — browsing is open, ORDERING needs a location. */
  | "no-location"
  /** We know where they are; no branch covers it. */
  | "out-of-zone";

export interface CustomerBranchContext {
  state: CustomerBranchState;
  /** The resolved branch id, or null in every non-"ok" state. */
  branchId: number | null;
  branch: {
    id: number;
    name: string;
    brandType: string;
    address: string;
    pickupEnabled: boolean;
    prepTimeMinutes: number;
  } | null;
  /** Straight-line distance to the resolved branch, km, server-computed. */
  distanceKm: number | null;
  /** Delivery fee for this point at this branch, from the shared coverage rules. */
  deliveryFee: number | null;
  /** Whether the point came from a GPS fix or the default saved address. */
  pointSource: "gps" | "address" | null;
  /** Whether the resolved branch can take an order right now (active + within hours). */
  open: boolean;
  /** Opening time ("HH:MM") to show when the branch is currently closed; null otherwise. */
  opensAt: string | null;
}

const EMPTY: CustomerBranchContext = {
  state: "no-location",
  branchId: null,
  branch: null,
  distanceKm: null,
  deliveryFee: null,
  pointSource: null,
  open: false,
  opensAt: null,
};

/**
 * Resolve the customer's delivery branch (supports preferred covered branch or nearest covered branch).
 */
export async function resolveCustomerBranch(userId: number, preferredBranchId?: number | null): Promise<CustomerBranchContext> {
  const nearest = await nearestEligibleBranch(userId);
  if (!nearest.point) return EMPTY;

  let targetBranchId: number | null = null;
  let targetDistance: number | null = null;

  if (preferredBranchId != null) {
    const match = nearest.branches.find((b) => b.id === preferredBranchId && b.covered);
    if (match) {
      targetBranchId = match.id;
      targetDistance = match.distance_km;
    }
  }

  if (targetBranchId == null) {
    if (!nearest.nearest) {
      return { ...EMPTY, state: "out-of-zone", pointSource: nearest.pointSource };
    }
    targetBranchId = nearest.nearest.id;
    targetDistance = nearest.nearest.distance_km;
  }

  const branch = await prisma.branch.findFirst({
    where: { id: targetBranchId, isActive: true, isArchived: false },
  });
  if (!branch) {
    return { ...EMPTY, state: "out-of-zone", pointSource: nearest.pointSource };
  }

  // WS-4.5 — coverage and price come from the ONE resolver in
  // lib/services/delivery.ts, against the same geometry, so the fee this strip
  // advertises is the fee the order write path snapshots. It used to read the
  // old `coverageFor().fee`, which was a flat 0 inside the branch radius while
  // the invoice charged Branch.deliveryFee or a named area's own charge.
  const [zones, areas] = await Promise.all([
    prisma.branchDeliveryZone.findMany({ where: { branchId: branch.id, isActive: true } }),
    prisma.branchDeliveryArea.findMany({ where: { branchId: branch.id, isActive: true } }),
  ]);
  const coverage = effectiveDeliveryFor(branch, zones, areas, nearest.point);

  // Open-now state comes from the SAME server decision used everywhere else
  // (nearestEligibleBranch already computed it per branch). Surfaced so the
  // homepage strip can warn "Opens at …" before a cart is built for a branch
  // that is covered but closed right now.
  const elig = nearest.branches.find((b) => b.id === targetBranchId) ?? null;
  const open = elig?.open_now ?? true;

  return {
    state: "ok",
    branchId: branch.id,
    branch: {
      id: branch.id,
      name: branch.name,
      brandType: branch.brandType,
      address: branch.address,
      pickupEnabled: branch.pickupEnabled,
      prepTimeMinutes: branch.prepTimeMinutes,
    },
    distanceKm: targetDistance,
    deliveryFee: coverage.covered ? Number(coverage.charge.toFixed(2)) : null,
    pointSource: nearest.pointSource,
    open,
    opensAt: open ? null : elig?.opens_at ?? null,
  };
}

/**
 * The resolved branch id, or null.
 */
export async function resolvedBranchIdFor(userId: number, preferredBranchId?: number | null): Promise<number | null> {
  const context = await resolveCustomerBranch(userId, preferredBranchId);
  return context.branchId;
}

/**
 * WS-8.14 — the browse policy, in ONE place so the homepage, the branches list
 * and the menu pages cannot drift apart.
 *
 * A signed-in customer with NO usable location used to be hard-scoped to their
 * covered branches — which is an empty set — while a logged-OUT visitor could
 * browse every branch's showcase. Backwards. With no location the customer
 * browses everything, exactly like the public homepage, and the location gate
 * is an invitation, not a wall. Ordering is unaffected: coverage, branch
 * resolution and the delivery fee are all still enforced server-side at
 * checkout from the customer's trusted point, never from what they browsed.
 *
 * Deliberately NOT true for "out-of-zone": there we DO know where they are and
 * the truthful banner (with the nearest-pickup callout) is the right answer.
 */
export function browsesWithoutLocation(context: Pick<CustomerBranchContext, "state">): boolean {
  return context.state === "no-location";
}
