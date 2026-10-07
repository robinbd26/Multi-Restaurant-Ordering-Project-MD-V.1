// "Can this brand at this branch take a delivery / pickup order right now?"
//
// THE decision every surface shares — order placement and the checkout quote
// (lib/services/orders.ts), nearest-branch ranking (lib/services/coverage.ts),
// the homepage's greyed-out brands, branch status chips and countdowns. It layers,
// in this order:
//   1. the branch itself: archived / deactivated by the super admin → closed;
//      a branch manager's order hold → closed on every channel;
//   2. the brand: not served by this branch, or inactive/archived → closed;
//   3. the brand's own schedule at this branch (lib/hours/schedule.ts), on the
//      Asia/Dhaka clock;
//   4. the branch-level delivery pause, which auto-resumes — delivery only, so
//      pickup keeps working while it runs.
// Pure: the caller loads the branch (BRANCH_HOURS_SELECT) and passes the clock.
//
// NOT CONFIGURED. A brand whose schedule was never set ("" in BranchBrand.hours)
// places no time restriction, exactly like a branch without opening hours did
// before schedules existed. Every existing branch got a real schedule from the
// migration, and the hours editors flag an unconfigured brand loudly; this rule
// only keeps a newly created branch orderable until someone sets its hours.

import { isDeliveryPaused } from "@/lib/coverage/pause";
import {
  fromMinutes,
  minutesUntilClose,
  nextOpening,
  openSlotAt,
  parseBrandHours,
  slotLength,
  slotsForDay,
  toMinutes,
  type Channel,
  type DhakaMoment,
  type NextOpening,
} from "@/lib/hours/schedule";

export type ClosedReason =
  | "branch_inactive"
  | "branch_on_hold"
  | "brand_not_served"
  | "brand_inactive"
  | "outside_hours"
  | "delivery_paused";

export interface ChannelStatus {
  open: boolean;
  reason: ClosedReason | null;
  /** When it next opens on this channel (outside_hours only). */
  opensAt: NextOpening | null;
  /** Minutes until the current slot's last order (open only, configured only). */
  closesInMinutes: number | null;
  /** False when the brand has no schedule yet (no time restriction applies). */
  configured: boolean;
}

/** The branch fields the decision reads. Load with BRANCH_HOURS_INCLUDE. */
export interface AvailabilityBranch {
  isActive: boolean;
  isArchived: boolean;
  isOnHold: boolean;
  deliveryPauseMode: string;
  deliveryPausedUntil: Date | null;
  brands: {
    hours: string;
    brand: { id: number; slug: string; isActive: boolean; isArchived: boolean; sortOrder: number };
  }[];
}

/** Prisma include for a branch whose availability will be evaluated. */
export const BRANCH_HOURS_INCLUDE = { brands: { include: { brand: true } } } as const;

function closed(reason: ClosedReason, configured = true, opensAt: NextOpening | null = null): ChannelStatus {
  return { open: false, reason, opensAt, closesInMinutes: null, configured };
}

export function channelStatus(
  branch: AvailabilityBranch,
  brandSlug: string,
  channel: Channel,
  at: DhakaMoment,
  now: Date = new Date(),
): ChannelStatus {
  if (!branch.isActive || branch.isArchived) return closed("branch_inactive");
  if (branch.isOnHold) return closed("branch_on_hold");
  const row = branch.brands.find((b) => b.brand.slug === brandSlug);
  if (!row) return closed("brand_not_served");
  if (!row.brand.isActive || row.brand.isArchived) return closed("brand_inactive");

  const hours = parseBrandHours(row.hours);
  let closesInMinutes: number | null = null;
  if (hours) {
    if (!openSlotAt(hours, channel, at)) return closed("outside_hours", true, nextOpening(hours, channel, at));
    closesInMinutes = minutesUntilClose(hours, channel, at);
  }
  // The delivery pause sits ON TOP of the schedule and only stops delivery.
  if (channel === "delivery" && isDeliveryPaused(branch, now)) return closed("delivery_paused", Boolean(hours));
  return { open: true, reason: null, opensAt: null, closesInMinutes, configured: Boolean(hours) };
}

