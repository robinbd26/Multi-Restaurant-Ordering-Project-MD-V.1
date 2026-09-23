import test from "node:test";
import assert from "node:assert/strict";

import {
  circleShape,
  circleToPolygon,
  parseShape,
  pointInShape,
  serializeShape,
  shapeReachKm,
  shapeWithinRadius,
  type CoverageShape,
} from "../lib/coverage/shape.ts";
import {
  coverageForBranch,
  rankBranchesForPoint,
  type CoverageAreaInput,
} from "../lib/coverage/resolve.ts";
import { isDeliveryPaused, pauseEndsAt } from "../lib/coverage/pause.ts";

/**
 * Focused tests for the rule that decides whether a customer can be delivered
 * to: a pin inside a drawn shape, on the shift running now.
 *
 * The bug that started all of this is the first test: a customer standing right
 * beside the Banani branch was told "not deliverable" because their block was
 * missing from a seeded list of area names. Coverage is geometry now, so the
 * only question is whether the pin is inside the shape.
 *
 * Run with: npm run test:unit
 */

// Real Dhaka coordinates, so a wrong sign or a swapped lat/lng is obvious.
const BANANI = { lat: 23.7936, lng: 90.4066 };
const GULSHAN = { lat: 23.7925, lng: 90.4078 };
const DHANMONDI = { lat: 23.7461, lng: 90.376 };
const UTTARA = { lat: 23.8759, lng: 90.3795 };

/** An area row with sensible defaults, so each test states only what it means. */
function area(over: Partial<CoverageAreaInput> & { id: number; shape: CoverageShape | null }): CoverageAreaInput {
  return {
    isActive: true,
    isHeld: false,
    coverageWindow: "both",
    deliveryCharge: 50,
    estimatedDeliveryMinutes: 40,
    ...over,
    shape: over.shape ? serializeShape(over.shape) : null,
  };
}

// ── shapes ────────────────────────────────────────────────────────────────

test("a pin beside the branch is inside the branch's circle (the Banani bug)", () => {
  // The exact failure that prompted the rewrite: the customer was at the
  // branch's doorstep, and name matching said no.
  const shape = circleShape(BANANI, 3);
  assert.equal(pointInShape({ lat: 23.7937, lng: 90.4067 }, shape), true);
});

test("inside and outside a circle are decided by real distance", () => {
  const shape = circleShape(BANANI, 1);
  assert.equal(pointInShape(GULSHAN, shape), true, "Gulshan is ~150 m away");
  assert.equal(pointInShape(DHANMONDI, shape), false, "Dhanmondi is ~6 km away");
});

test("a polygon contains the points inside it and excludes those outside", () => {
  // A square roughly around Banani.
  const square: CoverageShape = {
    type: "Polygon",
    coordinates: [
      [
        [90.40, 23.79],
        [90.42, 23.79],
        [90.42, 23.80],
        [90.40, 23.80],
        [90.40, 23.79],
      ],
    ],
  };
  assert.equal(pointInShape({ lat: 23.795, lng: 90.41 }, square), true, "centre");
  assert.equal(pointInShape({ lat: 23.785, lng: 90.41 }, square), false, "south of it");
  assert.equal(pointInShape({ lat: 23.795, lng: 90.43 }, square), false, "east of it");
  assert.equal(pointInShape(DHANMONDI, square), false, "another neighbourhood");
});

test("a concave polygon does not cover the bite taken out of it", () => {
  // An L shape: the missing north-east quadrant must not be covered.
  const L: CoverageShape = {
    type: "Polygon",
    coordinates: [
      [
        [90.40, 23.79],
        [90.42, 23.79],
        [90.42, 23.795],
        [90.41, 23.795],
        [90.41, 23.80],
        [90.40, 23.80],
        [90.40, 23.79],
      ],
    ],
  };
  assert.equal(pointInShape({ lat: 23.792, lng: 90.415 }, L), true, "inside the foot");
  assert.equal(pointInShape({ lat: 23.798, lng: 90.405 }, L), true, "inside the upright");
  assert.equal(pointInShape({ lat: 23.798, lng: 90.415 }, L), false, "inside the bite");
});

test("a shape stored as JSON survives the round trip", () => {
  const original = circleShape(GULSHAN, 2.5);
  const parsed = parseShape(serializeShape(original));
  assert.deepEqual(parsed, original);
  const polygon = circleToPolygon(GULSHAN, 2, 8);
  assert.deepEqual(parseShape(serializeShape(polygon)), polygon);
});

