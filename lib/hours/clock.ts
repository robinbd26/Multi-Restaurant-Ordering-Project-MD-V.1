import { APP_TIME_ZONE } from "@/lib/i18n/format";
import type { DhakaMoment } from "@/lib/hours/schedule";

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The Asia/Dhaka wall clock as weekday + minutes since midnight. Every hours
 * decision runs on this — never on the server's own zone (UTC in CI) and never
 * on the visitor's device clock.
 */
export function dhakaMoment(now: Date = new Date()): DhakaMoment {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl may emit "24" for midnight in some engines; fold it back to 0.
  const hours = Number(get("hour")) % 24;
  return { day: WEEKDAY_INDEX[get("weekday")] ?? 0, minutes: hours * 60 + Number(get("minute")) };
}

/** Minutes since midnight on the Asia/Dhaka clock. */
export function nowMinutesInDhaka(now: Date = new Date()): number {
  return dhakaMoment(now).minutes;
}
