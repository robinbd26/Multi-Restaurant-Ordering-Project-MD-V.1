import "server-only";

import { prisma } from "@/lib/db";
import type { BrowseScope, DeliverTo } from "@/lib/browse-scope/config";
import { coverageFor, effectiveDeliveryFor } from "@/lib/services/delivery";
import { isValidLatLng } from "@/lib/services/geo";
import {
  isBranchCoveredForCustomer,
  nearestEligibleBranch,
  pointForCustomerAddress,
  type TrustedPoint,
} from "@/lib/services/customer-location";
import { isBranchOpenNow } from "@/lib/services/branch-hours";
import { findLocality } from "@/lib/services/area-master";
import { branchCoversLocality } from "@/lib/services/locality-coverage";

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
    /** "dine_in" | "cloud_kitchen" — a display badge only. */
    businessType: string;
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
  /** The master locality the deliver-to address names, when it names one. */
  localityId?: number | null,
): Promise<CustomerBranchContext> {
  const nearest = await nearestEligibleBranch(userId, pointOverride, localityId);
  // A named locality can resolve a branch with no coordinates at all, so the
  // absence of a point is only "no location" when nothing covers them either.
  const coveredByName = nearest.branches.some((b) => b.covered);
  if (!nearest.point && !coveredByName) return EMPTY;

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
  // With a point, the shared geometry resolver prices it exactly as the order
  // write path will. Without one, the named-area row that granted coverage
  // carries its own charge, which is the only honest figure available.
  const coverage = nearest.point ? effectiveDeliveryFor(branch, zones, areas, nearest.point) : null;
  const listedRow = nearest.point == null && localityId != null
    ? await branchCoversLocality(branch.id, localityId)
    : null;

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
      businessType: branch.businessType,
      address: branch.address,
      pickupEnabled: branch.pickupEnabled,
      prepTimeMinutes: branch.prepTimeMinutes,
    },
    distanceKm: targetDistance,
    deliveryFee: coverage
      ? (coverage.covered ? Number(coverage.charge.toFixed(2)) : null)
      : (listedRow?.charge ?? null),
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

// ── Storefront deliver-to + browsing selection ──────────────────────────────

export interface HomeBranchContext extends CustomerBranchContext {
  /**
   * The scope actually IN FORCE, after validation. It can differ from the cookie
   * the browser sent — an address that is not theirs, or a branch that has since
   * been archived, is dropped here — so the controls highlight what the page
   * really did, never what was merely asked for.
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
  /**
   * When browse-only: a saved address of theirs that this branch CAN reach, so
   * the bar can offer the one-click fix instead of a dead end. Null when they
   * have none — the honest answer is then pickup, or nothing.
   */
  coveredAddress: { id: number; label: string } | null;
}

/**
 * The first saved address of theirs that a given branch can actually reach.
 *
 * This is the one-click answer to "I am in Banani, ordering for someone in
 * Mirpur": the branch on screen cannot deliver to the current deliver-to point,
 * but it may very well cover an address they have already saved. Offering that
 * beats the dead end, and it is not a loophole — picking it sets the deliver-to
 * point to a real row the customer owns, which is exactly what checkout would
 * have priced anyway (resolveDeliveryCoordinate treats a chosen address as
 * authoritative).
 *
 * Default first, so the most likely answer is the one offered. Stops at the
 * first match: the bar has room for one suggestion, not a list.
 */