test("a ring given without its closing point is still a valid polygon", () => {
  const parsed = parseShape(
    JSON.stringify({ type: "Polygon", coordinates: [[[90.40, 23.79], [90.42, 23.79], [90.42, 23.80]]] }),
  );
  assert.ok(parsed, "an open ring is accepted");
  assert.equal(parsed!.type, "Polygon");
  // It is stored closed, as GeoJSON requires.
  const ring = (parsed as { coordinates: [number, number][][] }).coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test("junk never parses into a shape that could widen coverage", () => {
  for (const junk of [
    null,
    "",
    "not json",
    "{}",
    JSON.stringify({ type: "Point", coordinates: [90.4, 23.8] }),
    JSON.stringify({ type: "Polygon", coordinates: [[[90.4, 23.8], [90.41, 23.8]]] }), // 2 points
    JSON.stringify({ type: "Circle", coordinates: [90.4, 23.8], radiusKm: 0 }),
    JSON.stringify({ type: "Circle", coordinates: [90.4, 23.8], radiusKm: 1e6 }),
    JSON.stringify({ type: "Circle", coordinates: [23.8, 900], radiusKm: 2 }), // off the globe
    JSON.stringify({ type: "Polygon", coordinates: [[["x", "y"], [1, 2], [3, 4]]] }),
  ]) {
    assert.equal(parseShape(junk), null, `rejected: ${String(junk).slice(0, 40)}`);
  }
});

test("a shape may not reach past the branch's maximum radius", () => {
  // The super admin's ceiling. A circle drawn AT the limit is allowed — the
  // editor starts new areas from exactly that circle.
  assert.equal(shapeWithinRadius(circleShape(BANANI, 3), BANANI, 3), true, "exactly at the limit");
  assert.equal(shapeWithinRadius(circleShape(BANANI, 3.5), BANANI, 3), false, "past the limit");
  // An off-centre circle is measured from its far edge, not its centre.
  assert.equal(shapeWithinRadius(circleShape(GULSHAN, 2), BANANI, 3), true);
  assert.equal(shapeWithinRadius(circleShape(DHANMONDI, 2), BANANI, 3), false);
  // A polygon is measured by its furthest vertex.
  assert.equal(shapeWithinRadius(circleToPolygon(BANANI, 2, 24), BANANI, 3), true);
  assert.equal(shapeWithinRadius(circleToPolygon(BANANI, 9, 24), BANANI, 3), false);
});

test("a circle turned into a polygon keeps roughly its reach", () => {
  const reach = shapeReachKm(circleToPolygon(BANANI, 3, 64), BANANI);
  assert.ok(Math.abs(reach - 3) < 0.05, `expected ~3 km, got ${reach}`);
});

// ── one branch ────────────────────────────────────────────────────────────

test("a pin inside an active area is deliverable", () => {
  const result = coverageForBranch(GULSHAN, [area({ id: 1, shape: circleShape(BANANI, 2) })], "day");
  assert.equal(result.status, "deliverable");
  assert.equal(result.reason, "covered");
  assert.equal(result.area?.id, 1);
});

test("a pin outside every area is not covered", () => {
  const result = coverageForBranch(DHANMONDI, [area({ id: 1, shape: circleShape(BANANI, 2) })], "day");
  assert.equal(result.status, "not_covered");
  assert.equal(result.reason, "outside");
});

test("an inactive area covers nobody", () => {
  const result = coverageForBranch(
    GULSHAN,
    [area({ id: 1, shape: circleShape(BANANI, 2), isActive: false })],
    "day",
  );
  assert.equal(result.status, "not_covered");
});

test("an area with no shape drawn yet covers nobody", () => {
  const result = coverageForBranch(GULSHAN, [area({ id: 1, shape: null })], "day");
  assert.equal(result.status, "not_covered");
  assert.equal(result.reason, "no_coverage_configured");
});

test("a night-only area does not cover during the day, and vice versa", () => {
  const night = [area({ id: 1, shape: circleShape(BANANI, 2), coverageWindow: "night" })];
  assert.equal(coverageForBranch(GULSHAN, night, "night").status, "deliverable");
  assert.equal(coverageForBranch(GULSHAN, night, "day").status, "not_covered");

  const day = [area({ id: 2, shape: circleShape(BANANI, 2), coverageWindow: "day" })];
  assert.equal(coverageForBranch(GULSHAN, day, "day").status, "deliverable");
  assert.equal(coverageForBranch(GULSHAN, day, "night").status, "not_covered");

  const allDay = [area({ id: 3, shape: circleShape(BANANI, 2), coverageWindow: "both" })];
  assert.equal(coverageForBranch(GULSHAN, allDay, "day").status, "deliverable");
  assert.equal(coverageForBranch(GULSHAN, allDay, "night").status, "deliverable");
});

test("the right shift's area is chosen when both shifts cover the pin", () => {
  const areas = [
    area({ id: 1, shape: circleShape(BANANI, 2), coverageWindow: "day", deliveryCharge: 40 }),
    area({ id: 2, shape: circleShape(BANANI, 2), coverageWindow: "night", deliveryCharge: 90 }),
  ];
  assert.equal(coverageForBranch(GULSHAN, areas, "day").area?.id, 1);
  assert.equal(coverageForBranch(GULSHAN, areas, "night").area?.id, 2);
});

test("a pin inside only held areas is pickup only", () => {
  const result = coverageForBranch(
    GULSHAN,
    [area({ id: 1, shape: circleShape(BANANI, 2), isHeld: true })],
    "day",
  );
  assert.equal(result.status, "pickup_only");
  assert.equal(result.reason, "area_held");
  assert.equal(result.area, null, "a held area must not price the order");
  assert.equal(result.heldArea?.id, 1, "the held area is reported so the UI can explain");
});

test("a held area never hides a live one that also covers the pin", () => {
  const result = coverageForBranch(
    GULSHAN,
    [
      area({ id: 1, shape: circleShape(BANANI, 2), isHeld: true, deliveryCharge: 10 }),
      area({ id: 2, shape: circleShape(BANANI, 2), deliveryCharge: 80 }),
    ],
    "day",
  );
  assert.equal(result.status, "deliverable");
  assert.equal(result.area?.id, 2, "the cheap held area must not win on price");
});

test("overlapping areas of one branch resolve to the cheapest, then the fastest", () => {
  const cheapest = coverageForBranch(
    GULSHAN,
    [
      area({ id: 1, shape: circleShape(BANANI, 2), deliveryCharge: 80, estimatedDeliveryMinutes: 20 }),
      area({ id: 2, shape: circleShape(GULSHAN, 2), deliveryCharge: 50, estimatedDeliveryMinutes: 60 }),
    ],
    "day",
  );
  assert.equal(cheapest.area?.id, 2, "cheaper wins even though it is slower");

  const fastest = coverageForBranch(
    GULSHAN,
    [
      area({ id: 3, shape: circleShape(BANANI, 2), deliveryCharge: 50, estimatedDeliveryMinutes: 60 }),
      area({ id: 4, shape: circleShape(GULSHAN, 2), deliveryCharge: 50, estimatedDeliveryMinutes: 25 }),
    ],
    "day",
  );
  assert.equal(fastest.area?.id, 4, "same charge, so the quicker one wins");

  const stable = coverageForBranch(
    GULSHAN,
    [
      area({ id: 9, shape: circleShape(BANANI, 2), deliveryCharge: 50, estimatedDeliveryMinutes: 30 }),
      area({ id: 5, shape: circleShape(GULSHAN, 2), deliveryCharge: 50, estimatedDeliveryMinutes: 30 }),
    ],
    "day",
  );
  assert.equal(stable.area?.id, 5, "ties break on the lowest id, so it is repeatable");
});

test("a paused branch is pickup only, and prices nothing", () => {
  const result = coverageForBranch(
    GULSHAN,
    [area({ id: 1, shape: circleShape(BANANI, 2) })],
    "day",
    { deliveryPaused: true },
  );
  assert.equal(result.status, "pickup_only");
  assert.equal(result.reason, "delivery_paused");
  assert.equal(result.area, null);
});

test("pausing a branch does not cover a pin that was never inside it", () => {
  const result = coverageForBranch(
    DHANMONDI,
    [area({ id: 1, shape: circleShape(BANANI, 2) })],
    "day",
    { deliveryPaused: true },
  );
  assert.equal(result.status, "not_covered");
});

// ── across branches ───────────────────────────────────────────────────────

/**
 * A branch at `center` covering everything within `radiusKm` of itself. The
 * default 8 km is wide enough that Banani, Gulshan and Dhanmondi all reach each
 * other, so these tests isolate the RANKING rather than re-testing containment.
 */
const covering = (
  id: number,
  center: { lat: number; lng: number },
  over: Partial<{ openNow: boolean; deliveryPaused: boolean; charge: number; radiusKm: number }> = {},
) => ({
  branchId: id,
  center,
  openNow: over.openNow ?? true,
  deliveryPaused: over.deliveryPaused ?? false,
  areas: [area({ id: id * 100, shape: circleShape(center, over.radiusKm ?? 8), deliveryCharge: over.charge ?? 50 })],
});

test("when several branches cover the pin, the nearest open one is the default", () => {
  // The pin sits in Gulshan; Banani is ~150 m away, Dhanmondi ~6 km.
  const ranked = rankBranchesForPoint(GULSHAN, [covering(1, DHANMONDI), covering(2, BANANI)], "day");
  assert.equal(ranked[0].branchId, 2, "Banani is nearer");
  assert.equal(ranked[0].status, "deliverable");
  // The customer may still switch: the other branch is offered, not dropped.
  assert.equal(ranked[1].branchId, 1);
  assert.equal(ranked[1].status, "deliverable");
});

test("a closed branch loses the default to an open one that also covers", () => {
  const ranked = rankBranchesForPoint(
    GULSHAN,
    [covering(1, BANANI, { openNow: false }), covering(2, DHANMONDI, { openNow: true })],
    "day",
  );
  assert.equal(ranked[0].branchId, 2, "further away, but open now");
  assert.equal(ranked[1].branchId, 1);
  assert.equal(ranked[1].status, "deliverable", "the closed branch still covers the pin");
});

test("a branch that can deliver outranks one that can only hand over", () => {
  const ranked = rankBranchesForPoint(
    GULSHAN,
    [covering(1, BANANI, { deliveryPaused: true }), covering(2, DHANMONDI)],
    "day",
  );
  assert.equal(ranked[0].branchId, 2);
  assert.equal(ranked[0].status, "deliverable");
  assert.equal(ranked[1].status, "pickup_only");
});

test("branches that do not cover the pin sort last, and stay marked as such", () => {
  const ranked = rankBranchesForPoint(UTTARA, [covering(1, BANANI, { radiusKm: 3 }), covering(2, UTTARA)], "day");
  assert.equal(ranked[0].branchId, 2);
  assert.equal(ranked[1].status, "not_covered");
});

test("a branch with no pin still ranks, just last, rather than by a made-up distance", () => {
  const pinless = {
    branchId: 3,
    center: null,
    openNow: true,
    deliveryPaused: false,
    areas: [area({ id: 300, shape: circleShape(GULSHAN, 8) })],
  };
  const ranked = rankBranchesForPoint(GULSHAN, [pinless, covering(1, BANANI)], "day");
  assert.equal(ranked[0].branchId, 1, "the measured branch is first");
  assert.equal(ranked[1].branchId, 3);
  assert.equal(ranked[1].distanceKm, null, "no distance is invented");
  assert.equal(ranked[1].status, "deliverable");
});

// ── delivery pause ────────────────────────────────────────────────────────

test("a pause lapses on its own once its time is up", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  const live = { deliveryPauseMode: "30m", deliveryPausedUntil: new Date("2026-09-23T12:20:00Z") };
  const lapsed = { deliveryPauseMode: "30m", deliveryPausedUntil: new Date("2026-09-23T11:40:00Z") };
  assert.equal(isDeliveryPaused(live, now), true);
  assert.equal(isDeliveryPaused(lapsed, now), false, "no job has to run for it to end");
});

test("an until-resumed pause has no end, and an unset branch is never paused", () => {
  assert.equal(isDeliveryPaused({ deliveryPauseMode: "until_resumed", deliveryPausedUntil: null }), true);
  assert.equal(isDeliveryPaused({ deliveryPauseMode: "", deliveryPausedUntil: null }), false);
  // A mode nothing recognises must not strand the branch on pickup forever.
  assert.equal(isDeliveryPaused({ deliveryPauseMode: "forever", deliveryPausedUntil: null }), false);
});

test("timed pauses end when they say they do", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  assert.equal(pauseEndsAt("30m", now)!.toISOString(), "2026-09-23T12:30:00.000Z");
  assert.equal(pauseEndsAt("1h", now)!.toISOString(), "2026-09-23T13:00:00.000Z");
  assert.equal(pauseEndsAt("until_resumed", now), null);
});

test("a rest-of-shift pause ends on the shift boundary coverage uses", () => {
  // 12:00 UTC is 18:00 in Dhaka — the day shift, which ends at 22:45 Dhaka
  // (16:45 UTC), the same boundary lib/services/coverage-window.ts uses.
  const daytime = pauseEndsAt("shift", new Date("2026-09-23T12:00:00Z"))!;
  assert.equal(daytime.toISOString(), "2026-09-23T16:45:00.000Z");

  // 20:00 UTC is 02:00 in Dhaka — the night shift, which ends at 04:00 Dhaka
  // (22:00 UTC the previous day... i.e. two hours later).
  const nighttime = pauseEndsAt("shift", new Date("2026-09-23T20:00:00Z"))!;
  assert.equal(nighttime.toISOString(), "2026-09-23T22:00:00.000Z");
});
