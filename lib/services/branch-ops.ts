import "server-only";
import type { Prisma, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/services/audit";
import { conflict, forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { branchForManager } from "@/lib/selectors";
import { midnight } from "@/lib/utils/dates";
import { resolveConfigurableBranch } from "@/lib/services/branches";
import { createNotification, notifyRole, notifyUsers, notifyBranchManagers } from "@/lib/services/notifications";
import { LIMITS } from "@/lib/validation/limits";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type ReservationRel = {
  id: number;
  branchId: number;
  customerId: number;
  guestName: string;
  guestPhone: string;
  partySize: number;
  requestedAt: Date;
  status: string;
  note: string;
  rejectionReason?: string;
  tableId?: number | null;
  createdAt: Date;
  customer?: { firstName: string; lastName: string; username: string; phone: string } | null;
  branch?: { name: string } | null;
  table?: { id: number; name: string; seats: number } | null;
  messages?: { id: number; senderId: number; body: string; createdAt: Date; sender?: { firstName: string; lastName: string; role: string } | null }[];
};

export function serializeReservation(r: ReservationRel) {
  return {
    id: r.id,
    branch: r.branchId,
    branch_name: r.branch?.name ?? "",
    customer: r.customerId,
    customer_name: r.customer ? `${r.customer.firstName} ${r.customer.lastName}`.trim() || r.customer.username : "",
    guest_name: r.guestName,
    guest_phone: r.guestPhone,
    party_size: r.partySize,
    requested_at: r.requestedAt.toISOString(),
    status: r.status,
    note: r.note,
    rejection_reason: r.rejectionReason ?? "",
    table: r.tableId ?? null,
    table_name: r.table?.name ?? null,
    table_seats: r.table?.seats ?? null,
    created_at: r.createdAt.toISOString(),
    messages: r.messages?.map((m) => ({
      id: m.id,
      sender: m.senderId,
      sender_name: m.sender ? `${m.sender.firstName} ${m.sender.lastName}`.trim() : "",
      sender_role: m.sender?.role ?? "",
      body: m.body,
      created_at: m.createdAt.toISOString(),
    })),
  };
}

/** The branch a manager runs, or throw a helpful 403. */
export async function requireManagerBranch(user: User) {
  const branch = await branchForManager(user.id);
  if (!branch) throw forbidden(sk("errors.ops.noBranchAssigned"));
  return branch;
}

/**
 * The branch a user may MANAGE (Phase B modules: zones, prep time, tables,
 * employees, attendance):
 * - super_admin → the submitted branchId (must exist).
 * - branch_manager → ALWAYS their assigned branch; a submitted branchId is
 *   ignored, blocking cross-branch spoofing (IDOR).
 * Anyone else → 403.
 */
export async function resolveManageableBranch(user: User, submittedBranchId?: number) {
  if (user.role === "branch_manager") return requireManagerBranch(user);
  if (user.role === "super_admin") {
    if (!submittedBranchId || Number.isNaN(submittedBranchId)) {
      throw validationError({ branch_id: sk("errors.ops.branchRequired") });
    }
    const branch = await prisma.branch.findUnique({ where: { id: submittedBranchId } });
    if (!branch) throw validationError({ branch_id: sk("errors.ops.branchRequired") });
    return branch;
  }
  throw forbidden(sk("errors.ops.noBranchAssigned"));
}

/** Assert the given resource branchId is one the user may manage (IDOR guard). */
export async function assertManagesBranch(user: User, branchId: number) {
  if (user.role === "super_admin") return;
  if (user.role === "branch_manager") {
    const branch = await branchForManager(user.id);
    if (!branch || branch.id !== branchId) throw forbidden(sk("errors.ops.noBranchAssigned"));
    return;
  }
  throw forbidden(sk("errors.ops.noBranchAssigned"));
}

// ── Branch-manager ORDER HOLD ───────────────────────────────────────────
/**
 * "Hold Orders" — a branch manager pauses NEW order intake for their own
 * branch. Confirmed with a dialog, entered with no reason; the REQUIRED reason
 * is collected when the hold is RELEASED (the client's explicit spec), so the
 * pair start→release lands on one complete audit record.
 *
 * WHY THIS IS NOT `isActive`/`holdReason` (the two columns that already exist):
 * those are the SUPER ADMIN's hold. If the manager's hold shared them, a
 * manager releasing their own hold would also lift an admin's — a privilege
 * escalation, and the admin's decision would silently disappear. `isOnHold`
 * is therefore its own state and the two gates are checked independently
 * (see lib/services/orders.ts): an admin hold OUTRANKS and SURVIVES a
 * manager's release.
 *
 * Scope: creation is blocked, nothing else. The branch is NOT hidden from
 * customers and orders already in progress keep moving to completion.
 */

/** A release reason is free text; same bound as every other long note. */
export const MAX_HOLD_REASON_LENGTH = LIMITS.longTextMax;

/** The Branch columns the hold surfaces need — nothing else is read. */
const HOLD_SELECT = {
  id: true,
  name: true,
  isOnHold: true,
  holdStartedAt: true,
  holdStartedById: true,
  holdReleaseReason: true,
  holdReleasedAt: true,
  holdReleasedById: true,
  isActive: true,
  holdReason: true,
  isArchived: true,
} satisfies Prisma.BranchSelect;

type HoldRow = Prisma.BranchGetPayload<{ select: typeof HOLD_SELECT }>;

/** Display name for an actor id, or "" when the user is gone/unset. */
async function actorName(userId: number | null): Promise<string> {
  if (userId == null) return "";
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, username: true },
  });
  if (!user) return "";
  return `${user.firstName} ${user.lastName}`.trim() || user.username;
}

