import "server-only";
import type { RiderDutyLog, RiderProfile, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { notFound, sk, validationError } from "@/lib/http/errors";
import { activeDutySession, endDuty, startDuty } from "@/lib/services/rider-duty";
import { midnight } from "@/lib/utils/dates";

/** Super Admin assigns (or clears) a rider's home branch. */
export async function assignRiderBranch(input: {
  riderId: number;
  branchId: number | null;
}): Promise<RiderProfile> {
  const { riderId, branchId } = input;
  if (branchId !== null) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, isActive: true } });
    if (!branch) throw validationError({ branch_id: sk("errors.money.branchNotFoundOrClosed") });
  }
  return prisma.riderProfile.upsert({
    where: { userId: riderId },
    create: { userId: riderId, assignedBranchId: branchId },
    update: { assignedBranchId: branchId },
  });
}

/** The signed-in rider behind a duty call — duty writes need the full user. */
async function riderOrFail(riderId: number): Promise<User> {
  const rider = await prisma.user.findFirst({ where: { id: riderId, role: "rider" } });
  if (!rider) throw notFound();
  return rider;
}

/**
 * Start today's duty (the clock-in facade).
 *
 * WS-5.5 — this used to be a SECOND write path that created a RiderDutyLog and
 * never opened a duty session, so the rider was "clocked in" for attendance
 * while every operational read (order pool, live map, duty chat, assignment)
 * still saw them off duty. It now delegates to `startDuty()`, the single duty
 * write path, and returns the day rollup that transaction projected.
 */
export async function clockIn(input: {
  riderId: number;
  branchId?: number | null;
}): Promise<RiderDutyLog> {
  const { riderId } = input;
  let branchId = input.branchId ?? null;

  // No branch given → fall back to the rider's assigned home branch.
  if (branchId === null) {
    const profile = await prisma.riderProfile.findUnique({
      where: { userId: riderId },
      include: { assignedBranch: true },
    });
    const branch = profile?.assignedBranch;
    if (!branch || !branch.isActive) {
      throw validationError({ branch_id: sk("errors.money.selectBranchNoneAssigned") });
    }
    branchId = branch.id;
  }

  const rider = await riderOrFail(riderId);
  // `startDuty` validates the branch is active and rejects a second concurrent
  // session (errors.rider.alreadyOnDuty). Clocking in again after clocking out
  // is allowed on purpose: it is a new session of the same duty day.
  const session = await startDuty(rider, branchId);
  return dutyLogForDay(riderId, session.startedAt);
}

/**
 * End today's duty (the clock-out facade) — delegates to `endDuty()`, so the
 * active-delivery guard, the offline flag, the chat closures and the day
 * rollup all happen in the one transaction the session write path owns.
 */
export async function clockOut(riderId: number): Promise<RiderDutyLog> {
  const rider = await riderOrFail(riderId);
  const active = await activeDutySession(riderId);
  if (active) {
    const ended = await endDuty(rider, "offline");
    return dutyLogForDay(riderId, ended.startedAt);
  }

  // No session: only a row written before the unification (or by a crashed
  // session) can still be open — close it so attendance is not left hanging.
  const log = await prisma.riderDutyLog.findUnique({
    where: { riderId_date: { riderId, date: midnight() } },
  });
  if (!log) throw validationError({ detail: sk("errors.money.noDutyLogToday") });
  if (log.clockOut) throw validationError({ detail: sk("errors.money.dutyAlreadyEnded") });
  return prisma.riderDutyLog.update({ where: { id: log.id }, data: { clockOut: new Date() } });
}

/** The day rollup a duty session belongs to (its start day, Dhaka). */
function dutyLogForDay(riderId: number, startedAt: Date): Promise<RiderDutyLog> {
  return prisma.riderDutyLog.findUniqueOrThrow({
    where: { riderId_date: { riderId, date: midnight(startedAt) } },
  });
}
