/**
 * Customer complaint ROUTING and the order picker's labels, as pure functions
 * (no database, no clock of their own) so the server, the form and the unit
 * tests agree.
 *
 * A customer never chooses who receives their complaint:
 *   - about an order  → the manager of THAT order's branch, and nobody else;
 *   - that branch has no manager assigned → the super admin (the branch is
 *     still recorded, so the complaint keeps its context);
 *   - no order chosen → the super admin (there is no branch to route on, and
 *     broadcasting to every branch manager would reach the wrong people).
 */

export interface RoutableOrder {
  branchId: number;
  /** True when the branch has an active, approved manager right now. */
  branchHasManager: boolean;
}

export interface ComplaintRoute {
  recipientRole: "branch_manager" | "super_admin";
  branchId: number | null;
}

export function customerComplaintRoute(order: RoutableOrder | null): ComplaintRoute {
  if (!order) return { recipientRole: "super_admin", branchId: null };
  if (!order.branchHasManager) return { recipientRole: "super_admin", branchId: order.branchId };
  return { recipientRole: "branch_manager", branchId: order.branchId };
}

// ── friendly order dates (Asia/Dhaka) ─────────────────────────────────────

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6, no daylight saving
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole Dhaka calendar days between two instants (0 = same Dhaka day). */
export function dhakaDaysBetween(earlier: Date, later: Date): number {
  const day = (d: Date) => Math.floor((d.getTime() + DHAKA_OFFSET_MS) / DAY_MS);
  return day(later) - day(earlier);
}

/** "2:15 PM" in Dhaka time. */
export function dhakaClock(date: Date): string {
  const local = new Date(date.getTime() + DHAKA_OFFSET_MS);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export type FriendlyDate =
  | { kind: "today"; time: string }
  | { kind: "yesterday"; time: string }
  | { kind: "daysAgo"; days: number }
  | { kind: "date"; day: number; month: string; time: string };

/**
 * "Today, 2:15 PM" / "Yesterday, 2:15 PM" / "3 days ago" (2 to 6 days) /
 * "3 Oct, 2:15 PM" (a week or more), all on the Dhaka calendar. Returned as
 * parts so each language words it; English wording is in `friendlyDateEn`.
 */
export function friendlyOrderDate(at: Date, now: Date): FriendlyDate {
  const days = dhakaDaysBetween(at, now);
  const time = dhakaClock(at);
  if (days <= 0) return { kind: "today", time };
  if (days === 1) return { kind: "yesterday", time };
  if (days <= 6) return { kind: "daysAgo", days };
  const local = new Date(at.getTime() + DHAKA_OFFSET_MS);
  return { kind: "date", day: local.getUTCDate(), month: MONTHS[local.getUTCMonth()], time };
}

export function friendlyDateEn(d: FriendlyDate): string {
  switch (d.kind) {
    case "today":
      return `Today, ${d.time}`;
    case "yesterday":
      return `Yesterday, ${d.time}`;
    case "daysAgo":
      return `${d.days} days ago`;
    case "date":
      return `${d.day} ${d.month}, ${d.time}`;
  }
}