/**
 * The hold state of a branch, as the dashboard reads it.
 *
 * `admin_hold` is reported alongside the manager's own hold so the UI can
 * explain why releasing a manager hold may still leave the branch unable to
 * take orders, instead of looking broken.
 */
export interface BranchHoldState {
  branch_id: number;
  branch_name: string;
  is_on_hold: boolean;
  hold_started_at: string | null;
  hold_started_by: string;
  hold_release_reason: string;
  hold_released_at: string | null;
  admin_hold: boolean;
  admin_hold_reason: string;
  is_archived: boolean;
}

async function serializeHold(branch: HoldRow): Promise<BranchHoldState> {
  return {
    branch_id: branch.id,
    branch_name: branch.name,
    is_on_hold: branch.isOnHold,
    hold_started_at: branch.holdStartedAt?.toISOString() ?? null,
    hold_started_by: await actorName(branch.holdStartedById),
    hold_release_reason: branch.holdReleaseReason,
    hold_released_at: branch.holdReleasedAt?.toISOString() ?? null,
    // The super admin's INDEPENDENT hold — reported, never writable from here.
    admin_hold: !branch.isActive,
    admin_hold_reason: branch.holdReason,
    is_archived: branch.isArchived,
  };
}

/**
 * Hold state by branch id, for a caller that has ALREADY established the branch
 * is theirs (the branch-manager dashboard, whose branch is server-resolved from
 * the session). Returns null instead of throwing when the branch has gone, so a
 * dashboard degrades to "no hold controls" rather than to an error page.
 */
export async function branchHoldStateById(branchId: number): Promise<BranchHoldState | null> {
  const row = await prisma.branch.findUnique({ where: { id: branchId }, select: HOLD_SELECT });
  return row ? serializeHold(row) : null;
}

/** Read the hold state of a branch the actor may configure (IDOR-safe). */
export async function branchHoldState(user: User, submittedBranchId?: number): Promise<BranchHoldState> {
  // Authorization is resolveConfigurableBranch's job: a branch_manager always
  // gets their OWN branch and a submitted foreign id is a 403; a super_admin
  // must name the branch. Every other role is forbidden.
  const branch = await resolveConfigurableBranch(user, submittedBranchId);
  const row = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: HOLD_SELECT });
  return serializeHold(row);
}

/**
 * Put the branch on hold. No reason is required to ENTER the hold.
 *
 * Idempotent: a double-tapped confirmation leaves the ORIGINAL holdStartedAt /
 * holdStartedById intact rather than rewriting who started the hold and when.
 * The guarded `updateMany` makes that atomic, so two simultaneous requests
 * cannot both count as "the one that started it".
 */
