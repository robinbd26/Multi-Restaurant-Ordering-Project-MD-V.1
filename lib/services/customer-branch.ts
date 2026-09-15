import "server-only";

import { prisma } from "@/lib/db";
import { GPS_SCOPE, type BrowseScope } from "@/lib/browse-scope/config";
import { effectiveDeliveryFor } from "@/lib/services/delivery";
import {
  isBranchCoveredForCustomer,
  nearestEligibleBranch,
  pointForCustomerAddress,
  type TrustedPoint,
} from "@/lib/services/customer-location";
import { isBranchOpenNow } from "@/lib/services/branch-hours";

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
 *
 * @param pointOverride A deliver-to point the customer chose — a saved address of
 *   their own, resolved by pointForCustomerAddress(). Everything downstream
 *   (coverage, the serving branch, the quoted fee) is then computed against THAT
 *   point instead of where their phone is. Ordering paths never pass it.
 */
export async function resolveCustomerBranch(
  userId: number,
  preferredBranchId?: number | null,
  pointOverride?: TrustedPoint | null,
): Promise<CustomerBranchContext> {
  const nearest = await nearestEligibleBranch(userId, pointOverride);
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

// ── Storefront deliver-to selection ─────────────────────────────────────────

export interface HomeBranchContext extends CustomerBranchContext {
  /**
   * The scope actually IN FORCE, after validation. It can differ from the cookie
   * the browser sent — an address that is not theirs, or a branch that has since
   * been archived, degrades to "gps" here — so the picker highlights what the
   * page really did, never what was merely asked for.
   */
  selection: BrowseScope;
  /**
   * True when the customer is looking at a branch that cannot deliver to their
   * deliver-to point. The menu is real and self-pickup still works; delivery
   * from here does not, and the bar has to say so rather than let them build a
   * cart that checkout will refuse.
   */
  browseOnly: boolean;
  /** The saved address this page is priced for, when one was chosen. */
  deliverToLabel: string | null;
}

/** display_label, without paying for a full serializer. */
function addressLabel(a: { label: string; customLabel: string | null }): string {
  return a.label === "Others" && a.customLabel ? a.customLabel : a.label;
}

/**
 * THE homepage branch resolution: today's nearest-branch logic, plus the two
 * choices the customer is now allowed to make.
 *
 * Deliberately the only entry point that reads a browse scope. Every other
 * consumer of resolveCustomerBranch — the products API, the category selector,
 * the per-branch menu page, order placement — is untouched and still resolves
 * from the customer's own trusted point alone. That asymmetry is the design: the
 * scope is a view lens on ONE page, not a change to what the customer may buy.
 */
export async function resolveHomeBranch(
  userId: number,
  scope: BrowseScope,
): Promise<HomeBranchContext> {
  if (scope.mode === "address") {
    const address = await prisma.customerAddress.findFirst({
      where: { id: scope.addressId, userId, isActive: true },
      select: { id: true, label: true, customLabel: true },
    });
    const point = address ? await pointForCustomerAddress(userId, scope.addressId) : null;
    // A row they do not own, that was deactivated, or that has no map pin: fall
    // through to the ordinary resolution rather than failing the page.
    if (address && point) {
      const context = await resolveCustomerBranch(userId, null, point);
      return {
        ...context,
        selection: scope,
        browseOnly: false,
        deliverToLabel: addressLabel(address),
      };
    }
    return withGpsScope(await resolveCustomerBranch(userId));
  }

  if (scope.mode === "branch") {
    const branch = await prisma.branch.findFirst({
      where: { id: scope.branchId, isActive: true, isArchived: false },
    });
    if (!branch) return withGpsScope(await resolveCustomerBranch(userId));

    // Covered → this is simply choosing among the branches that can already serve
    // them (the Foodpanda model resolveCustomerBranch has always supported), so
    // distance, fee and open-now all come from the normal path.
    const covered = await isBranchCoveredForCustomer(userId, branch.id);
    if (covered) {
      const context = await resolveCustomerBranch(userId, branch.id);
      if (context.branchId === branch.id) {
        return { ...context, selection: scope, browseOnly: false, deliverToLabel: null };
      }
    }

    // Not covered (or no usable point at all) — show the menu and be honest about
    // it. No distance and no fee: both are properties of a delivery that cannot
    // happen from here, and inventing them would be the lie the bar exists to avoid.
    const hours = isBranchOpenNow(branch);
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
      distanceKm: null,
      deliveryFee: null,
      pointSource: null,
      open: hours.orderable,
      opensAt: hours.orderable ? null : hours.opensAt,
      selection: scope,
      browseOnly: true,
      deliverToLabel: null,
    };
  }

  return withGpsScope(await resolveCustomerBranch(userId));
}

function withGpsScope(context: CustomerBranchContext): HomeBranchContext {
  return { ...context, selection: GPS_SCOPE, browseOnly: false, deliverToLabel: null };
}
