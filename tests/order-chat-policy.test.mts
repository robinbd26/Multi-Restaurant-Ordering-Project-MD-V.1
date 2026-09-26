import test from "node:test";
import assert from "node:assert/strict";

import {
  CHAT_READ_ONLY_AFTER_MS,
  chatAccessFor,
  chatReadOnlyAt,
  deliveryContactActive,
  isChatReadOnly,
  orderPhoneVisibility,
  type ChatOrderFacts,
  type DeliveryContactFacts,
} from "@/lib/order-chat/policy";

/**
 * The order chat's permission rules, without a database: who may read and post,
 * when the chat closes, and when the customer and the rider see each other's
 * numbers. The API-level spec (tests/e2e/72-order-chat.spec.ts) checks that the
 * routes actually apply these.
 *
 * Run with: npm run test:unit
 */

const CUSTOMER = 10;
const MANAGER = 20;
const RIDER = 30;
const OTHER_RIDER = 31;

const delivery: ChatOrderFacts = { customerId: CUSTOMER, riderId: RIDER, fulfillmentType: "delivery", branchManagerId: MANAGER };

test("chat access: the three participants read and write", () => {
  assert.deepEqual(chatAccessFor({ id: CUSTOMER, role: "customer" }, delivery), { role: "customer", canWrite: true });
  assert.deepEqual(chatAccessFor({ id: MANAGER, role: "branch_manager" }, delivery), { role: "branch_manager", canWrite: true });
  assert.deepEqual(chatAccessFor({ id: RIDER, role: "rider" }, delivery), { role: "rider", canWrite: true });
});

test("chat access: super admin observes and cannot write", () => {
  assert.deepEqual(chatAccessFor({ id: 1, role: "super_admin" }, delivery), { role: "observer", canWrite: false });
});

test("chat access: everyone else is refused", () => {
  assert.equal(chatAccessFor({ id: 99, role: "customer" }, delivery), null, "another customer");
  assert.equal(chatAccessFor({ id: 21, role: "branch_manager" }, delivery), null, "another branch's manager");
  assert.equal(chatAccessFor({ id: OTHER_RIDER, role: "rider" }, delivery), null, "a rider who is not (or no longer) assigned");
  for (const role of ["management", "accounts", "marketing"]) {
    assert.equal(chatAccessFor({ id: 50, role }, delivery), null, role);
  }
});

test("chat access: a replaced rider loses access as soon as the order names someone else", () => {
  const reassigned = { ...delivery, riderId: OTHER_RIDER };
  assert.equal(chatAccessFor({ id: RIDER, role: "rider" }, reassigned), null);
  assert.deepEqual(chatAccessFor({ id: OTHER_RIDER, role: "rider" }, reassigned), { role: "rider", canWrite: true });
  assert.equal(chatAccessFor({ id: RIDER, role: "rider" }, { ...delivery, riderId: null }), null, "unassigned");
});

test("chat access: a pickup order never admits a rider, even if one is recorded", () => {
  const pickup = { ...delivery, fulfillmentType: "pickup" };
  assert.equal(chatAccessFor({ id: RIDER, role: "rider" }, pickup), null);
  assert.deepEqual(chatAccessFor({ id: CUSTOMER, role: "customer" }, pickup), { role: "customer", canWrite: true });
});

test("chat access: the manager role alone is not enough; it must be this branch's manager", () => {
  assert.equal(chatAccessFor({ id: MANAGER, role: "branch_manager" }, { ...delivery, branchManagerId: null }), null);
  // Same id but a different role (e.g. the account was changed to a rider) is not the manager.
  assert.equal(chatAccessFor({ id: MANAGER, role: "rider" }, delivery), null);
});

test("read-only: open while the order runs, writable until exactly 2 hours after it ends", () => {
  const ended = new Date("2026-09-26T10:00:00Z");
  assert.equal(isChatReadOnly(null), false, "order still open");
  assert.equal(isChatReadOnly(ended, new Date(ended.getTime() + CHAT_READ_ONLY_AFTER_MS - 1)), false, "1 ms before");
  assert.equal(isChatReadOnly(ended, new Date(ended.getTime() + CHAT_READ_ONLY_AFTER_MS)), true, "at 2 h");
  assert.equal(isChatReadOnly(ended, new Date(ended.getTime() + 3 * 3600_000)), true, "after");
  assert.equal(chatReadOnlyAt(ended)?.toISOString(), "2026-09-26T12:00:00.000Z");
  assert.equal(chatReadOnlyAt(null), null);
});

const active: DeliveryContactFacts = {
  fulfillmentType: "delivery",
  status: "on_the_way",
  riderId: RIDER,
  latestAssignment: { riderId: RIDER, status: "accepted" },
};

test("phones: shared only while an accepted delivery is in flight", () => {
  assert.equal(deliveryContactActive(active), true);
  for (const status of ["accepted", "preparing", "ready", "picked_up", "on_the_way", "delayed"]) {
    assert.equal(deliveryContactActive({ ...active, status }), true, status);
  }
  for (const status of ["pending", "delivered", "cancelled"]) {
    assert.equal(deliveryContactActive({ ...active, status }), false, status);
  }
});

test("phones: a pending, rejected or superseded offer is not an active delivery", () => {
  for (const status of ["pending", "rejected", "superseded"]) {
    assert.equal(deliveryContactActive({ ...active, latestAssignment: { riderId: RIDER, status } }), false, status);
  }
  assert.equal(deliveryContactActive({ ...active, latestAssignment: null }), false, "no offer on record");
});

test("phones: the acceptance must belong to the current rider", () => {
  assert.equal(
    deliveryContactActive({ ...active, riderId: OTHER_RIDER, latestAssignment: { riderId: RIDER, status: "accepted" } }),
    false,
  );
});

test("phones: never on pickup or unassigned orders", () => {
  assert.equal(deliveryContactActive({ ...active, fulfillmentType: "pickup" }), false);
  assert.equal(deliveryContactActive({ ...active, riderId: null }), false);
});

test("phone visibility per viewer", () => {
  const order = { ...active, customerId: CUSTOMER };
  const ended = { ...order, status: "delivered" };

  assert.deepEqual(orderPhoneVisibility({ id: CUSTOMER, role: "customer" }, order), { customerPhone: true, riderPhone: true, payerPhone: true });
  assert.deepEqual(orderPhoneVisibility({ id: CUSTOMER, role: "customer" }, ended), { customerPhone: true, riderPhone: false, payerPhone: true });

  assert.deepEqual(orderPhoneVisibility({ id: RIDER, role: "rider" }, order), { customerPhone: true, riderPhone: true, payerPhone: false });
  assert.deepEqual(orderPhoneVisibility({ id: RIDER, role: "rider" }, ended), { customerPhone: false, riderPhone: true, payerPhone: false });
  // A rider looking at an order that is not theirs (the unassigned pool).
  assert.deepEqual(
    orderPhoneVisibility({ id: OTHER_RIDER, role: "rider" }, { ...order, riderId: null, latestAssignment: null }),
    { customerPhone: false, riderPhone: false, payerPhone: false },
  );

  for (const role of ["branch_manager", "super_admin", "management", "accounts"]) {
    assert.deepEqual(orderPhoneVisibility({ id: MANAGER, role }, ended), { customerPhone: true, riderPhone: true, payerPhone: true }, role);
  }
});
