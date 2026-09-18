import { test, expect, type APIRequestContext } from "@playwright/test";

import { API_BASE, newSession, setLocale, isDhakaFullClosureWindow, FULL_CLOSURE_REASON } from "./helpers";

/**
 * ITEM 6 — pickup orders get their own shorter status timeline.
 *
 * The 7-step delivery flow (Pending → Accepted → Preparing → Ready → Picked Up
 * → On the Way → Delivered) was built for a rider leg a pickup order never
 * travels. Pickup now renders 5 steps — Pending → Accepted → Preparing →
 * "Ready for Pickup" → "Picked Up (Done)" — on BOTH the branch-manager and the
 * customer order views (one shared component, components/orders/
 * order-detail-card.tsx), with no "assign rider" card and no "on the way" step.
 *
 * Server-side, a pickup order at "ready" may jump straight to "delivered" — its
 * real "Picked Up (Done)" moment — skipping the delivery-only picked_up/
 * on_the_way detour; "delivered" is still what every report already keys a
 * completed sale off, so nothing else needed to change. A DELIVERY order still
 * cannot skip that detour — proven as a regression guard.
 */

test.beforeEach(async ({ context }) => {
  test.skip(isDhakaFullClosureWindow(), FULL_CLOSURE_REASON);
  await setLocale(context, "en");
});


async function mainBranchProduct(req: APIRequestContext) {
  const branches = (await (await req.get(`${API_BASE}/api/branches/?search=Main%20Branch&page_size=100`)).json()).results as {
    id: number;
    name: string;
  }[];
  const main = branches.find((b) => b.name === "Main Branch");
  expect(main, "seeded Main Branch exists").toBeTruthy();
  const products = (await (await req.get(`${API_BASE}/api/products/?branch_id=${main!.id}&page_size=100`)).json())
    .results as { id: number; is_available: boolean; variation_type?: string }[];
  const product = products.find((p) => p.is_available);
  expect(product, "Main Branch has an orderable product").toBeTruthy();
  return { branchId: main!.id, product: product! };
}

function items(product: { id: number; variation_type?: string }) {
  const crust = product.variation_type === "THIN" ? "THIN" : "THICK";
  return [{ product_id: product.id, quantity: 1, variation_type: crust }];
}

async function placePickupOrder(customer: APIRequestContext, branchId: number, product: { id: number; variation_type?: string }) {
  const res = await customer.post(`${API_BASE}/api/orders/`, {
    data: {
      branch_id: branchId,
      payment_method: "cash",
      delivery_address: "Pickup",
      fulfillment_type: "pickup",
      items: items(product),
    },
  });
  expect(res.status(), "pickup order placed").toBe(201);
  return (await res.json()) as { id: number };
}

async function placeDeliveryOrder(customer: APIRequestContext, branchId: number, product: { id: number; variation_type?: string }) {
  const res = await customer.post(`${API_BASE}/api/orders/`, {
    data: {
      branch_id: branchId,
      payment_method: "cash",
      delivery_address: "Test Rd, Dhaka",
      fulfillment_type: "delivery",
      lat: 23.781,
      lng: 90.408,
      items: items(product),
    },
  });
  expect(res.status(), "delivery order placed").toBe(201);
  return (await res.json()) as { id: number };
}

const setStatus = (req: APIRequestContext, id: number, status: string, reason?: string) =>
  req.post(`${API_BASE}/api/orders/${id}/update-status/`, {
    data: { status, ...(reason !== undefined ? { reason } : {}) },
  });