export async function holdBranchOrders(user: User, submittedBranchId?: number): Promise<BranchHoldState> {
  const branch = await resolveConfigurableBranch(user, submittedBranchId);
  if (branch.isArchived) throw conflict(sk("errors.branchHold.branchArchived"));

  const started = await prisma.branch.updateMany({
    where: { id: branch.id, isOnHold: false },
    data: {
      isOnHold: true,
      holdStartedAt: new Date(),
      holdStartedById: user.id,
      // A new hold window starts clean — the previous window's release reason
      // belongs to that window and must not be read as this one's.
      holdReleaseReason: "",
      holdReleasedAt: null,
      holdReleasedById: null,
    },
  });

  if (started.count > 0) {
    await prisma.managerActivityLog.create({
      data: {
        managerId: user.id,
        branchId: branch.id,
        activityType: "action",
        description: `Held new orders for branch "${branch.name}"`,
      },
    });
    // WS-6.3 — Management oversees branch operations, so a branch pausing its
    // own order intake must reach them, not just the branch's audit log. Inside
    // the `started.count > 0` guard, so a double-tapped confirmation (or two
    // racing requests) produces exactly ONE notification per real transition.
    await notifyRole("management", {
      type: "system",
      titleKey: "notifications.branchHold.started.title",
      bodyKey: "notifications.branchHold.started.body",
      params: { branch: branch.name },
      link: "/management/branches",
    });
  }
  const row = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: HOLD_SELECT });
  return serializeHold(row);
}

/**
 * Take the branch off hold. The reason is REQUIRED here (not when the hold
 * started) and is validated server-side — a UI that forgets to collect it is
 * rejected with a field error on `hold_release_reason`, never silently accepted.
 *
 * Clears ONLY `isOnHold`. `isActive` (the super admin's hold) is deliberately
 * untouched, so a manager can never release an admin's hold.
 */
export async function releaseBranchHold(
  user: User,
  rawReason: unknown,
  submittedBranchId?: number,
): Promise<BranchHoldState> {
  const branch = await resolveConfigurableBranch(user, submittedBranchId);
  const reason = String(rawReason ?? "").trim();
  if (!reason) throw validationError({ hold_release_reason: sk("errors.branchHold.reasonRequired") });
  if (reason.length > MAX_HOLD_REASON_LENGTH) {
    throw validationError({
      hold_release_reason: sk("errors.branchHold.reasonTooLong", { max: MAX_HOLD_REASON_LENGTH }),
    });
  }

  const released = await prisma.branch.updateMany({
    where: { id: branch.id, isOnHold: true },
    data: {
      isOnHold: false,
      holdReleaseReason: reason,
      holdReleasedAt: new Date(),
      holdReleasedById: user.id,
    },
  });
  // Not on hold: refuse rather than record a reason for a hold that never ran.
  if (released.count === 0) throw conflict(sk("errors.branchHold.notOnHold"));

  await prisma.managerActivityLog.create({
    data: {
      managerId: user.id,
      branchId: branch.id,
      activityType: "action",
      description: `Resumed orders for branch "${branch.name}" — reason: ${reason}`,
    },
  });
  // WS-6.3 — the release carries the mandatory reason, so Management learns not
  // only THAT the branch resumed but WHY it was held. Reached only when
  // `released.count === 1`, i.e. exactly once per real release.
  await notifyRole("management", {
    type: "system",
    titleKey: "notifications.branchHold.released.title",
    bodyKey: "notifications.branchHold.released.body",
    params: { branch: branch.name, reason },
    link: "/management/branches",
  });
  const row = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: HOLD_SELECT });
  return serializeHold(row);
}

// ── Delivery hours / time slots ─────────────────────────────────────────
export async function addTimeSlot(branchId: number, input: { label: string; startTime: string; endTime: string }) {
  if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) {
    throw validationError({ time: sk("errors.ops.timeInvalid") });
  }
  if (input.endTime <= input.startTime) {
    throw validationError({ end_time: sk("errors.ops.endTimeAfterStart") });
  }
  return prisma.deliveryTimeSlot.create({
    data: { branchId, label: input.label.trim(), startTime: input.startTime, endTime: input.endTime },
  });
}

