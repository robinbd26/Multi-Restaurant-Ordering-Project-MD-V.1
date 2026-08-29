import "server-only";
import { Prisma } from "@prisma/client";
import type { Branch, BranchDeliveryArea, BranchDeliveryZone, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { validationError, sk } from "@/lib/http/errors";
import { branchAllowsBrand, isProductBrand } from "@/lib/constants/enums";
import { directionsUrl, haversineKm, isValidLatLng, roundKm, type LatLng } from "@/lib/services/geo";
import { resolveManageableBranch, assertManagesBranch } from "@/lib/services/branch-ops";

function branchPoint(b: Pick<Branch, "latitude" | "longitude">): LatLng | null {
  if (b.latitude == null || b.longitude == null) return null;
  return { lat: Number(b.latitude), lng: Number(b.longitude) };
}

// ────────────────────────────────────────────────────────────────────────
// WS-4.5 · ONE coverage + pricing resolver
// ────────────────────────────────────────────────────────────────────────
// Two models describe "where we deliver and for how much", and before this pass
// they disagreed:
//
//   BranchDeliveryZone — a named CIRCLE (centre + radiusKm + deliveryFee). This
//     is the only thing coverage was ever checked against.
//   BranchDeliveryArea — a named administrative AREA (Dhanmondi, Mirpur…) with
//     its own optional centre, hold state, ETA and deliveryCharge. This is the
//     row `createOrder` snapshots and BILLS the customer from.
//
// So a customer could be admitted by one geometry and charged from another, and
// the "delivery fee" the storefront advertised (a zone fee, or a flat 0 inside
// the radius) was never the number the invoice used. The resolver below is now
// the SINGLE read path, and its precedence is deliberate:
//
//   1. COVERAGE is geometry, and geometry is zones + the branch's primary
//      radius ONLY. BranchDeliveryArea has a centre but no radius column (the
//      schema is frozen), so an area cannot describe a boundary and therefore
//      can never widen or narrow coverage. `coveredVia` records which rule
//      admitted the point.
//   2. PRICE comes from the most specific thing that describes the point, and
//      the ladder is EXACTLY the one `createOrder` persists, so a quote, the
//      storefront strip and the invoice can no longer disagree:
//        a. the BranchDeliveryArea resolved for this point → area.deliveryCharge
//           (+ its ETA, + its hold state, which BLOCKS a new delivery order);
//        b. otherwise Branch.deliveryFee.
//   3. BranchDeliveryZone.deliveryFee is NOT billed by the order write path. It
//      is surfaced as `zoneFee` so the branch-manager editor can show the
//      operator that the number they typed on a zone is currently inert — but
//      it is never presented to a customer as their charge. Unifying that is a
//      write-path change (see followUps), not something a read path may fake.

type CoverageBranch = Pick<Branch, "latitude" | "longitude" | "deliveryRadiusKm" | "deliveryFee">;
type CoverageZone = Pick<BranchDeliveryZone, "centerLat" | "centerLng" | "radiusKm" | "deliveryFee" | "isActive">;
type PricingArea = Pick<
  BranchDeliveryArea,
  "id" | "name" | "centerLat" | "centerLng" | "deliveryCharge" | "estimatedDeliveryMinutes" | "isActive" | "isHeld" | "holdReason"
>;

/** How a point was admitted: the branch's own radius, a named zone, or not at all. */
export type CoveredVia = "radius" | "zone" | null;

/** Which rule produced the money the customer is charged. */
export type DeliveryChargeSource = "area" | "branch";

// ── Coverage math ───────────────────────────────────────────────────────
/**
 * Whether `point` is covered by a branch: inside the branch's primary radius,
 * or inside any active named zone (step 1 of the precedence above).
 *
 * `fee` is the BRANCH-LEVEL charge that actually applies when no named delivery
 * area covers the point — i.e. `Branch.deliveryFee`, the same value the order
 * write path snapshots. It used to be 0 inside the radius and the cheapest
 * covering zone's fee otherwise, neither of which was ever billed.
 * `zoneFee` keeps the cheapest covering zone's advertised fee for the branch
 * manager's benefit; it is informational, never the customer's charge.
 */
export function coverageFor(
  branch: CoverageBranch,
  zones: CoverageZone[],
  point: LatLng,
): { covered: boolean; distanceKm: number | null; fee: number; zoneFee: number | null; coveredVia: CoveredVia } {
  const center = branchPoint(branch);
  const distanceKm = center ? roundKm(haversineKm(center, point)) : null;
  let covered = false;
  let coveredVia: CoveredVia = null;
  let zoneFee: number | null = null;

  if (center && distanceKm != null && distanceKm <= Number(branch.deliveryRadiusKm)) {
    covered = true;
    coveredVia = "radius";
  }
  for (const z of zones) {
    if (!z.isActive) continue;
    const zc = { lat: Number(z.centerLat), lng: Number(z.centerLng) };
    if (haversineKm(zc, point) <= Number(z.radiusKm)) {
      if (!covered) {
        covered = true;
        coveredVia = "zone";
      }
      // Cheapest covering zone wins, as it always did.
      const fee = Number(z.deliveryFee);
      zoneFee = zoneFee == null ? fee : Math.min(zoneFee, fee);
    }
  }
  return { covered, distanceKm, fee: Number(branch.deliveryFee), zoneFee, coveredVia };
}

/**
 * How far this branch's coverage can possibly reach, in km from its own centre:
 * the primary radius, or the far edge of the furthest active zone. Used to stop
 * an area centre on the other side of the city from claiming a point (below).
 */
function coverageReachKm(branch: CoverageBranch, zones: CoverageZone[]): number {
  const center = branchPoint(branch);
  let reach = Number(branch.deliveryRadiusKm);
  for (const z of zones) {
    if (!z.isActive) continue;
    const radius = Number(z.radiusKm);
    const edge = center
      ? haversineKm(center, { lat: Number(z.centerLat), lng: Number(z.centerLng) }) + radius
      : radius;
    if (edge > reach) reach = edge;
  }
  return reach;
}

/**
 * WHICH named area a covered coordinate belongs to (step 2a).
 *
 * An area has a centre but no radius, so it cannot be tested with "is the point
 * inside it?". The assignment is therefore a nearest-centre (Voronoi) split of
 * the branch's own coverage footprint: the point belongs to the active area
 * whose centre is closest to it, provided that centre is within the branch's
 * coverage reach — otherwise a single area in another neighbourhood would price
 * every delivery the branch makes.
 *
 * Deliberate details:
 *  - an area with NO centre is name-only: it can still be chosen explicitly at
 *    checkout, but it is never inferred from a coordinate;
 *  - a HELD area is still a candidate. Skipping it would silently reprice the
 *    order from a neighbouring area instead of refusing it, which is the exact
 *    opposite of what a hold means;
 *  - an INACTIVE area is not a candidate at all;
 *  - ties break on the lowest id, so the answer is stable across requests.
 */
function areaForPoint(
  branch: CoverageBranch,
  zones: CoverageZone[],
  areas: PricingArea[],
  point: LatLng,
): PricingArea | null {
  const reach = coverageReachKm(branch, zones);
  let best: { area: PricingArea; distance: number } | null = null;
  for (const area of areas) {
    if (!area.isActive) continue;
    if (area.centerLat == null || area.centerLng == null) continue;
    const distance = haversineKm({ lat: Number(area.centerLat), lng: Number(area.centerLng) }, point);
    if (distance > reach) continue;
    if (!best || distance < best.distance || (distance === best.distance && area.id < best.area.id)) {
      best = { area, distance };
    }
  }
  return best?.area ?? null;
}

/** The one answer every read path should ask for: is it covered, and what does it cost? */
export interface EffectiveDelivery {
  covered: boolean;
  coveredVia: CoveredVia;
  distanceKm: number | null;
  /** Exact money — Decimal all the way, never a JS float. */
  charge: Prisma.Decimal;
  source: DeliveryChargeSource;
  area: { id: number; name: string; estimatedMinutes: number; isHeld: boolean; holdReason: string } | null;
  /** Covered, but the resolved area is on hold: refuse NEW delivery orders. */
  held: boolean;
  /** Advertised zone fee for the covering zone. Informational — see the note above. */
  zoneFee: number | null;
}

/** Pure form of the resolver, so callers that already hold the rows skip the queries. */
export function effectiveDeliveryFor(
  branch: CoverageBranch,
  zones: CoverageZone[],
  areas: PricingArea[],
  point: LatLng,
): EffectiveDelivery {
  const coverage = coverageFor(branch, zones, point);
  const area = coverage.covered ? areaForPoint(branch, zones, areas, point) : null;
  return {
    covered: coverage.covered,
    coveredVia: coverage.coveredVia,
    distanceKm: coverage.distanceKm,
    charge: new Prisma.Decimal(area ? area.deliveryCharge : branch.deliveryFee),
    source: area ? "area" : "branch",
    area: area
      ? {
          id: area.id,
          name: area.name,
          estimatedMinutes: area.estimatedDeliveryMinutes,
          isHeld: area.isHeld,
          holdReason: area.holdReason,
        }
      : null,
    held: Boolean(area?.isHeld),
    zoneFee: coverage.zoneFee,
  };
}

/** Load a branch's geometry + pricing rows and resolve `point` against them. */
export async function resolveEffectiveDelivery(branchId: number, point: LatLng): Promise<EffectiveDelivery | null> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) return null;
  const [zones, areas] = await Promise.all([
    prisma.branchDeliveryZone.findMany({ where: { branchId, isActive: true } }),
    prisma.branchDeliveryArea.findMany({ where: { branchId, isActive: true } }),
  ]);
  return effectiveDeliveryFor(branch, zones, areas, point);
}