test.describe("Pickup orders skip the delivery-only middle statuses", () => {
  test("a pickup order jumps ready → delivered directly, and it is the branch manager's own action", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId, product } = await mainBranchProduct(admin.req);
    const customer = await newSession(browser, "customer");
    const order = await placePickupOrder(customer.req, branchId, product);

    const manager = await newSession(browser, "branch_manager");
    expect((await setStatus(manager.req, order.id, "accepted")).status()).toBe(200);
    expect((await setStatus(manager.req, order.id, "preparing")).status()).toBe(200);
    expect((await setStatus(manager.req, order.id, "ready")).status()).toBe(200);

    // The shortcut: ready → delivered directly, no picked_up/on_the_way detour.
    const done = await setStatus(manager.req, order.id, "delivered");
    expect(done.status(), "pickup jumps straight to delivered").toBe(200);
    const final = (await done.json()) as { status: string };
    expect(final.status).toBe("delivered");

    await admin.context.close();
    await customer.context.close();
    await manager.context.close();
  });

  test("the old ready → picked_up → on_the_way → delivered path still works (backward compatible)", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId, product } = await mainBranchProduct(admin.req);
    const customer = await newSession(browser, "customer");
    const order = await placePickupOrder(customer.req, branchId, product);

    const manager = await newSession(browser, "branch_manager");
    await setStatus(manager.req, order.id, "accepted");
    await setStatus(manager.req, order.id, "preparing");
    await setStatus(manager.req, order.id, "ready");
    expect((await setStatus(manager.req, order.id, "picked_up")).status(), "the OLD edge is not removed").toBe(200);
    expect((await setStatus(manager.req, order.id, "on_the_way")).status()).toBe(200);
    expect((await setStatus(manager.req, order.id, "delivered")).status()).toBe(200);

    await admin.context.close();
    await customer.context.close();
    await manager.context.close();
  });

  test("a DELIVERY order cannot skip the detour — the shortcut is pickup-only", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId, product } = await mainBranchProduct(admin.req);
    const customer = await newSession(browser, "customer");
    const order = await placeDeliveryOrder(customer.req, branchId, product);

    const manager = await newSession(browser, "branch_manager");
    await setStatus(manager.req, order.id, "accepted");
    await setStatus(manager.req, order.id, "preparing");
    await setStatus(manager.req, order.id, "ready");

    const skip = await setStatus(manager.req, order.id, "delivered");
    expect(skip.status(), "a delivery order still needs the picked_up/on_the_way steps").toBe(409);

    await admin.context.close();
    await customer.context.close();
    await manager.context.close();
  });

  test("branch-manager view: 5-step timeline, pickup wording, no Assign Rider card", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId, product } = await mainBranchProduct(admin.req);
    const customer = await newSession(browser, "customer");
    const order = await placePickupOrder(customer.req, branchId, product);

    const manager = await newSession(browser, "branch_manager");
    await setStatus(manager.req, order.id, "accepted");
    await setStatus(manager.req, order.id, "preparing");
    await setStatus(manager.req, order.id, "ready");

    await manager.page.goto(`/branch-manager/orders/${order.id}`, { waitUntil: "domcontentloaded" });
    const timeline = manager.page.getByTestId("order-status-timeline");
    await expect(timeline).toContainText("Ready for Pickup");
    await expect(timeline).toContainText("Picked Up (Done)");
    await expect(timeline).not.toContainText("On the Way");

    // No rider-assignment card for a pickup order.
    await expect(manager.page.getByText(/assign.*rider/i)).toHaveCount(0);

    // The offered next action reads the pickup wording and completes the order.
    const action = manager.page.getByRole("button", { name: /picked up \(done\)/i });
    await expect(action).toBeVisible();
    await expect(manager.page.getByRole("button", { name: /^on the way$/i })).toHaveCount(0);
    await action.click();
    // Terminal: no further next-status action is offered once delivered.
    await expect(action).toHaveCount(0, { timeout: 10000 });
    await expect(manager.page.getByRole("button", { name: /mark ready|accepted|preparing/i })).toHaveCount(0);

    await admin.context.close();
    await customer.context.close();
    await manager.context.close();
  });

  test("customer view: same 5-step pickup timeline, no rider tracking card", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId, product } = await mainBranchProduct(admin.req);
    const customer = await newSession(browser, "customer");
    const order = await placePickupOrder(customer.req, branchId, product);

    const manager = await newSession(browser, "branch_manager");
    await setStatus(manager.req, order.id, "accepted");
    await setStatus(manager.req, order.id, "preparing");
    await setStatus(manager.req, order.id, "ready");

    await customer.page.goto(`/customer/orders/${order.id}`, { waitUntil: "domcontentloaded" });
    const timeline = customer.page.getByTestId("order-status-timeline");
    await expect(timeline).toContainText("Ready for Pickup");
    await expect(timeline).toContainText("Picked Up (Done)");
    await expect(timeline).not.toContainText("On the Way");
    await expect(customer.page.getByRole("heading", { name: "Track rider" })).toHaveCount(0);

    await admin.context.close();
    await customer.context.close();
    await manager.context.close();
  });

  test("a delivery order still renders the full 7-step timeline, unchanged", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId, product } = await mainBranchProduct(admin.req);
    const customer = await newSession(browser, "customer");
    const order = await placeDeliveryOrder(customer.req, branchId, product);

    const manager = await newSession(browser, "branch_manager");
    await manager.page.goto(`/branch-manager/orders/${order.id}`, { waitUntil: "domcontentloaded" });
    const timeline = manager.page.getByTestId("order-status-timeline");
    await expect(timeline).toContainText("On the Way");
    await expect(timeline).not.toContainText("Ready for Pickup");
    await expect(timeline).not.toContainText("Picked Up (Done)");

    await admin.context.close();
    await customer.context.close();
    await manager.context.close();
  });
});
