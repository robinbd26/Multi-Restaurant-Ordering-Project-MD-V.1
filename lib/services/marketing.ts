import "server-only";
import { Prisma } from "@prisma/client";
import type { Campaign, Coupon, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { haversineKm, isValidLatLng, type LatLng } from "@/lib/services/geo";
import { branchForManager } from "@/lib/selectors";
import { notifyCampaignAudience, claimCampaignNotificationClick } from "@/lib/services/notifications";

/**
 * PHASE 5 — where a coupon is in its life RIGHT NOW. Derived, never stored, so
 * a coupon goes live and ends on its own schedule without a job to flip it.
 * "End now" works by stamping endsAt, which makes it ended through this same
 * rule rather than through a second, competing flag.
 */
export type CouponState = "archived" | "ended" | "paused" | "scheduled" | "live";

export function couponState(
  c: { isArchived: boolean; isActive: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date = new Date(),
): CouponState {
  if (c.isArchived) return "archived";
  if (c.endsAt && c.endsAt <= now) return "ended";
  if (!c.isActive) return "paused";
  if (c.startsAt && c.startsAt > now) return "scheduled";
  return "live";
}

export function serializeCoupon(c: {
  id: number;
  code: string;
  discountType: string;
  value: Prisma.Decimal;
  minOrder: Prisma.Decimal;
  maxUses: number;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  // WS-7.2 — per-customer cap (null = uncapped) + archive flag.
  perCustomerLimit: number | null;
  isArchived: boolean;
  createdAt: Date;
  // PHASE 5 — null = platform-wide; set = valid at that branch only.
  branchId: number | null;
  branch?: { name: string } | null;
}) {
  return {
    id: c.id,
    code: c.code,
    discount_type: c.discountType,
    value: c.value.toFixed(2),
    min_order: c.minOrder.toFixed(2),
    max_uses: c.maxUses,
    used_count: c.usedCount,
    starts_at: c.startsAt?.toISOString() ?? null,
    ends_at: c.endsAt?.toISOString() ?? null,
    is_active: c.isActive,
    per_customer_limit: c.perCustomerLimit,
    is_archived: c.isArchived,
    created_at: c.createdAt.toISOString(),
    branch_id: c.branchId,
    branch_name: c.branch?.name ?? null,
    state: couponState(c),
  };
}

export function parseCouponBody(body: Record<string, unknown>) {
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) throw validationError({ code: sk("errors.ops.couponCodeRequired") });
  const discountType = body.discount_type === "fixed" ? "fixed" : "percent";
  const value = Number(body.value);
  if (Number.isNaN(value) || value <= 0 || (discountType === "percent" && value > 100)) {
    throw validationError({ value: sk("errors.ops.discountValueInvalid") });
  }
  // PHASE 5 — ONE redemption per customer unless the coupon says otherwise.
  // Absent or empty means that default; an explicit 0 means no per-customer cap,
  // which is also how an existing uncapped coupon round-trips on edit.
  const perRaw = body.per_customer_limit;
  const perCustomerRaw =
    perRaw === undefined || perRaw === null || perRaw === ""
      ? 1
      : Math.max(0, Math.floor(Number(perRaw) || 0));
  // PHASE 5 — null = platform-wide. The route decides whether THIS user may
  // choose it; a branch manager's submission is overridden with their own branch.
  const branchRaw = body.branch_id;
  const branchId =
    branchRaw === undefined || branchRaw === null || branchRaw === "" ? null : Number(branchRaw);
  if (branchId != null && (!Number.isSafeInteger(branchId) || branchId <= 0)) {
    throw validationError({ branch_id: sk("errors.catalog.selectBranch") });
  }
  // PHASE 5 — start and end are full instants (date AND time). A junk value is a
  // field error, not a 500 from the database layer.
  const instant = (raw: unknown, field: string): Date | null => {
    if (raw === undefined || raw === null || raw === "") return null;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) throw validationError({ [field]: sk("errors.ops.dateInvalid") });
    return d;
  };
  const startsAt = instant(body.starts_at, "starts_at");
  const endsAt = instant(body.ends_at, "ends_at");
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw validationError({ ends_at: sk("errors.ops.endTimeAfterStart") });
  }
  return {
    code,
    discountType,
    value: new Prisma.Decimal(value.toFixed(2)),
    minOrder: new Prisma.Decimal(Number(body.min_order ?? 0).toFixed(2)),
    maxUses: Math.max(0, Math.floor(Number(body.max_uses ?? 0) || 0)),
    perCustomerLimit: perCustomerRaw > 0 ? perCustomerRaw : null,
    startsAt,
    endsAt,
    isActive: body.is_active === undefined ? true : Boolean(body.is_active),
    branchId,
  };
}

// ────────────────────────────────────────────────────────────────────────
// WS-7.3 · Campaign lifecycle
// ────────────────────────────────────────────────────────────────────────
// A Campaign row used to be inert: it was written, listed and edited, and then
// nothing in the product ever READ it. It now has a real lifecycle, a real
// audience and a real customer-facing surface:
//
//   scheduled → live → ended        (driven by startsAt/endsAt, in real time)
//        ↑        ↓
//      paused (isActive = false, the marketer's manual switch)
//
// `isActive` is deliberately kept as the MARKETER'S switch and never used on its
// own to mean "running". A campaign that is enabled but has not reached its
// startsAt is `scheduled` and is invisible to customers; one whose endsAt has
// passed is `ended`. That is what makes "activate on schedule" true without a
// cron: the window itself gates every read path (see LIVE_CAMPAIGN_WHERE).
// `syncCampaignSchedule()` then handles the one thing a window cannot express —
// flipping the stored switch off once the campaign is over, so the list, the
// coupon link and the send endpoint all agree it is finished.

/** Derived lifecycle state of a campaign. Never stored — always recomputed. */
export type CampaignState = "archived" | "paused" | "scheduled" | "live" | "ended";

type CampaignWindow = Pick<Campaign, "isActive" | "isArchived" | "startsAt" | "endsAt">;

