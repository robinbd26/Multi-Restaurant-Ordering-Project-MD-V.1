import "server-only";
import { Prisma } from "@prisma/client";
import type { RamadanConfig, RamadanMenu, RamadanReservation, RamadanReservationPayment, RamadanTimeSlot, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { conflict, forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { assertManagesBranch, resolveManageableBranch } from "@/lib/services/branch-ops";
import { createNotification, notifyBranchManagers, notifyRole, notifySuperAdmins } from "@/lib/services/notifications";
import {
  GATEWAY_CALLBACK_RAMADAN_PATH,
  createGatewayPayment,
  gatewayAmountMatches,
  verifyGatewayPayment,
} from "@/lib/services/payments";
import { dhakaDayKey } from "@/lib/utils/dates";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Blocking statuses that hold a physical table for a time.
const NORMAL_BLOCKING = ["accepted", "confirmed"];
const RAMADAN_BLOCKING = ["pending_payment", "pending", "confirmed"];
const RAMADAN_STATUSES = ["pending_payment", "pending", "confirmed", "rejected", "cancelled", "completed"];
// WS-9.3 — legacy (System 1) statuses that still hold a table. Legacy rows have
// no slot, so a hold covers the WHOLE booking day.
const LEGACY_BLOCKING = ["booked"];

/** Either the shared client or an open transaction — reads work on both. */
type Db = Prisma.TransactionClient;

/** Parse a YYYY-MM-DD to UTC midnight (timezone-safe round-trip). */
function dateUtc(str: string): Date {
  const day = str && /^\d{4}-\d{2}-\d{2}/.test(str) ? str.slice(0, 10) : "";
  if (!day) return new Date(NaN);
  return new Date(`${day}T00:00:00.000Z`);
}
function dec(v: unknown): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(String(v ?? 0));
}
function money(v: unknown, field: string): Prisma.Decimal {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) throw validationError({ [field]: sk("errors.catalog.validPriceRequired") });
  return new Prisma.Decimal(n.toFixed(2));
}

// ── Config ────────────────────────────────────────────────────────────────
export function serializeConfig(c: RamadanConfig | null, branchId: number) {
  return {
    branch: branchId,
    is_enabled: c?.isEnabled ?? false,
    booking_start_date: c?.bookingStartDate ? c.bookingStartDate.toISOString().slice(0, 10) : null,
    booking_end_date: c?.bookingEndDate ? c.bookingEndDate.toISOString().slice(0, 10) : null,
    advance_type: c?.advanceType ?? "none",
    advance_value: (c?.advanceValue ?? new Prisma.Decimal(0)).toString(),
    advance_guest_threshold: c?.advanceGuestThreshold ?? 0,
    payment_deadline_hours: c?.paymentDeadlineHours ?? 0,
    cancellation_policy: c?.cancellationPolicy ?? "",
  };
}

export async function getConfig(branchId: number) {
  return prisma.ramadanConfig.findUnique({ where: { branchId } });
}

export async function saveConfig(user: User, input: {
  branchId?: number; isEnabled?: boolean; bookingStartDate?: string; bookingEndDate?: string;
  advanceType?: string; advanceValue?: number; advanceGuestThreshold?: number; paymentDeadlineHours?: number; cancellationPolicy?: string;
}) {
  const branch = await resolveManageableBranch(user, input.branchId);
  if (input.advanceType && !["none", "fixed", "percent", "per_guest"].includes(input.advanceType)) {
    throw validationError({ advance_type: sk("errors.ramadan.invalidAdvanceType") });
  }
  const start = input.bookingStartDate ? dateUtc(input.bookingStartDate) : null;
  const end = input.bookingEndDate ? dateUtc(input.bookingEndDate) : null;
  if (start && Number.isNaN(start.getTime())) throw validationError({ booking_start_date: sk("errors.ops.dateInvalid") });
  if (end && Number.isNaN(end.getTime())) throw validationError({ booking_end_date: sk("errors.ops.dateInvalid") });
  if (start && end && end < start) throw validationError({ booking_end_date: sk("errors.ramadan.endBeforeStart") });
  const data = {
    isEnabled: input.isEnabled ?? false,
    bookingStartDate: start,
    bookingEndDate: end,
    advanceType: input.advanceType ?? "none",
    advanceValue: money(input.advanceValue ?? 0, "advance_value"),
    advanceGuestThreshold: Math.max(0, Math.floor(Number(input.advanceGuestThreshold ?? 0))),
    paymentDeadlineHours: Math.max(0, Math.floor(Number(input.paymentDeadlineHours ?? 0))),
    cancellationPolicy: (input.cancellationPolicy ?? "").trim(),
  };
  return prisma.ramadanConfig.upsert({ where: { branchId: branch.id }, update: data, create: { branchId: branch.id, ...data } });
}

// ── Slots ─────────────────────────────────────────────────────────────────
export function serializeSlot(s: RamadanTimeSlot) {
  return { id: s.id, branch: s.branchId, label: s.label, start_time: s.startTime, end_time: s.endTime, capacity: s.capacity, is_active: s.isActive, sort_order: s.sortOrder };
}
export async function slotsForBranch(branchId: number, activeOnly = false) {
  return prisma.ramadanTimeSlot.findMany({ where: { branchId, ...(activeOnly ? { isActive: true } : {}) }, orderBy: [{ sortOrder: "asc" }, { startTime: "asc" }] });
}
export async function createSlot(user: User, input: { branchId?: number; label: string; startTime: string; endTime: string; capacity?: number; isActive?: boolean; sortOrder?: number }) {
  const branch = await resolveManageableBranch(user, input.branchId);
  if (!input.label.trim()) throw validationError({ label: sk("errors.ramadan.slotLabelRequired") });
  if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) throw validationError({ start_time: sk("errors.ops.timeInvalid") });
  if (input.endTime <= input.startTime) throw validationError({ end_time: sk("errors.ops.endTimeAfterStart") });
  return prisma.ramadanTimeSlot.create({ data: {
    branchId: branch.id, label: input.label.trim(), startTime: input.startTime, endTime: input.endTime,
    capacity: Math.max(0, Math.floor(Number(input.capacity ?? 0))), isActive: input.isActive ?? true, sortOrder: Math.floor(Number(input.sortOrder ?? 0)),
  } });
}
export async function updateSlot(user: User, slotId: number, input: Partial<{ label: string; startTime: string; endTime: string; capacity: number; isActive: boolean; sortOrder: number }>) {
  const slot = await prisma.ramadanTimeSlot.findUnique({ where: { id: slotId } });
  if (!slot) throw notFound(sk("errors.ramadan.slotNotFound"));
  await assertManagesBranch(user, slot.branchId);
  const st = input.startTime ?? slot.startTime, et = input.endTime ?? slot.endTime;
  if (input.startTime !== undefined && !TIME_RE.test(st)) throw validationError({ start_time: sk("errors.ops.timeInvalid") });
  if (input.endTime !== undefined && !TIME_RE.test(et)) throw validationError({ end_time: sk("errors.ops.timeInvalid") });
  if (et <= st) throw validationError({ end_time: sk("errors.ops.endTimeAfterStart") });
  return prisma.ramadanTimeSlot.update({ where: { id: slotId }, data: {
    ...(input.label !== undefined ? { label: input.label.trim() } : {}),
    ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
    ...(input.endTime !== undefined ? { endTime: input.endTime } : {}),
    ...(input.capacity !== undefined ? { capacity: Math.max(0, Math.floor(Number(input.capacity))) } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: Math.floor(Number(input.sortOrder)) } : {}),
  } });
}
export async function deleteSlot(user: User, slotId: number) {
  const slot = await prisma.ramadanTimeSlot.findUnique({ where: { id: slotId } });
  if (!slot) throw notFound(sk("errors.ramadan.slotNotFound"));
  await assertManagesBranch(user, slot.branchId);
  await prisma.ramadanTimeSlot.delete({ where: { id: slotId } });
}

