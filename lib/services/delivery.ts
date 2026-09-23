import "server-only";
import { Prisma } from "@prisma/client";
import type { Branch } from "@prisma/client";

import { prisma } from "@/lib/db";
import { validationError, sk } from "@/lib/http/errors";
import { branchAllowsBrand, isProductBrand } from "@/lib/constants/enums";
import { branchPoint, coverageForPoint, type BranchCoverage } from "@/lib/services/coverage";
import { directionsUrl, haversineKm, roundKm, type LatLng } from "@/lib/services/geo";

/**
 * Delivery pricing + pickup, on top of the ONE coverage answer.
 *
 * Coverage itself lives in lib/services/coverage.ts (rules) and lib/coverage
 * (pure geometry). This module only turns a verdict into the wire shapes the
 * storefront and checkout read, and answers "where can they collect instead?".
 *
 * WHAT CHANGED, and why it matters when reading old call sites: there used to
 * be three competing geometries — the branch radius, BranchDeliveryZone circles
 * and a named-area centroid Voronoi split — so a customer could be admitted by
 * one and billed from another. There is now exactly one: a drawn delivery-area
 * shape. The branch radius is a CEILING on what a manager may draw, not a
 * coverage grant, and the circles are gone (migrated into shapes).
 */

/** Wire shape of a coverage verdict — money as an exact decimal STRING. */
export interface DeliveryPricingPayload {
  charge: string;
  /** Which rule produced the money: a drawn area, or the branch-level fee. */
  source: "area" | "branch";
  status: BranchCoverage["status"];
  reason: BranchCoverage["reason"];
  area_id: number | null;
  area_name: string;
  estimated_minutes: number | null;
  /** True when a hold or a delivery pause leaves only pickup. */
  is_held: boolean;
  hold_reason: string;
}

export function serializeCoverage(coverage: BranchCoverage): DeliveryPricingPayload {
  const named = coverage.area ?? coverage.blockedArea;
  return {
    charge: coverage.charge.toFixed(2),
    source: coverage.area ? "area" : "branch",
    status: coverage.status,
    reason: coverage.reason,
    area_id: coverage.area?.id ?? null,
    area_name: named?.name ?? "",
    estimated_minutes: coverage.estimatedMinutes,
    is_held: coverage.pickupOnly,
    hold_reason: coverage.blockedArea?.holdReason ?? "",
  };
}

export interface PickupInfo {
  branch_id: number;
  branch_name: string;
  address: string;
  phone: string;
  distance_km: number | null;
  latitude: string | null;
  longitude: string | null;
  opening_time: string | null;
  closing_time: string | null;
  directions_url: string | null;
}

function pickupInfo(branch: Branch, point: LatLng | null): PickupInfo {
  const bp = branchPoint(branch);
  return {
    branch_id: branch.id,
    branch_name: branch.name,
    address: branch.pickupAddress || branch.address,
    phone: branch.pickupPhone || branch.phone,
    distance_km: bp && point ? roundKm(haversineKm(bp, point)) : null,
    latitude: branch.latitude?.toString() ?? null,
    longitude: branch.longitude?.toString() ?? null,
    opening_time: branch.openingTime,
    closing_time: branch.closingTime,
    // A plain Google Maps URL for the customer to navigate with — no API key.
    directions_url: bp ? directionsUrl(bp) : null,
  };
}

/**
 * Nearest active branch offering pickup, respecting active state, pickup
 * availability, coordinates and (when given) brand compatibility.
 *
 * Deliberately independent of delivery coverage: collecting in person does not
 * need the branch to deliver to you, which is the whole point of the fallback.
 */
export async function nearestPickupBranch(
  point: LatLng,
  opts: { brand?: string | null; excludeBranchId?: number } = {},
): Promise<PickupInfo | null> {
  const branches = await prisma.branch.findMany({
    where: {
      isActive: true,
      isArchived: false,
      pickupEnabled: true,
      latitude: { not: null },
      longitude: { not: null },
    },
  });
  let best: { branch: Branch; d: number } | null = null;
  for (const b of branches) {
    if (opts.excludeBranchId && b.id === opts.excludeBranchId) continue;
    // Only filter by brand when a real PRODUCT brand is supplied (cheez/madchef).
    if (opts.brand && isProductBrand(opts.brand) && !branchAllowsBrand(b.brandType, opts.brand)) continue;
    const bp = branchPoint(b);
    if (!bp) continue;
    const d = haversineKm(bp, point);
    if (!best || d < best.d) best = { branch: b, d };
  }
  return best ? pickupInfo(best.branch, point) : null;
}

export interface CoverageOutcome {
  covered: boolean;
  branch_id: number;
  branch_name: string;
  distance_km: number | null;
  delivery_fee: number;
  nearest_pickup: PickupInfo | null;
  pricing: DeliveryPricingPayload;
}

/**
 * Full coverage check for a customer pin against a specific branch. Always
 * computed server-side. When delivery is not available, the nearest eligible
 * pickup branch is attached so the answer is never a dead end.
 */
export async function checkCoverage(
  branchId: number,
  point: LatLng,
  opts: { brand?: string | null } = {},
): Promise<CoverageOutcome> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch || !branch.isActive) {
    throw validationError({ branch_id: sk("errors.orders.branchNotFoundOrClosed") });
  }
  const coverage = await coverageForPoint(branch, point);

  return {
    covered: coverage.covered,
    branch_id: branch.id,
    branch_name: branch.name,
    distance_km: coverage.distanceKm,
    delivery_fee: Number(coverage.charge.toFixed(2)),
    // Nearest pickup respects the product brand when one is in play; the branch's
    // own brandType is NOT a product brand and must not filter pickup options.
    nearest_pickup: coverage.covered ? null : await nearestPickupBranch(point, { brand: opts.brand ?? null }),
    pricing: serializeCoverage(coverage),
  };
}

/**
 * The delivery charge for a cart: pickup is free, a covering area supplies its
 * own charge, otherwise the branch-level fee applies. Read straight off the
 * Decimal columns — never recomputed from a client figure.
 */
export function deliveryChargeFor(
  fulfillmentType: "delivery" | "pickup",
  branch: { deliveryFee: Prisma.Decimal },
  area: { deliveryCharge: Prisma.Decimal } | null,
): Prisma.Decimal {
  if (fulfillmentType === "pickup") return new Prisma.Decimal(0);
  return new Prisma.Decimal(area ? area.deliveryCharge : branch.deliveryFee).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}
