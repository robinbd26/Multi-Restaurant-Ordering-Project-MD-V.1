import test from "node:test";
import assert from "node:assert/strict";

import {
  canFlagReview,
  canModerateReviews,
  eligibleOrderFor,
  parseRating,
  reviewListScope,
  summarize,
} from "@/lib/reviews/policy";

/**
 * Product review rules: who may review (eligibility) and who may moderate.
 * Run with: npm run test:unit
 */

const PIZZA = 11;
const BURGER = 22;
const at = (iso: string) => new Date(iso);

// ── eligibility ───────────────────────────────────────────────────────────

test("a delivered (or collected) order containing the product makes it reviewable", () => {
  const orders = [{ id: 1, status: "delivered", at: at("2026-10-01T10:00:00Z"), productIds: [PIZZA] }];
  assert.equal(eligibleOrderFor(orders, PIZZA), 1);
});

test("no finished order with the product: not reviewable", () => {
  const orders = [{ id: 1, status: "delivered", at: at("2026-10-01T10:00:00Z"), productIds: [BURGER] }];
  assert.equal(eligibleOrderFor(orders, PIZZA), null);
  assert.equal(eligibleOrderFor([], PIZZA), null);
});

test("orders that never finished do not count, whatever stage they reached", () => {
  for (const status of ["pending", "accepted", "preparing", "ready", "picked_up", "on_the_way", "cancelled"]) {
    const orders = [{ id: 1, status, at: at("2026-10-01T10:00:00Z"), productIds: [PIZZA] }];
    assert.equal(eligibleOrderFor(orders, PIZZA), null, `${status} must not unlock a review`);
  }
});

test("ordering again points the review at the newest finished order", () => {
  const orders = [
    { id: 1, status: "delivered", at: at("2026-10-01T10:00:00Z"), productIds: [PIZZA] },
    { id: 7, status: "delivered", at: at("2026-10-05T10:00:00Z"), productIds: [PIZZA, BURGER] },
    { id: 9, status: "cancelled", at: at("2026-10-06T10:00:00Z"), productIds: [PIZZA] },
  ];
  assert.equal(eligibleOrderFor(orders, PIZZA), 7);
});

test("a rating must be a whole number from 1 to 5", () => {
  assert.equal(parseRating(5), 5);
  assert.equal(parseRating("3"), 3);
  for (const bad of [0, 6, 2.5, "x", null, undefined, -1]) assert.equal(parseRating(bad), null, String(bad));
});

// ── moderation permissions ────────────────────────────────────────────────

test("only marketing and the super admin hide or restore reviews", () => {
  assert.equal(canModerateReviews("marketing"), true);
  assert.equal(canModerateReviews("super_admin"), true);
  for (const role of ["branch_manager", "customer", "rider", "accounts", "management"]) {
    assert.equal(canModerateReviews(role), false, role);
  }
});

test("a branch manager flags only reviews of their own branch's products", () => {
  assert.equal(canFlagReview("branch_manager", 3, 3), true);
  assert.equal(canFlagReview("branch_manager", 3, 4), false, "another branch");
  assert.equal(canFlagReview("branch_manager", null, 3), false, "no branch assigned");
  assert.equal(canFlagReview("marketing", 3, 3), false, "marketing hides; it does not flag");
  assert.equal(canFlagReview("customer", 3, 3), false);
});

test("the list scope: moderators see all, a manager their branch, others nothing", () => {
  assert.deepEqual(reviewListScope("marketing", null), { kind: "all" });
  assert.deepEqual(reviewListScope("super_admin", null), { kind: "all" });
  assert.deepEqual(reviewListScope("branch_manager", 5), { kind: "branch", branchId: 5 });
  assert.deepEqual(reviewListScope("branch_manager", null), { kind: "none" });
  assert.deepEqual(reviewListScope("customer", null), { kind: "none" });
});

test("the summary averages to one decimal and breaks down by star", () => {
  const s = summarize([5, 5, 4, 1]);
  assert.equal(s.count, 4);
  assert.equal(s.average, 3.8);
  assert.deepEqual(s.breakdown, { 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 });
  assert.deepEqual(summarize([]), { average: 0, count: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
});