// ── Staff attendance ────────────────────────────────────────────────────
export async function markAttendance(user: User, status: string, note: string) {
  if (!["present", "absent", "leave"].includes(status)) {
    throw validationError({ status: sk("errors.ops.statusInvalid") });
  }
  const branch = await branchForManager(user.id).catch(() => null);
  return prisma.staffAttendance.upsert({
    where: { userId_date: { userId: user.id, date: midnight() } },
    update: { status, note: note.trim() },
    create: { userId: user.id, branchId: branch?.id ?? null, date: midnight(), status, note: note.trim() },
  });
}

// ── B3: Graphical branch tables ─────────────────────────────────────────
export const TABLE_STATUSES = ["available", "occupied", "out_of_service"] as const;

export function serializeTable(t: {
  id: number; branchId: number; name: string; posX: number; posY: number; width: number; height: number;
  seats: number; status: string; section: string; sortOrder: number; isActive: boolean;
}) {
  return {
    id: t.id,
    branch: t.branchId,
    name: t.name,
    pos_x: t.posX,
    pos_y: t.posY,
    width: t.width,
    height: t.height,
    seats: t.seats,
    status: t.status,
    section: t.section,
    sort_order: t.sortOrder,
    is_active: t.isActive,
  };
}

interface TableInput {
  branchId?: number;
  name: string;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  seats?: number;
  status?: string;
  section?: string;
  sortOrder?: number;
  isActive?: boolean;
}

function validateTable(input: { name: string; seats?: number; status?: string }) {
  if (!input.name.trim()) throw validationError({ name: sk("errors.ops.tableNameRequired") });
  if (input.seats !== undefined) {
    const s = Number(input.seats);
    if (!Number.isFinite(s) || s < 1 || s > 50) throw validationError({ seats: sk("errors.ops.invalidCapacity") });
  }
  if (input.status !== undefined && !(TABLE_STATUSES as readonly string[]).includes(input.status)) {
    throw validationError({ status: sk("errors.ops.statusInvalid") });
  }
}