/** Campaign + the coupon fields every serializer/read path needs. */
type CampaignRow = Campaign & { coupon?: Pick<Coupon, "code"> | null };

export function campaignState(c: CampaignWindow, now: Date = new Date()): CampaignState {
  if (c.isArchived) return "archived";
  if (c.endsAt < now) return "ended";
  if (!c.isActive) return "paused";
  if (c.startsAt > now) return "scheduled";
  return "live";
}

/**
 * WS-7.3 — the campaigns a customer may actually be shown. Enabled, not
 * archived, and INSIDE its own window: the schedule is part of the query, so a
 * campaign can never leak onto the offers page a day early or a week late.
 */
export function liveCampaignWhere(now: Date = new Date()): Prisma.CampaignWhereInput {
  return { isArchived: false, isActive: true, startsAt: { lte: now }, endsAt: { gte: now } };
}

/**
 * WS-7.3 — deactivate on schedule. Every read path already gates on the window,
 * so this is not what keeps an expired campaign off the storefront; it is what
 * stops a finished campaign from sitting in the dashboard still labelled
 * "Active", and what makes a re-send of an expired campaign impossible.
 *
 * Idempotent and cheap: one conditional UPDATE, no rows touched on the common
 * path. Called from the campaign list / offers / performance read paths rather
 * than from a cron, because this deployment has no scheduler.
 */
export async function syncCampaignSchedule(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.campaign.updateMany({
    where: { isArchived: false, isActive: true, endsAt: { lt: now } },
    data: { isActive: false },
  });
  return count;
}

/** Percentage of `sent` that reached `n`, to one decimal (0 when nothing sent). */
function rateOf(n: number, sent: number): number {
  return sent > 0 ? Math.round((n / sent) * 1000) / 10 : 0;
}

export function serializeCampaign(c: CampaignRow, now: Date = new Date()) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    type: c.type,
    starts_at: c.startsAt.toISOString(),
    ends_at: c.endsAt.toISOString(),
    is_active: c.isActive,
    coupon: c.couponId,
    coupon_code: c.coupon?.code ?? null,
    created_at: c.createdAt.toISOString(),
    // WS-7.3/7.5 — the lifecycle and the engagement counters travel with the
    // campaign, so the list renders N campaigns from ONE query.
    state: campaignState(c, now),
    is_archived: c.isArchived,
    last_sent_at: c.lastSentAt?.toISOString() ?? null,
    sent_count: c.sentCount,
    delivered_count: c.deliveredCount,
    open_count: c.openCount,
    click_count: c.clickCount,
    conversion_count: c.conversionCount,
    conversion_revenue: c.conversionRevenue.toFixed(2),
    open_rate: rateOf(c.openCount, c.sentCount),
    click_rate: rateOf(c.clickCount, c.sentCount),
    conversion_rate: rateOf(c.conversionCount, c.sentCount),
  };
}

export function parseCampaignBody(body: Record<string, unknown>) {
  const title = String(body.title ?? "").trim();
  if (!title) throw validationError({ title: sk("errors.ops.campaignTitleRequired") });
  const type = ["discount", "offer", "promotion"].includes(String(body.type))
    ? String(body.type)
    : "promotion";
  const startsAt = new Date(String(body.starts_at ?? ""));
  const endsAt = new Date(String(body.ends_at ?? ""));
  if (Number.isNaN(startsAt.getTime())) throw validationError({ starts_at: sk("errors.ops.startDateRequired") });
  if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw validationError({ ends_at: sk("errors.ops.endDateAfterStart") });
  }
  const couponId = body.coupon_id ? Math.floor(Number(body.coupon_id)) : null;
  if (couponId !== null && (!Number.isFinite(couponId) || couponId <= 0)) {
    throw validationError({ coupon_id: sk("errors.ops.couponInvalidOrExpired") });
  }
  return {
    title,
    description: String(body.description ?? "").trim(),
    type,
    startsAt,
    endsAt,
    isActive: body.is_active === undefined ? true : Boolean(body.is_active),
    couponId,
  };
}

/**
 * WS-7.3/7.5 — archive-or-delete a campaign (mirrors the coupon verdict).
 *
 * A campaign that has EVER been sent owns history: CampaignEvent rows cascade on
 * delete and every marketing Notification it produced would have its campaignId
 * nulled by SetNull, so a hard delete silently rewrites past performance and
 * erases why a customer was messaged. Such a campaign is archived — invisible to
 * customers, still joinable from every event and notification it caused. A
 * campaign that never sent anything has no history and is genuinely removed.
 * The caller is told which of the two actually happened.
 */
export async function archiveOrDeleteCampaign(campaignId: number): Promise<"archived" | "deleted"> {
  const [events, notifications, campaign] = await Promise.all([
    prisma.campaignEvent.count({ where: { campaignId } }),
    prisma.notification.count({ where: { campaignId } }),
    prisma.campaign.findUnique({ where: { id: campaignId } }),
  ]);
  // sentCount is included so a campaign whose events were pruned is still
  // protected from a hard delete.
  if (events > 0 || notifications > 0 || (campaign?.sentCount ?? 0) > 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { isArchived: true, isActive: false },
    });
    return "archived";
  }
  await prisma.campaign.delete({ where: { id: campaignId } });
  return "deleted";
}

// ────────────────────────────────────────────────────────────────────────
// WS-7.4 · Audience segmentation
// ────────────────────────────────────────────────────────────────────────
// SEGMENTATION USED TO MATCH ALMOST NOBODY. `User.address` is hardcoded "" at
// registration and is never written again, so a location segment resolved to
// `address contains "Mirpur"` against an empty column for every customer who did
// not happen to have an order carrying the word. The saved CustomerAddress rows
// — the only place a customer's location actually lives — were not consulted at
// all, and neither was the trusted `User.currentLat/currentLng` GPS fix.
//
// The rebuilt evaluator resolves location from, in order:
//   1. the customer's ACTIVE saved addresses (address / area / custom label,
//      plus their coordinates),
//   2. the trusted device GPS fix on the user row (WS-4.2 provenance),
//   3. the immutable delivery-address snapshots on their own orders.
// `User.address` is never read. The three axes the requirement asks for —
// LOCATION, ORDER HISTORY and BEHAVIOUR — each have their own criteria below,
// and every one of them is optional, so an old saved segment keeps its meaning.

