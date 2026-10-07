import { toMinutes } from "@/lib/hours/schedule";

/** An opening window, "HH:MM" to "HH:MM" (the end may be after midnight). */
export type Span = { start: string; end: string };

/**
 * Closing times are compared from noon, so 04:00 (after midnight) counts as
 * later than 23:00; opening times from 04:00, so 11:00 counts as earlier than a
 * 22:45 night-shift opening. The business day turns over at 04:00.
 */
export const lateness = (hhmm: string) => (toMinutes(hhmm) - 720 + 1440) % 1440;
export const earliness = (hhmm: string) => (toMinutes(hhmm) - 240 + 1440) % 1440;

/** The widest window covering all of these (earliest start, latest end). */
export function widest(spans: (Span | null | undefined)[]): Span | null {
  const real = spans.filter((s): s is Span => Boolean(s));
  if (!real.length) return null;
  const start = real.map((s) => s.start).sort((a, b) => earliness(a) - earliness(b))[0];
  const end = real.map((s) => s.end).sort((a, b) => lateness(b) - lateness(a))[0];
  return { start, end };
}

/** A window that carries on past midnight (late-night service). */
export const crossesMidnight = (s: Span) => toMinutes(s.end) <= toMinutes(s.start);
