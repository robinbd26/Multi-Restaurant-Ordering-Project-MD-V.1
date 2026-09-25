import "server-only";

import type { Prisma, User } from "@prisma/client";

import { revalidateCatalog } from "@/lib/cache/catalog";
import { prisma } from "@/lib/db";
import { conflict, notFound, sk, validationError } from "@/lib/http/errors";
import { logAdminAction } from "@/lib/services/audit";

/**
 * Removing a branch, under the rule every admin list follows:
 * ANYTHING WITH HISTORY IS ARCHIVED, ONLY PURE SETUP IS DELETED.
 *
 * HISTORY is what the business did at the branch: orders and everything hung
 * off them, money (settlements, expenses, adjustments, commissions, Ramadan
 * payments), rider tallies (duty sessions and logs, assignments, handovers,
 * duty chats), reservations, complaints and attendance. Any of it means the
 * branch can only be ARCHIVED: hidden from customers and the default admin
 * list, every record kept.
 *
 * SETUP is what someone configured and nobody has used: products, categories,
 * delivery areas, tables, time slots, employees without attendance, teams,
 * branch-only coupons (never redeemed, since there are no orders), branch-only
 * reward rules, Ramadan configuration and the manager-assignment trail. A
 * PERMANENT delete removes it with the branch. Most of it goes by the schema's
 * own cascades; branch reward rules are deleted explicitly, because their
 * relation is SetNull and a null branch means "every branch": left alone, a
 * branch-only rule would silently become platform-wide.
 *
 * Kept either way: Activity Logs (their branch link is nulled, and the delete
 * is itself logged by name) and riders assigned to the branch (they become
 * unassigned).
 */

export interface BranchHistory {
  orders: number;
  riderAssignments: number;
  riderHandovers: number;
  riderCommissions: number;
  riderDutySessions: number;
  riderDutyLogs: number;
  riderDutyChats: number;
  settlements: number;
  expenses: number;
  financialAdjustments: number;
  tableReservations: number;
  ramadanReservations: number;
  ramadanBookings: number;
  ramadanPayments: number;
  complaints: number;
  employeeAttendance: number;
  staffAttendance: number;
}

export interface BranchSetup {
  products: number;
  categories: number;
  deliveryAreas: number;
  tables: number;
  timeSlots: number;
  employees: number;
  employeeTeams: number;
  coupons: number;
  rewardRules: number;
  ramadanConfigs: number;
  ramadanSlots: number;
  ramadanMenus: number;
  ramadanTables: number;
  managerAssignments: number;
}

export interface BranchRemovalCheck {
  branch: { id: number; name: string; isArchived: boolean };
  history: BranchHistory;
  setup: BranchSetup;
  /** Riders whose assigned branch this is; they become unassigned. */
  ridersAssigned: number;
  /** True when there is no history at all: a permanent delete is allowed. */
  deletable: boolean;
}

export async function branchRemovalCheck(branchId: number): Promise<BranchRemovalCheck> {
  // A malformed id ("undefined", "abc") is simply not a branch: 404, not a
  // Prisma validation 500.
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw notFound(sk("errors.catalog.branchNotFound"));
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, isArchived: true },
  });
  if (!branch) throw notFound(sk("errors.catalog.branchNotFound"));
  const where = { branchId } as const;

  const [
    orders, riderAssignments, riderHandovers, riderCommissions, riderDutySessions, riderDutyLogs,
    riderDutyChats, settlements, expenses, financialAdjustments, tableReservations,
    ramadanReservations, ramadanBookings, ramadanPayments, complaints, employeeAttendance,
    staffAttendance,
  ] = await Promise.all([
    prisma.order.count({ where }),
    prisma.riderOrderAssignment.count({ where }),
    prisma.orderReceiveConfirmation.count({ where }),
    prisma.riderCommission.count({ where }),
    prisma.riderBranchDutySession.count({ where }),
    prisma.riderDutyLog.count({ where }),
    prisma.riderDutyChatThread.count({ where }),
    prisma.branchSettlement.count({ where }),
    prisma.branchExpense.count({ where }),
    prisma.financialAdjustment.count({ where }),
    prisma.tableReservation.count({ where }),
    prisma.ramadanReservation.count({ where }),
    prisma.ramadanBooking.count({ where }),
    prisma.ramadanReservationPayment.count({ where }),
    prisma.complaint.count({ where }),
    prisma.employeeAttendance.count({ where }),
    prisma.staffAttendance.count({ where }),
  ]);

  const [
    products, categories, deliveryAreas, tables, timeSlots, employees, employeeTeams, coupons,
    rewardRules, ramadanConfigs, ramadanSlots, ramadanMenus, ramadanTables, managerAssignments,
    ridersAssigned,
  ] = await Promise.all([
    prisma.product.count({ where }),
    prisma.category.count({ where }),
    prisma.branchDeliveryArea.count({ where }),
    prisma.branchTable.count({ where }),
    prisma.deliveryTimeSlot.count({ where }),
    prisma.branchEmployee.count({ where }),
    prisma.employeeTeam.count({ where }),
    prisma.coupon.count({ where }),
    prisma.rewardEarningRule.count({ where }),
    prisma.ramadanConfig.count({ where }),
    prisma.ramadanTimeSlot.count({ where }),
    prisma.ramadanMenu.count({ where }),
    prisma.ramadanTable.count({ where }),
    prisma.branchManagerAssignment.count({ where }),
    prisma.riderProfile.count({ where: { assignedBranchId: branchId } }),
  ]);

  const history: BranchHistory = {
    orders, riderAssignments, riderHandovers, riderCommissions, riderDutySessions, riderDutyLogs,
    riderDutyChats, settlements, expenses, financialAdjustments, tableReservations,
    ramadanReservations, ramadanBookings, ramadanPayments, complaints, employeeAttendance,
    staffAttendance,
  };
  const setup: BranchSetup = {
    products, categories, deliveryAreas, tables, timeSlots, employees, employeeTeams, coupons,
    rewardRules, ramadanConfigs, ramadanSlots, ramadanMenus, ramadanTables, managerAssignments,
  };
  return {
    branch,
    history,
    setup,
    ridersAssigned,
    deletable: Object.values(history).every((n) => n === 0),
  };
}