export interface BrandStatus {
  slug: string;
  delivery: ChannelStatus;
  pickup: ChannelStatus;
}

/** Live brands a branch serves, in display order. */
export function liveBrandSlugs(branch: Pick<AvailabilityBranch, "brands">): string[] {
  return branch.brands
    .map((b) => b.brand)
    .filter((b) => b.isActive && !b.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((b) => b.slug);
}

/** Status of every live brand at a branch, both channels. */
export function branchBrandStatuses(branch: AvailabilityBranch, at: DhakaMoment, now: Date = new Date()): BrandStatus[] {
  return liveBrandSlugs(branch).map((slug) => ({
    slug,
    delivery: channelStatus(branch, slug, "delivery", at, now),
    pickup: channelStatus(branch, slug, "pickup", at, now),
  }));
}

/** Is any live brand of the branch open on this channel (or on either)? */
export function branchOpenFor(
  branch: AvailabilityBranch,
  channel: Channel | "any",
  at: DhakaMoment,
  now: Date = new Date(),
): boolean {
  return branchBrandStatuses(branch, at, now).some((s) =>
    channel === "any" ? s.delivery.open || s.pickup.open : s[channel].open,
  );
}

/** The soonest opening across a branch's live brands (for "Opens at …"). */
export function branchNextOpening(
  branch: AvailabilityBranch,
  channel: Channel | "any",
  at: DhakaMoment,
  now: Date = new Date(),
): NextOpening | null {
  const candidates = branchBrandStatuses(branch, at, now)
    .flatMap((s) => (channel === "any" ? [s.delivery.opensAt, s.pickup.opensAt] : [s[channel].opensAt]))
    .filter((o): o is NextOpening => o !== null);
  return earliest(candidates);
}

export function earliest(openings: (NextOpening | null)[]): NextOpening | null {
  let best: NextOpening | null = null;
  for (const o of openings) {
    if (!o) continue;
    if (!best || o.dayOffset < best.dayOffset || (o.dayOffset === best.dayOffset && o.time < best.time)) best = o;
  }
  return best;
}

/**
 * i18n key + params for "Opens at 11:00 AM" / "Opens tomorrow at …" /
 * "Opens Friday at …". The caller formats `time` (fmt.clock on a page,
 * formatClock in a server message) and resolves the weekday key.
 */
export function opensAtMessage(opening: NextOpening): { key: string; dayKey: string | null } {
  if (opening.dayOffset === 0) return { key: "hours.opensAt", dayKey: null };
  if (opening.dayOffset === 1) return { key: "hours.opensTomorrowAt", dayKey: null };
  return { key: "hours.opensOnDayAt", dayKey: `hours.weekday.${opening.day}` };
}

/**
 * Today's ordering window across a branch's live brands, for display ("Today
 * 11:00 AM – 4:00 AM"): the earliest start and the latest last-order among the
 * slots of today's schedules on the channel. Null when nothing opens today, or
 * when no live brand has a schedule (then nothing restricts it).
 */
export function branchTodaySpan(
  branch: Pick<AvailabilityBranch, "brands">,
  channel: Channel | "any",
  day: number,
): { start: string; end: string } | null {
  const live = new Set(liveBrandSlugs(branch));
  const spans: { start: number; end: number }[] = [];
  for (const row of branch.brands) {
    if (!live.has(row.brand.slug)) continue;
    const hours = parseBrandHours(row.hours);
    if (!hours) continue;
    for (const slot of slotsForDay(hours, day)) {
      const on = channel === "any" ? slot.delivery || slot.pickup : slot[channel];
      if (!on) continue;
      const s = toMinutes(slot.start);
      spans.push({ start: s, end: s + slotLength(slot) });
    }
  }
  if (!spans.length) return null;
  const start = Math.min(...spans.map((x) => x.start));
  const end = Math.max(...spans.map((x) => x.end));
  return { start: fromMinutes(start), end: fromMinutes(end) };
}