// ── Menus (B8) ──────────────────────────────────────────────────────────────
/** Parse an `items` payload (JSON array or newline/comma list) into names. */
export function parseMenuItems(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* not JSON — treat as newline/comma list */
  }
  return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

type MenuRel = RamadanMenu & { items?: { id: number; name: string; sortOrder: number }[] };
export function serializeMenu(m: MenuRel) {
  return {
    id: m.id, branch: m.branchId, name: m.name, description: m.description, image: m.image ?? null,
    price: dec(m.price).toFixed(2), compare_at_price: m.compareAtPrice != null ? dec(m.compareAtPrice).toFixed(2) : null,
    serving_capacity: m.servingCapacity, start_date: m.startDate ? m.startDate.toISOString().slice(0, 10) : null,
    end_date: m.endDate ? m.endDate.toISOString().slice(0, 10) : null, allowed_slots: m.allowedSlots,
    min_guests: m.minGuests, max_guests: m.maxGuests, is_active: m.isActive, is_archived: m.isArchived, sort_order: m.sortOrder,
    items: (m.items ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.name),
  };
}
export async function menusForBranch(branchId: number, opts: { includeArchived?: boolean } = {}) {
  return prisma.ramadanMenu.findMany({
    // PHASE L — archived platters stay retrievable for history, but are out of
    // the way of day-to-day management unless explicitly asked for.
    where: { branchId, ...(opts.includeArchived ? {} : { isArchived: false }) },
    include: { items: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/** PHASE L — View one platter, with the same branch guard as every mutation. */
export async function getMenuForManage(user: User, menuId: number) {
  await menuForManage(user, menuId);
  const menu = await prisma.ramadanMenu.findUnique({ where: { id: menuId }, include: { items: true } });
  if (!menu) throw notFound(sk("errors.ramadan.menuNotFound"));
  return menu;
}
export async function eligibleMenus(branchId: number, date: Date, slotId?: number | null) {
  const menus = await prisma.ramadanMenu.findMany({ where: { branchId, isActive: true, isArchived: false }, include: { items: true }, orderBy: [{ sortOrder: "asc" }] });
  return menus.filter((m) => {
    if (m.startDate && date < m.startDate) return false;
    if (m.endDate && date > m.endDate) return false;
    if (slotId && m.allowedSlots.trim()) {
      const allowed = m.allowedSlots.split(",").map((s) => Number(s.trim())).filter(Boolean);
      if (allowed.length && !allowed.includes(slotId)) return false;
    }
    return true;
  });
}
interface MenuInput {
  branchId?: number; name: string; description?: string; image?: string | null; price: number; compareAtPrice?: number | null;
  servingCapacity?: number; startDate?: string | null; endDate?: string | null; allowedSlots?: string; minGuests?: number; maxGuests?: number;
  isActive?: boolean; sortOrder?: number; items?: string[];
}
function validateMenu(input: { name: string; price: number }) {
  if (!input.name.trim()) throw validationError({ name: sk("errors.ramadan.menuNameRequired") });
  money(input.price, "price");
}
export async function createMenu(user: User, input: MenuInput) {
  const branch = await resolveManageableBranch(user, input.branchId);
  validateMenu(input);
  return prisma.ramadanMenu.create({
    data: {
      branchId: branch.id, name: input.name.trim(), description: (input.description ?? "").trim(), image: input.image ?? null,
      price: money(input.price, "price"), compareAtPrice: input.compareAtPrice != null ? money(input.compareAtPrice, "compare_at_price") : null,
      servingCapacity: Math.max(1, Math.floor(Number(input.servingCapacity ?? 4))),
      startDate: input.startDate ? dateUtc(input.startDate) : null, endDate: input.endDate ? dateUtc(input.endDate) : null,
      allowedSlots: (input.allowedSlots ?? "").trim(), minGuests: Math.max(0, Math.floor(Number(input.minGuests ?? 0))), maxGuests: Math.max(0, Math.floor(Number(input.maxGuests ?? 0))),
      isActive: input.isActive ?? true, sortOrder: Math.floor(Number(input.sortOrder ?? 0)),
      items: { create: (input.items ?? []).map((n, i) => ({ name: n.trim(), sortOrder: i })).filter((it) => it.name) },
    },
    include: { items: true },
  });
}
export async function menuForManage(user: User, menuId: number) {
  const menu = await prisma.ramadanMenu.findUnique({ where: { id: menuId } });
  if (!menu) throw notFound(sk("errors.ramadan.menuNotFound"));
  await assertManagesBranch(user, menu.branchId);
  return menu;
}
export async function updateMenu(user: User, menuId: number, input: Partial<MenuInput>) {
  const current = await menuForManage(user, menuId);
  // PHASE L — an archived platter is history; editing it would rewrite what a
  // past customer was offered.
  if (current.isArchived) throw conflict(sk("errors.ramadan.menuArchived"));
  if (input.name !== undefined && !input.name.trim()) throw validationError({ name: sk("errors.ramadan.menuNameRequired") });
  const data: Prisma.RamadanMenuUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description.trim();
  if (input.image) data.image = input.image;
  if (input.price !== undefined) data.price = money(input.price, "price");
  if (input.compareAtPrice !== undefined) data.compareAtPrice = input.compareAtPrice == null ? null : money(input.compareAtPrice, "compare_at_price");
  if (input.servingCapacity !== undefined) data.servingCapacity = Math.max(1, Math.floor(Number(input.servingCapacity)));
  if (input.startDate !== undefined) data.startDate = input.startDate ? dateUtc(input.startDate) : null;
  if (input.endDate !== undefined) data.endDate = input.endDate ? dateUtc(input.endDate) : null;
  if (input.allowedSlots !== undefined) data.allowedSlots = input.allowedSlots.trim();
  if (input.minGuests !== undefined) data.minGuests = Math.max(0, Math.floor(Number(input.minGuests)));
  if (input.maxGuests !== undefined) data.maxGuests = Math.max(0, Math.floor(Number(input.maxGuests)));
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.sortOrder !== undefined) data.sortOrder = Math.floor(Number(input.sortOrder));
  return prisma.$transaction(async (tx) => {
    if (input.items !== undefined) {
      await tx.ramadanMenuItem.deleteMany({ where: { menuId } });
      await tx.ramadanMenuItem.createMany({ data: (input.items ?? []).map((n, i) => ({ menuId, name: n.trim(), sortOrder: i })).filter((it) => it.name) });
    }
    return tx.ramadanMenu.update({ where: { id: menuId }, data, include: { items: true } });
  });
}
/**
 * PHASE L — safe delete. A platter nobody has booked is genuinely removed; one
 * with reservations is ARCHIVED and deactivated, so the reservation keeps its
 * link and its immutable snapshot. Customer-facing lists show neither.
 */
export async function deleteMenu(user: User, menuId: number) {
  const menu = await menuForManage(user, menuId);
  const reservations = await prisma.ramadanReservation.count({ where: { menuId } });
  if (reservations > 0) {
    const archived = await prisma.ramadanMenu.update({
      where: { id: menuId },
      data: { isArchived: true, isActive: false },
      include: { items: true },
    });
    return { archived: true, menu: archived, reservations };
  }
  await prisma.ramadanMenu.delete({ where: { id: menuId } });
  return { archived: false, menu, reservations: 0 };
}

// ── Advance-payment rules (B9) ──────────────────────────────────────────────
export function computeAdvance(config: RamadanConfig | null, total: Prisma.Decimal, partySize: number): Prisma.Decimal {
  if (!config || config.advanceType === "none") return new Prisma.Decimal(0);
  if (config.advanceGuestThreshold > 0 && partySize < config.advanceGuestThreshold) return new Prisma.Decimal(0);
  const val = dec(config.advanceValue);
  let advance: Prisma.Decimal;
  if (config.advanceType === "fixed") advance = val;
  else if (config.advanceType === "percent") advance = total.mul(val).div(100);
  else advance = val.mul(partySize); // per_guest
  if (advance.gt(total)) advance = total;
  return new Prisma.Decimal(advance.toFixed(2));
}

// ══════════════════════════════════════════════════════════════════════════
// WS-9.3 — ONE canonical Ramadan booking path
//
// Two booking systems were built against the same physical dining room:
//
//   System 1 (LEGACY): RamadanTable + RamadanBooking. A private table registry
//     with one booking per table per DAY — no config, no iftar slots, no
//     platters, no money, no accept/reject, and no link to the physical room.
//   System 2 (CANONICAL): RamadanConfig + RamadanTimeSlot + RamadanMenu +
//     RamadanReservation + RamadanReservationPayment, seated on the SHARED
//     physical BranchTable, so a Ramadan booking and a normal TableReservation
//     already cannot occupy the same table.
//
// System 2 is canonical. It is the only one that models the physical room, the
// booking window, iftar slots, platters, verified advances and refunds, and it
// is what every notification link, the accounts ledger and the management
// summary already point at. Moving all of that onto System 1 would be a
// rewrite; teaching System 2 to respect System 1's rows is a read.
//
// So NEW bookings only ever go through `createRamadanReservation`. Legacy rows
// are never created again — the single remaining legacy write is
// `cancelLegacyRamadanBooking`, which only RELEASES a hold — but they are still
// read: by the availability check below (a legacy booking keeps holding its
// table, so the transition cannot double-book) and by the legacy list the
// branch manager and the customer still see.
//
// THE BRIDGE. The two systems share no foreign key and the schema is frozen, so
// the only link available is the table NAME inside a branch: the legacy
// `RamadanTable` named "Table 3" IS the physical `BranchTable` named "Table 3".
// Names are compared case-folded with whitespace collapsed. A legacy table with
// no physical namesake cannot hold anything physical; those rows are reported as
// `unmatched` rather than silently ignored, because staff still have to honour
// them and the retirement migration has to reconcile them by hand.
// ══════════════════════════════════════════════════════════════════════════

/** Case/whitespace-insensitive table-name key that bridges the two systems. */
function tableNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A legacy `bookingDate` was written as `new Date("YYYY-MM-DDT00:00:00")` — the
 * SERVER's local midnight — while the canonical system stores UTC midnight. So
 * the stored instant is either 00:00Z or 18:00Z on the previous day. Fetch a
 * ±24h window around UTC midnight and let `dhakaDayKey` decide the day: it maps
 * BOTH encodings back onto the same Dhaka calendar day.
 */
function legacyFetchWindow(dayKey: string): { gte: Date; lt: Date } {
  const anchor = new Date(`${dayKey}T00:00:00.000Z`).getTime();
  return { gte: new Date(anchor - 86400000), lt: new Date(anchor + 86400000) };
}

/** ±2h around a slot's start — the window a normal TableReservation collides in. */
function slotClashWindow(dayKey: string, startTime: string): { from: Date; to: Date } {
  // Parsed in the local frame to match how a normal reservation's requestedAt
  // was written.
  const at = new Date(`${dayKey}T${startTime}:00`);
  return { from: new Date(at.getTime() - 2 * 3600000), to: new Date(at.getTime() + 2 * 3600000) };
}

export interface LegacyHold {
  bookingId: number;
  tableName: string;
  guestName: string;
  partySize: number;
}

/**
 * Every LEGACY hold on a branch's tables for one Dhaka day, keyed by the
 * PHYSICAL BranchTable id it maps onto. `unmatched` carries the holds whose
 * legacy table has no physical namesake — they block nothing, but they are real
 * bookings, so they are handed back instead of dropped.
 */
export async function legacyHoldsForDay(
  branchId: number,
  dayKey: string,
  db: Db = prisma,
): Promise<{ byTableId: Map<number, LegacyHold>; unmatched: LegacyHold[] }> {
  const byTableId = new Map<number, LegacyHold>();
  const unmatched: LegacyHold[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return { byTableId, unmatched };

  const window = legacyFetchWindow(dayKey);
  const bookings = await db.ramadanBooking.findMany({
    where: { branchId, status: { in: LEGACY_BLOCKING }, bookingDate: { gte: window.gte, lt: window.lt } },
    include: { table: true },
  });
  const sameDay = bookings.filter((b) => dhakaDayKey(b.bookingDate) === dayKey);
  if (sameDay.length === 0) return { byTableId, unmatched };

  const physical = await db.branchTable.findMany({ where: { branchId }, select: { id: true, name: true } });
  const byName = new Map(physical.map((t) => [tableNameKey(t.name), t.id]));
  for (const b of sameDay) {
    const hold: LegacyHold = { bookingId: b.id, tableName: b.table.name, guestName: b.guestName, partySize: b.partySize };
    const physicalId = byName.get(tableNameKey(b.table.name));
    if (physicalId == null) {
      unmatched.push(hold);
      continue;
    }
    // Legacy allows one booking per table per day, so the first hold wins.
    if (!byTableId.has(physicalId)) byTableId.set(physicalId, hold);
  }
  return { byTableId, unmatched };
}

export type TableBlockReason = "" | "legacy" | "ramadan" | "reservation";

export interface TableAvailabilityRow {
  table: { id: number; branchId: number; name: string; posX: number; posY: number; width: number; height: number; seats: number; status: string; section: string; sortOrder: number; isActive: boolean };
  available: boolean;
  reason: TableBlockReason;
  heldFor: string;
}

/**
 * WS-9.3 — the ONE place table availability is decided, read across BOTH
 * booking systems plus normal table reservations.
 *
 * With a slot: a table is blocked by a legacy day-hold, by a canonical Ramadan
 * reservation in the same slot, or by a normal reservation within ±2h of the
 * slot start. Without a slot only the legacy day-holds apply — a table busy in
 * one iftar slot may still be free in another, so pretending otherwise would
 * hide seats the branch can actually sell.
 *
 * `slotRemaining` is the slot's own guest capacity (null = unlimited or no slot
 * chosen). Legacy rows carry no slot, so they are accounted at the TABLE level
 * above instead of against a slot they never belonged to.
 */
export async function ramadanTableAvailability(
  branchId: number,
  dayKey: string,
  slotId: number | null,
  db: Db = prisma,
): Promise<{ rows: TableAvailabilityRow[]; slotRemaining: number | null; unmatchedLegacy: LegacyHold[] }> {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const [tables, legacy] = await Promise.all([
    db.branchTable.findMany({
      where: { branchId, isActive: true, status: { not: "out_of_service" } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    legacyHoldsForDay(branchId, dayKey, db),
  ]);
  const tableIds = tables.map((t) => t.id);
  const held = new Map<number, { reason: TableBlockReason; heldFor: string }>();
  for (const [tableId, hold] of legacy.byTableId) {
    if (tableIds.includes(tableId)) held.set(tableId, { reason: "legacy", heldFor: hold.guestName });
  }

  const slot = slotId ? await db.ramadanTimeSlot.findFirst({ where: { id: slotId, branchId } }) : null;
  let slotRemaining: number | null = null;
  if (slot && tableIds.length > 0) {
    const [ramadanHolds, normalHolds] = await Promise.all([
      db.ramadanReservation.findMany({
        where: { branchId, bookingDate: date, slotId: slot.id, status: { in: RAMADAN_BLOCKING }, tableId: { in: tableIds } },
        select: { tableId: true, guestName: true },
      }),
      (async () => {
        const w = slotClashWindow(dayKey, slot.startTime);
        return db.tableReservation.findMany({
          where: { tableId: { in: tableIds }, status: { in: NORMAL_BLOCKING }, requestedAt: { gt: w.from, lt: w.to } },
          select: { tableId: true, guestName: true },
        });
      })(),
    ]);
    for (const r of ramadanHolds) {
      if (r.tableId != null && !held.has(r.tableId)) held.set(r.tableId, { reason: "ramadan", heldFor: r.guestName });
    }
    for (const r of normalHolds) {
      if (r.tableId != null && !held.has(r.tableId)) held.set(r.tableId, { reason: "reservation", heldFor: r.guestName });
    }
  }
  if (slot && slot.capacity > 0) {
    // The slot's guest capacity was configurable but never enforced, so a branch
    // could sell an iftar sitting far past what its kitchen had committed to.
    const booked = await db.ramadanReservation.aggregate({
      where: { branchId, bookingDate: date, slotId: slot.id, status: { in: RAMADAN_BLOCKING } },
      _sum: { partySize: true },
    });
    slotRemaining = Math.max(0, slot.capacity - (booked._sum.partySize ?? 0));
  }

  return {
    rows: tables.map((table) => {
      const hold = held.get(table.id);
      return { table, available: !hold, reason: hold?.reason ?? "", heldFor: hold?.heldFor ?? "" };
    }),
    slotRemaining,
    unmatchedLegacy: legacy.unmatched,
  };
}

// ── Legacy (System 1) reads + the one remaining legacy write ────────────────
type LegacyBookingRel = {
  id: number; branchId: number; customerId: number; guestName: string; guestPhone: string;
  partySize: number; bookingDate: Date; status: string; createdAt: Date;
  table: { name: string }; branch: { name: string };
  customer: { firstName: string; lastName: string; username: string };
};

/**
 * Legacy rows are serialized in the SAME shape as a canonical reservation where
 * the fields exist, plus `is_legacy` and the physical table the name bridge
 * resolves to, so one UI can render both without a second vocabulary.
 */
export function serializeLegacyBooking(b: LegacyBookingRel, physicalTableId: number | null) {
  return {
    id: b.id,
    is_legacy: true as const,
    branch: b.branchId,
    branch_name: b.branch.name,
    customer: b.customerId,
    customer_name: `${b.customer.firstName} ${b.customer.lastName}`.trim() || b.customer.username,
    guest_name: b.guestName,
    guest_phone: b.guestPhone,
    party_size: b.partySize,
    // Decodes both the UTC-midnight and the local-midnight encoding (see
    // `legacyFetchWindow`) onto the Dhaka calendar day the guest actually booked.
    booking_date: dhakaDayKey(b.bookingDate),
    status: b.status,
    table_name: b.table.name,
    // null = the legacy table has no physical namesake, so this row holds no
    // real table and the retirement migration has to map it by hand.
    physical_table: physicalTableId,
    created_at: b.createdAt.toISOString(),
  };
}

/**
 * WS-9.3 — read-only view of LEGACY bookings, so rows made before unification
 * still display for the customer who made them and for the branch that has to
 * honour them. Role-scoped exactly like the canonical reservation list.
 */
export async function legacyRamadanBookings(user: User, opts: { branchId?: number; limit?: number } = {}) {
  const where: Prisma.RamadanBookingWhereInput = {};
  if (user.role === "branch_manager") {
    const branch = await prisma.branch.findFirst({ where: { managerId: user.id } });
    if (!branch) return [];
    where.branchId = branch.id;
  } else if (user.role === "customer") {
    where.customerId = user.id;
  } else if (["super_admin", "management", "accounts"].includes(user.role)) {
    if (opts.branchId) where.branchId = opts.branchId;
  } else {
    return [];
  }
  const rows = await prisma.ramadanBooking.findMany({
    where,
    include: { table: true, branch: true, customer: true },
    orderBy: { bookingDate: "desc" },
    take: Math.min(Math.max(1, Math.floor(opts.limit ?? 100)), 300),
  });
  if (rows.length === 0) return [];
  // One lookup for every branch involved, so the list stays a constant number
  // of queries however many bookings it renders.
  const physical = await prisma.branchTable.findMany({
    where: { branchId: { in: [...new Set(rows.map((r) => r.branchId))] } },
    select: { id: true, name: true, branchId: true },
  });
  const byName = new Map(physical.map((t) => [`${t.branchId}:${tableNameKey(t.name)}`, t.id]));
  return rows.map((r) => serializeLegacyBooking(r, byName.get(`${r.branchId}:${tableNameKey(r.table.name)}`) ?? null));
}

/**
 * WS-9.3 — the ONLY remaining write to the legacy tables, and deliberately the
 * narrowest one: RELEASING a hold. A legacy booking pins a physical table for a
 * whole day; with the legacy create path closed there would otherwise be no way
 * to free a table whose guest cancelled during the transition, and a stale row
 * would keep an iftar seat off the market for the rest of Ramadan. It cannot
 * create anything and it cannot un-cancel.
 */
export async function cancelLegacyRamadanBooking(user: User, bookingId: number) {
  const booking = await prisma.ramadanBooking.findUnique({ where: { id: bookingId } });
  if (!booking) throw notFound();
  const allowed =
    user.role === "super_admin" ||
    (user.role === "customer" && booking.customerId === user.id) ||
    (user.role === "branch_manager" &&
      (await prisma.branch.findFirst({ where: { id: booking.branchId, managerId: user.id } })) != null);
  if (!allowed) throw forbidden();
  if (booking.status === "cancelled") return booking;
  return prisma.ramadanBooking.update({ where: { id: bookingId }, data: { status: "cancelled" } });
}

// ── Reservations (B7) ───────────────────────────────────────────────────────
type ReservationRel = RamadanReservation & {
  branch?: { name: string } | null; table?: { name: string; seats: number } | null;
  customer?: { firstName: string; lastName: string; username: string; phone: string } | null;
  payment?: RamadanReservationPayment | null; slot?: { label: string } | null;
};
export function serializeReservation(r: ReservationRel) {
  return {
    id: r.id, branch: r.branchId, branch_name: r.branch?.name ?? "",
    customer: r.customerId, customer_name: r.customer ? `${r.customer.firstName} ${r.customer.lastName}`.trim() || r.customer.username : "",
    table: r.tableId ?? null, table_name: r.table?.name ?? null, table_seats: r.table?.seats ?? null,
    slot: r.slotId ?? null, slot_label: r.slotLabel,
    booking_date: r.bookingDate.toISOString().slice(0, 10),
    guest_name: r.guestName, guest_phone: r.guestPhone, party_size: r.partySize, special_request: r.specialRequest,
    status: r.status, rejection_reason: r.rejectionReason,
    menu: r.menuId ?? null, menu_name: r.menuName, menu_description: r.menuDescription,
    menu_items: r.menuItemsSnapshot ? r.menuItemsSnapshot.split("\n").filter(Boolean) : [],
    menu_unit_price: dec(r.menuUnitPrice).toFixed(2), menu_serving_capacity: r.menuServingCapacity, menu_quantity: r.menuQuantity,
    total_amount: dec(r.totalAmount).toFixed(2), advance_required: dec(r.advanceRequired).toFixed(2),
    payment: r.payment ? serializePayment(r.payment) : null,
    created_at: r.createdAt.toISOString(),
  };
}

export const RES_INCLUDE = { branch: true, customer: true, table: true, slot: true, payment: true } satisfies Prisma.RamadanReservationInclude;

export async function reservationScope(user: User): Promise<Prisma.RamadanReservationWhereInput | null> {
  if (user.role === "super_admin" || user.role === "management" || user.role === "accounts") return {};
  if (user.role === "branch_manager") {
    const b = await prisma.branch.findFirst({ where: { managerId: user.id } });
    return b ? { branchId: b.id } : null;
  }
  if (user.role === "customer") return { customerId: user.id };
  return null;
}
async function canAccessReservation(user: User, r: { branchId: number; customerId: number }): Promise<boolean> {
  if (user.role === "super_admin" || user.role === "management" || user.role === "accounts") return true;
  if (user.role === "customer") return r.customerId === user.id;
  if (user.role === "branch_manager") {
    const b = await prisma.branch.findFirst({ where: { id: r.branchId, managerId: user.id } });
    return b != null;
  }
  return false;
}

/**
 * One reservation, guarded by the same role scope as the list. Used by the
 * customer booking-detail page every payment notification deep-links to.
 */
export async function getRamadanReservation(user: User, reservationId: number) {
  if (!Number.isInteger(reservationId) || reservationId <= 0) throw notFound();
  const reservation = await prisma.ramadanReservation.findUnique({ where: { id: reservationId }, include: RES_INCLUDE });
  if (!reservation) throw notFound();
  if (!(await canAccessReservation(user, reservation))) throw forbidden();
  return reservation;
}

export async function createRamadanReservation(customer: User, input: {
  branchId: number; bookingDate: string; slotId: number; tableId: number; menuId: number; quantity?: number;
  guestName: string; guestPhone: string; partySize: number; specialRequest?: string;
}) {
  const branch = await prisma.branch.findFirst({ where: { id: input.branchId, isActive: true } });
  if (!branch) throw validationError({ branch_id: sk("errors.ops.branchRequired") });
  const config = await getConfig(branch.id);
  if (!config || !config.isEnabled) throw validationError({ branch_id: sk("errors.ramadan.notEnabled") });
  if (!input.guestName.trim()) throw validationError({ guest_name: sk("errors.ops.nameRequired") });
  if (!input.guestPhone.trim()) throw validationError({ guest_phone: sk("errors.ops.phoneRequired") });

  const date = dateUtc(input.bookingDate);
  if (Number.isNaN(date.getTime())) throw validationError({ booking_date: sk("errors.ops.dateInvalid") });
  // Booking dates are stored as date-only (UTC midnight), so "today" has to be
  // encoded the same way — but the DAY itself is the Dhaka calendar day. A UTC
  // "today" let a customer book a date that had already passed in Bangladesh
  // whenever the request arrived before 06:00 Dhaka.
  const todayUtc = new Date(`${dhakaDayKey()}T00:00:00.000Z`);
  if (date < todayUtc) throw validationError({ booking_date: sk("errors.ramadan.pastBooking") });
  if (config.bookingStartDate && date < config.bookingStartDate) throw validationError({ booking_date: sk("errors.ramadan.outsideRange") });
  if (config.bookingEndDate && date > config.bookingEndDate) throw validationError({ booking_date: sk("errors.ramadan.outsideRange") });

  const size = Math.max(1, Math.floor(Number(input.partySize) || 1));

  // A missing or non-numeric id must be a FIELD ERROR, not a 500: without this
  // `Number(undefined)` reaches Prisma as NaN and the request dies with a
  // server error that tells the customer nothing.
  const requireId = (value: number, field: string) => {
    if (!Number.isInteger(value) || value <= 0) throw validationError({ [field]: sk("errors.ops.idRequired") });
    return value;
  };
  requireId(input.slotId, "slot_id");
  requireId(input.tableId, "table_id");
  requireId(input.menuId, "menu_id");

  const slot = await prisma.ramadanTimeSlot.findUnique({ where: { id: input.slotId } });
  if (!slot || slot.branchId !== branch.id) throw validationError({ slot_id: sk("errors.ramadan.slotNotYourBranch") });
  if (!slot.isActive) throw validationError({ slot_id: sk("errors.ramadan.slotInactive") });

  const table = await prisma.branchTable.findUnique({ where: { id: input.tableId } });
  if (!table || table.branchId !== branch.id) throw validationError({ table_id: sk("errors.ops.tableNotYourBranch") });
  if (!table.isActive || table.status === "out_of_service") throw validationError({ table_id: sk("errors.ops.tableUnavailable") });
  if (size > table.seats) throw validationError({ party_size: sk("errors.ops.tableCapacity", { capacity: table.seats }) });

  const menu = await prisma.ramadanMenu.findUnique({ where: { id: input.menuId }, include: { items: true } });
  if (!menu || menu.branchId !== branch.id || !menu.isActive) throw validationError({ menu_id: sk("errors.ramadan.menuNotEligible") });
  if (menu.startDate && date < menu.startDate) throw validationError({ menu_id: sk("errors.ramadan.menuNotEligible") });
  if (menu.endDate && date > menu.endDate) throw validationError({ menu_id: sk("errors.ramadan.menuNotEligible") });
  if (menu.allowedSlots.trim()) {
    const allowed = menu.allowedSlots.split(",").map((s) => Number(s.trim())).filter(Boolean);
    if (allowed.length && !allowed.includes(slot.id)) throw validationError({ menu_id: sk("errors.ramadan.menuNotForSlot") });
  }
  if (menu.minGuests > 0 && size < menu.minGuests) throw validationError({ party_size: sk("errors.ramadan.belowMinGuests", { min: menu.minGuests }) });
  if (menu.maxGuests > 0 && size > menu.maxGuests) throw validationError({ party_size: sk("errors.ramadan.aboveMaxGuests", { max: menu.maxGuests }) });

  // Quantity: enough servings to cover the party.
  const quantity = input.quantity && input.quantity > 0 ? Math.floor(input.quantity) : Math.ceil(size / menu.servingCapacity);
  if (menu.servingCapacity * quantity < size) throw validationError({ menu_quantity: sk("errors.ramadan.servingsInsufficient") });

  // Server-side money (Decimal-safe): total + advance.
  const total = dec(menu.price).mul(quantity);
  const advance = computeAdvance(config, total, size);
  const status = advance.gt(0) ? "pending_payment" : "pending";

  const dayKey = input.bookingDate.slice(0, 10);

  const reservation = await prisma.$transaction(async (tx) => {
    // WS-9.3 — Ramadan-vs-LEGACY: a System 1 booking has no slot, so it holds
    // its physical table for the whole day. Not reading it is exactly how the
    // same table got sold twice through two different screens.
    const legacy = await legacyHoldsForDay(branch.id, dayKey, tx);
    if (legacy.byTableId.has(table.id)) throw conflict(sk("errors.ramadan.tableTaken"));
    // Ramadan-vs-Ramadan: one physical table per slot per date.
    const ramClash = await tx.ramadanReservation.findFirst({
      where: { tableId: table.id, bookingDate: date, slotId: slot.id, status: { in: RAMADAN_BLOCKING } },
    });
    if (ramClash) throw conflict(sk("errors.ramadan.tableTaken"));
    // Ramadan-vs-Normal: same physical table within ±2h of the slot start on that date.
    const w = slotClashWindow(dayKey, slot.startTime);
    const normalClash = await tx.tableReservation.findFirst({
      where: { tableId: table.id, status: { in: NORMAL_BLOCKING }, requestedAt: { gt: w.from, lt: w.to } },
    });
    if (normalClash) throw conflict(sk("errors.ramadan.tableTaken"));
    // Slot capacity (0 = unlimited). Configurable since B7 but never enforced,
    // so a branch could sell an iftar sitting past what its kitchen committed to.
    if (slot.capacity > 0) {
      const booked = await tx.ramadanReservation.aggregate({
        where: { branchId: branch.id, bookingDate: date, slotId: slot.id, status: { in: RAMADAN_BLOCKING } },
        _sum: { partySize: true },
      });
      const remaining = slot.capacity - (booked._sum.partySize ?? 0);
      if (size > remaining) throw conflict(sk("errors.ramadan.slotFull", { remaining: Math.max(0, remaining) }));
    }

    const res = await tx.ramadanReservation.create({
      data: {
        branchId: branch.id, customerId: customer.id, tableId: table.id, slotId: slot.id, bookingDate: date,
        guestName: input.guestName.trim(), guestPhone: input.guestPhone.trim(), partySize: size,
        specialRequest: (input.specialRequest ?? "").trim(), status, slotLabel: slot.label,
        // Immutable menu snapshot.
        menuId: menu.id, menuName: menu.name, menuDescription: menu.description,
        menuItemsSnapshot: menu.items.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.name).join("\n"),
        menuImage: menu.image, menuUnitPrice: dec(menu.price), menuServingCapacity: menu.servingCapacity, menuQuantity: quantity,
        totalAmount: new Prisma.Decimal(total.toFixed(2)), advanceRequired: advance,
      },
      include: RES_INCLUDE,
    });
    if (advance.gt(0)) {
      await tx.ramadanReservationPayment.create({
        data: { reservationId: res.id, branchId: branch.id, amount: advance, status: "unpaid", method: "demo" },
      });
    }
    return res;
  });

  await notifyBranchManagers(branch.id, {
    type: "ramadan", titleKey: "notifications.ramadan.new.title", bodyKey: "notifications.ramadan.new.body",
    params: { guest: reservation.guestName, date: input.bookingDate }, link: "/branch-manager/ramadan-bookings",
  });
  if (advance.gt(0)) {
    await createNotification(customer.id, {
      type: "payment", titleKey: "notifications.ramadan.advanceRequired.title", bodyKey: "notifications.ramadan.advanceRequired.body",
      params: { amount: advance.toFixed(2), id: reservation.id }, link: `/customer/ramadan-bookings/${reservation.id}`,
    });
  }
  return prisma.ramadanReservation.findUniqueOrThrow({ where: { id: reservation.id }, include: RES_INCLUDE });
}

export async function setRamadanStatus(reservationId: number, status: string, actor: User, opts: { reason?: string } = {}) {
  if (!RAMADAN_STATUSES.includes(status)) throw validationError({ status: sk("errors.ops.statusInvalid") });
  const reservation = await prisma.ramadanReservation.findUnique({ where: { id: reservationId }, include: { payment: true } });
  if (!reservation) throw notFound();
  if (!(await canAccessReservation(actor, reservation))) throw forbidden();

  const isStaff = actor.role === "branch_manager" || actor.role === "super_admin";
  // Customers may only cancel their own booking.
  if (!isStaff && !(actor.role === "customer" && status === "cancelled")) throw forbidden();

  const reason = (opts.reason ?? "").trim();
  if (status === "rejected" && !reason) throw validationError({ rejection_reason: sk("errors.ops.rejectionReasonRequired") });
  // A booking needing advance cannot be confirmed until the advance is paid.
  if (status === "confirmed" && dec(reservation.advanceRequired).gt(0) && reservation.payment?.status !== "paid") {
    throw conflict(sk("errors.ramadan.advanceNotPaid"));
  }

  const updated = await prisma.ramadanReservation.update({
    where: { id: reservationId },
    data: { status, rejectionReason: status === "rejected" ? reason : reservation.rejectionReason },
    include: RES_INCLUDE,
  });
  await createNotification(reservation.customerId, {
    type: "ramadan",
    titleKey: status === "rejected" ? "notifications.ramadan.rejected.title" : "notifications.ramadan.updated.title",
    bodyKey: status === "rejected" ? "notifications.ramadan.rejected.body" : "notifications.ramadan.updated.body",
    params: status === "rejected" ? { reason } : { status: `@:ramadanStatus.${status}` },
    link: `/customer/ramadan-bookings/${reservationId}`,
  });
  return updated;
}

// ── Payments + refunds (B9 / WS-1.3) ────────────────────────────────────────
export function serializePayment(p: RamadanReservationPayment) {
  return {
    id: p.id, reservation: p.reservationId, branch: p.branchId,
    amount: dec(p.amount).toFixed(2), paid_amount: dec(p.paidAmount).toFixed(2), refunded_amount: dec(p.refundedAmount).toFixed(2),
    status: p.status, method: p.method, gateway_ref: p.gatewayRef,
    // WS-1.3 — how the advance actually settled. "" on legacy rows.
    source: p.source, recorded_by: p.recordedById ?? null,
    created_at: p.createdAt.toISOString(),
  };
}

async function auditFinancial(actorId: number | null, action: string, entityId: string, detail: string) {
  await prisma.financialAuditLog.create({ data: { actorId, action, entity: "RamadanReservationPayment", entityId, detail } });
}

/**
 * WS-1.3 — a payment only ever counts as revenue in these states. Everything
 * else (unpaid, pending, failed) is an ATTEMPT and is excluded from the summary
 * and from the financial audit trail's paid totals.
 */
const SETTLED_PAYMENT_STATUSES = ["paid", "refunded"];

/**
 * Side effects shared by the two legitimate settlement paths (verified gateway
 * callback and recorded offline advance). Keeping them here means a booking
 * cannot be advanced without the matching audit row and notifications.
 */
async function afterAdvanceSettled(
  reservation: RamadanReservation,
  payment: RamadanReservationPayment,
  actorId: number | null,
  action: string,
  detail: string,
) {
  // Advance satisfied → booking moves to pending (awaiting BM acceptance).
  if (reservation.status === "pending_payment") {
    await prisma.ramadanReservation.update({ where: { id: reservation.id }, data: { status: "pending" } });
  }
  await auditFinancial(actorId, action, String(payment.id), detail);
  await notifyBranchManagers(reservation.branchId, {
    type: "ramadan", titleKey: "notifications.ramadan.paid.title", bodyKey: "notifications.ramadan.paid.body",
    params: { id: reservation.id }, link: "/branch-manager/ramadan-bookings",
  });
  await createNotification(reservation.customerId, {
    type: "payment", titleKey: "notifications.ramadan.paymentSucceeded.title", bodyKey: "notifications.ramadan.paymentSucceeded.body",
    params: { id: reservation.id }, link: `/customer/ramadan-bookings/${reservation.id}`,
  });
}

/**
 * WS-1.3 — START a REAL advance payment.
 *
 * This replaces the old demo endpoint, which took `{outcome:"success"}` from the
 * REQUEST BODY and marked the booking paid on the customer's say-so — free iftar
 * tables and fabricated revenue in the financial audit log. Nothing in this
 * function marks anything paid: it only asks the gateway for a payment and
 * remembers its id. Only `settleRamadanAdvanceFromGateway`, off a server-side
 * status read, can settle it.
 *
 * With no gateway credentials configured this raises a clean field error telling
 * the customer to settle at the branch (which the offline path below records) —
 * it never crashes and never fakes a payment.
 */
export async function startRamadanAdvancePayment(user: User, reservationId: number) {
  const reservation = await prisma.ramadanReservation.findUnique({ where: { id: reservationId }, include: { payment: true } });
  if (!reservation) throw notFound();
  // Only the booking's customer (or SA) may pay.
  if (user.role !== "super_admin" && reservation.customerId !== user.id) throw forbidden();
  const payment = reservation.payment;
  if (!payment) throw validationError({ detail: sk("errors.ramadan.noAdvanceRequired") });
  if (SETTLED_PAYMENT_STATUSES.includes(payment.status)) throw conflict(sk("errors.ramadan.alreadyPaid"));

  const amount = dec(payment.amount);
  if (amount.lte(0)) throw validationError({ detail: sk("errors.ramadan.noAdvanceRequired") });

  // An earlier attempt that already settled at the gateway must never be
  // charged twice — reconcile it instead of creating a second payment.
  if (payment.gatewayRef && !payment.gatewayRef.startsWith("offline:")) {
    const existing = await verifyGatewayPayment(payment.gatewayRef, { execute: false }).catch(() => null);
    if (existing?.settled) {
      const reconciled = await settleRamadanAdvanceFromGateway(payment.gatewayRef, { execute: false }).catch(() => null);
      // No second charge either way: a clean settlement is already credited, and
      // a mismatch is an accounts problem, not another payment attempt.
      throw conflict(reconciled?.outcome === "mismatch"
        ? sk("errors.ramadan.advanceAmountMismatch", { amount: amount.toFixed(2) })
        : sk("errors.ramadan.alreadyPaid"));
    }
  }

  const created = await createGatewayPayment({
    amount,
    invoiceNumber: `RAM-${reservation.id}`,
    payerReference: reservation.guestPhone || user.phone || "",
    callbackPath: GATEWAY_CALLBACK_RAMADAN_PATH,
  });

  const updated = await prisma.ramadanReservationPayment.update({
    where: { reservationId },
    data: {
      // "pending" = a gateway payment is in flight. It is NOT revenue.
      status: "pending", method: created.provider, source: "gateway",
      gatewayRef: created.paymentId, recordedById: null,
    },
  });
  return {
    payment: updated,
    reservation: await prisma.ramadanReservation.findUniqueOrThrow({ where: { id: reservationId }, include: RES_INCLUDE }),
    redirectUrl: created.redirectUrl,
    provider: created.provider,
  };
}

export type RamadanSettlementOutcome = "paid" | "already_paid" | "failed" | "mismatch" | "unknown";

/**
 * WS-1.3 — settle (or loudly refuse) an advance from the gateway callback.
 *
 * The callback carries nothing we believe: the payment id is a lookup key only,
 * the state is re-read from the gateway, and the amount it reports is compared
 * to the required advance TO THE PAISA. A mismatch leaves the booking unpaid,
 * writes an audit row and alerts accounts + super admins.
 *
 * Idempotent twice over: an already-settled payment short-circuits, and the paid
 * transition is a conditional updateMany stamped with the gateway payment id as
 * the unique idempotencyKey, so a repeated callback can never double-credit.
 */
export async function settleRamadanAdvanceFromGateway(
  paymentId: string,
  opts: { execute?: boolean } = {},
): Promise<{ reservationId: number | null; outcome: RamadanSettlementOutcome }> {
  const ref = paymentId.trim();
  if (!ref) return { reservationId: null, outcome: "unknown" };

  const payment = await prisma.ramadanReservationPayment.findFirst({ where: { gatewayRef: ref } });
  if (!payment) {
    console.error(`[ramadan:gateway] callback for an unknown paymentID=${ref} — ignored.`);
    return { reservationId: null, outcome: "unknown" };
  }
  if (SETTLED_PAYMENT_STATUSES.includes(payment.status)) {
    return { reservationId: payment.reservationId, outcome: "already_paid" };
  }
  const reservation = await prisma.ramadanReservation.findUnique({ where: { id: payment.reservationId } });
  if (!reservation) return { reservationId: payment.reservationId, outcome: "unknown" };

  const state = await verifyGatewayPayment(ref, { execute: opts.execute });
  if (!state) return { reservationId: payment.reservationId, outcome: "unknown" };

  const expected = dec(payment.amount);

  if (!state.settled) {
    await prisma.ramadanReservationPayment.update({ where: { id: payment.id }, data: { status: "failed" } });
    await auditFinancial(null, "ramadan_advance_failed", String(payment.id),
      `${state.provider} paymentID=${ref} status="${state.status}" — reservation ${reservation.id} left unpaid.`);
    await createNotification(reservation.customerId, {
      type: "payment", titleKey: "notifications.ramadan.paymentFailed.title", bodyKey: "notifications.ramadan.paymentFailed.body",
      params: { id: reservation.id }, link: `/customer/ramadan-bookings/${reservation.id}`,
    });
    return { reservationId: reservation.id, outcome: "failed" };
  }

  // Currency is part of the amount: 100 of anything else is not 100 Taka.
  if (!gatewayAmountMatches(state.amount, expected) || state.currency.toUpperCase() !== "BDT") {
    // FAIL LOUDLY — money moved, but not the amount we asked for.
    const reported = state.amount ? `${state.amount.toFixed(2)} ${state.currency}` : "none";
    console.error(`[ramadan:gateway] AMOUNT MISMATCH on reservation ${reservation.id}: expected ${expected.toFixed(2)} BDT, gateway reported ${reported} (paymentID=${ref}, trxID=${state.trxId || "-"}).`);
    await prisma.ramadanReservationPayment.update({ where: { id: payment.id }, data: { status: "failed" } });
    await auditFinancial(null, "ramadan_advance_amount_mismatch", String(payment.id),
      `Reservation ${reservation.id}: expected ${expected.toFixed(2)} BDT, ${state.provider} reported ${reported} (trxID ${state.trxId || "-"}, paymentID ${ref}). NOT marked paid.`);
    const alert = {
      type: "payment" as const,
      titleKey: "notifications.ramadan.paymentMismatch.title", bodyKey: "notifications.ramadan.paymentMismatch.body",
      params: { id: reservation.id }, link: "/accounts/ramadan",
    };
    await notifyRole("accounts", alert);
    await notifySuperAdmins(alert);
    return { reservationId: reservation.id, outcome: "mismatch" };
  }

  const claimed = await prisma.ramadanReservationPayment.updateMany({
    where: { id: payment.id, status: { notIn: SETTLED_PAYMENT_STATUSES } },
    data: {
      status: "paid", paidAmount: expected, source: "gateway", method: state.provider,
      recordedById: null, idempotencyKey: ref,
    },
  });
  if (claimed.count === 0) return { reservationId: reservation.id, outcome: "already_paid" };

  await afterAdvanceSettled(reservation, payment, null, "ramadan_advance_paid",
    `Advance ${expected.toFixed(2)} for reservation ${reservation.id} settled by ${state.provider} (paymentID ${ref}, trxID ${state.trxId || "-"}).`);
  return { reservationId: reservation.id, outcome: "paid" };
}

/** Who may record an OFFLINE advance: accounts / SA, or the OWN-branch manager. */
async function assertCanRecordAdvance(user: User, branchId: number) {
  if (user.role === "accounts" || user.role === "super_admin") return;
  if (user.role === "branch_manager") {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, managerId: user.id } });
    if (!branch) throw forbidden(sk("errors.ramadan.recordAdvanceForbidden"));
    return;
  }
  throw forbidden(sk("errors.ramadan.recordAdvanceForbidden"));
}

/**
 * WS-1.3 — record an advance taken OUTSIDE the gateway (cash or bKash handed
 * over at the counter). Accounts, super admin or the reservation's OWN branch
 * manager only; a customer can never reach this, which is the whole point.
 *
 * The row is stamped with `recordedById` + `source="offline_recorded"` so
 * reconciliation can always tell a hand-entered advance from a settlement the
 * gateway verified, and the staffer's reference is kept in the financial audit
 * log (and in gatewayRef, prefixed "offline:", so it stays queryable).
 *
 * The amount is NOT taken on trust either — it must equal the required advance
 * to the paisa, exactly like a gateway settlement.
 */
export async function recordOfflineRamadanAdvance(
  actor: User,
  reservationId: number,
  input: { amount?: unknown; reference?: unknown; note?: unknown },
) {
  const reservation = await prisma.ramadanReservation.findUnique({ where: { id: reservationId }, include: { payment: true } });
  if (!reservation) throw notFound();
  await assertCanRecordAdvance(actor, reservation.branchId);

  const payment = reservation.payment;
  if (!payment) throw validationError({ detail: sk("errors.ramadan.noAdvanceRequired") });
  if (SETTLED_PAYMENT_STATUSES.includes(payment.status)) throw conflict(sk("errors.ramadan.alreadyPaid"));

  // A receipt/TrxID is mandatory: an offline advance with no reference is not auditable.
  const reference = String(input.reference ?? "").trim().slice(0, 100);
  if (!reference) throw validationError({ reference: sk("errors.ramadan.offlineReferenceRequired") });
  const note = String(input.note ?? "").trim().slice(0, 300);

  const expected = dec(payment.amount);
  const submitted = input.amount === undefined || input.amount === null || input.amount === ""
    ? expected
    : money(input.amount, "amount");
  if (!submitted.equals(expected)) {
    throw validationError({ amount: sk("errors.ramadan.advanceAmountMismatch", { amount: expected.toFixed(2) }) });
  }

  const claimed = await prisma.ramadanReservationPayment.updateMany({
    where: { id: payment.id, status: { notIn: SETTLED_PAYMENT_STATUSES } },
    data: {
      status: "paid", paidAmount: expected, method: "offline", source: "offline_recorded",
      recordedById: actor.id, gatewayRef: `offline:${reference}`,
      // One offline settlement per payment — the unique key makes a double-submit
      // a no-op instead of a second credit.
      idempotencyKey: `offline-${payment.id}`,
    },
  });
  if (claimed.count === 0) throw conflict(sk("errors.ramadan.alreadyPaid"));

  await afterAdvanceSettled(reservation, payment, actor.id, "ramadan_advance_recorded_offline",
    `Advance ${expected.toFixed(2)} for reservation ${reservation.id} recorded OFFLINE by user ${actor.id} (${actor.username}); reference "${reference}"${note ? `; note: ${note}` : ""}.`);

  return {
    payment: await prisma.ramadanReservationPayment.findUniqueOrThrow({ where: { id: payment.id } }),
    reservation: await prisma.ramadanReservation.findUniqueOrThrow({ where: { id: reservationId }, include: RES_INCLUDE }),
  };
}

/** Accounts/SA refund (B9). Cannot exceed refundable paid amount; idempotent-safe. */
export async function refundRamadan(actor: User, reservationId: number, amount: number) {
  if (actor.role !== "accounts" && actor.role !== "super_admin") throw forbidden();
  const payment = await prisma.ramadanReservationPayment.findUnique({ where: { reservationId } });
  if (!payment) throw notFound();
  const refundable = dec(payment.paidAmount).minus(dec(payment.refundedAmount));
  const amt = money(amount, "amount");
  if (amt.lte(0) || amt.gt(refundable)) throw validationError({ amount: sk("errors.ramadan.refundExceeds") });

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.ramadanReservationPayment.findUniqueOrThrow({ where: { reservationId } });
    const newRefunded = dec(p.refundedAmount).plus(amt);
    if (newRefunded.gt(dec(p.paidAmount))) throw validationError({ amount: sk("errors.ramadan.refundExceeds") });
    return tx.ramadanReservationPayment.update({
      where: { reservationId },
      data: { refundedAmount: newRefunded, status: newRefunded.gte(dec(p.paidAmount)) ? "refunded" : p.status },
    });
  });
  await auditFinancial(actor.id, "ramadan_refund", String(updated.id), `Refund ${amt.toFixed(2)} for reservation ${reservationId}`);
  const res = await prisma.ramadanReservation.findUnique({ where: { id: reservationId } });
  if (res) {
    await createNotification(res.customerId, {
      type: "payment", titleKey: "notifications.ramadan.refunded.title", bodyKey: "notifications.ramadan.refunded.body",
      params: { amount: amt.toFixed(2), id: reservationId }, link: `/customer/ramadan-bookings/${reservationId}`,
    });
  }
  return updated;
}

// ── Accounts / Management reads ──────────────────────────────────────────────
export async function ramadanTransactions(user: User, filters: { branchId?: number; status?: string; from?: string; to?: string; customerId?: number; reservationId?: number }) {
  if (!["accounts", "super_admin", "management"].includes(user.role)) throw forbidden();
  const where: Prisma.RamadanReservationPaymentWhereInput = {};
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.status) where.status = filters.status;
  if (filters.reservationId) where.reservationId = filters.reservationId;
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(`${filters.from}T00:00:00.000Z`);
    if (filters.to) where.createdAt.lte = new Date(`${filters.to}T23:59:59.999Z`);
  }
  const rows = await prisma.ramadanReservationPayment.findMany({
    where, include: { reservation: { include: { branch: true, customer: true } } }, orderBy: { createdAt: "desc" }, take: 300,
  });
  const filtered = filters.customerId ? rows.filter((r) => r.reservation.customerId === filters.customerId) : rows;
  return filtered.map((p) => ({
    ...serializePayment(p),
    reservation_id: p.reservationId, branch_name: p.reservation.branch.name,
    customer_name: `${p.reservation.customer.firstName} ${p.reservation.customer.lastName}`.trim() || p.reservation.customer.username,
    booking_date: p.reservation.bookingDate.toISOString().slice(0, 10),
  }));
}