/** "3 products, 1 category, …" for the log line; only the non-zero counts. */
function describeCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${key.replace(/([A-Z])/g, " $1").toLowerCase()}`);
  return parts.length ? parts.join(", ") : "nothing else";
}

/**
 * The delete itself, shared by the explicit permanent delete and the legacy
 * archive-or-delete endpoint. Branch reward rules first (see the file note),
 * then the branch, whose cascades take the rest of its setup.
 */
async function deleteBranchRows(tx: Prisma.TransactionClient, branchId: number): Promise<void> {
  await tx.rewardEarningRule.deleteMany({ where: { branchId } });
  await tx.branch.delete({ where: { id: branchId } });
}

/** Archive: hidden from customers and the default admin list, all kept. Logged. */
export async function archiveBranch(actor: User, branchId: number) {
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw notFound(sk("errors.catalog.branchNotFound"));
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw notFound(sk("errors.catalog.branchNotFound"));
  if (branch.isArchived) return branch;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.branch.update({
      where: { id: branchId },
      data: { isArchived: true, archivedAt: new Date(), archivedById: actor.id, isActive: false },
    });
    await logAdminAction(actor.id, "archive", `Archived branch "${branch.name}" (#${branch.id}); all its records are kept`, {
      branchId,
      tx,
    });
    return row;
  });
  // Archiving removes every one of the branch's products from customer surfaces.
  revalidateCatalog({ branchId });
  return updated;
}

/**
 * Permanent delete, super admin only (checked by the route). The caller must
 * type the branch's exact name; a branch with any history is refused with a
 * 409 naming the reason, and the admin is pointed at Archive.
 */
export async function permanentlyDeleteBranch(actor: User, branchId: number, confirmName: unknown) {
  const check = await branchRemovalCheck(branchId);
  if (String(confirmName ?? "").trim() !== check.branch.name.trim()) {
    throw validationError({ confirm_name: sk("errors.branchRemoval.nameMismatch") });
  }
  if (!check.deletable) {
    throw conflict(
      sk("errors.branchRemoval.hasHistory", {
        orders: check.history.orders,
        records: Object.values(check.history).reduce((sum, n) => sum + n, 0),
      }),
    );
  }
  await prisma.$transaction(async (tx) => {
    await deleteBranchRows(tx, branchId);
    await logAdminAction(
      actor.id,
      "delete",
      `Permanently deleted branch "${check.branch.name}" (#${check.branch.id}), which had no orders or other history. Removed with it: ${describeCounts({ ...check.setup })}.${check.ridersAssigned ? ` ${check.ridersAssigned} rider(s) became unassigned.` : ""}`,
      { tx },
    );
  });
  revalidateCatalog({ branchId });
  return check;
}

/**
 * The long-standing DELETE /api/branches/[id] behaviour, kept for API callers:
 * a branch with no rows of any kind is deleted, anything else is archived. It
 * now shares the delete (reward-rule safe) and the logging with the above.
 */
export async function legacyArchiveOrDeleteBranch(actor: User, branchId: number) {
  const check = await branchRemovalCheck(branchId);
  const anything =
    !check.deletable ||
    Object.values(check.setup).some((n) => n > 0) ||
    (await prisma.managerActivityLog.count({ where: { branchId } })) > 0;
  if (!anything) {
    await prisma.$transaction(async (tx) => {
      await deleteBranchRows(tx, branchId);
      await logAdminAction(actor.id, "delete", `Permanently deleted branch "${check.branch.name}" (#${check.branch.id}); it had no data at all`, { tx });
    });
    revalidateCatalog({ branchId });
    return { action: "deleted" as const, check };
  }
  const branch = await archiveBranch(actor, branchId);
  return { action: "archived" as const, check, branch };
}
