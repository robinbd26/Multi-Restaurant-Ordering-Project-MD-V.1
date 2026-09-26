import "server-only";
import type { Branch, Prisma, RiderDutyLog, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { conflict, forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { createNotification, notifyBranchManagers } from "@/lib/services/notifications";
import { daysAgo, dhakaDayKey, midnight } from "@/lib/utils/dates";

// WS-5.5 — ONE DUTY SYSTEM.
//
// `RiderBranchDutySession` is the SOURCE OF TRUTH for "is this rider on duty,
// since when, and for which branch": it is branch-scoped, allows several
// sessions per day (branch switching, a break and back on), and every
// operational guard in the app (order pooling, receive-confirmation, live map,
// duty chat, rider assignment) already reads it.
//
// `RiderDutyLog` is now a DERIVED per-Dhaka-day rollup of those sessions —
// clockIn = the first moment the rider went on duty that day, clockOut = the
// moment their last session of the day ended (null while one is running) —
// written inside the SAME transaction as the session it describes, so the two
// can no longer disagree. It is kept (not dropped: the schema is frozen and the
// attendance report, branch dashboards and the legacy /api/riders/duty/* routes
// read it) and `clockIn()` / `clockOut()` in lib/services/riders.ts are thin
// facades over `startDuty()` / `endDuty()` rather than a second write path.
//
// An overnight shift files under the day it STARTED, so a session that begins
// 23:30 and ends 00:30 closes yesterday's row instead of opening a phantom one.

// An order counts as an ACTIVE delivery for a rider while it is assigned to them
// and not yet delivered or cancelled — this blocks going offline / switching.
// WS-5.2 — "delayed" belongs here: the food is still in the rider's hands, so a
// delayed delivery must keep blocking going offline just like on_the_way does.
const OPEN_DELIVERY_STATES = ["accepted", "preparing", "ready", "picked_up", "on_the_way", "delayed"];

// ── Serializers ─────────────────────────────────────────────────────────
export function serializeDutySession(s: {
  id: number; riderId: number; branchId: number; status: string; startedAt: Date; endedAt: Date | null; endReason: string;
  branch?: { name: string; brandType: string; address: string } | null;
}) {
  return {
    id: s.id,
    rider: s.riderId,
    branch: s.branchId,
    branch_name: s.branch?.name ?? "",
    branch_brand_type: s.branch?.brandType ?? "",
    branch_address: s.branch?.address ?? "",
    status: s.status,
    started_at: s.startedAt.toISOString(),
    ended_at: s.endedAt ? s.endedAt.toISOString() : null,
    end_reason: s.endReason,
  };
}

// ── C1: eligible branches + start duty ──────────────────────────────────
export async function eligibleBranchesForRider() {
  // Eligible = active branches. (Riders are not locked to a home branch.)
  return prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
}

export async function activeDutySession(riderId: number) {
  return prisma.riderBranchDutySession.findFirst({
    where: { riderId, status: "active" },
    include: { branch: true },
  });
}

/** Any assigned, not-yet-finished delivery blocks going offline / switching. */
export async function hasActiveDelivery(riderId: number): Promise<boolean> {
  const open = await prisma.order.findFirst({ where: { riderId, status: { in: OPEN_DELIVERY_STATES } } });
  return Boolean(open);
}

// ── Derived daily duty log ──────────────────────────────────────────────
// Both projections run inside the caller's transaction, so a session and its
// day rollup are committed together or not at all.

/**
 * Project a session START onto the rider's day rollup: open the day if it is
 * the first session, otherwise re-open it (a rider back on duty after clocking
 * out) and move it to the branch they are working now. `clockIn` is never
 * rewritten — it is the first on-duty moment of that Dhaka day.
 */
async function projectDutyLogStart(
  tx: Prisma.TransactionClient,
  riderId: number,
  branchId: number,
  startedAt: Date,
): Promise<void> {
  const date = midnight(startedAt); // Dhaka midnight of the day the shift began
  const existing = await tx.riderDutyLog.findUnique({ where: { riderId_date: { riderId, date } } });
  if (!existing) {
    await tx.riderDutyLog.create({ data: { riderId, branchId, date, clockIn: startedAt } });
    return;
  }
  await tx.riderDutyLog.update({ where: { id: existing.id }, data: { branchId, clockOut: null } });
}

/**
 * Project a session END onto the rider's day rollup. The row is created if it
 * is missing, which heals sessions started before this unification landed.
 */
async function projectDutyLogEnd(
  tx: Prisma.TransactionClient,
  riderId: number,
  session: { branchId: number; startedAt: Date },
  endedAt: Date,
): Promise<void> {
  const date = midnight(session.startedAt);
  const existing = await tx.riderDutyLog.findUnique({ where: { riderId_date: { riderId, date } } });
  if (!existing) {
    await tx.riderDutyLog.create({
      data: { riderId, branchId: session.branchId, date, clockIn: session.startedAt, clockOut: endedAt },
    });
    return;
  }
  await tx.riderDutyLog.update({ where: { id: existing.id }, data: { clockOut: endedAt } });
}

/**
 * Start an online duty session at a branch (C1). Transactional: rejects a
 * second concurrent active session, validates the branch is active, flips the
 * rider online, opens the duty chat thread and projects the day's duty log
 * (WS-5.5 — the ONLY way a rider goes on duty). Notifies the branch's managers.
 */
export async function startDuty(rider: User, branchId: number) {
  if (!branchId || Number.isNaN(branchId)) throw validationError({ branch_id: sk("errors.rider.selectBranch") });
  const branch = await prisma.branch.findFirst({ where: { id: branchId, isActive: true } });
  if (!branch) throw validationError({ branch_id: sk("errors.rider.branchNotEligible") });

  const session = await prisma.$transaction(async (tx) => {
    const existing = await tx.riderBranchDutySession.findFirst({ where: { riderId: rider.id, status: "active" } });
    if (existing) throw conflict(sk("errors.rider.alreadyOnDuty"));
    const s = await tx.riderBranchDutySession.create({
      data: { riderId: rider.id, branchId: branch.id, status: "active" },
      include: { branch: true },
    });
    await tx.riderProfile.upsert({
      where: { userId: rider.id },
      create: { userId: rider.id, isOnline: true },
      update: { isOnline: true },
    });
    // One duty chat thread per session (unique sessionId).
    await tx.riderDutyChatThread.create({ data: { sessionId: s.id, riderId: rider.id, branchId: branch.id } });
    await projectDutyLogStart(tx, rider.id, branch.id, s.startedAt);
    return s;
  });

  await notifyBranchManagers(branch.id, {
    type: "system",
    titleKey: "notifications.rider.dutyStarted.title",
    bodyKey: "notifications.rider.dutyStarted.body",
    params: { rider: `${rider.firstName} ${rider.lastName}`.trim() || rider.username },
    link: "/branch-manager/riders",
  });
  return session;
}

/**
 * End the active duty session (C2). Transactional: requires an active session,
 * blocks while an active delivery is unresolved, flips offline, closes the duty
 * chat, and closes the day's duty log (WS-5.5 —
 * the ONLY way a rider goes off duty).
 */
export async function endDuty(rider: User, reason = "offline") {
  const active = await activeDutySession(rider.id);
  if (!active) throw validationError({ detail: sk("errors.rider.notOnDuty") });
  if (await hasActiveDelivery(rider.id)) throw conflict(sk("errors.rider.activeDeliveryBlocksOffline"));

  // One instant for the session and its rollup, so durations agree exactly.
  const endedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const ended = await tx.riderBranchDutySession.update({
      where: { id: active.id },
      data: { status: "ended", endedAt, endReason: reason },
      include: { branch: true },
    });
    await tx.riderProfile.update({ where: { userId: rider.id }, data: { isOnline: false } });
    await tx.riderDutyChatThread.updateMany({ where: { sessionId: active.id }, data: { isClosed: true } });
    await projectDutyLogEnd(tx, rider.id, active, endedAt);
    return ended;
  });
}