export async function tablesForBranch(branchId: number) {
  return prisma.branchTable.findMany({ where: { branchId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
}

export async function createTable(user: User, input: TableInput) {
  const branch = await resolveManageableBranch(user, input.branchId);
  validateTable(input);
  const dup = await prisma.branchTable.findFirst({ where: { branchId: branch.id, name: input.name.trim() } });
  if (dup) throw validationError({ name: sk("errors.ops.tableNameDuplicate") });
  return prisma.branchTable.create({
    data: {
      branchId: branch.id,
      name: input.name.trim(),
      posX: Math.round(Number(input.posX ?? 0)),
      posY: Math.round(Number(input.posY ?? 0)),
      width: Math.round(Number(input.width ?? 80)),
      height: Math.round(Number(input.height ?? 80)),
      seats: Math.round(Number(input.seats ?? 4)),
      status: input.status && (TABLE_STATUSES as readonly string[]).includes(input.status) ? input.status : "available",
      section: (input.section ?? "").trim(),
      sortOrder: Math.round(Number(input.sortOrder ?? 0)),
      isActive: input.isActive ?? true,
    },
  });
}

export async function updateTable(user: User, tableId: number, input: Partial<TableInput>) {
  const table = await prisma.branchTable.findUnique({ where: { id: tableId } });
  if (!table) throw notFound(sk("errors.ops.tableRequired"));
  await assertManagesBranch(user, table.branchId);
  if (input.name !== undefined || input.seats !== undefined || input.status !== undefined) {
    validateTable({ name: input.name ?? table.name, seats: input.seats, status: input.status });
  }
  if (input.name !== undefined && input.name.trim() !== table.name) {
    const dup = await prisma.branchTable.findFirst({ where: { branchId: table.branchId, name: input.name.trim() } });
    if (dup) throw validationError({ name: sk("errors.ops.tableNameDuplicate") });
  }
  const data: Prisma.BranchTableUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.posX !== undefined) data.posX = Math.round(Number(input.posX));
  if (input.posY !== undefined) data.posY = Math.round(Number(input.posY));
  if (input.width !== undefined) data.width = Math.round(Number(input.width));
  if (input.height !== undefined) data.height = Math.round(Number(input.height));
  if (input.seats !== undefined) data.seats = Math.round(Number(input.seats));
  if (input.status !== undefined) data.status = input.status;
  if (input.section !== undefined) data.section = input.section.trim();
  if (input.sortOrder !== undefined) data.sortOrder = Math.round(Number(input.sortOrder));
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return prisma.branchTable.update({ where: { id: tableId }, data });
}

export async function deleteTable(user: User, tableId: number) {
  const table = await prisma.branchTable.findUnique({ where: { id: tableId } });
  if (!table) throw notFound(sk("errors.ops.tableRequired"));
  await assertManagesBranch(user, table.branchId);
  await prisma.branchTable.delete({ where: { id: tableId } });
  await logAdminAction(user.id, "delete", `Deleted table "${table.name}" (#${table.id})`, { branchId: table.branchId });
}

// Reservations that hold a table (block new bookings) — accepted or confirmed.
const BLOCKING_STATUSES = ["accepted", "confirmed"];
// A table is considered double-booked when another blocking reservation exists
// within this window of the requested time.
const OVERLAP_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Table reservations ──────────────────────────────────────────────────
export const RESERVATION_INCLUDE = {
  customer: true,
  branch: true,
  table: true,
} satisfies Prisma.TableReservationInclude;

export async function createReservation(customer: User, input: {
  branchId: number;
  guestName: string;
  guestPhone: string;
  partySize: number;
  requestedAt: string;
  note: string;
  tableId?: number | null;
}) {
  const branch = await prisma.branch.findFirst({ where: { id: input.branchId, isActive: true } });
  if (!branch) throw validationError({ branch_id: sk("errors.ops.branchRequired") });
  if (!input.guestName.trim()) throw validationError({ guest_name: sk("errors.ops.nameRequired") });
  if (!input.guestPhone.trim()) throw validationError({ guest_phone: sk("errors.ops.phoneRequired") });
  const when = new Date(input.requestedAt);
  if (Number.isNaN(when.getTime())) throw validationError({ requested_at: sk("errors.ops.timeRequired") });
  if (when.getTime() < Date.now()) throw validationError({ requested_at: sk("errors.ops.reservationInPast") });
  const size = Math.max(1, Math.floor(Number(input.partySize) || 1));

  // The whole check + insert runs in one transaction so two simultaneous
  // requests for the same table/time cannot both succeed.
  const reservation = await prisma.$transaction(async (tx) => {
    if (input.tableId != null) {
      const table = await tx.branchTable.findUnique({ where: { id: input.tableId } });
      if (!table || table.branchId !== branch.id) throw validationError({ table_id: sk("errors.ops.tableNotYourBranch") });
      if (!table.isActive || table.status === "out_of_service") throw validationError({ table_id: sk("errors.ops.tableUnavailable") });
      if (size > table.seats) throw validationError({ party_size: sk("errors.ops.tableCapacity", { capacity: table.seats }) });
      const from = new Date(when.getTime() - OVERLAP_WINDOW_MS);
      const to = new Date(when.getTime() + OVERLAP_WINDOW_MS);
      const clash = await tx.tableReservation.findFirst({
        where: { tableId: table.id, status: { in: BLOCKING_STATUSES }, requestedAt: { gt: from, lt: to } },
      });
      if (clash) throw validationError({ requested_at: sk("errors.ops.tableAlreadyBooked") });
      // Cross-check Ramadan reservations holding the same physical table (B7):
      // normal + Ramadan bookings must not overlap the same table/time.
      const ramReservations = await tx.ramadanReservation.findMany({
        where: { tableId: table.id, status: { in: ["pending_payment", "pending", "confirmed"] } },
        include: { slot: true },
      });
      for (const rr of ramReservations) {
        if (!rr.slot) continue;
        // Same local frame as a normal reservation's requestedAt (no trailing Z).
        const rrAt = new Date(`${rr.bookingDate.toISOString().slice(0, 10)}T${rr.slot.startTime}:00`);
        if (Math.abs(rrAt.getTime() - when.getTime()) < OVERLAP_WINDOW_MS) {
          throw validationError({ requested_at: sk("errors.ops.tableAlreadyBooked") });
        }
      }
    }
    return tx.tableReservation.create({
      data: {
        branchId: branch.id,
        customerId: customer.id,
        guestName: input.guestName.trim(),
        guestPhone: input.guestPhone.trim(),
        partySize: size,
        requestedAt: when,
        note: input.note.trim(),
        tableId: input.tableId ?? null,
      },
      include: RESERVATION_INCLUDE,
    });
  });

  if (branch.managerId) {
    await createNotification(branch.managerId, {
      type: "system",
      titleKey: "notifications.reservation.new.title",
      bodyKey: "notifications.reservation.new.body",
      params: { name: reservation.guestName, size },
      link: `/branch-manager/table-reservations/${reservation.id}`,
    });
  }
  return reservation;
}

/** Which reservations a user may see. */
export async function reservationsWhereForUser(user: User): Promise<Prisma.TableReservationWhereInput | null> {
  if (user.role === "super_admin" || user.role === "management") return {};
  if (user.role === "branch_manager") {
    const branch = await branchForManager(user.id);
    return branch ? { branchId: branch.id } : null;
  }
  if (user.role === "customer") return { customerId: user.id };
  return null;
}

async function canAccessReservation(user: User, reservation: { branchId: number; customerId: number }): Promise<boolean> {
  if (user.role === "super_admin" || user.role === "management") return true;
  if (user.role === "customer") return reservation.customerId === user.id;
  if (user.role === "branch_manager") {
    const branch = await branchForManager(user.id);
    return branch?.id === reservation.branchId;
  }
  return false;
}

const RESERVATION_STATUSES = ["pending", "accepted", "confirmed", "rejected", "cancelled", "completed", "expired"];

export async function setReservationStatus(
  reservationId: number,
  status: string,
  actor: User,
  opts: { rejectionReason?: string; tableId?: number | null } = {},
) {
  if (!RESERVATION_STATUSES.includes(status)) {
    throw validationError({ status: sk("errors.ops.statusInvalid") });
  }
  const reservation = await prisma.tableReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw notFound();
  if (!(await canAccessReservation(actor, reservation))) throw forbidden();

  // Rejecting requires a mandatory reason (staff action).
  const reason = (opts.rejectionReason ?? "").trim();
  if (status === "rejected" && !reason) {
    throw validationError({ rejection_reason: sk("errors.ops.rejectionReasonRequired") });
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Optional table (re)assignment — staff only, must belong to the branch.
    let tableId = reservation.tableId;
    if (opts.tableId !== undefined && (actor.role === "branch_manager" || actor.role === "super_admin")) {
      if (opts.tableId === null) tableId = null;
      else {
        const table = await tx.branchTable.findUnique({ where: { id: opts.tableId } });
        if (!table || table.branchId !== reservation.branchId) throw validationError({ table_id: sk("errors.ops.tableNotYourBranch") });
        if (!table.isActive || table.status === "out_of_service") throw validationError({ table_id: sk("errors.ops.tableUnavailable") });
        if (reservation.partySize > table.seats) throw validationError({ party_size: sk("errors.ops.tableCapacity", { capacity: table.seats }) });
        tableId = table.id;
      }
    }
    // Accepting re-checks the table is still free at that time (race-safe).
    if ((status === "accepted" || status === "confirmed") && tableId != null) {
      const from = new Date(reservation.requestedAt.getTime() - OVERLAP_WINDOW_MS);
      const to = new Date(reservation.requestedAt.getTime() + OVERLAP_WINDOW_MS);
      const clash = await tx.tableReservation.findFirst({
        where: { tableId, status: { in: BLOCKING_STATUSES }, requestedAt: { gt: from, lt: to }, id: { not: reservationId } },
      });
      if (clash) throw validationError({ requested_at: sk("errors.ops.tableAlreadyBooked") });
    }
    return tx.tableReservation.update({
      where: { id: reservationId },
      data: { status, tableId, rejectionReason: status === "rejected" ? reason : reservation.rejectionReason },
      include: RESERVATION_INCLUDE,
    });
  });

  await createNotification(reservation.customerId, {
    type: "system",
    titleKey: status === "rejected" ? "notifications.reservation.rejected.title" : "notifications.reservation.updated.title",
    bodyKey: status === "rejected" ? "notifications.reservation.rejected.body" : "notifications.reservation.updated.body",
    params: status === "rejected" ? { reason } : { status: `@:reservationStatus.${status}` },
    link: `/customer/reservations/${reservationId}`,
  });
  return updated;
}

/** Membership-checked message history for a reservation (for polling). */
export async function reservationMessages(user: User, reservationId: number) {
  const reservation = await prisma.tableReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw notFound();
  if (!(await canAccessReservation(user, reservation))) throw forbidden();
  return prisma.reservationMessage.findMany({
    where: { reservationId },
    include: { sender: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function addReservationMessage(reservationId: number, sender: User, body: string) {
  if (!body.trim()) throw validationError({ body: sk("errors.ops.messageRequired") });
  const reservation = await prisma.tableReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw notFound();
  if (!(await canAccessReservation(sender, reservation))) throw forbidden();

  const msg = await prisma.reservationMessage.create({
    data: { reservationId, senderId: sender.id, body: body.trim() },
    include: { sender: true },
  });
  // Notify the other party.
  const branch = await prisma.branch.findUnique({ where: { id: reservation.branchId }, select: { managerId: true } });
  const otherId = sender.id === reservation.customerId ? branch?.managerId : reservation.customerId;
  if (otherId) {
    await notifyUsers([otherId], {
      type: "system",
      titleKey: "notifications.reservation.newMessage.title",
      body: reservation.guestName, // user-supplied guest name — kept as typed
      link: sender.id === reservation.customerId
        ? `/branch-manager/table-reservations/${reservationId}`
        : `/customer/reservations/${reservationId}`,
    });
  }
  return msg;
}

// ── Ramadan bookings ────────────────────────────────────────────────────
export async function bookRamadanTable(customer: User, input: {
  tableId: number;
  guestName: string;
  guestPhone: string;
  partySize: number;
  bookingDate: string;
}) {
  const table = await prisma.ramadanTable.findFirst({ where: { id: input.tableId, isActive: true } });
  if (!table) throw validationError({ table_id: sk("errors.ops.tableRequired") });
  if (!input.guestName.trim()) throw validationError({ guest_name: sk("errors.ops.nameRequired") });
  if (!input.guestPhone.trim()) throw validationError({ guest_phone: sk("errors.ops.phoneRequired") });
  const date = new Date(`${input.bookingDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) throw validationError({ booking_date: sk("errors.ops.dateInvalid") });
  const size = Math.max(1, Math.floor(Number(input.partySize) || 1));
  if (size > table.capacity) {
    throw validationError({ party_size: sk("errors.ops.tableCapacity", { capacity: table.capacity }) });
  }

  const existing = await prisma.ramadanBooking.findUnique({
    where: { tableId_bookingDate: { tableId: table.id, bookingDate: date } },
  });
  if (existing && existing.status === "booked") {
    throw validationError({ booking_date: sk("errors.ops.tableAlreadyBooked") });
  }

  const booking = await prisma.ramadanBooking.upsert({
    where: { tableId_bookingDate: { tableId: table.id, bookingDate: date } },
    update: {
      customerId: customer.id,
      guestName: input.guestName.trim(),
      guestPhone: input.guestPhone.trim(),
      partySize: size,
      status: "booked",
    },
    create: {
      tableId: table.id,
      branchId: table.branchId,
      customerId: customer.id,
      guestName: input.guestName.trim(),
      guestPhone: input.guestPhone.trim(),
      partySize: size,
      bookingDate: date,
    },
  });
  // Notify the branch's managers of the Ramadan iftar booking request.
  await notifyBranchManagers(table.branchId, {
    type: "ramadan",
    titleKey: "notifications.ramadan.new.title",
    bodyKey: "notifications.ramadan.new.body",
    params: { guest: input.guestName.trim(), date: input.bookingDate },
    link: "/branch-manager/dashboard",
  });
  return booking;
}
