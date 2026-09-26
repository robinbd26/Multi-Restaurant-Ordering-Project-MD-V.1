import "server-only";

import type { User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { conflict, forbidden, sk } from "@/lib/http/errors";
import { logAdminAction } from "@/lib/services/audit";

/**
 * Removing a user account, under the one rule every admin list follows:
 * ANYTHING WITH HISTORY IS ARCHIVED, ONLY PURE SETUP IS DELETED.
 *
 * For a user, "archive" is deactivation (isActive=false): they cannot sign in,
 * and every order, payment, coin, rider tally and audit row that names them
 * stays intact. A hard delete used to be allowed for anyone but a super admin,
 * and it deleted a customer's ORDERS first to get past the foreign key, while
 * dozens of other relations cascade: a rider's commissions, withdrawals and
 * duty logs, a manager's activity trail, everyone's reviews and complaints.
 * So a permanent delete is now only for an account that has done nothing yet.
 *
 * What does NOT count as history, and goes with the account: login history,
 * notifications, push subscriptions, password-reset tokens and saved
 * addresses. They describe the account, not business the platform did.
 */

export interface UserHistory {
  ordersAsCustomer: number;
  ordersAsRider: number;
  riderAssignments: number;
  riderHandovers: number;
  riderCommissions: number;
  riderWithdrawals: number;
  riderDutyLogs: number;
  riderDutySessions: number;
  rewardLedger: number;
  rewardRedemptions: number;
  couponRedemptions: number;
  reservations: number;
  ramadanReservations: number;
  ramadanBookings: number;
  complaints: number;
  foodReviews: number;
  riderReviews: number;
  staffAttendance: number;
  activityLogs: number;
  managerAssignments: number;
  noticesAuthored: number;
  /** Branches this user manages right now: reassign those first. */
  managedBranches: number;
}

export async function userHistory(userId: number): Promise<UserHistory> {
  const [
    ordersAsCustomer, ordersAsRider, riderAssignments, riderHandovers, riderCommissions,
    riderWithdrawals, riderDutyLogs, riderDutySessions, rewardLedger, rewardRedemptions,
    couponRedemptions, reservations, ramadanReservations, ramadanBookings, complaints,
    foodReviews, riderReviews, staffAttendance, activityLogs, managerAssignments,
    noticesAuthored, managedBranches,
  ] = await Promise.all([
    prisma.order.count({ where: { customerId: userId } }),
    prisma.order.count({ where: { riderId: userId } }),
    prisma.riderOrderAssignment.count({ where: { riderId: userId } }),
    prisma.orderReceiveConfirmation.count({ where: { riderId: userId } }),
    prisma.riderCommission.count({ where: { riderId: userId } }),
    prisma.riderWithdrawal.count({ where: { riderId: userId } }),
    prisma.riderDutyLog.count({ where: { riderId: userId } }),
    prisma.riderBranchDutySession.count({ where: { riderId: userId } }),
    prisma.rewardLedger.count({ where: { userId } }),
    prisma.rewardRedemption.count({ where: { userId } }),
    prisma.couponRedemption.count({ where: { customerId: userId } }),
    prisma.tableReservation.count({ where: { customerId: userId } }),
    prisma.ramadanReservation.count({ where: { customerId: userId } }),
    prisma.ramadanBooking.count({ where: { customerId: userId } }),
    prisma.complaint.count({ where: { complainantId: userId } }),
    prisma.foodReview.count({ where: { customerId: userId } }),
    prisma.riderReview.count({ where: { OR: [{ customerId: userId }, { riderId: userId }] } }),
    prisma.staffAttendance.count({ where: { userId } }),
    prisma.managerActivityLog.count({ where: { managerId: userId } }),
    prisma.branchManagerAssignment.count({ where: { managerId: userId } }),
    prisma.notice.count({ where: { authorId: userId } }),
    prisma.branch.count({ where: { managerId: userId } }),
  ]);
  return {
    ordersAsCustomer, ordersAsRider, riderAssignments, riderHandovers, riderCommissions,
    riderWithdrawals, riderDutyLogs, riderDutySessions, rewardLedger, rewardRedemptions,
    couponRedemptions, reservations, ramadanReservations, ramadanBookings, complaints,
    foodReviews, riderReviews, staffAttendance, activityLogs, managerAssignments,
    noticesAuthored, managedBranches,
  };
}

function displayName(user: Pick<User, "firstName" | "lastName" | "username">): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.username;
}

/**
 * Permanently delete an account that has no history. Refused with a 409 that
 * says what exists, so the admin is pointed at Deactivate instead.
 */
export async function permanentlyDeleteUser(actor: User, target: User): Promise<void> {
  if (target.role === "super_admin") throw forbidden(sk("errors.auth.cannotDeleteSuperAdmin"));
  if (target.id === actor.id) throw forbidden(sk("errors.auth.cannotDeleteSelf"));

  const history = await userHistory(target.id);
  if (history.managedBranches > 0) {
    throw conflict(sk("errors.auth.deleteManagesBranch", { count: history.managedBranches }));
  }
  const { managedBranches: _managed, ...records } = history;
  void _managed;
  const total = Object.values(records).reduce((sum, n) => sum + n, 0);
  if (total > 0) {
    const orders = history.ordersAsCustomer + history.ordersAsRider;
    throw conflict(sk("errors.auth.deleteHasHistory", { orders, records: total }));
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id: target.id } });
    await logAdminAction(
      actor.id,
      "delete",
      `Permanently deleted ${target.role} account "${displayName(target)}" (@${target.username}, #${target.id}); it had no orders or other history`,
      { tx },
    );
  });
}

/** The archive for an account: sign-in stops, every record stays. Logged. */
export async function logUserActiveChange(actor: User, target: User, active: boolean): Promise<void> {
  await logAdminAction(
    actor.id,
    active ? "action" : "archive",
    `${active ? "Reactivated" : "Deactivated (archived)"} ${target.role} account "${displayName(target)}" (@${target.username}, #${target.id})`,
  );
}