/** Wire shape of `EffectiveDelivery` — money as an exact decimal STRING. */
export interface DeliveryPricingPayload {
  charge: string;
  source: DeliveryChargeSource;
  covered_via: CoveredVia;
  zone_fee: string | null;
  area_id: number | null;
  area_name: string;
  estimated_minutes: number | null;
  is_held: boolean;
  hold_reason: string;
}

export function serializeEffectiveDelivery(effective: EffectiveDelivery): DeliveryPricingPayload {
  return {
    charge: effective.charge.toFixed(2),
    source: effective.source,
    covered_via: effective.coveredVia,
    zone_fee: effective.zoneFee != null ? effective.zoneFee.toFixed(2) : null,
    area_id: effective.area?.id ?? null,
    area_name: effective.area?.name ?? "",
    estimated_minutes: effective.area?.estimatedMinutes ?? null,
    is_held: effective.held,
    hold_reason: effective.area?.holdReason ?? "",
  };
}

export interface CoverageOutcome {
  covered: boolean;
  branch_id: number;
  branch_name: string;
  distance_km: number | null;
  delivery_fee: number;
  nearest_pickup: PickupInfo | null;
  /**
   * WS-4.5 — the unified resolver's verdict for this exact point: what the
   * customer will be charged, which rule decided it, and whether that area is
   * on hold. `delivery_fee` is kept for the existing checkout consumer and is
   * simply `charge` as a number.
   */
  pricing: DeliveryPricingPayload;
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
    directions_url: bp ? directionsUrl(bp) : null,
  };
}