export interface SegmentCriteria {
  // ── LOCATION ──────────────────────────────────────────────────────────
  /** Free text matched against saved addresses (area/address/label) + order snapshots. */
  location?: string;
  /** Circle centre + radius (km) matched against saved-address and GPS coordinates. */
  near_lat?: number;
  near_lng?: number;
  radius_km?: number;

  // ── ORDER HISTORY ─────────────────────────────────────────────────────
  /** Only count orders placed at this branch. */
  branch_id?: number;
  min_orders?: number;
  max_orders?: number;
  /** Lifetime non-cancelled order value, in Tk. */
  min_spend?: number;
  /** Ordered within the last N days (recency). */
  days_since_last_order?: number;

  // ── BEHAVIOUR ─────────────────────────────────────────────────────────
  /** Has NOT ordered in the last N days (win-back). */
  inactive_days?: number;
  /** Registered but never placed an order. */
  never_ordered?: boolean;
  /** Only customers whose notification toggle is on (reachable audience). */
  reachable_only?: boolean;
}

const DAY_MS = 86_400_000;

/** A cancelled order proves nothing about a customer's habits. */
const COUNTED_ORDER: Prisma.OrderWhereInput = { status: { not: "cancelled" } };

function positiveInt(value: unknown): number | undefined {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalize a criteria payload (from the segment form) into the stored shape.
 * Absent / empty / zero values are DROPPED rather than stored as 0, so "no
 * filter" and "filter on zero" can never be confused.
 */
export function parseSegmentCriteria(body: Record<string, unknown>): SegmentCriteria {
  const criteria: SegmentCriteria = {
    location: String(body.location ?? "").trim() || undefined,
    branch_id: positiveInt(body.branch_id),
    min_orders: positiveInt(body.min_orders),
    max_orders: positiveInt(body.max_orders),
    min_spend: positiveNumber(body.min_spend),
    days_since_last_order: positiveInt(body.days_since_last_order),
    inactive_days: positiveInt(body.inactive_days),
    never_ordered: body.never_ordered === true || body.never_ordered === "true" ? true : undefined,
    reachable_only: body.reachable_only === true || body.reachable_only === "true" ? true : undefined,
  };
  // A radius is only meaningful with a valid centre — a lone "5 km" would
  // otherwise silently match everybody or nobody depending on read order.
  const lat = finiteNumber(body.near_lat);
  const lng = finiteNumber(body.near_lng);
  const radius = positiveNumber(body.radius_km);
  if (radius !== undefined && isValidLatLng(lat, lng)) {
    criteria.near_lat = lat;
    criteria.near_lng = lng;
    criteria.radius_km = Math.min(radius, 500);
  }
  return criteria;
}

/** Read a stored criteria JSON string back, tolerating anything malformed. */
export function readSegmentCriteria(raw: string): SegmentCriteria {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parseSegmentCriteria(parsed && typeof parsed === "object" ? parsed : {});
  } catch {
    return {};
  }
}

/** Every coordinate we legitimately know for a customer (saved pins + GPS fix). */
function customerPoints(u: {
  currentLat: Prisma.Decimal | null;
  currentLng: Prisma.Decimal | null;
  addresses: { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null }[];
}): LatLng[] {
  const points: LatLng[] = [];
  for (const a of u.addresses) {
    if (a.latitude != null && a.longitude != null) {
      points.push({ lat: Number(a.latitude), lng: Number(a.longitude) });
    }
  }
  if (u.currentLat != null && u.currentLng != null) {
    points.push({ lat: Number(u.currentLat), lng: Number(u.currentLng) });
  }
  return points;
}

/** Approved, active, unblocked customers — the only people marketing may reach. */
function reachableCustomerWhere(reachableOnly = false): Prisma.UserWhereInput {
  return {
    role: "customer",
    status: "approved",
    isActive: true,
    isBlocked: false,
    ...(reachableOnly ? { notificationsEnabled: true } : {}),
  };
}

