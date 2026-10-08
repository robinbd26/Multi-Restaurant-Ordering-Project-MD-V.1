import test from "node:test";
import assert from "node:assert/strict";

import { customerComplaintRoute, dhakaClock, friendlyDateEn, friendlyOrderDate } from "@/lib/complaints/routing";

/**
 * Customer complaint routing and the order picker's date labels.
 * Run with: npm run test:unit
 */

test("a complaint about an order goes to that order's branch manager, and only that branch", () => {
  assert.deepEqual(customerComplaintRoute({ branchId: 4, branchHasManager: true }), {
    recipientRole: "branch_manager",
    branchId: 4,
  });
});

test("a branch without a manager falls back to the super admin, keeping the branch", () => {
  assert.deepEqual(customerComplaintRoute({ branchId: 4, branchHasManager: false }), {
    recipientRole: "super_admin",
    branchId: 4,
  });
});

test("no order: the super admin, never a broadcast to every branch manager", () => {
  const route = customerComplaintRoute(null);
  assert.equal(route.recipientRole, "super_admin");
  assert.equal(route.branchId, null);
});

// Dhaka is UTC+6. 2026-10-08 14:15 Dhaka = 08:15Z.
const NOW = new Date("2026-10-08T08:15:00Z");

test("dates read Today / Yesterday with a Dhaka clock time", () => {
  assert.equal(friendlyDateEn(friendlyOrderDate(new Date("2026-10-08T08:15:00Z"), NOW)), "Today, 2:15 PM");
  assert.equal(friendlyDateEn(friendlyOrderDate(new Date("2026-10-07T13:00:00Z"), NOW)), "Yesterday, 7:00 PM");
});

test("the Dhaka calendar decides the day, not UTC", () => {
  // 2026-10-07 19:30Z is already 8 Oct 01:30 in Dhaka: that is TODAY there.
  assert.equal(friendlyDateEn(friendlyOrderDate(new Date("2026-10-07T19:30:00Z"), NOW)), "Today, 1:30 AM");
  // 2026-10-07 17:59Z is 7 Oct 23:59 in Dhaka: yesterday.
  assert.equal(friendlyDateEn(friendlyOrderDate(new Date("2026-10-07T17:59:00Z"), NOW)), "Yesterday, 11:59 PM");
});

test("two to six days back reads 'N days ago'; a week or more is a plain date", () => {
  assert.equal(friendlyDateEn(friendlyOrderDate(new Date("2026-10-05T08:00:00Z"), NOW)), "3 days ago");
  assert.equal(friendlyDateEn(friendlyOrderDate(new Date("2026-10-02T08:00:00Z"), NOW)), "6 days ago");
  assert.equal(friendlyDateEn(friendlyOrderDate(new Date("2026-10-01T08:15:00Z"), NOW)), "1 Oct, 2:15 PM");
  assert.equal(friendlyDateEn(friendlyOrderDate(new Date("2026-09-03T08:15:00Z"), NOW)), "3 Sep, 2:15 PM");
});

test("midnight and noon use 12, not 0", () => {
  assert.equal(dhakaClock(new Date("2026-10-07T18:00:00Z")), "12:00 AM");
  assert.equal(dhakaClock(new Date("2026-10-08T06:05:00Z")), "12:05 PM");
});
