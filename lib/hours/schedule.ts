// Ordering hours per brand per branch — the pure, client-safe half.
//
// THE single source of truth for "can this brand at this branch take a delivery
// (or pickup) order at this moment?". Stored as JSON on BranchBrand.hours and
// evaluated here with no database and no clock of its own: the server passes the
// Asia/Dhaka wall clock (lib/hours/clock.ts), never the visitor's device time.
//
// SHAPE
//   everyDay — the default "same every day" slots;
//   days     — optional overrides keyed by weekday ("0" = Sunday … "6" =
//              Saturday). An override REPLACES the default for that day; an
//              empty list means closed all that day.
// Each slot opens at `start`, takes its last order at `end`, and says which
// channels are open in it. Nothing is guessed: a slot with neither box ticked
// takes no orders.
//
// MIDNIGHT. A slot whose end is not after its start crosses midnight
// (11:00 → 04:00) and BELONGS TO THE DAY IT STARTED: Friday 11:00 → 04:00 is open
// until 04:00 on Saturday morning, and a Saturday override does not cut it short.
// start == end is a full 24 hours from `start`.

export type Channel = "delivery" | "pickup";
export const CHANNELS: readonly Channel[] = ["delivery", "pickup"];

export interface HoursSlot {
  /** "HH:MM", 24-hour. */
  start: string;
  /** "HH:MM" — the last moment an order is accepted. */
  end: string;
  delivery: boolean;
  pickup: boolean;
}

export interface BrandHours {
  everyDay: HoursSlot[];
  /** Weekday overrides, "0" (Sunday) … "6" (Saturday). */
  days: Partial<Record<string, HoursSlot[]>>;
}

/** Display-only dine-in hours for a branch (the app takes no dine-in orders). */
export interface DineInSlot {
  start: string;
  end: string;
}
export interface DineInHours {
  everyDay: DineInSlot[];
  days: Partial<Record<string, DineInSlot[]>>;
}

export const WEEKDAYS = ["0", "1", "2", "3", "4", "5", "6"] as const;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const MAX_SLOTS_PER_DAY = 8;

export function toMinutes(hhmm: string): number {
  const m = TIME.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Slot length in minutes; a crossing (or start == end) slot wraps past midnight. */
export function slotLength(slot: { start: string; end: string }): number {
  const s = toMinutes(slot.start);
  const e = toMinutes(slot.end);
  return e > s ? e - s : e + 1440 - s;
}

// ── Parsing & validation ─────────────────────────────────────────────────

/** Parse the stored JSON. "" or anything unreadable = not configured (null). */
export function parseBrandHours(raw: string | null | undefined): BrandHours | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BrandHours>;
    if (!v || !Array.isArray(v.everyDay)) return null;
    return { everyDay: v.everyDay, days: v.days && typeof v.days === "object" ? v.days : {} };
  } catch {
    return null;
  }
}

export function parseDineInHours(raw: string | null | undefined): DineInHours | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DineInHours>;
    if (!v || !Array.isArray(v.everyDay)) return null;
    return { everyDay: v.everyDay, days: v.days && typeof v.days === "object" ? v.days : {} };
  } catch {
    return null;
  }
}

/** A validation problem: an i18n key plus where it is ("everyDay.1", "days.5.0"). */
export interface HoursProblem {
  at: string;
  key: string;
}

function checkSlots(
  slots: unknown,
  at: string,
  withChannels: boolean,
  problems: HoursProblem[],
): { start: string; end: string; delivery?: boolean; pickup?: boolean }[] {
  if (!Array.isArray(slots)) {
    problems.push({ at, key: "errors.hours.invalid" });
    return [];
  }
  if (slots.length > MAX_SLOTS_PER_DAY) problems.push({ at, key: "errors.hours.tooManySlots" });
  const clean = slots.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const start = String(s.start ?? "");
    const end = String(s.end ?? "");
    if (!TIME.test(start) || !TIME.test(end)) problems.push({ at: `${at}.${i}`, key: "errors.hours.badTime" });
    const out: { start: string; end: string; delivery?: boolean; pickup?: boolean } = { start, end };
    if (withChannels) {
      out.delivery = s.delivery === true;
      out.pickup = s.pickup === true;
    }
    return out;
  });
  // Overlap check within one day: two slots covering the same minute make the
  // schedule ambiguous (which channels apply?), so it is refused.
  const ranges = clean
    .filter((s) => TIME.test(s.start) && TIME.test(s.end))
    .map((s) => [toMinutes(s.start), toMinutes(s.start) + slotLength(s)] as const)
    .sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] < ranges[i - 1][1]) {
      problems.push({ at, key: "errors.hours.overlap" });
      break;
    }
  }
  return clean;
}

