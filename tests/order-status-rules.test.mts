import test from "node:test";
import assert from "node:assert/strict";

import {
  managerNextStatuses,
  orderStatusLabelKey,
  overrideTargets,
  riderNextStatuses,
} from "@/lib/constants/orders";

/**
 * The order status flow without a database: who may move an order where. The
 * API-level spec (tests/e2e/75-order-status-flow.spec.ts) checks that the
 * service actually enforces these.
 */

test("on a delivery order the manager stops at Ready for rider", () => {
  assert.deepEqual(managerNextStatuses("pending", "delivery"), ["accepted", "cancelled"]);
  assert.deepEqual(managerNextStatuses("preparing", "delivery"), ["ready", "cancelled"]);
  assert.deepEqual(managerNextStatuses("ready", "delivery"), ["cancelled"], "the rider leg is not the manager's");
  assert.deepEqual(managerNextStatuses("on_the_way", "delivery"), ["cancelled"]);
  assert.deepEqual(managerNextStatuses("delivered", "delivery"), []);
});

test("a pickup order runs to Collected under the manager alone", () => {
  assert.deepEqual(managerNextStatuses("ready", "pickup"), ["delivered", "cancelled"]);
  assert.equal(orderStatusLabelKey("delivered", "pickup"), "orderStatusPickup.delivered");
  assert.equal(orderStatusLabelKey("ready", "pickup"), "orderStatusPickup.ready");
  assert.equal(orderStatusLabelKey("ready", "delivery"), "orderStatusDelivery.ready");
  assert.equal(orderStatusLabelKey("on_the_way", "delivery"), "orderStatus.on_the_way");
  assert.deepEqual(riderNextStatuses("ready", "pickup"), [], "no rider on a pickup order");
});

test("the rider can pick up before Ready and may skip On the way", () => {
  assert.deepEqual(riderNextStatuses("accepted"), ["picked_up"]);
  assert.deepEqual(riderNextStatuses("preparing"), ["picked_up"]);
  assert.deepEqual(riderNextStatuses("picked_up"), ["on_the_way", "delivered", "cancelled", "delayed"]);
  assert.deepEqual(riderNextStatuses("on_the_way"), ["delivered", "cancelled", "delayed"]);
  assert.deepEqual(riderNextStatuses("pending"), [], "nothing before the branch accepts");
  assert.deepEqual(riderNextStatuses("delivered"), []);
});

test("the override reaches any other step of the order's own flow, never back to Pending", () => {
  assert.deepEqual(overrideTargets("on_the_way", "delivery"), [
    "accepted",
    "preparing",
    "ready",
    "picked_up",
    "delivered",
    "cancelled",
  ]);
  assert.deepEqual(overrideTargets("preparing", "pickup"), ["accepted", "ready", "delivered", "cancelled"]);
  assert.deepEqual(overrideTargets("delivered", "delivery"), [], "a delivered order is final");
  assert.deepEqual(overrideTargets("cancelled", "pickup"), []);
});
