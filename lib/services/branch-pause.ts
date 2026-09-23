import "server-only";
import type { User } from "@prisma/client";

import { DELIVERY_PAUSE_MODES, isDeliveryPauseMode, isDeliveryPaused, pauseEndsAt, type DeliveryPauseMode } from "@/lib/coverage/pause";
import { prisma } from "@/lib/db";
import { sk, validationError } from "@/lib/http/errors";
import { resolveManageableBranch } from "@/lib/services/branch-ops";

/**
 * Branch-manager "Pause delivery".
 *
 * Deliberately NARROWER than the two holds that already exist: the super
 * admin's `isActive` closes the branch, the manager's `isOnHold` stops every new
 * order, and this stops DELIVERY ONLY. Pickup keeps working throughout, so a
 * branch drowning in orders can slow its riders without turning customers away.
 *
 * It ENDS BY ITSELF. The row carries the instant the pause runs out and every
 * read compares that to now (lib/coverage/pause.ts), so nothing has to run on a
 * schedule and a pause cannot get stuck on because a worker died.
 *
 * Authorization is resolveManageableBranch's: a branch manager always gets
 * their OWN branch and a submitted foreign id is a 403; a super admin must name
 * the branch. Every change is written to the activity log.
 */

export interface DeliveryPauseState {
  branch_id: number;
  paused: boolean;
  mode: string;
  /** ISO instant the pause lifts itself; null for "until resumed". */
  until: string | null;
  paused_at: string | null;
}

const PAUSE_SELECT = {
  id: true,
  name: true,
  deliveryPauseMode: true,
  deliveryPausedUntil: true,
  deliveryPausedAt: true,
} as const;

function serialize(row: {
  id: number;
  deliveryPauseMode: string;
  deliveryPausedUntil: Date | null;
  deliveryPausedAt: Date | null;
}): DeliveryPauseState {
  const paused = isDeliveryPaused(row);
  return {
    branch_id: row.id,
    paused,
    // A lapsed pause reads as "not paused" without anything being written back,
    // so never report a stale mode as live.
    mode: paused ? row.deliveryPauseMode : "",
    until: paused ? (row.deliveryPausedUntil?.toISOString() ?? null) : null,
    paused_at: paused ? (row.deliveryPausedAt?.toISOString() ?? null) : null,
  };
}

export async function deliveryPauseState(user: User, submittedBranchId?: number): Promise<DeliveryPauseState> {
  const branch = await resolveManageableBranch(user, submittedBranchId);
  const row = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: PAUSE_SELECT });
  return serialize(row);
}

/** Pause delivery for 30 minutes, an hour, the rest of the shift, or until resumed. */
export async function pauseDelivery(
  user: User,
  rawMode: unknown,
  submittedBranchId?: number,
): Promise<DeliveryPauseState> {
  const branch = await resolveManageableBranch(user, submittedBranchId);
  const mode = String(rawMode ?? "").trim();
  if (!isDeliveryPauseMode(mode)) {
    throw validationError({
      mode: sk("errors.branchPause.invalidMode", { modes: DELIVERY_PAUSE_MODES.join(", ") }),
    });
  }
  const until = pauseEndsAt(mode as DeliveryPauseMode);
  await prisma.branch.update({
    where: { id: branch.id },
    data: {
      deliveryPauseMode: mode,
      deliveryPausedUntil: until,
      deliveryPausedAt: new Date(),
      deliveryPausedById: user.id,
    },
  });
  await prisma.managerActivityLog.create({
    data: {
      managerId: user.id,
      branchId: branch.id,
      activityType: "action",
      description: `Paused delivery for branch "${branch.name}" (${mode}${until ? ` until ${until.toISOString()}` : ", until resumed"}); pickup stays open`,
    },
  });
  const row = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: PAUSE_SELECT });
  return serialize(row);
}

/**
 * Resume delivery now.
 *
 * Idempotent: resuming a branch that is not paused simply clears the (already
 * lapsed) columns, which is the tidy-up that lets a lapsed pause stop taking up
 * space without a scheduled job.
 */
export async function resumeDelivery(user: User, submittedBranchId?: number): Promise<DeliveryPauseState> {
  const branch = await resolveManageableBranch(user, submittedBranchId);
  const before = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: PAUSE_SELECT });
  const wasPaused = isDeliveryPaused(before);
  await prisma.branch.update({
    where: { id: branch.id },
    data: {
      deliveryPauseMode: "",
      deliveryPausedUntil: null,
      deliveryPausedAt: null,
      deliveryPausedById: null,
    },
  });
  // Only a REAL transition is worth an audit line; clearing a lapsed pause is
  // housekeeping, not a decision.
  if (wasPaused) {
    await prisma.managerActivityLog.create({
      data: {
        managerId: user.id,
        branchId: branch.id,
        activityType: "action",
        description: `Resumed delivery for branch "${branch.name}"`,
      },
    });
  }
  const row = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: PAUSE_SELECT });
  return serialize(row);
}