/**
 * Nearest active branch offering pickup, respecting active state, pickup
 * availability, coordinates and (when given) brand compatibility.
 */
export async function nearestPickupBranch(point: LatLng, opts: { brand?: string | null; excludeBranchId?: number } = {}): Promise<PickupInfo | null> {
  const branches = await prisma.branch.findMany({
    where: { isActive: true, pickupEnabled: true, latitude: { not: null }, longitude: { not: null } },
  });
  let best: { branch: Branch; d: number } | null = null;
  for (const b of branches) {
    if (opts.excludeBranchId && b.id === opts.excludeBranchId) continue;
    // Only filter by brand when a real PRODUCT brand is supplied (cheez/madchef).
    if (opts.brand && isProductBrand(opts.brand) && !branchAllowsBrand(b.brandType, opts.brand)) continue;
    const bp = branchPoint(b)!;
    const d = haversineKm(bp, point);
    if (!best || d < best.d) best = { branch: b, d };
  }
  return best ? pickupInfo(best.branch, point) : null;
}

/**
 * Full coverage check for a customer point against a specific branch. Always
 * computed server-side. When delivery is not available, the nearest eligible
 * pickup branch is attached.
 */
export async function checkCoverage(branchId: number, point: LatLng, opts: { brand?: string | null } = {}): Promise<CoverageOutcome> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch || !branch.isActive) throw validationError({ branch_id: sk("errors.orders.branchNotFoundOrClosed") });
  // WS-4.5 — coverage AND price come from the same resolver, against the same
  // geometry, in one place. No caller re-derives either.
  const [zones, areas] = await Promise.all([
    prisma.branchDeliveryZone.findMany({ where: { branchId, isActive: true } }),
    prisma.branchDeliveryArea.findMany({ where: { branchId, isActive: true } }),
  ]);
  const effective = effectiveDeliveryFor(branch, zones, areas, point);

  return {
    covered: effective.covered,
    branch_id: branch.id,
    branch_name: branch.name,
    distance_km: effective.distanceKm,
    delivery_fee: Number(effective.charge.toFixed(2)),
    // Nearest pickup respects the product brand when one is in play; the branch's
    // own brandType is NOT a product brand and must not filter pickup options.
    nearest_pickup: effective.covered ? null : await nearestPickupBranch(point, { brand: opts.brand ?? null }),
    pricing: serializeEffectiveDelivery(effective),
  };
}