export async function ramadanSummary(user: User, branchId?: number) {
  if (!["management", "super_admin", "accounts"].includes(user.role)) throw forbidden();
  const resWhere: Prisma.RamadanReservationWhereInput = branchId ? { branchId } : {};
  const payWhere: Prisma.RamadanReservationPaymentWhereInput = branchId ? { branchId } : {};
  // WS-1.3 — money is aggregated over SETTLED rows only. An unpaid/pending/failed
  // attempt carries no revenue and must never reach a management figure.
  const settledWhere: Prisma.RamadanReservationPaymentWhereInput = { ...payWhere, status: { in: SETTLED_PAYMENT_STATUSES } };
  const [byStatus, guests, payByStatus, settledAgg, bySource] = await Promise.all([
    prisma.ramadanReservation.groupBy({ by: ["status"], where: resWhere, _count: { status: true } }),
    prisma.ramadanReservation.aggregate({ where: resWhere, _sum: { partySize: true } }),
    prisma.ramadanReservationPayment.groupBy({ by: ["status"], where: payWhere, _count: { status: true }, _sum: { paidAmount: true } }),
    prisma.ramadanReservationPayment.aggregate({ where: settledWhere, _sum: { refundedAmount: true, paidAmount: true } }),
    prisma.ramadanReservationPayment.groupBy({ by: ["source"], where: settledWhere, _count: { source: true }, _sum: { paidAmount: true } }),
  ]);
  const reservations: Record<string, number> = { pending_payment: 0, pending: 0, confirmed: 0, rejected: 0, cancelled: 0, completed: 0 };
  for (const g of byStatus) reservations[g.status] = g._count.status;
  const payments: Record<string, number> = { unpaid: 0, pending: 0, paid: 0, failed: 0, refunded: 0 };
  for (const g of payByStatus) payments[g.status] = g._count.status;
  // Gateway settlements vs advances a staffer typed in at the counter — the
  // split accounts need to reconcile against the bank. "" = legacy rows.
  const settledBySource: Record<string, string> = { gateway: "0.00", offline_recorded: "0.00", unknown: "0.00" };
  for (const g of bySource) settledBySource[g.source || "unknown"] = dec(g._sum.paidAmount ?? 0).toFixed(2);
  const totalPaid = dec(settledAgg._sum.paidAmount ?? 0);
  const totalRefunded = dec(settledAgg._sum.refundedAmount ?? 0);
  return {
    reservations, total_reservations: byStatus.reduce((n, g) => n + g._count.status, 0),
    total_guests: guests._sum.partySize ?? 0, payments,
    total_paid: totalPaid.toFixed(2), total_refunded: totalRefunded.toFixed(2),
    total_net: totalPaid.minus(totalRefunded).toFixed(2),
    settled_by_source: settledBySource,
  };
}
