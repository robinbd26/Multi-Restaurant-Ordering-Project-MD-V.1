import "server-only";

import type { Branch } from "@prisma/client";

import { prisma } from "@/lib/db";
import { findLocality } from "@/lib/services/area-master";
import { currentCoverageWindow } from "@/lib/services/coverage-window";
import { coverageFor } from "@/lib/services/delivery";
import { isValidLatLng, type LatLng } from "@/lib/services/geo";
import { branchCoversLocality, type LocalityCoverage } from "@/lib/services/locality-coverage";

/**
 * THE checkout coverage decision: can THIS branch deliver to THIS destination,
 * on the shift running right now?
 *
 * One function, used by the live check the checkout drawer shows while an address
 * is being chosen AND by the quote and order write paths that enforce it, so the
 * customer is never told "covered" by a screen that the server then contradicts.
 *
 * The destination is a saved address, a raw point, or both:
 *   - a saved address's OWN coordinates win over whatever the request carried
 *     (the WS-4.2 rule: a chosen address cannot be steered by the body);
 *   - its zone + locality pair is resolved against the MASTER list, so an address
 *     with no map pin can still be covered by name;
 *   - a custom-typed locality names nothing on that list and covers nobody.
 *
 * Coverage is the UNION of geometry (radius / zones) and the branch's locality
 * list for the active shift. A cart belongs to exactly one branch, so there is no
 * "find another branch" here: either this branch covers the destination, or
 * delivery is not offered and pickup is the answer.
 */

export interface AddressCoverage {
  covered: boolean;
  /** What granted it. Geometry is reported first when both would. */
  via: "geometry" | "locality" | null;
  /** The point coverage and pricing are measured from, when there is one. */
  point: LatLng | null;
  /** The saved address this decision was made for, once ownership is verified. */
  customerAddressId: number | null;
  localityId: number | null;
  localityName: string | null;
  /**
   * The branch's coverage row for that locality on the active shift, if any —
   * returned even when it is ON HOLD (isHeld true), so a caller can explain WHY
   * ("this area is paused") rather than just "not covered". It does NOT, by
   * itself, mean the address is covered: see `covered` and `via`.
   */
  localityRow: LocalityCoverage | null;
  window: "day" | "night";
  /** covered · no_location (nothing to measure) · on_hold · not_covered (measured, outside). */
  reason: "covered" | "no_location" | "on_hold" | "not_covered";
}

export async function coverageForAddress(
  branch: Branch,
  target: {
    customerId: number;
    customerAddressId?: number | null;
    lat?: number | null;
    lng?: number | null;
    /**
     * ITEM 8 — a ONE-TIME address for this order only, never saved to the
     * address book. Read ONLY when customerAddressId is absent: a saved
     * address, once chosen, is still authoritative over anything the body
     * carries (WS-4.2) — these fields exist for the customer's OWN typed
     * text on an order that has no saved row to be authoritative instead.
     */
    mainArea?: string | null;
    subArea?: string | null;
  },
): Promise<AddressCoverage> {
  const window = currentCoverageWindow();

  let point: LatLng | null =
    target.lat != null && target.lng != null && isValidLatLng(Number(target.lat), Number(target.lng))
      ? { lat: Number(target.lat), lng: Number(target.lng) }
      : null;
  let customerAddressId: number | null = null;
  let localityId: number | null = null;
  let localityName: string | null = null;

  if (target.customerAddressId != null && Number.isSafeInteger(Number(target.customerAddressId))) {
    // Scoped to this customer's own active rows: an id borrowed from another
    // account resolves to nothing and contributes no coverage.
    const address = await prisma.customerAddress.findFirst({
      where: { id: Number(target.customerAddressId), userId: target.customerId, isActive: true },
      select: { id: true, latitude: true, longitude: true, mainArea: true, subArea: true },
    });
    if (address) {
      customerAddressId = address.id;
      if (address.latitude != null && address.longitude != null) {
        const lat = Number(address.latitude);
        const lng = Number(address.longitude);
        if (isValidLatLng(lat, lng)) point = { lat, lng };
      }
      const locality = await findLocality(address.mainArea, address.subArea);
      if (locality) {
        localityId = locality.id;
        localityName = locality.name;
      }
    }
  } else if (target.mainArea) {
    // ITEM 8 — the one-time path: no saved row, so the customer's own typed
    // area/sub-area pair (this request only) is matched the SAME way a saved
    // address's stored pair is — by name, against the master list. A point
    // already resolved from target.lat/lng above (e.g. a map pick) stands.
    const locality = await findLocality(target.mainArea, target.subArea ?? "");
    if (locality) {
      localityId = locality.id;
      localityName = locality.name;
    }
  }

  let geometry = false;
  if (point && branch.latitude != null && branch.longitude != null) {
    const zones = await prisma.branchDeliveryZone.findMany({
      where: { branchId: branch.id, isActive: true },
    });
    geometry = coverageFor(branch, zones, point).covered;
  }

  const localityRow = localityId != null ? await branchCoversLocality(branch.id, localityId, window) : null;
  // ITEM 2 — a branch manager's HOLD on a named area is a deliberate "not
  // delivering there right now" and must not grant coverage, even though the
  // row still genuinely names the locality. Geometry is a SEPARATE signal (a
  // different admin surface, BranchDeliveryZone) and is left untouched: if the
  // address independently falls inside the branch's radius/zone, that still
  // covers it regardless of what a named-area hold says.
  const localityGrants = localityRow != null && !localityRow.isHeld;
  const covered = geometry || localityGrants;

  return {
    covered,
    via: geometry ? "geometry" : localityGrants ? "locality" : null,
    point,
    customerAddressId,
    localityId,
    localityName,
    localityRow,
    window,
    reason: covered
      ? "covered"
      : localityRow?.isHeld
        ? "on_hold"
        : !point && localityId == null
          ? "no_location"
          : "not_covered",
  };
}