/** Every customer id marketing may broadcast to (the "all customers" audience). */
export async function allCustomerIds(): Promise<number[]> {
  const users = await prisma.user.findMany({
    where: reachableCustomerWhere(),
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Users matching a segment's criteria (approved, active, unblocked customers). */
export async function evaluateSegment(criteriaRaw: string): Promise<number[]> {
  const criteria = readSegmentCriteria(criteriaRaw);
  const now = Date.now();

  const users = await prisma.user.findMany({
    where: reachableCustomerWhere(criteria.reachable_only),
    select: {
      id: true,
      currentLat: true,
      currentLng: true,
      // WS-7.4 — the saved address book is the real location source. Inactive
      // rows are soft-deleted addresses and must not target anyone.
      addresses: {
        where: { isActive: true },
        select: {
          address: true,
          area: true,
          customLabel: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });
  if (users.length === 0) return [];
  const ids = users.map((u) => u.id);

  // ORDER HISTORY — one grouped query instead of N per-user reads.
  const stats = await prisma.order.groupBy({
    by: ["customerId"],
    where: {
      customerId: { in: ids },
      ...COUNTED_ORDER,
      ...(criteria.branch_id ? { branchId: criteria.branch_id } : {}),
    },
    _count: { _all: true },
    _sum: { totalAmount: true },
    _max: { createdAt: true },
  });
  const statFor = new Map(stats.map((s) => [s.customerId, s]));

  // LOCATION (order snapshots) — the immutable delivery address / area recorded
  // on the customer's own orders, resolved DB-side so we never load every order.
  let orderLocationHits: Set<number> | null = null;
  if (criteria.location) {
    const rows = await prisma.order.findMany({
      where: {
        customerId: { in: ids },
        OR: [
          { deliveryAddress: { contains: criteria.location } },
          { deliveryAreaName: { contains: criteria.location } },
        ],
      },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    orderLocationHits = new Set(rows.map((r) => r.customerId));
  }

  const needle = criteria.location?.toLowerCase() ?? "";
  const centre: LatLng | null =
    criteria.radius_km !== undefined && isValidLatLng(criteria.near_lat, criteria.near_lng)
      ? { lat: Number(criteria.near_lat), lng: Number(criteria.near_lng) }
      : null;

  return users
    .filter((u) => {
      const stat = statFor.get(u.id);
      const orders = stat?._count._all ?? 0;
      const spend = stat?._sum.totalAmount ? Number(stat._sum.totalAmount) : 0;
      const last = stat?._max.createdAt ?? null;

      // ── ORDER HISTORY ────────────────────────────────────────────────
      if (criteria.min_orders !== undefined && orders < criteria.min_orders) return false;
      if (criteria.max_orders !== undefined && orders > criteria.max_orders) return false;
      if (criteria.min_spend !== undefined && spend < criteria.min_spend) return false;
      if (criteria.days_since_last_order !== undefined) {
        if (!last || last.getTime() < now - criteria.days_since_last_order * DAY_MS) return false;
      }

      // ── BEHAVIOUR ────────────────────────────────────────────────────
      if (criteria.never_ordered && orders > 0) return false;
      if (criteria.inactive_days !== undefined) {
        if (last && last.getTime() >= now - criteria.inactive_days * DAY_MS) return false;
      }

      // ── LOCATION ─────────────────────────────────────────────────────
      if (needle) {
        // Saved addresses are matched case-insensitively in JS so the answer
        // does not depend on the database's LIKE collation; the order-snapshot
        // half is the DB `contains` above.
        const saved = u.addresses.some((a) =>
          `${a.address} ${a.area} ${a.customLabel}`.toLowerCase().includes(needle),
        );
        if (!saved && !orderLocationHits?.has(u.id)) return false;
      }
      if (centre) {
        const points = customerPoints(u);
        if (!points.some((p) => haversineKm(centre, p) <= (criteria.radius_km as number))) return false;
      }
      return true;
    })
    .map((u) => u.id);
}

// ────────────────────────────────────────────────────────────────────────
// WS-7.5 · Campaign engagement tracking
// ────────────────────────────────────────────────────────────────────────
// Campaign performance used to be fiction: marketing notifications were created
// with no link back to the campaign and no lifecycle at all, so the performance
// page could only ever report coupon counters and a notice's recipient count.
//
// CampaignEvent is now the append-only source of truth (one row per touch) and
// the Campaign.*Count columns are a denormalised mirror incremented in the SAME
// transaction that writes the event, so the list renders N campaigns with one
// query. DOUBLE-FIRE SAFETY does not come from the counters — it comes from a
// single-use token per event:
//   opened  → Notification.readAt   (flipped by ONE conditional UPDATE)
//   clicked → Notification.clickedAt(flipped by ONE conditional UPDATE)
//   converted → the (campaign, order) pair, re-checked inside the transaction
// A replayed request finds the token already spent and records nothing.

export const CAMPAIGN_EVENT_TYPES = ["sent", "delivered", "opened", "clicked", "converted"] as const;
export type CampaignEventType = (typeof CAMPAIGN_EVENT_TYPES)[number];

/** The counter (and, for a conversion, the money) one event moves. */
function counterUpdate(
  type: CampaignEventType,
  amount?: Prisma.Decimal | null,
): Prisma.CampaignUpdateInput {
  const one = { increment: 1 };
  switch (type) {
    case "sent":
      return { sentCount: one };
    case "delivered":
      return { deliveredCount: one };
    case "opened":
      return { openCount: one };
    case "clicked":
      return { clickCount: one };
    case "converted":
      return amount
        ? { conversionCount: one, conversionRevenue: { increment: amount } }
        : { conversionCount: one };
  }
}

function metaJson(metadata?: Record<string, unknown>): string {
  if (!metadata) return "";
  try {
    return JSON.stringify(metadata);
  } catch {
    return "";
  }
}

/**
 * Append one engagement event and move its counter atomically. Callers are
 * responsible for spending the event's single-use token FIRST (see above) —
 * this function is the write, not the guard.
 */
export async function recordCampaignEvent(input: {
  campaignId: number;
  type: CampaignEventType;
  userId?: number | null;
  orderId?: number | null;
  amount?: Prisma.Decimal | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.campaignEvent.create({
      data: {
        campaignId: input.campaignId,
        userId: input.userId ?? null,
        type: input.type,
        orderId: input.orderId ?? null,
        metadata: metaJson(input.metadata),
      },
    });
    await tx.campaign.update({
      where: { id: input.campaignId },
      data: counterUpdate(input.type, input.amount),
    });
  });
}

/**
 * WS-7.5 — record a fan-out. `sent` is one event per recipient; `deliveredCount`
 * moves with it because the in-app inbox row IS the delivery for this channel
 * (it is written synchronously and cannot fail later). A push transport must
 * therefore NOT increment deliveredCount again for the same recipient — it
 * records its own channel events instead. See the seam note in
 * lib/services/notifications.ts.
 */
export async function recordCampaignSend(
  campaignId: number,
  userIds: number[],
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (userIds.length === 0) return;
  const meta = metaJson(metadata);
  await prisma.$transaction(async (tx) => {
    await tx.campaignEvent.createMany({
      data: userIds.map((userId) => ({ campaignId, userId, type: "sent", metadata: meta })),
    });
    await tx.campaign.update({
      where: { id: campaignId },
      data: {
        sentCount: { increment: userIds.length },
        deliveredCount: { increment: userIds.length },
        lastSentAt: new Date(),
      },
    });
  });
}

/**
 * WS-7.5 — record the opens produced by "mark all read". The caller has already
 * flipped each Notification.readAt with its own conditional UPDATE, so this list
 * contains ONLY notifications that really changed: a second "mark all read"
 * yields an empty list and moves no counter.
 */
export async function recordCampaignOpens(
  userId: number,
  opens: { campaignId: number; notificationId: number }[],
): Promise<void> {
  if (opens.length === 0) return;
  const byCampaign = new Map<number, number[]>();
  for (const o of opens) {
    const list = byCampaign.get(o.campaignId) ?? [];
    list.push(o.notificationId);
    byCampaign.set(o.campaignId, list);
  }
  for (const [campaignId, notificationIds] of byCampaign) {
    await prisma.$transaction(async (tx) => {
      await tx.campaignEvent.createMany({
        data: notificationIds.map((notificationId) => ({
          campaignId,
          userId,
          type: "opened",
          metadata: metaJson({ channel: "inapp", notificationId }),
        })),
      });
      await tx.campaign.update({
        where: { id: campaignId },
        data: { openCount: { increment: notificationIds.length } },
      });
    });
  }
}

/**
 * WS-7.5 — a customer followed a campaign notification through to the offers
 * page. The single-use token is the recipient's own unclicked notification for
 * that campaign: once it is spent, refreshing or re-opening the page records
 * nothing, and a visitor who was never sent the campaign can never inflate its
 * click count.
 */
export async function trackCampaignClick(userId: number, campaignId: number): Promise<boolean> {
  const claimed = await claimCampaignNotificationClick(userId, campaignId);
  if (!claimed) return false;
  await recordCampaignEvent({
    campaignId,
    type: "clicked",
    userId,
    metadata: { channel: "inapp", notificationId: claimed },
  });
  return true;
}

// ── Conversion attribution ──────────────────────────────────────────────
// An order is credited to a campaign when one of two defensible things is true:
//
//   coupon — the order redeemed the campaign's own coupon inside the campaign
//            window. This is exact: the coupon code IS the campaign's offer.
//   click  — the customer clicked through to the offers page from the campaign
//            and then placed their FIRST order before the window closed. Only
//            one order per customer is ever credited this way.
//
// Attribution runs as an idempotent reconciliation from the marketing read paths
// rather than from the order write path: lib/services/orders.ts is owned
// elsewhere, and a read-side reconciliation cannot break checkout if it fails.

interface ConversionCandidate {
  orderId: number;
  userId: number;
  amount: Prisma.Decimal;
  source: "coupon" | "click";
}

async function reconcileOne(
  campaign: Pick<Campaign, "id" | "couponId" | "startsAt" | "endsAt">,
  now: Date,
): Promise<number> {
  const windowEnd = campaign.endsAt < now ? campaign.endsAt : now;
  if (windowEnd <= campaign.startsAt) return 0;

  const existing = await prisma.campaignEvent.findMany({
    where: { campaignId: campaign.id, type: "converted" },
    select: { orderId: true, userId: true },
  });
  const seenOrders = new Set<number>();
  const seenUsers = new Set<number>();
  for (const e of existing) {
    if (e.orderId != null) seenOrders.add(e.orderId);
    if (e.userId != null) seenUsers.add(e.userId);
  }

  const candidates: ConversionCandidate[] = [];

  // (a) COUPON attribution — the campaign's own coupon, inside its window.
  if (campaign.couponId != null) {
    const orders = await prisma.order.findMany({
      where: {
        couponId: campaign.couponId,
        ...COUNTED_ORDER,
        createdAt: { gte: campaign.startsAt, lte: windowEnd },
      },
      select: { id: true, customerId: true, totalAmount: true },
    });
    for (const o of orders) {
      if (seenOrders.has(o.id)) continue;
      seenOrders.add(o.id);
      seenUsers.add(o.customerId);
      candidates.push({ orderId: o.id, userId: o.customerId, amount: o.totalAmount, source: "coupon" });
    }
  }

  // (b) CLICK-THROUGH attribution — first order after the click, one per user.
  const clicks = await prisma.campaignEvent.findMany({
    where: { campaignId: campaign.id, type: "clicked", userId: { not: null } },
    select: { userId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const firstClick = new Map<number, Date>();
  for (const c of clicks) {
    if (c.userId != null && !firstClick.has(c.userId)) firstClick.set(c.userId, c.createdAt);
  }
  const pendingClickUsers = [...firstClick.keys()].filter((id) => !seenUsers.has(id));
  if (pendingClickUsers.length > 0) {
    const orders = await prisma.order.findMany({
      where: {
        customerId: { in: pendingClickUsers },
        ...COUNTED_ORDER,
        createdAt: { lte: windowEnd },
      },
      select: { id: true, customerId: true, totalAmount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    for (const o of orders) {
      if (seenUsers.has(o.customerId) || seenOrders.has(o.id)) continue;
      const clickedAt = firstClick.get(o.customerId);
      if (!clickedAt || o.createdAt < clickedAt) continue;
      seenOrders.add(o.id);
      seenUsers.add(o.customerId);
      candidates.push({ orderId: o.id, userId: o.customerId, amount: o.totalAmount, source: "click" });
    }
  }

  let recorded = 0;
  for (const candidate of candidates) {
    // The (campaign, order) pair is re-checked INSIDE the transaction, so two
    // reconciliations racing each other cannot both credit the same order.
    const written = await prisma.$transaction(async (tx) => {
      const dupe = await tx.campaignEvent.findFirst({
        where: { campaignId: campaign.id, type: "converted", orderId: candidate.orderId },
        select: { id: true },
      });
      if (dupe) return false;
      await tx.campaignEvent.create({
        data: {
          campaignId: campaign.id,
          userId: candidate.userId,
          type: "converted",
          orderId: candidate.orderId,
          metadata: metaJson({ source: candidate.source }),
        },
      });
      await tx.campaign.update({
        where: { id: campaign.id },
        // Money is Decimal end to end — the order total is never converted to a
        // float on its way into attributed revenue.
        data: { conversionCount: { increment: 1 }, conversionRevenue: { increment: candidate.amount } },
      });
      return true;
    });
    if (written) recorded += 1;
  }
  return recorded;
}

/** Credit every attributable order to its campaign. Safe to run repeatedly. */
export async function reconcileCampaignConversions(now: Date = new Date()): Promise<number> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      isArchived: false,
      // Nothing to attribute to a campaign that neither sent anything nor owns
      // a coupon, so those are never scanned.
      OR: [{ sentCount: { gt: 0 } }, { couponId: { not: null } }],
    },
    select: { id: true, couponId: true, startsAt: true, endsAt: true },
  });
  let recorded = 0;
  for (const campaign of campaigns) recorded += await reconcileOne(campaign, now);
  return recorded;
}

// ── Sending ─────────────────────────────────────────────────────────────

/**
 * WS-7.3/7.5 — send a campaign to an audience.
 *
 * This is the link that was missing between a Campaign row and anything the
 * customer ever sees: it fans the campaign out as marketing notifications that
 * CARRY their campaign id (so every later open/click/conversion can be
 * attributed), deep-links them at the offers page, and records the send.
 *
 * Targeting is an action, not stored config: the campaign is sent either to a
 * saved AudienceSegment or to every reachable customer, and which one was used
 * is preserved in the event metadata.
 */
export async function sendCampaign(input: {
  campaignId: number;
  segmentId?: number | null;
  title?: string;
  body?: string;
}): Promise<{ sent: number; audience: number; segment: string | null }> {
  const now = new Date();
  await syncCampaignSchedule(now);
  const campaign = await prisma.campaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) throw notFound();

  // An archived or finished campaign can never message anyone — sending one
  // would advertise an offer that is no longer redeemable.
  const state = campaignState(campaign, now);
  if (state === "archived" || state === "ended") {
    throw validationError({ non_field_errors: sk("errors.ops.campaignNotSendable") });
  }

  let segment: { id: number; name: string; criteria: string } | null = null;
  if (input.segmentId) {
    segment = await prisma.audienceSegment.findUnique({ where: { id: input.segmentId } });
    if (!segment) throw validationError({ segment_id: sk("errors.ops.segmentNotFound") });
  }

  const audience = segment ? await evaluateSegment(segment.criteria) : await allCustomerIds();
  const title = (input.title ?? "").trim() || campaign.title;
  const body = (input.body ?? "").trim() || campaign.description;

  const recipients = await notifyCampaignAudience(audience, {
    campaignId: campaign.id,
    type: "marketing",
    title,
    body,
    // The deep link is what turns an inbox tap into a measurable click.
    link: `/customer/offers?c=${campaign.id}`,
  });
  await recordCampaignSend(campaign.id, recipients, {
    channel: "inapp",
    segmentId: segment?.id ?? null,
    segmentName: segment?.name ?? null,
  });

  return { sent: recipients.length, audience: audience.length, segment: segment?.name ?? null };
}

// ── Customer-facing offers ──────────────────────────────────────────────

export interface CustomerOffer {
  id: number;
  title: string;
  description: string;
  type: string;
  starts_at: string;
  ends_at: string;
  coupon: {
    code: string;
    discount_type: string;
    value: string;
    min_order: string;
    ends_at: string | null;
    /** Uses left on a capped coupon; null = unlimited. */
    remaining: number | null;
  } | null;
}

/**
 * WS-7.3 — the offers a customer may be shown right now. The schedule is part of
 * the query, and a campaign's coupon is only advertised while it is itself
 * redeemable: an exhausted, paused, archived or out-of-window coupon is shown as
 * an offer WITHOUT a code rather than as a code that fails at checkout.
 */
export async function liveOffers(now: Date = new Date()): Promise<CustomerOffer[]> {
  await syncCampaignSchedule(now);
  const campaigns = await prisma.campaign.findMany({
    where: liveCampaignWhere(now),
    include: { coupon: true },
    orderBy: [{ endsAt: "asc" }, { id: "desc" }],
  });

  return campaigns.map((c) => {
    const coupon = c.coupon;
    const redeemable =
      coupon != null &&
      coupon.isActive &&
      !coupon.isArchived &&
      (coupon.startsAt === null || coupon.startsAt <= now) &&
      (coupon.endsAt === null || coupon.endsAt >= now) &&
      (coupon.maxUses === 0 || coupon.usedCount < coupon.maxUses);
    return {
      id: c.id,
      title: c.title,
      description: c.description,
      type: c.type,
      starts_at: c.startsAt.toISOString(),
      ends_at: c.endsAt.toISOString(),
      coupon:
        redeemable && coupon
          ? {
              code: coupon.code,
              discount_type: coupon.discountType,
              value: coupon.value.toFixed(2),
              min_order: coupon.minOrder.toFixed(2),
              ends_at: coupon.endsAt?.toISOString() ?? null,
              remaining: coupon.maxUses > 0 ? Math.max(0, coupon.maxUses - coupon.usedCount) : null,
            }
          : null,
    };
  });
}

// ── Performance reporting ───────────────────────────────────────────────

export interface CampaignPerformanceRow {
  id: number;
  title: string;
  type: string;
  state: CampaignState;
  starts_at: string;
  ends_at: string;
  last_sent_at: string | null;
  coupon_code: string | null;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  revenue: string;
  open_rate: number;
  click_rate: number;
  conversion_rate: number;
}

export interface MarketingPerformance {
  campaigns: CampaignPerformanceRow[];
  totals: {
    campaigns: number;
    live: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    converted: number;
    revenue: string;
    open_rate: number;
    click_rate: number;
    conversion_rate: number;
  };
  coupons: {
    id: number;
    code: string;
    discount_type: string;
    value: string;
    used_count: number;
    max_uses: number;
    is_archived: boolean;
  }[];
  coupon_discount: string;
  sends: { id: number; title: string; recipients: number; created_at: string }[];
}

/**
 * WS-7.5 — the numbers behind /marketing/performance. The schedule is synced and
 * conversions are reconciled FIRST, so what the page prints is current rather
 * than whatever happened to have been written last.
 */
export async function marketingPerformance(now: Date = new Date()): Promise<MarketingPerformance> {
  await syncCampaignSchedule(now);
  await reconcileCampaignConversions(now);

  const [campaigns, coupons, sends, couponOrders] = await Promise.all([
    prisma.campaign.findMany({ include: { coupon: true }, orderBy: { createdAt: "desc" } }),
    prisma.coupon.findMany({ orderBy: { usedCount: "desc" } }),
    prisma.notice.findMany({ where: { type: "marketing" }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.order.aggregate({ where: { couponId: { not: null } }, _sum: { discountAmount: true } }),
  ]);

  const rows: CampaignPerformanceRow[] = campaigns.map((c) => ({
    id: c.id,
    title: c.title,
    type: c.type,
    state: campaignState(c, now),
    starts_at: c.startsAt.toISOString(),
    ends_at: c.endsAt.toISOString(),
    last_sent_at: c.lastSentAt?.toISOString() ?? null,
    coupon_code: c.coupon?.code ?? null,
    sent: c.sentCount,
    delivered: c.deliveredCount,
    opened: c.openCount,
    clicked: c.clickCount,
    converted: c.conversionCount,
    revenue: c.conversionRevenue.toFixed(2),
    open_rate: rateOf(c.openCount, c.sentCount),
    click_rate: rateOf(c.clickCount, c.sentCount),
    conversion_rate: rateOf(c.conversionCount, c.sentCount),
  }));

  const sum = (pick: (c: (typeof campaigns)[number]) => number) =>
    campaigns.reduce((a, c) => a + pick(c), 0);
  const sent = sum((c) => c.sentCount);
  // Attributed revenue is summed as Decimal, never as a float.
  const revenue = campaigns.reduce(
    (a, c) => a.add(c.conversionRevenue),
    new Prisma.Decimal(0),
  );

  return {
    campaigns: rows,
    totals: {
      campaigns: campaigns.length,
      live: campaigns.filter((c) => campaignState(c, now) === "live").length,
      sent,
      delivered: sum((c) => c.deliveredCount),
      opened: sum((c) => c.openCount),
      clicked: sum((c) => c.clickCount),
      converted: sum((c) => c.conversionCount),
      revenue: revenue.toFixed(2),
      open_rate: rateOf(sum((c) => c.openCount), sent),
      click_rate: rateOf(sum((c) => c.clickCount), sent),
      conversion_rate: rateOf(sum((c) => c.conversionCount), sent),
    },
    coupons: coupons.map((c) => ({
      id: c.id,
      code: c.code,
      discount_type: c.discountType,
      value: c.value.toFixed(2),
      used_count: c.usedCount,
      max_uses: c.maxUses,
      is_archived: c.isArchived,
    })),
    coupon_discount: (couponOrders._sum.discountAmount ?? new Prisma.Decimal(0)).toFixed(2),
    sends: sends.map((s) => ({
      id: s.id,
      title: s.title,
      recipients: s.recipients,
      created_at: s.createdAt.toISOString(),
    })),
  };
}

/**
 * WS-7.2 — coupons that customers may still be offered. An ARCHIVED coupon is
 * historical: it stays joinable from every order that used it (and readable in
 * reports), but it is never listed or redeemable again.
 */
export const LIVE_COUPON_WHERE: Prisma.CouponWhereInput = { isArchived: false };

/**
 * Validate a coupon code for an order subtotal; returns coupon + discount.
 *
 * `client` lets the checkout transaction validate on its OWN connection, so the
 * check and the claim that follows it cannot straddle two transactions.
 * `customerId` enables the per-customer cap — omitted, the coupon is only
 * checked against its global limits (the read-only "does this code work?" case).
 */
export async function validateCoupon(
  code: string,
  subtotal: number,
  opts: { customerId?: number; client?: Prisma.TransactionClient; branchId?: number | null } = {},
): Promise<{ coupon: Coupon; discount: number }> {
  const db: Prisma.TransactionClient = opts.client ?? prisma;
  const coupon = await db.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  const fail = () => validationError({ coupon_code: sk("errors.ops.couponInvalidOrExpired") });
  if (!coupon || !coupon.isActive || coupon.isArchived) throw fail();
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) throw fail();
  if (coupon.endsAt && coupon.endsAt < now) throw fail();
  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) throw fail();
  // PHASE 5 — a branch coupon is valid only at its own branch. Strict: a caller
  // that does not say which branch it is ordering from cannot use one at all.
  // Checked before the per-customer count, so the customer is told the real reason.
  if (coupon.branchId != null && coupon.branchId !== opts.branchId) {
    throw validationError({ coupon_code: sk("errors.ops.couponWrongBranch") });
  }
  // WS-7.2 — per-customer cap, counted from the redemption trail rather than
  // inferred from usedCount (which cannot tell WHO used the coupon).
  if (opts.customerId != null && coupon.perCustomerLimit != null && coupon.perCustomerLimit > 0) {
    const mine = await db.couponRedemption.count({
      where: { couponId: coupon.id, customerId: opts.customerId },
    });
    if (mine >= coupon.perCustomerLimit) {
      throw validationError({
        coupon_code: sk("errors.ops.couponPerCustomerLimit", { limit: coupon.perCustomerLimit }),
      });
    }
  }
  if (subtotal < Number(coupon.minOrder)) {
    throw validationError({
      coupon_code: sk("errors.ops.couponMinOrder", { amount: Number(coupon.minOrder).toFixed(0) }),
    });
  }
  const discount =
    coupon.discountType === "percent"
      ? (subtotal * Number(coupon.value)) / 100
      : Math.min(Number(coupon.value), subtotal);
  return { coupon, discount: Math.round(discount * 100) / 100 };
}

/**
 * WS-7.2 — CLAIM a coupon for an order, atomically, inside the order's own
 * transaction. Returns the coupon id and the server-computed discount.
 *
 * THE RACE THIS CLOSES (in the spirit of the PHASE R idempotency note on Order):
 * the old path READ `usedCount`, compared it to `maxUses`, and INCREMENTED it in
 * a separate, later statement. Two checkouts landing in that gap both read the
 * same count, both passed the limit check, and both incremented — a "first 100
 * customers" coupon could be redeemed by every customer who tapped at the same
 * moment, and the counter could even be pushed past its own ceiling. The limit
 * is now part of the WHERE clause of ONE conditional UPDATE: only a single
 * statement can move usedCount from maxUses-1 to maxUses, and the loser gets
 * count === 0 and is rejected with the ordinary "invalid or expired" message.
 * The unique CouponRedemption([couponId, orderId]) row written in the same
 * transaction is the backstop — a replayed checkout for the same order can never
 * be counted twice, because the second insert violates the constraint.
 */
export async function claimCouponForOrder(
  tx: Prisma.TransactionClient,
  input: { code: string; subtotal: number; customerId: number; orderId: number; branchId?: number | null },
): Promise<{ couponId: number; discount: Prisma.Decimal }> {
  const { coupon, discount } = await validateCoupon(input.code, input.subtotal, {
    customerId: input.customerId,
    client: tx,
    branchId: input.branchId ?? null,
  });
  // 0 = unlimited, so the ceiling only joins the WHERE clause when there is one.
  const ceiling: Prisma.CouponWhereInput =
    coupon.maxUses > 0 ? { usedCount: { lt: coupon.maxUses } } : {};
  const claimed = await tx.coupon.updateMany({
    where: { id: coupon.id, isActive: true, isArchived: false, ...ceiling },
    data: { usedCount: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    throw validationError({ coupon_code: sk("errors.ops.couponInvalidOrExpired") });
  }
  await tx.couponRedemption.create({
    data: { couponId: coupon.id, orderId: input.orderId, customerId: input.customerId },
  });
  // The per-customer cap is re-counted AFTER our own row exists, so two orders
  // from the same customer racing each other cannot both see "0 used". Throwing
  // here rolls the whole checkout transaction back, including the increment.
  // (On Postgres READ COMMITTED two concurrent transactions still cannot see
  //  each other's uncommitted row; a @@unique([couponId, customerId]) would be
  //  the absolute backstop, but the schema is frozen — recorded as a follow-up.)
  if (coupon.perCustomerLimit != null && coupon.perCustomerLimit > 0) {
    const mine = await tx.couponRedemption.count({
      where: { couponId: coupon.id, customerId: input.customerId },
    });
    if (mine > coupon.perCustomerLimit) {
      throw validationError({
        coupon_code: sk("errors.ops.couponPerCustomerLimit", { limit: coupon.perCustomerLimit }),
      });
    }
  }
  return { couponId: coupon.id, discount: new Prisma.Decimal(discount.toFixed(2)) };
}

/**
 * WS-7.2 — give the use back when the order that consumed it is cancelled. A
 * cancelled order used to keep the coupon's use forever, so a limited campaign
 * silently shrank every time an order fell through.
 *
 * Idempotent by construction: the DELETE's affected-row count decides whether
 * `usedCount` moves at all, and the decrement is itself guarded by
 * `usedCount > 0`, so a repeated cancellation can never drive the counter
 * negative or release a use twice.
 */
export async function releaseCouponForOrder(orderId: number): Promise<boolean> {
  const redemption = await prisma.couponRedemption.findFirst({ where: { orderId } });
  if (!redemption) return false;
  return prisma.$transaction(async (tx) => {
    const removed = await tx.couponRedemption.deleteMany({ where: { id: redemption.id } });
    if (removed.count !== 1) return false;
    await tx.coupon.updateMany({
      where: { id: redemption.couponId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    return true;
  });
}

/**
 * WS-7.2 — archive-or-delete a coupon (mirrors the branch delete verdict). A
 * coupon that has EVER been redeemed is archived, never hard-deleted: the
 * relation is `onDelete: SetNull`, so deleting it silently nulled `couponId` on
 * every historical order and erased why those orders were discounted. The caller
 * is told which of the two actually happened.
 */
export async function archiveOrDeleteCoupon(couponId: number): Promise<"archived" | "deleted"> {
  const [redemptions, orders] = await Promise.all([
    prisma.couponRedemption.count({ where: { couponId } }),
    prisma.order.count({ where: { couponId } }),
  ]);
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
  // usedCount is included so a coupon redeemed before the redemption trail
  // existed is still protected from a hard delete.
  if (redemptions > 0 || orders > 0 || (coupon?.usedCount ?? 0) > 0) {
    await prisma.coupon.update({
      where: { id: couponId },
      data: { isArchived: true, isActive: false },
    });
    return "archived";
  }
  await prisma.coupon.delete({ where: { id: couponId } });
  return "deleted";
}

/**
 * PHASE 5 — ONE coupon system, scoped by role.
 *
 * A branch manager sees and changes only coupons scoped to their own branch;
 * anything they create is forced to that branch whatever they submit, so no id
 * in a request can widen their reach. Super admin and marketing see everything
 * and may create platform-wide coupons (branchId null) or branch-scoped ones.
 * A coupon outside the caller's scope is reported as NOT FOUND rather than
 * forbidden, so its existence is not disclosed either.
 */
export async function couponScopeForUser(user: User): Promise<{
  where: Prisma.CouponWhereInput;
  /** The only branch this user may scope a coupon to; null = any, incl. platform-wide. */
  lockedBranchId: number | null;
}> {
  if (user.role === "branch_manager") {
    const branch = await branchForManager(user.id);
    if (!branch) throw forbidden(sk("errors.catalog.noBranchAssigned"));
    return { where: { branchId: branch.id }, lockedBranchId: branch.id };
  }
  return { where: {}, lockedBranchId: null };
}

/**
 * The branch a coupon being written ends up scoped to, for this caller.
 * `current` is the coupon's existing branch on an edit: keeping it is always
 * allowed, even if that branch has since been archived, so an unrelated edit
 * never fails or silently widens the coupon.
 */
export async function couponBranchFor(
  requested: number | null,
  scope: { lockedBranchId: number | null },
  current?: number | null,
): Promise<number | null> {
  if (scope.lockedBranchId != null) return scope.lockedBranchId;
  if (requested == null) return null;
  if (current != null && requested === current) return current;
  const branch = await prisma.branch.findFirst({
    where: { id: requested, isArchived: false },
    select: { id: true },
  });
  if (!branch) throw validationError({ branch_id: sk("errors.catalog.selectBranch") });
  return branch.id;
}

/** PHASE 5 — branches a coupon can be scoped to, for the scope selector. */
export async function couponBranchOptions(): Promise<{ id: number; name: string }[]> {
  return prisma.branch.findMany({
    where: { isArchived: false },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
