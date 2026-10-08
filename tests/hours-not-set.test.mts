import test from "node:test";
import assert from "node:assert/strict";

import { brandsWithoutHours, branchOpenFor, channelStatus, type AvailabilityBranch } from "@/lib/hours/availability";

/**
 * "No hours set means closed to customers."
 * Run with: npm run test:unit
 */

const ALL_DAY = JSON.stringify({ everyDay: [{ start: "00:00", end: "00:00", delivery: true, pickup: true }], days: {} });
const NOON = { day: 3, minutes: 12 * 60 }; // Wednesday 12:00 Dhaka

function branch(hoursBySlug: Record<string, string>): AvailabilityBranch {
  return {
    isActive: true,
    isArchived: false,
    isOnHold: false,
    deliveryPauseMode: "",
    deliveryPausedUntil: null,
    brands: Object.entries(hoursBySlug).map(([slug, hours], i) => ({
      hours,
      brand: { id: i + 1, slug, isActive: true, isArchived: false, sortOrder: i },
    })),
  };
}

test("a brand with no hours is closed on both channels, with its own reason", () => {
  const b = branch({ cheez: "" });
  for (const channel of ["delivery", "pickup"] as const) {
    const s = channelStatus(b, "cheez", channel, NOON);
    assert.equal(s.open, false, channel);
    assert.equal(s.reason, "hours_not_set");
    assert.equal(s.configured, false);
    assert.equal(s.opensAt, null, "there is no opening time to promise");
  }
});

test("unreadable hours count as not set, so they close too (never open by accident)", () => {
  for (const raw of ["{broken", JSON.stringify({ days: {} }), "null"]) {
    assert.equal(channelStatus(branch({ cheez: raw }), "cheez", "delivery", NOON).reason, "hours_not_set", raw);
  }
});

test("a brand with hours is decided by them, as before", () => {
  const s = channelStatus(branch({ cheez: ALL_DAY }), "cheez", "delivery", NOON);
  assert.equal(s.open, true);
  assert.equal(s.configured, true);
});

test("one unscheduled brand does not close the other brand at the same branch", () => {
  const b = branch({ cheez: ALL_DAY, madchef: "" });
  assert.equal(branchOpenFor(b, "delivery", NOON), true);
  assert.equal(channelStatus(b, "madchef", "pickup", NOON).open, false);
  assert.deepEqual(brandsWithoutHours(b), ["madchef"]);
});

test("a branch whose only brand has no hours is closed for ordering", () => {
  assert.equal(branchOpenFor(branch({ cheez: "" }), "any", NOON), false);
});

test("inactive brands are not reported as missing hours (customers never see them)", () => {
  const b = branch({ cheez: "", madchef: "" });
  b.brands[1].brand.isActive = false;
  assert.deepEqual(brandsWithoutHours(b), ["cheez"]);
});