// ── Zone CRUD (BM own branch / SA any) ──────────────────────────────────
export function serializeZone(z: BranchDeliveryZone) {
  return {
    id: z.id,
    branch: z.branchId,
    name: z.name,
    center_lat: z.centerLat.toString(),
    center_lng: z.centerLng.toString(),
    radius_km: z.radiusKm.toString(),
    delivery_fee: z.deliveryFee.toString(),
    is_active: z.isActive,
    created_at: z.createdAt.toISOString(),
  };
}

interface ZoneInput {
  branchId?: number;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  deliveryFee?: number;
  isActive?: boolean;
}

function validateZone(input: ZoneInput) {
  if (!input.name.trim()) throw validationError({ name: sk("errors.ops.zoneNameRequired") });
  if (!isValidLatLng(input.centerLat, input.centerLng)) throw validationError({ center_lat: sk("errors.ops.invalidCoordinates") });
  const r = Number(input.radiusKm);
  if (!Number.isFinite(r) || r <= 0 || r > 100) throw validationError({ radius_km: sk("errors.money.enterValidRadius") });
  const fee = Number(input.deliveryFee ?? 0);
  if (!Number.isFinite(fee) || fee < 0) throw validationError({ delivery_fee: sk("errors.ops.invalidFee") });
}

export async function createZone(user: User, input: ZoneInput) {
  const branch = await resolveManageableBranch(user, input.branchId);
  validateZone(input);
  return prisma.branchDeliveryZone.create({
    data: {
      branchId: branch.id,
      name: input.name.trim(),
      centerLat: new Prisma.Decimal(Number(input.centerLat).toFixed(7)),
      centerLng: new Prisma.Decimal(Number(input.centerLng).toFixed(7)),
      radiusKm: new Prisma.Decimal(Number(input.radiusKm).toFixed(2)),
      deliveryFee: new Prisma.Decimal(Number(input.deliveryFee ?? 0).toFixed(2)),
      isActive: input.isActive ?? true,
    },
  });
}

export async function updateZone(user: User, zoneId: number, input: Partial<ZoneInput>) {
  const zone = await prisma.branchDeliveryZone.findUnique({ where: { id: zoneId } });
  if (!zone) throw validationError({ id: sk("errors.ops.zoneNotFound") });
  await assertManagesBranch(user, zone.branchId);
  const merged = {
    name: input.name ?? zone.name,
    centerLat: input.centerLat ?? Number(zone.centerLat),
    centerLng: input.centerLng ?? Number(zone.centerLng),
    radiusKm: input.radiusKm ?? Number(zone.radiusKm),
    deliveryFee: input.deliveryFee ?? Number(zone.deliveryFee),
  };
  validateZone(merged);
  return prisma.branchDeliveryZone.update({
    where: { id: zoneId },
    data: {
      name: merged.name.trim(),
      centerLat: new Prisma.Decimal(merged.centerLat.toFixed(7)),
      centerLng: new Prisma.Decimal(merged.centerLng.toFixed(7)),
      radiusKm: new Prisma.Decimal(merged.radiusKm.toFixed(2)),
      deliveryFee: new Prisma.Decimal(merged.deliveryFee.toFixed(2)),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

export async function deleteZone(user: User, zoneId: number) {
  const zone = await prisma.branchDeliveryZone.findUnique({ where: { id: zoneId } });
  if (!zone) throw validationError({ id: sk("errors.ops.zoneNotFound") });
  await assertManagesBranch(user, zone.branchId);
  await prisma.branchDeliveryZone.delete({ where: { id: zoneId } });
}

export async function zonesForBranch(branchId: number) {
  return prisma.branchDeliveryZone.findMany({ where: { branchId }, orderBy: { createdAt: "asc" } });
}