/** Validate + normalise submitted brand hours. Throws nothing; returns problems. */
export function normaliseBrandHours(input: unknown): { hours: BrandHours | null; problems: HoursProblem[] } {
  if (input === null || input === undefined || input === "") return { hours: null, problems: [] };
  const v = (input ?? {}) as Record<string, unknown>;
  const problems: HoursProblem[] = [];
  const everyDay = checkSlots(v.everyDay, "everyDay", true, problems) as HoursSlot[];
  const days: Partial<Record<string, HoursSlot[]>> = {};
  if (v.days && typeof v.days === "object") {
    for (const [day, slots] of Object.entries(v.days as Record<string, unknown>)) {
      if (!(WEEKDAYS as readonly string[]).includes(day)) {
        problems.push({ at: `days.${day}`, key: "errors.hours.invalid" });
        continue;
      }
      days[day] = checkSlots(slots, `days.${day}`, true, problems) as HoursSlot[];
    }
  }
  return { hours: { everyDay, days }, problems };
}

export function normaliseDineInHours(input: unknown): { hours: DineInHours | null; problems: HoursProblem[] } {
  if (input === null || input === undefined || input === "") return { hours: null, problems: [] };
  const v = (input ?? {}) as Record<string, unknown>;
  const problems: HoursProblem[] = [];
  const everyDay = checkSlots(v.everyDay, "dineIn.everyDay", false, problems) as DineInSlot[];
  const days: Partial<Record<string, DineInSlot[]>> = {};
  if (v.days && typeof v.days === "object") {
    for (const [day, slots] of Object.entries(v.days as Record<string, unknown>)) {
      if (!(WEEKDAYS as readonly string[]).includes(day)) continue;
      days[day] = checkSlots(slots, `dineIn.days.${day}`, false, problems) as DineInSlot[];
    }
  }
  if (everyDay.length === 0 && Object.keys(days).length === 0) return { hours: null, problems };
  return { hours: { everyDay, days }, problems };
}

// ── Evaluation ───────────────────────────────────────────────────────────

/** The slots that apply to a weekday: its override if it has one, else every-day. */
export function slotsForDay<T>(hours: { everyDay: T[]; days: Partial<Record<string, T[]>> }, day: number): T[] {
  const override = hours.days[String(((day % 7) + 7) % 7)];
  return override ?? hours.everyDay;
}

/** A moment on the Dhaka clock: weekday (0 = Sunday) and minutes since midnight. */
export interface DhakaMoment {
  day: number;
  minutes: number;
}

/** The slot open for `channel` at this moment, or null. */
export function openSlotAt(hours: BrandHours, channel: Channel, at: DhakaMoment): HoursSlot | null {
  // Today's slots that have started…
  for (const slot of slotsForDay(hours, at.day)) {
    if (!slot[channel]) continue;
    const s = toMinutes(slot.start);
    if (at.minutes >= s && at.minutes < s + slotLength(slot)) return slot;
  }
  // …and yesterday's slots that crossed midnight into today.
  for (const slot of slotsForDay(hours, at.day - 1)) {
    if (!slot[channel]) continue;
    const s = toMinutes(slot.start);
    const end = s + slotLength(slot);
    if (end > 1440 && at.minutes < end - 1440) return slot;
  }
  return null;
}

/** When the next slot for `channel` opens, within the coming week. */
export interface NextOpening {
  /** 0 = later today, 1 = tomorrow, … */
  dayOffset: number;
  /** Weekday of that opening (0 = Sunday). */
  day: number;
  /** "HH:MM" */
  time: string;
}

export function nextOpening(hours: BrandHours, channel: Channel, at: DhakaMoment): NextOpening | null {
  for (let offset = 0; offset <= 7; offset++) {
    const day = (at.day + offset) % 7;
    const starts = slotsForDay(hours, day)
      .filter((s) => s[channel] && TIME.test(s.start))
      .map((s) => toMinutes(s.start))
      .filter((m) => offset > 0 || m > at.minutes)
      .sort((a, b) => a - b);
    if (starts.length) return { dayOffset: offset, day, time: fromMinutes(starts[0]) };
  }
  return null;
}

/**
 * Minutes left in the open slot for `channel` (until its last order), or null
 * when closed. Used by the "last order in …" countdown.
 */
export function minutesUntilClose(hours: BrandHours, channel: Channel, at: DhakaMoment): number | null {
  const slot = openSlotAt(hours, channel, at);
  if (!slot) return null;
  const s = toMinutes(slot.start);
  const end = s + slotLength(slot);
  // Started yesterday → measure in today's minutes.
  const startedToday = at.minutes >= s && at.minutes < end;
  return startedToday ? end - at.minutes : end - 1440 - at.minutes;
}

/** Every-day schedule summary for banners: earliest start, latest end (in minutes past the first start). */
export function everyDaySpan(hours: BrandHours, channel?: Channel): { start: string; end: string } | null {
  const slots = hours.everyDay.filter((s) => (channel ? s[channel] : s.delivery || s.pickup));
  if (!slots.length) return null;
  const starts = slots.map((s) => toMinutes(s.start));
  const first = Math.min(...starts);
  // Measure each end as minutes after the first opening, so a 04:00 that follows
  // an 11:00 opening counts as the LATEST, not the earliest.
  const ends = slots.map((s) => {
    const st = toMinutes(s.start);
    return (st - first + 1440) % 1440 + slotLength(s);
  });
  return { start: fromMinutes(first), end: fromMinutes(first + Math.max(...ends)) };
}
