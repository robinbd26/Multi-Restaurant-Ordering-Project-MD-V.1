// Date helpers for dashboards, reports and duty logs.
//
// ONE DEFINITION OF "A DAY". The business runs in Bangladesh, so a business day
// starts at MIDNIGHT IN DHAKA — never at the server's local midnight and never
// at UTC midnight. On a UTC cloud host those are 06:00 Dhaka, which silently
// files every order placed between 00:00 and 06:00 Dhaka under the PREVIOUS
// day: "today's sales", "today's orders" and "today's cancelled orders" were
// all 6am-to-6am windows, and a once-per-day key (daily login reward, duty log)
// could be claimed twice inside one Dhaka day.
//
// Everything below therefore resolves through Asia/Dhaka. The zone is imported
// from the i18n formatter (the display side already pins it) so the app never
// carries two copies of the answer. The legacy exports (`startOfToday`,
// `endOfToday`, `midnight`, `daysAgo`, `weekBounds`, `isoDate`) keep their
// signatures and are simply re-pointed at the Dhaka-correct implementations, so
// every existing caller is fixed without being edited.

import { APP_TIME_ZONE } from "@/lib/i18n/format";

/**
 * Fallback offset used ONLY if the runtime's Intl has no IANA time-zone data
 * (a stripped-down ICU build). Bangladesh has observed a fixed UTC+6 with no
 * DST since the 2009 experiment was abandoned, so this is correct today — but
 * it is a constant in exactly one place, and the Intl path above it is what
 * actually runs, so a future policy change needs no code edit.
 */
const DHAKA_FALLBACK_OFFSET_MINUTES = 360;

/**
 * `hourCycle: "h23"` (not `hour12: false`) — some ICU versions report midnight
 * as hour "24" for the latter, which would push every day key forward by one.
 */
function makeDhakaFormatter(): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIME_ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return null;
  }
}

const DHAKA_FORMATTER = makeDhakaFormatter();

/** Dhaka wall-clock fields of an instant (month is 1-based, like a human reads it). */
interface DhakaWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function dhakaWallClock(date: Date): DhakaWallClock {
  if (DHAKA_FORMATTER) {
    const parts = DHAKA_FORMATTER.formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second"),
    };
  }
  const shifted = new Date(date.getTime() + DHAKA_FALLBACK_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** Milliseconds Dhaka is ahead of UTC at the given instant. */
function dhakaOffsetMs(at: Date): number {
  const w = dhakaWallClock(at);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // formatToParts has no sub-second precision, so compare against a whole second.
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The real instant of a Dhaka wall-clock reading. Out-of-range components are
 * allowed and normalized (month 13 = January of the next year, day 0 = the last
 * day of the previous month), which is what makes the month/year bounds below
 * one-liners. The offset is looked up twice so the result stays correct even if
 * the first guess landed on the far side of an offset change.
 */
function dhakaInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const guess = wall - dhakaOffsetMs(new Date(wall));
  const settled = wall - dhakaOffsetMs(new Date(guess));
  return new Date(settled);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` for the DHAKA calendar day an instant falls in. */
export function dhakaDayKey(date: Date = new Date()): string {
  const w = dhakaWallClock(date);
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
}

/** Midnight (00:00:00.000) in Dhaka on the day the instant falls in. */
export function dhakaMidnight(date: Date = new Date()): Date {
  const w = dhakaWallClock(date);
  return dhakaInstant(w.year, w.month, w.day);
}

/** Last representable instant (23:59:59.999 Dhaka) of that Dhaka day. */
export function dhakaDayEnd(date: Date = new Date()): Date {
  const w = dhakaWallClock(date);
  return new Date(dhakaInstant(w.year, w.month, w.day + 1).getTime() - 1);
}

/** Same wall-clock time N Dhaka days later (negative = earlier). */
export function dhakaAddDays(date: Date, days: number): Date {
  const w = dhakaWallClock(date);
  return dhakaInstant(w.year, w.month, w.day + days, w.hour, w.minute, w.second);
}

/** 0 (Sunday) … 6 (Saturday) for the Dhaka calendar day. */
export function dhakaWeekday(date: Date = new Date()): number {
  const w = dhakaWallClock(date);
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

export function startOfDhakaToday(): Date {
  return dhakaMidnight(new Date());
}

export function endOfDhakaToday(): Date {
  return dhakaDayEnd(new Date());
}

/** Dhaka Sunday → Saturday span (start/end instants + the 7 day-starts). */
export function dhakaWeekBounds(date: Date = new Date()): { start: Date; end: Date; days: Date[] } {
  const start = dhakaAddDays(dhakaMidnight(date), -dhakaWeekday(date));
  const days = Array.from({ length: 7 }, (_, i) => dhakaAddDays(start, i));
  return { start, end: dhakaDayEnd(days[6]), days };
}

/** First instant → last instant of the Dhaka calendar month. */
export function dhakaMonthBounds(date: Date = new Date()): { start: Date; end: Date } {
  const w = dhakaWallClock(date);
  return {
    start: dhakaInstant(w.year, w.month, 1),
    end: new Date(dhakaInstant(w.year, w.month + 1, 1).getTime() - 1),
  };
}

/** First instant → last instant of the Dhaka calendar year. */
export function dhakaYearBounds(date: Date = new Date()): { start: Date; end: Date } {
  const w = dhakaWallClock(date);
  return {
    start: dhakaInstant(w.year, 1, 1),
    end: new Date(dhakaInstant(w.year + 1, 1, 1).getTime() - 1),
  };
}

/**
 * Parse a `YYYY-MM-DD` day key (as typed into a date input) into the Dhaka
 * midnight that opens it. Returns null for anything malformed so a hand-crafted
 * query string can never widen a report window to Invalid Date.
 */
export function dhakaDayStartFromKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = dhakaInstant(year, month, day);
  // Reject a rolled-over date (e.g. 2026-02-31 → 3 March) rather than silently
  // reporting on a day the user did not ask for.
  return dhakaDayKey(start) === `${m[1]}-${m[2]}-${m[3]}` ? start : null;
}

/** Inclusive end (23:59:59.999 Dhaka) of a `YYYY-MM-DD` day key, or null. */
export function dhakaDayEndFromKey(key: string): Date | null {
  const start = dhakaDayStartFromKey(key);
  return start ? dhakaDayEnd(start) : null;
}

// ── Legacy names, now Dhaka-correct ──────────────────────────────────────
// Kept exactly as they were exported so no caller needs editing.

export function startOfToday(): Date {
  return startOfDhakaToday();
}

export function endOfToday(): Date {
  return endOfDhakaToday();
}

/** Dhaka midnight for a given date — the unique key for a duty day. */
export function midnight(date: Date = new Date()): Date {
  return dhakaMidnight(date);
}

export function daysAgo(days: number): Date {
  return dhakaAddDays(startOfDhakaToday(), -days);
}

/** Current Dhaka week's Sunday → Saturday span (aware start/end + 7 day-starts). */
export function weekBounds(): { start: Date; end: Date; days: Date[] } {
  return dhakaWeekBounds();
}

/** `YYYY-MM-DD` bucket key — the DHAKA day, not the UTC one. */
export function isoDate(d: Date): string {
  return dhakaDayKey(d);
}
