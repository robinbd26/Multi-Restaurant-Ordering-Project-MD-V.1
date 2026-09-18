import "server-only";

import { prisma } from "@/lib/db";
import type { CoverageWindow } from "@/lib/constants/enums";
import { coverageAppliesIn, currentCoverageWindow } from "@/lib/services/coverage-window";

/**
 * NAMED-AREA COVERAGE — "does this branch deliver to this locality, on the shift
 * running right now?"
 *
 * The older question, "is this coordinate inside the branch's radius or one of
 * its circles?", still lives in lib/services/delivery.ts and still answers for a
 * GPS fix. This module answers the same question for a saved address that names
 * a place on the master list, which is how coverage works without a map pin on
 * every address.
 *
 * THE TWO ARE UNIONED, NOT SWAPPED. Every coverage row starts with no locality
 * attached, so if membership replaced geometry the moment this shipped, every
 * customer ordering to a saved address would become "not covered" until each
 * branch manager had ticked their list. Union keeps today's behaviour exactly as
 * it is and adds the new path beside it; retiring the geometry rule is a separate
 * decision for when the lists are actually populated.
 */

export interface LocalityCoverage {
  branchId: number;
  /** The BranchDeliveryArea row that granted coverage. */
  areaId: number;
  areaName: string;
  /** This area's own delivery charge, already rounded to the paisa. */
  charge: number;
  estimatedMinutes: number;
  /** Covered, but the branch has paused new delivery orders for this area. */
  isHeld: boolean;
  holdReason: string;
  /** Which list granted it: the active shift's own row, or an all-day row. */
  window: CoverageWindow;
}

/**
 * Which live branches list `localityId`, keyed by branch id.
 *
 * A branch may hold BOTH a shift-specific row and an all-day row for the same
 * locality (the unique key allows it, so a night charge can differ from a day
 * one). The more specific row wins: an explicit "day"/"night" row beats "both",
 * so the charge quoted is the one operations set for the shift actually running.
 */
export async function branchesCoveringLocality(
  localityId: number,
  options: { window?: Exclude<CoverageWindow, "both">; branchIds?: number[] } = {},
): Promise<Map<number, LocalityCoverage>> {
  const active = options.window ?? currentCoverageWindow();
  const rows = await prisma.branchDeliveryArea.findMany({
    where: {
      localityId,
      isActive: true,
      branch: { isActive: true, isArchived: false },
      ...(options.branchIds ? { branchId: { in: options.branchIds } } : {}),
    },
    select: {
      id: true,
      branchId: true,
      name: true,
      deliveryCharge: true,
      estimatedDeliveryMinutes: true,
      isHeld: true,
      holdReason: true,
      coverageWindow: true,
    },
  });

  const byBranch = new Map<number, LocalityCoverage>();
  for (const row of rows) {
    if (!coverageAppliesIn(row.coverageWindow, active)) continue;
    const candidate: LocalityCoverage = {
      branchId: row.branchId,
      areaId: row.id,
      areaName: row.name,
      charge: Number(Number(row.deliveryCharge).toFixed(2)),
      estimatedMinutes: row.estimatedDeliveryMinutes,
      isHeld: row.isHeld,
      holdReason: row.holdReason,
      window: row.coverageWindow as CoverageWindow,
    };
    const existing = byBranch.get(row.branchId);
    // Specific shift beats "both"; otherwise first row wins deterministically.
    if (!existing || (existing.window === "both" && candidate.window !== "both")) {
      byBranch.set(row.branchId, candidate);
    }
  }
  return byBranch;
}

/** Does this one branch list this locality on the shift running now? */
export async function branchCoversLocality(
  branchId: number,
  localityId: number,
  window?: Exclude<CoverageWindow, "both">,
): Promise<LocalityCoverage | null> {
  const map = await branchesCoveringLocality(localityId, { window, branchIds: [branchId] });
  return map.get(branchId) ?? null;
}
