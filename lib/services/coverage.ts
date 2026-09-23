import "server-only";
import { Prisma } from "@prisma/client";
import type { Branch, BranchDeliveryArea } from "@prisma/client";

import { isDeliveryPaused } from "@/lib/coverage/pause";
import {
  coverageForBranch,
  rankBranchesForPoint,
  type BranchCoverageResult,
  type CoverageReason,
  type CoverageStatus,
} from "@/lib/coverage/resolve";
import { prisma } from "@/lib/db";
import { isBranchOpenNow } from "@/lib/services/branch-hours";
import { currentCoverageWindow } from "@/lib/services/coverage-window";
import { haversineKm, isValidLatLng, roundKm, type LatLng } from "@/lib/services/geo";

/**
 * THE database-backed coverage answer: "can this branch deliver to this pin,
 * right now, and for how much?" — and, across branches, "who should serve it?".
 *
 * The RULES all live in lib/coverage (pure, tested). This module only loads
 * rows and hands them over, so there is exactly one implementation of the
 * decision and the live checkout check, the quote and the order write path
 * cannot drift apart.
 *
 * Money stays a Prisma.Decimal end to end: the engine compares charges as
 * numbers to pick an area, and the chosen AREA ROW is what supplies the figure
 * that gets billed.
 */

/** Everything the decision needs off an area row. */
export const COVERAGE_AREA_SELECT = {
  id: true,
  name: true,
  shape: true,
  isActive: true,
  isHeld: true,
  holdReason: true,
  coverageWindow: true,
  deliveryCharge: true,
  estimatedDeliveryMinutes: true,
} as const;

export type CoverageArea = Prisma.BranchDeliveryAreaGetPayload<{ select: typeof COVERAGE_AREA_SELECT }>;

/** The branch columns coverage reads. */
type CoverageBranch = Pick<
  Branch,
  | "id"
  | "latitude"
  | "longitude"
  | "deliveryRadiusKm"
  | "deliveryFee"
  | "deliveryPauseMode"
  | "deliveryPausedUntil"
>;

export function branchPoint(b: Pick<Branch, "latitude" | "longitude">): LatLng | null {
  if (b.latitude == null || b.longitude == null) return null;
  const lat = Number(b.latitude);
  const lng = Number(b.longitude);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

/** One branch's verdict, with the money already resolved. */
export interface BranchCoverage {
  branchId: number;
  status: CoverageStatus;
  reason: CoverageReason;
  /** True only for "deliverable" — the single question every caller asks. */
  covered: boolean;
  /** Pickup is the honest offer when a hold or a pause blocks delivery. */
  pickupOnly: boolean;
  /** The area that prices the order. Null unless deliverable. */
  area: CoverageArea | null;
  /** The held/paused area behind a pickup-only verdict, so the UI can say why. */
  blockedArea: CoverageArea | null;
  /** Exact money — the chosen area's charge, else the branch-level fee. */
  charge: Prisma.Decimal;
  estimatedMinutes: number | null;
  distanceKm: number | null;
  window: "day" | "night";
}

function toBranchCoverage(
  branch: CoverageBranch,
  point: LatLng,
  result: BranchCoverageResult<CoverageArea>,
  window: "day" | "night",
): BranchCoverage {
  const center = branchPoint(branch);
  return {
    branchId: branch.id,
    status: result.status,
    reason: result.reason,
    covered: result.status === "deliverable",
    pickupOnly: result.status === "pickup_only",
    area: result.area,
    blockedArea: result.heldArea,
    // The branch-level fee keeps its old meaning: it applies when no area
    // supplies a charge. Coverage now always names an area, so in practice this
    // is the fallback for a quote taken before an area is resolved.
    charge: new Prisma.Decimal(result.area ? result.area.deliveryCharge : branch.deliveryFee),
    estimatedMinutes: result.area?.estimatedDeliveryMinutes ?? null,
    distanceKm: center ? roundKm(haversineKm(center, point)) : null,
    window,
  };
}

/** Load a branch's areas for the coverage decision. */
export async function areasForCoverage(branchId: number): Promise<CoverageArea[]> {
  return prisma.branchDeliveryArea.findMany({
    where: { branchId, isActive: true },
    select: COVERAGE_AREA_SELECT,
  });
}

/**
 * Can THIS branch deliver to THIS pin, right now?
 *
 * The one call the quote, the order write path and the live checkout check all
 * make, so a customer can never be told "covered" by a screen the server then
 * contradicts.
 */
export async function coverageForPoint(
  branch: CoverageBranch,
  point: LatLng,
  options: { window?: "day" | "night"; areas?: CoverageArea[] } = {},
): Promise<BranchCoverage> {
  const window = options.window ?? currentCoverageWindow();
  const areas = options.areas ?? (await areasForCoverage(branch.id));
  const result = coverageForBranch(point, areas, window, { deliveryPaused: isDeliveryPaused(branch) });
  return toBranchCoverage(branch, point, result, window);
}

/** Load the branch too, when the caller only has an id. */
export async function coverageForBranchId(
  branchId: number,
  point: LatLng,
  options: { window?: "day" | "night" } = {},
): Promise<BranchCoverage | null> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) return null;
  return coverageForPoint(branch, point, options);
}

