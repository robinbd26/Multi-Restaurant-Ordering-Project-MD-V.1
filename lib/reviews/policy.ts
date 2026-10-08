/**
 * Product review RULES, as pure functions (no database, no clock), so the
 * service, the API and the unit tests all run the same decision.
 *
 * Eligibility: a customer may review a product when they have at least one
 * order containing it that reached Delivered, or Collected for pickup (both are
 * stored as "delivered"). One review per customer per product; they edit it.
 *
 * Moderation:
 *   - marketing and super admin hide / restore any review;
 *   - a branch manager sees their own branch's reviews and may FLAG one for
 *     marketing, but never hide or restore;
 *   - everyone else (customers, riders, accounts, management) moderates nothing.
 */

/** Order statuses that make the products in an order reviewable. */
export const REVIEWABLE_ORDER_STATUSES: readonly string[] = ["delivered"];

export const REVIEW_COMMENT_MAX = 1000;
export const REVIEW_REASON_MAX = 200;

export interface EligibilityOrder {
  id: number;
  status: string;
  /** When the order reached its final state (or was placed); newest wins. */
  at: Date;
  productIds: readonly number[];
}

/**
 * The order that makes this product reviewable for this customer: the most
 * recent finished order containing it, or null when there is none.
 */
export function eligibleOrderFor(orders: readonly EligibilityOrder[], productId: number): number | null {
  let best: EligibilityOrder | null = null;
  for (const order of orders) {
    if (!REVIEWABLE_ORDER_STATUSES.includes(order.status)) continue;
    if (!order.productIds.includes(productId)) continue;
    if (!best || order.at.getTime() > best.at.getTime() || (order.at.getTime() === best.at.getTime() && order.id > best.id)) {
      best = order;
    }
  }
  return best?.id ?? null;
}

/** Only marketing and the super admin hide or restore reviews. */
export function canModerateReviews(role: string): boolean {
  return role === "marketing" || role === "super_admin";
}

/** Who may open the reviews list, and for which branches. */
export function reviewListScope(
  role: string,
  managerBranchId: number | null,
): { kind: "all" } | { kind: "branch"; branchId: number } | { kind: "none" } {
  if (canModerateReviews(role)) return { kind: "all" };
  if (role === "branch_manager" && managerBranchId != null) return { kind: "branch", branchId: managerBranchId };
  return { kind: "none" };
}

/** A branch manager may flag a review of their OWN branch's product. */
export function canFlagReview(role: string, managerBranchId: number | null, reviewBranchId: number | null): boolean {
  return role === "branch_manager" && managerBranchId != null && reviewBranchId === managerBranchId;
}

/** Valid star rating: an integer 1..5. */
export function parseRating(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** Average to one decimal and a 5..1 breakdown, from visible ratings only. */
export function summarize(ratings: readonly number[]): { average: number; count: number; breakdown: Record<1 | 2 | 3 | 4 | 5, number> } {
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  let total = 0;
  for (const r of ratings) {
    if (r >= 1 && r <= 5) {
      breakdown[r as 1 | 2 | 3 | 4 | 5] += 1;
      total += r;
    }
  }
  const count = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { average: count ? Math.round((total / count) * 10) / 10 : 0, count, breakdown };
}
