import "server-only";

import type { Branch } from "@prisma/client";

import { prisma } from "@/lib/db";
import { coverageForPoint, type BranchCoverage } from "@/lib/services/coverage";
import { isValidLatLng, type LatLng } from "@/lib/services/geo";

/**
 * THE checkout coverage decision: can THIS branch deliver to THIS destination,
 * on the shift running right now?
 *
 * One function, used by the live check the checkout drawer shows while an
 * address is being chosen AND by the quote and order write paths that enforce
 * it, so the customer is never told "covered" by a screen that the server then
 * contradicts.
 *
 * THE DESTINATION IS A PIN. Nothing else. A saved address carries its own
 * coordinates (required since the map migration) and those WIN over whatever
 * the request body sent — a chosen address cannot be steered by the client. A
 * one-time address at checkout carries a pin the customer just dropped. Typed
 * street and area text is delivery instructions for the rider; it decides
 * nothing, which is exactly the name matching this replaced.
 */

export interface AddressCoverage {
  covered: boolean;
  /** Pickup is still on offer: the area is held, or delivery is paused. */
  pickupOnly: boolean;
  /** The point the decision was made from, when there was one. */
  point: LatLng | null;
  /** The saved address this decision was made for, once ownership is verified. */
  customerAddressId: number | null;
  /** The branch's full verdict, including the charge and the covering area. */
  coverage: BranchCoverage | null;
  window: "day" | "night";
  /** covered · no_location (nothing to measure) · on_hold · not_covered. */
  reason: "covered" | "no_location" | "on_hold" | "not_covered";
}

export async function coverageForAddress(
  branch: Branch,
  target: {
    customerId: number;
    customerAddressId?: number | null;
    lat?: number | null;
    lng?: number | null;
  },
): Promise<AddressCoverage> {
  let point: LatLng | null =
    target.lat != null && target.lng != null && isValidLatLng(Number(target.lat), Number(target.lng))
      ? { lat: Number(target.lat), lng: Number(target.lng) }
      : null;
  let customerAddressId: number | null = null;

  if (target.customerAddressId != null && Number.isSafeInteger(Number(target.customerAddressId))) {
    // Scoped to this customer's own active rows: an id borrowed from another
    // account resolves to nothing and contributes no coverage.
    const address = await prisma.customerAddress.findFirst({
      where: { id: Number(target.customerAddressId), userId: target.customerId, isActive: true },
      select: { id: true, latitude: true, longitude: true },
    });
    if (address) {
      customerAddressId = address.id;
      const lat = Number(address.latitude);
      const lng = Number(address.longitude);
      if (isValidLatLng(lat, lng)) point = { lat, lng };
    }
  }

  if (!point) {
    return {
      covered: false,
      pickupOnly: false,
      point: null,
      customerAddressId,
      coverage: null,
      window: "day",
      reason: "no_location",
    };
  }

  const coverage = await coverageForPoint(branch, point);
  return {
    covered: coverage.covered,
    pickupOnly: coverage.pickupOnly,
    point,
    customerAddressId,
    coverage,
    window: coverage.window,
    reason: coverage.covered ? "covered" : coverage.pickupOnly ? "on_hold" : "not_covered",
  };
}
