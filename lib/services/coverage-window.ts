import { nowMinutesInDhaka } from "@/lib/hours/clock";
import type { CoverageWindow } from "@/lib/constants/enums";

/**
 * THE day/night shift boundary for DELIVERY COVERAGE.
 *
 * Operations runs two coverage lists per branch: the day list from 11:00 to
 * 22:45 and the night list from 22:45 through 04:00. When orders are actually
 * accepted (last-order times, which channels) is each brand's own schedule.
 *
 * DELIBERATELY SEPARATE FROM OPENING HOURS. lib/hours/availability.ts answers
 * "can this brand at this branch take an order right now?" from each brand's
 * own schedule at that branch. This module answers a different
 * question — "which coverage list applies right now?" — and nothing here decides
 * whether a branch is open. A branch can therefore be open while having no
 * coverage configured for the active window, which is a real state the UI has to
 * explain rather than hide.
 *
 * The handoff is gap-free by decision: the night window begins the moment the day
 * window ends, so there is never a minute with no active list. If operations later
 * wants a gap between shifts, changing NIGHT_START_MINUTES is the whole edit.
 */

/** 11:00 — the day list takes over. */
export const DAY_START_MINUTES = 11 * 60;
/** 22:45 — the day list ends and the night list takes over, with no gap. */
export const NIGHT_START_MINUTES = 22 * 60 + 45;
/** 04:00 — the night list ends; deliveries must be completed by now. */
export const NIGHT_END_MINUTES = 4 * 60;

/**
 * The coverage list that applies at a given wall-clock minute.
 *
 * Night spans midnight, so it is the union of [22:45, 24:00) and [00:00, 04:00).
 * Everything else — including the quiet stretch between 04:00 and 11:00, when no
 * shift is running — resolves to "day", so the day list is what a customer
 * browses before opening time. Whether ordering is open in that stretch is the
 * brands' schedules' decision, not this function's.
 */
export function coverageWindowAt(minutes: number): Exclude<CoverageWindow, "both"> {
  if (minutes >= NIGHT_START_MINUTES || minutes < NIGHT_END_MINUTES) return "night";
  return "day";
}

/** The coverage list that applies right now, in the app's timezone (Asia/Dhaka). */
export function currentCoverageWindow(now: Date = new Date()): Exclude<CoverageWindow, "both"> {
  return coverageWindowAt(nowMinutesInDhaka(now));
}

/**
 * Does a coverage row apply in the given window? A row marked "both" always does.
 * This is the one place that rule lives, so a query filter and an in-memory check
 * can never disagree about it.
 */
export function coverageAppliesIn(rowWindow: string, active: Exclude<CoverageWindow, "both">): boolean {
  return rowWindow === "both" || rowWindow === active;
}