async function coveredSavedAddress(
  userId: number,
  branch: { id: number } & Parameters<typeof coverageFor>[0],
): Promise<{ id: number; label: string } | null> {
  const rows = await prisma.customerAddress.findMany({
    where: { userId, isActive: true, latitude: { not: null }, longitude: { not: null } },
    select: { id: true, label: true, customLabel: true, latitude: true, longitude: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (rows.length === 0) return null;
  const zones = await prisma.branchDeliveryZone.findMany({
    where: { branchId: branch.id, isActive: true },
  });
  for (const a of rows) {
    if (a.latitude == null || a.longitude == null) continue;
    const lat = Number(a.latitude);
    const lng = Number(a.longitude);
    if (!isValidLatLng(lat, lng)) continue;
    if (coverageFor(branch, zones, { lat, lng }).covered) {
      return { id: a.id, label: addressLabel(a) };
    }
  }
  return null;
}

/** display_label, without paying for a full serializer. */
function addressLabel(a: { label: string; customLabel: string | null }): string {
  return a.label === "Others" && a.customLabel ? a.customLabel : a.label;
}

/**
 * Resolve the deliver-to half of a scope into a point.
 *
 * Returns the validated choice alongside the point, so a rejected address (not
 * theirs, deactivated, or saved without a map pin) comes back as "gps" and the
 * controls never show a selection the page did not honour. Shared by the
 * homepage and the dashboard Restaurants page, so both judge coverage from the
 * same point.
 */
export async function resolveDeliverTo(
  userId: number,
  deliverTo: DeliverTo,
): Promise<{
  deliverTo: DeliverTo;
  point: TrustedPoint | null;
  label: string | null;
  /** The master locality this address names, when it names one. */
  localityId: number | null;
  localityName: string | null;
}> {
  if (deliverTo.mode === "address") {
    const address = await prisma.customerAddress.findFirst({
      where: { id: deliverTo.addressId, userId, isActive: true },
      select: { id: true, label: true, customLabel: true, mainArea: true, subArea: true },
    });
    const point = address ? await pointForCustomerAddress(userId, address.id) : null;
    // Only a zone + locality pair that exists on the MASTER list counts. A
    // custom-typed area resolves to nothing, so it stays uncovered until a
    // branch manager adds it — the rule that keeps the coverage list meaningful.
    const locality = address ? await findLocality(address.mainArea, address.subArea) : null;
    // An address with no map pin is still usable when it names a covered
    // locality: that is exactly what named-area coverage is for.
    if (address && (point || locality)) {
      return {
        deliverTo,
        point,
        label: addressLabel(address),
        localityId: locality?.id ?? null,
        localityName: locality?.name ?? null,
      };
    }
  }
  // A null point means "use the customer's own trusted point", which every
  // resolver below already derives when no override is passed.
  return { deliverTo: { mode: "gps" }, point: null, label: null, localityId: null, localityName: null };
}

/**
 * THE homepage branch resolution: today's nearest-branch logic, plus the two
 * independent choices the customer is now allowed to make.
 *
 *   1. deliverTo fixes the point every coverage and price decision is made from.
 *   2. branchId, when set, picks the menu. If that branch covers the point, this
 *      is simply choosing among the branches that can already serve them (the
 *      Foodpanda model resolveCustomerBranch has always supported), with real
 *      distance, fee and open-now. If it does not, the menu is still shown and
 *      the context is marked browseOnly.
 *
 * Every consumer of resolveCustomerBranch that places or prices an order — the
 * products API, the category selector, the per-branch menu page, order
 * placement — is untouched and still resolves from the customer's own trusted
 * point alone. The scope is a view lens, not a change to what they may buy.
 */
export async function resolveHomeBranch(
  userId: number,
  scope: BrowseScope,
): Promise<HomeBranchContext> {
  const target = await resolveDeliverTo(userId, scope.deliverTo);

  if (scope.branchId != null) {
    const branch = await prisma.branch.findFirst({
      where: { id: scope.branchId, isActive: true, isArchived: false },
    });
    if (branch) {
      const selection: BrowseScope = { deliverTo: target.deliverTo, branchId: branch.id };
      // resolveCustomerBranch honours a preferred branch only when it covers the
      // point, and otherwise falls back to the nearest covering one — so landing
      // on a DIFFERENT branch id is precisely "the browsed branch cannot reach".
      const context = await resolveCustomerBranch(userId, branch.id, target.point, target.localityId);
      if (context.branchId === branch.id) {
        return {
          ...context,
          selection,
          browseOnly: false,
          deliverToLabel: target.label,
          coveredAddress: null,
        };
      }

      // No distance and no fee: both are properties of a delivery that cannot
      // happen from here, and inventing them would be the lie the bar exists to avoid.
      const hours = isBranchOpenNow(branch);
      return {
        state: "ok",
        branchId: branch.id,
        branch: {
          id: branch.id,
          name: branch.name,
          brandType: branch.brandType,
      businessType: branch.businessType,
          address: branch.address,
          pickupEnabled: branch.pickupEnabled,
          prepTimeMinutes: branch.prepTimeMinutes,
        },
        distanceKm: null,
        deliveryFee: null,
        pointSource: context.pointSource,
        open: hours.orderable,
        opensAt: hours.orderable ? null : hours.opensAt,
        selection,
        browseOnly: true,
        deliverToLabel: target.label,
        coveredAddress: await coveredSavedAddress(userId, branch),
      };
    }
  }

  const context = await resolveCustomerBranch(userId, null, target.point, target.localityId);
  return {
    ...context,
    selection: { deliverTo: target.deliverTo, branchId: null },
    browseOnly: false,
    deliverToLabel: target.label,
    coveredAddress: null,
  };
}