export async function dutyHistory(riderId: number) {
  return prisma.riderBranchDutySession.findMany({
    where: { riderId },
    include: { branch: true },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
}

// ── Unified duty reads ──────────────────────────────────────────────────
// Everything that answers "was this rider on duty, when, where and for how
// long" goes through these, so duty history, attendance, working hours and the
// rider dashboard can never quote different numbers.

/** A duty log row plus its branch — the shape every duty read returns. */
export type DutyDayLog = RiderDutyLog & { branch: Branch | null };

/**
 * The day rollup derived from a session, used when no row exists yet (a
 * session opened before this unification landed, or an overnight shift being
 * read from the next calendar day).
 */
function dutyLogFromSession(
  session: { id: number; riderId: number; branchId: number; startedAt: Date; endedAt: Date | null; createdAt: Date; updatedAt: Date; branch?: Branch | null },
): DutyDayLog {
  return {
    id: session.id,
    riderId: session.riderId,
    branchId: session.branchId,
    date: midnight(session.startedAt),
    clockIn: session.startedAt,
    clockOut: session.endedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    branch: session.branch ?? null,
  };
}

/**
 * The rider's CURRENT duty day: the running session's day when they are on
 * duty (an overnight shift still belongs to the day it started), otherwise
 * today's row. Derived from the session when the row is missing, so a rider is
 * never shown as off duty while a session is running.
 */
export async function currentDutyDay(riderId: number): Promise<DutyDayLog | null> {
  const active = await prisma.riderBranchDutySession.findFirst({
    where: { riderId, status: "active" },
    include: { branch: true },
    orderBy: { startedAt: "desc" },
  });
  const date = midnight(active ? active.startedAt : new Date());
  const log = await prisma.riderDutyLog.findUnique({
    where: { riderId_date: { riderId, date } },
    include: { branch: true },
  });
  if (!active) return log;
  if (!log) return dutyLogFromSession(active);
  // A running session always wins over a stale closed row.
  return log.clockOut === null ? log : { ...log, clockOut: null, branchId: active.branchId, branch: active.branch };
}

/**
 * The rider's duty days over the last `days` days, newest first. Sessions are
 * the source of truth; a persisted row is used when it exists (it carries the
 * whole day, including sessions older than the window) and days that only have
 * sessions are derived, so history written before the unification still shows.
 */
export async function dutyDayLogs(riderId: number, days = 30): Promise<DutyDayLog[]> {
  const since = daysAgo(days);
  const [logs, sessions] = await Promise.all([
    prisma.riderDutyLog.findMany({
      where: { riderId, date: { gte: since } },
      include: { branch: true },
      orderBy: [{ date: "desc" }, { clockIn: "desc" }],
    }),
    prisma.riderBranchDutySession.findMany({
      where: { riderId, startedAt: { gte: since } },
      include: { branch: true },
      orderBy: { startedAt: "asc" },
    }),
  ]);

  const byDay = new Map<string, DutyDayLog>();
  for (const log of logs) byDay.set(dhakaDayKey(log.date), log);
  for (const session of sessions) {
    const key = dhakaDayKey(session.startedAt);
    const existing = byDay.get(key);
    if (!existing) {
      byDay.set(key, dutyLogFromSession(session));
      continue;
    }
    // Keep the row, but never let it claim the rider is off duty while a
    // session of that day is still running.
    if (session.status === "active" && existing.clockOut !== null) {
      byDay.set(key, { ...existing, clockOut: null, branchId: session.branchId, branch: session.branch });
    }
  }
  return [...byDay.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** One row of the full duty log: a single on-duty stretch at one branch. */
export interface DutySessionView {
  id: number;
  dayKey: string;
  branchId: number;
  branchName: string;
  startedAt: Date;
  endedAt: Date | null;
  endReason: string;
  isActive: boolean;
  /** Worked minutes, counted to "now" while the session is still running. */
  minutes: number;
}

/** Minutes between two instants, floored and never negative. */
function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000));
}

/**
 * The rider's full duty log (every session, newest first) — the branch-level
 * detail behind the day rollups, and the exact basis for working hours: the
 * day rollup spans first-on to last-off (breaks included), this sums only the
 * time actually spent on duty.
 */
export async function dutySessionLog(riderId: number, days = 30): Promise<DutySessionView[]> {
  const sessions = await prisma.riderBranchDutySession.findMany({
    where: { riderId, startedAt: { gte: daysAgo(days) } },
    include: { branch: true },
    orderBy: { startedAt: "desc" },
  });
  const now = new Date();
  return sessions.map((s) => ({
    id: s.id,
    dayKey: dhakaDayKey(s.startedAt),
    branchId: s.branchId,
    branchName: s.branch?.name ?? "",
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    endReason: s.endReason,
    isActive: s.status === "active",
    minutes: minutesBetween(s.startedAt, s.endedAt ?? now),
  }));
}

/** Worked minutes in a window, summed from sessions (open sessions count to now). */
export async function workedMinutes(riderId: number, from: Date, to: Date = new Date()): Promise<number> {
  const sessions = await prisma.riderBranchDutySession.findMany({
    where: { riderId, startedAt: { lte: to }, OR: [{ endedAt: null }, { endedAt: { gte: from } }] },
    select: { startedAt: true, endedAt: true },
  });
  const now = new Date();
  let total = 0;
  for (const s of sessions) {
    // Clip each stretch to the window so a shift that straddles it counts once.
    const start = s.startedAt > from ? s.startedAt : from;
    const end = (s.endedAt ?? now) < to ? (s.endedAt ?? now) : to;
    total += minutesBetween(start, end);
  }
  return total;
}

// ── C3: eligible orders for the active-session branch ───────────────────
export async function eligibleOrdersForRider(rider: User) {
  const active = await activeDutySession(rider.id);
  // Orders already assigned to this rider are always visible; the pooled
  // "ready" orders are scoped to the active session branch only.
  const where: Prisma.OrderWhereInput = active
    ? { OR: [{ riderId: rider.id }, { branchId: active.branchId, status: "ready", riderId: null }] }
    : { riderId: rider.id };
  return { activeBranchId: active?.branchId ?? null, where };
}

/** Server-side guard for a rider viewing/acting on a specific order (C3 IDOR). */
export async function assertRiderCanAccessOrder(rider: User, order: { id: number; branchId: number; status: string; riderId: number | null }) {
  if (order.riderId === rider.id) return; // own assignment
  const active = await activeDutySession(rider.id);
  if (active && order.branchId === active.branchId && order.status === "ready" && order.riderId == null) return; // eligible pool
  throw forbidden(sk("errors.rider.orderNotEligible"));
}

// ── C5: order receive confirmation ──────────────────────────────────────
export async function isReceiveConfirmed(orderId: number, riderId: number): Promise<boolean> {
  const c = await prisma.orderReceiveConfirmation.findUnique({ where: { orderId_riderId: { orderId, riderId } } });
  return Boolean(c);
}

/**
 * The assigned rider confirms physically receiving the order (C5). Transactional
 * + idempotent. Only the currently-assigned rider, online in an active session
 * for the order's branch, with the order in a confirmable state, may confirm.
 * Notifies BM + customer. (It used to open a rider↔customer delivery chat; the
 * order chat in lib/services/order-chat.ts now exists from order placement.)
 */
export async function confirmReceive(rider: User, orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound(sk("errors.orders.orderNotFound"));
  if (order.riderId !== rider.id) throw forbidden(sk("errors.rider.notAssignedRider"));
  const active = await activeDutySession(rider.id);
  if (!active || active.branchId !== order.branchId) throw forbidden(sk("errors.rider.notOnDutyForBranch"));
  if (order.status !== "ready") throw conflict(sk("errors.rider.orderNotConfirmable"));

  const { confirmation, created } = await prisma.$transaction(async (tx) => {
    // Idempotent: a repeat confirm by the same rider returns the existing row.
    const existing = await tx.orderReceiveConfirmation.findUnique({ where: { orderId_riderId: { orderId, riderId: rider.id } } });
    const row = existing ?? (await tx.orderReceiveConfirmation.create({
      data: { orderId, riderId: rider.id, branchId: order.branchId, sessionId: active.id, status: "confirmed" },
    }));
    return { confirmation: row, created: !existing };
  });

  if (created) {
    await notifyBranchManagers(order.branchId, {
      type: "order",
      titleKey: "notifications.rider.receiveConfirmed.title",
      bodyKey: "notifications.rider.receiveConfirmed.body",
      params: { id: order.id, rider: `${rider.firstName} ${rider.lastName}`.trim() || rider.username },
      link: `/branch-manager/orders/${order.id}`,
    });
    await createNotification(order.customerId, {
      type: "order",
      titleKey: "notifications.rider.receiveConfirmedCustomer.title",
      bodyKey: "notifications.rider.receiveConfirmedCustomer.body",
      params: { id: order.id },
      link: `/customer/orders/${order.id}`,
    });
  }
  return confirmation;
}

// ── C4 duty chat ────────────────────────────────────────────────────────
function isBody(body: unknown): string {
  const s = String(body ?? "").trim();
  if (!s) throw validationError({ body: sk("errors.ops.messageRequired") });
  return s;
}

// Duty chat (rider ↔ branch manager) membership
export async function dutyThreadWithAccess(user: User, threadId: number) {
  const thread = await prisma.riderDutyChatThread.findUnique({ where: { id: threadId } });
  if (!thread) throw notFound();
  const ok =
    user.id === thread.riderId ||
    user.role === "super_admin" || // audited oversight (read)
    (user.role === "branch_manager" && (await prisma.branch.findFirst({ where: { id: thread.branchId, managerId: user.id } })) != null);
  if (!ok) throw forbidden();
  return thread;
}

export async function sendDutyMessage(user: User, threadId: number, body: string) {
  const text = isBody(body);
  const thread = await dutyThreadWithAccess(user, threadId);
  if (user.role === "super_admin") throw forbidden(); // oversight is read-only
  if (thread.isClosed) throw conflict(sk("errors.rider.chatClosed"));
  const msg = await prisma.riderDutyChatMessage.create({ data: { threadId, senderId: user.id, body: text } });
  // Notify the other party.
  const otherIsRider = user.id !== thread.riderId;
  const recipientId = otherIsRider ? thread.riderId : (await managerOfBranch(thread.branchId));
  if (recipientId) {
    await createNotification(recipientId, {
      type: "system",
      titleKey: "notifications.rider.dutyChat.title",
      bodyKey: "notifications.rider.dutyChat.body",
      params: {},
      link: otherIsRider ? "/rider/duty-chat" : `/branch-manager/riders`,
    });
  }
  return msg;
}

export async function dutyMessages(user: User, threadId: number) {
  const thread = await dutyThreadWithAccess(user, threadId);
  const messages = await prisma.riderDutyChatMessage.findMany({ where: { threadId }, orderBy: { createdAt: "asc" }, include: { sender: true } });
  // Mark read for the viewing participant.
  if (user.id === thread.riderId) await prisma.riderDutyChatThread.update({ where: { id: threadId }, data: { riderLastReadAt: new Date() } });
  else if (user.role === "branch_manager") await prisma.riderDutyChatThread.update({ where: { id: threadId }, data: { managerLastReadAt: new Date() } });
  return { thread, messages };
}

async function managerOfBranch(branchId: number): Promise<number | null> {
  const b = await prisma.branch.findUnique({ where: { id: branchId }, select: { managerId: true } });
  return b?.managerId ?? null;
}

export function serializeChatMessage(m: { id: number; senderId: number; body: string; createdAt: Date; sender?: { firstName: string; lastName: string; role: string } | null }) {
  return {
    id: m.id,
    sender: m.senderId,
    sender_name: m.sender ? `${m.sender.firstName} ${m.sender.lastName}`.trim() : "",
    sender_role: m.sender?.role ?? "",
    body: m.body, // user-written content kept exactly as typed
    created_at: m.createdAt.toISOString(),
  };
}
