import { coverageAppliesIn } from "@/lib/services/coverage-window";
import { haversineKm, isValidLatLng, type LatLng } from "@/lib/services/geo";

import { parseShape, pointInShape } from "./shape";

/**
 * THE coverage decision, as pure functions.
 *
 * "Can this branch deliver to this pin, right now, and on what terms?" — and,
 * across branches, "which branch should serve it?". No database and no clock of
 * its own: callers pass the rows and the active shift in, so the live checkout
 * check, the order write path and the tests all run the identical code.
 *
 * THE RULES, in the order they apply:
 *   1. an area covers a pin when its shape contains the pin, the row is ACTIVE,
 *      and the row applies to the shift running now (day / night / all day);
 *   2. a pin inside only HELD areas is PICKUP ONLY for that branch — a hold is
 *      a deliberate "not right now", not an invitation to price it from a
 *      neighbouring area;
 *   3. a branch whose manager has PAUSED DELIVERY is pickup only too, however
 *      well its shapes cover the pin;
 *   4. inside several of one branch's areas, the CHEAPEST charge wins, then the
 *      shortest delivery time, then the lowest id so the answer is stable;
 *   5. across branches, the NEAREST branch that covers the pin and is OPEN now
 *      is the default — and the customer may switch to any other branch that
 *      covers them.
 */

/** The minimum an area row must expose to be judged. Prisma rows satisfy it. */
export interface CoverageAreaInput {
  id: number;
  shape: string | null;
  isActive: boolean;
  isHeld: boolean;
  coverageWindow: string;
  /** Compared, never billed: money is read from the caller's own row. */
  deliveryCharge: unknown;
  estimatedDeliveryMinutes: number;
}

/** Why a branch came out the way it did — the UI says this to the customer. */
export type CoverageReason =
  /** Inside an active area on this shift. */
  | "covered"
  /** Inside an area, but that area is on hold: pickup only. */
  | "area_held"
  /** The branch manager paused delivery: pickup only. */
  | "delivery_paused"
  /** Outside every shape this branch has for this shift. */
  | "outside"
  /** The branch has no drawn area that applies right now. */
  | "no_coverage_configured";

export type CoverageStatus = "deliverable" | "pickup_only" | "not_covered";

export interface BranchCoverageResult<A extends CoverageAreaInput> {
  status: CoverageStatus;
  reason: CoverageReason;
  /** The area that decides the charge and the ETA. Null unless deliverable. */
  area: A | null;
  /** When pickup-only because of a hold: the held area, so the UI can say why. */
  heldArea: A | null;
}

/** Areas that could cover ANY pin for this branch on this shift. */
function applicableAreas<A extends CoverageAreaInput>(
  areas: readonly A[],
  window: "day" | "night",
): A[] {
  return areas.filter((a) => a.isActive && a.shape != null && coverageAppliesIn(a.coverageWindow, window));
}

/** Cheapest charge, then shortest delivery time, then lowest id. */
function betterArea<A extends CoverageAreaInput>(candidate: A, current: A): boolean {
  const a = Number(candidate.deliveryCharge);
  const b = Number(current.deliveryCharge);
  if (a !== b) return a < b;
  if (candidate.estimatedDeliveryMinutes !== current.estimatedDeliveryMinutes) {
    return candidate.estimatedDeliveryMinutes < current.estimatedDeliveryMinutes;
  }
  return candidate.id < current.id;
}

/**
 * One branch's verdict for one pin.
 *
 * `deliveryPaused` is passed in rather than derived here so the expiry clock
 * lives in exactly one place (lib/services/branch-pause.ts).
 */
export function coverageForBranch<A extends CoverageAreaInput>(
  point: LatLng,
  areas: readonly A[],
  window: "day" | "night",
  options: { deliveryPaused?: boolean } = {},
): BranchCoverageResult<A> {
  if (!isValidLatLng(point.lat, point.lng)) {
    return { status: "not_covered", reason: "outside", area: null, heldArea: null };
  }
  const applicable = applicableAreas(areas, window);
  if (applicable.length === 0) {
    return { status: "not_covered", reason: "no_coverage_configured", area: null, heldArea: null };
  }

  let best: A | null = null;
  let held: A | null = null;
  for (const area of applicable) {
    const shape = parseShape(area.shape);
    // A shape that will not parse covers nothing: a corrupt row must never
    // widen coverage, and never take the whole check down either.
    if (!shape || !pointInShape(point, shape)) continue;
    if (area.isHeld) {
      if (!held || betterArea(area, held)) held = area;
      continue;
    }
    if (!best || betterArea(area, best)) best = area;
  }

  // A manager's pause outranks a perfectly good shape, but never removes
  // pickup: "our riders are swamped" is not "we are closed".
  if (options.deliveryPaused) {
    const inside = best ?? held;
    return {
      status: inside ? "pickup_only" : "not_covered",
      reason: inside ? "delivery_paused" : "outside",
      area: null,
      heldArea: inside,
    };
  }
  if (best) return { status: "deliverable", reason: "covered", area: best, heldArea: null };
  if (held) return { status: "pickup_only", reason: "area_held", area: null, heldArea: held };
  return { status: "not_covered", reason: "outside", area: null, heldArea: null };
}

// ── across branches ───────────────────────────────────────────────────────

export interface BranchCandidate<A extends CoverageAreaInput> {
  branchId: number;
  /** The branch pin. Null when the admin has not set one — it then ranks last. */
  center: LatLng | null;
  /** Server-decided opening-hours verdict; never the browser's clock. */
  openNow: boolean;
  deliveryPaused?: boolean;
  areas: readonly A[];
}

export interface BranchCoverageRanking<A extends CoverageAreaInput> extends BranchCoverageResult<A> {
  branchId: number;
  /** Straight-line branch → pin distance in km; null without a branch pin. */
  distanceKm: number | null;
  openNow: boolean;
}

/**
 * Every branch's verdict for one pin, best first.
 *
 * Ordering is the customer-facing default, and it is deliberate: a branch that
 * can deliver beats one that can only hand over; among those, one that is open
 * now beats one that is closed; among those, the nearest wins. A branch with no
 * pin has no honest distance, so it sorts after every measured one rather than
 * being ranked by an invented number.
 *
 * The caller picks `[0]` as the default and offers the rest — the customer may
 * switch to any branch whose status is not "not_covered".
 */
export function rankBranchesForPoint<A extends CoverageAreaInput>(
  point: LatLng,
  branches: readonly BranchCandidate<A>[],
  window: "day" | "night",
): BranchCoverageRanking<A>[] {
  const rank: Record<CoverageStatus, number> = { deliverable: 0, pickup_only: 1, not_covered: 2 };
  return branches
    .map((branch) => {
      const result = coverageForBranch(point, branch.areas, window, {
        deliveryPaused: branch.deliveryPaused,
      });
      return {
        ...result,
        branchId: branch.branchId,
        distanceKm: branch.center ? haversineKm(branch.center, point) : null,
        openNow: branch.openNow,
      };
    })
    .sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      if (a.openNow !== b.openNow) return a.openNow ? -1 : 1;
      if (a.distanceKm == null || b.distanceKm == null) {
        if (a.distanceKm === b.distanceKm) return a.branchId - b.branchId;
        return a.distanceKm == null ? 1 : -1;
      }
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return a.branchId - b.branchId;
    });
}