// ── across branches ───────────────────────────────────────────────────────

export interface BranchCoverageOption extends BranchCoverage {
  branchName: string;
  openNow: boolean;
  /** Opening time to show when the branch is covered but closed; else null. */
  opensAt: string | null;
  pickupEnabled: boolean;
}

/**
 * Every live branch's verdict for one pin, best first.
 *
 * `[0]` is the default the customer gets — the nearest branch that can deliver
 * and is open — and every other entry whose status is not "not_covered" is a
 * branch they may switch to. Archived and deactivated branches are excluded
 * outright: they are not a choice, so listing them would only be noise.
 *
 * ONE query for the branches and ONE for every area, rather than a query per
 * branch: this runs on the homepage, the restaurants page and at checkout.
 */
export async function branchOptionsForPoint(
  point: LatLng,
  options: { window?: "day" | "night"; brandFilter?: (branch: Branch) => boolean } = {},
): Promise<BranchCoverageOption[]> {
  const window = options.window ?? currentCoverageWindow();
  const branches = (
    await prisma.branch.findMany({ where: { isActive: true, isArchived: false }, orderBy: { name: "asc" } })
  ).filter((b) => (options.brandFilter ? options.brandFilter(b) : true));
  if (branches.length === 0) return [];

  const areas = await prisma.branchDeliveryArea.findMany({
    where: { branchId: { in: branches.map((b) => b.id) }, isActive: true },
    select: { ...COVERAGE_AREA_SELECT, branchId: true },
  });
  const byBranch = new Map<number, CoverageArea[]>();
  for (const a of areas) {
    const list = byBranch.get(a.branchId);
    if (list) list.push(a);
    else byBranch.set(a.branchId, [a]);
  }

  const hoursById = new Map(branches.map((b) => [b.id, isBranchOpenNow(b)]));
  const ranked = rankBranchesForPoint(
    point,
    branches.map((b) => ({
      branchId: b.id,
      center: branchPoint(b),
      openNow: hoursById.get(b.id)?.orderable ?? false,
      deliveryPaused: isDeliveryPaused(b),
      areas: byBranch.get(b.id) ?? [],
    })),
    window,
  );

  const branchById = new Map(branches.map((b) => [b.id, b]));
  return ranked.map((row) => {
    const branch = branchById.get(row.branchId)!;
    const hours = hoursById.get(branch.id)!;
    return {
      ...toBranchCoverage(branch, point, row, window),
      branchName: branch.name,
      openNow: hours.orderable,
      opensAt: hours.orderable ? null : hours.opensAt,
      pickupEnabled: branch.pickupEnabled,
    };
  });
}

/**
 * The branch that should serve this pin: the nearest one that can deliver and
 * is open. Null when nothing can deliver — the caller then offers pickup.
 */
export async function bestBranchForPoint(
  point: LatLng,
  options: { window?: "day" | "night" } = {},
): Promise<BranchCoverageOption | null> {
  const ranked = await branchOptionsForPoint(point, options);
  return ranked.find((b) => b.covered && b.openNow) ?? ranked.find((b) => b.covered) ?? null;
}

/**
 * Does any live branch deliver to this pin at all? Used by the storefront to
 * tell "we do not deliver here" apart from "this branch does not".
 */
export async function anyBranchCovers(point: LatLng): Promise<boolean> {
  const ranked = await branchOptionsForPoint(point);
  return ranked.some((b) => b.covered);
}

/** The shape rows the super admin's overview map and the editors render. */
export async function areaShapesForBranches(branchIds?: number[]): Promise<
  (Pick<BranchDeliveryArea, "id" | "branchId" | "name" | "shape" | "isActive" | "isHeld" | "coverageWindow"> & {
    deliveryCharge: string;
    estimatedDeliveryMinutes: number;
  })[]
> {
  const rows = await prisma.branchDeliveryArea.findMany({
    where: branchIds ? { branchId: { in: branchIds } } : {},
    select: {
      id: true,
      branchId: true,
      name: true,
      shape: true,
      isActive: true,
      isHeld: true,
      coverageWindow: true,
      deliveryCharge: true,
      estimatedDeliveryMinutes: true,
    },
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
  });
  return rows.map((r) => ({ ...r, deliveryCharge: r.deliveryCharge.toFixed(2) }));
}
