import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";

import { API_BASE, apiLogin, branchIdByName, setLocale } from "./helpers";

/**
 * Order status flow with rider-controlled statuses (Part 3 of the brands /
 * hours / statuses round). Server-side enforcement, via the API:
 *
 *  - delivery: the branch manager drives Pending → Accepted → Preparing → Ready
 *    for rider; Picked up / On the way / Delivered belong to the assigned rider;
 *  - the old "Cannot move from On the Way" bug: a stale manager screen re-sending
 *    On the way is now refused as not-yours (403), and the rider re-sending it is
 *    a harmless no-op (200), never a 409;
 *  - a rider may tap Picked up before Ready (it counts as Ready), and be assigned
 *    from Accepted on (not before);
 *  - Override status: manager / super admin only, reason required, logged;
 *  - pickup: the manager runs it to Collected (stored as delivered).
 */

type Session = { context: BrowserContext; req: APIRequestContext };
const opened: Session[] = [];
// Orders a test placed, and a super admin session to tidy them up with: an
// order a failed test leaves open (say at Picked up) would keep the e2e rider
// "on a delivery" and block every later spec that takes them off duty.
const placed: number[] = [];
let tidyReq: APIRequestContext | null = null;
async function login(browser: Browser, username: string): Promise<Session> {
  const s = await apiLogin(browser, username);
  await setLocale(s.context, "en");
  opened.push(s);
  return s;
}
test.afterEach(async () => {
  while (tidyReq && placed.length) {
    const id = placed.pop()!;
    const status = ((await (await tidyReq.get(`${API_BASE}/api/orders/${id}/status`)).json()) as { status: string }).status;
    if (status !== "delivered" && status !== "cancelled") {
      await tidyReq.post(`${API_BASE}/api/orders/${id}/override-status`, { data: { status: "cancelled", reason: "e2e cleanup" } });
    }
  }
  placed.length = 0;
  tidyReq = null;
  while (opened.length) await opened.pop()!.context.close();
});

async function placeOrder(customer: APIRequestContext, branchId: number, kind: "delivery" | "pickup"): Promise<number> {
  const products = (await (await customer.get(`${API_BASE}/api/products/?branch_id=${branchId}&page_size=100`)).json())
    .results as { id: number; is_available: boolean; variation_type?: string }[];
  const product = products.find((p) => p.is_available)!;
  const res = await customer.post(`${API_BASE}/api/orders/`, {
    data: {
      branch_id: branchId,
      payment_method: "cash",
      delivery_address: kind === "pickup" ? "Pickup" : "Flow Test Rd, Dhaka",
      fulfillment_type: kind,
      ...(kind === "delivery" ? { lat: 23.781, lng: 90.408 } : {}),
      items: [{ product_id: product.id, quantity: 1, variation_type: product.variation_type === "THIN" ? "THIN" : "THICK" }],
    },
  });
  expect(res.status(), `${kind} order placed: ${await res.text()}`).toBe(201);
  const id = (await res.json()).id as number;
  placed.push(id);
  return id;
}

const setStatus = (req: APIRequestContext, id: number, status: string, reason?: string) =>
  req.post(`${API_BASE}/api/orders/${id}/update-status/`, { data: { status, ...(reason ? { reason } : {}) } });
const override = (req: APIRequestContext, id: number, status: string, reason: string) =>
  req.post(`${API_BASE}/api/orders/${id}/override-status`, { data: { status, reason } });
const assign = (req: APIRequestContext, id: number, riderId: number | null) =>
  req.post(`${API_BASE}/api/orders/${id}/assign-rider`, { data: { rider_id: riderId } });
const statusOf = async (req: APIRequestContext, id: number) =>
  ((await (await req.get(`${API_BASE}/api/orders/${id}/status`)).json()) as { status: string }).status;

async function onDutyAt(rider: APIRequestContext, branchId: number) {
  const current = (await (await rider.get(`${API_BASE}/api/rider/duty`)).json()).active_session?.branch ?? null;
  if (current === branchId) return;
  if (current !== null) await rider.post(`${API_BASE}/api/rider/duty/end`, { data: {} });
  expect((await rider.post(`${API_BASE}/api/rider/duty/start`, { data: { branch_id: branchId } })).status()).toBe(201);
}

async function setup(browser: Browser) {
  const customer = await login(browser, "customer");
  const bm = await login(browser, "branch_manager");
  const rider = await login(browser, "rider");
  const admin = await login(browser, "super_admin");
  tidyReq = admin.req;
  const branchId = await branchIdByName(admin.req, "Main Branch");
  const riderId = ((await (await rider.req.get(`${API_BASE}/api/auth/me`)).json()) as { id: number }).id;
  return { customer, bm, rider, admin, branchId, riderId };
}

test.describe("Order status flow", () => {
  test("delivery: the manager stops at Ready for rider; the rider leg is the rider's alone", async ({ browser }) => {
    const { customer, bm, rider, branchId, riderId } = await setup(browser);
    const id = await placeOrder(customer.req, branchId, "delivery");

    // No rider before the branch accepts.
    await onDutyAt(rider.req, branchId);
    expect((await assign(bm.req, id, riderId)).status(), "no rider while pending").toBe(409);

    for (const s of ["accepted", "preparing"]) expect((await setStatus(bm.req, id, s)).status(), s).toBe(200);
    // Assigned while the food is being prepared, so the rider can head over.
    expect((await assign(bm.req, id, riderId)).status()).toBe(200);
    expect((await setStatus(bm.req, id, "ready")).status()).toBe(200);

    // The manager may not set the rider statuses.
    for (const s of ["picked_up", "on_the_way", "delivered"]) {
      expect((await setStatus(bm.req, id, s)).status(), `BM ${s}`).toBe(403);
    }
    // The customer cannot either.
    expect((await setStatus(customer.req, id, "delivered")).status()).toBe(403);

    expect((await setStatus(rider.req, id, "picked_up")).status()).toBe(200);

    // THE "Cannot move from On the Way" BUG. Before: the manager's page offered
    // "Mark On the way" too, so manager and rider raced on the same step. Now
    // the manager cannot set it at all (403, with a clear message)...
    const managerMove = await setStatus(bm.req, id, "on_the_way");
    expect(managerMove.status()).toBe(403);
    expect(JSON.stringify(await managerMove.json())).toMatch(/assigned rider/i);

    expect((await setStatus(rider.req, id, "on_the_way")).status()).toBe(200);
    // ...and a stale screen re-sending the CURRENT status — the exact request
    // that used to answer 409 "Cannot move from On the Way to this status" — is
    // a harmless no-op now, for the manager and for the rider's double tap.
    expect((await setStatus(bm.req, id, "on_the_way")).status(), "stale manager screen").toBe(200);
    expect((await setStatus(rider.req, id, "on_the_way")).status(), "rider double tap").toBe(200);
    expect(await statusOf(customer.req, id)).toBe("on_the_way");

    // A delay is an announcement: the status stays On the way.
    const delay = await rider.req.post(`${API_BASE}/api/orders/${id}/update-status/`, {
      data: { status: "delayed", delay_minutes: 15, reason: "Traffic" },
    });
    expect(delay.status()).toBe(200);
    expect(await statusOf(customer.req, id)).toBe("on_the_way");

    expect((await setStatus(rider.req, id, "delivered")).status()).toBe(200);
    expect(await statusOf(bm.req, id)).toBe("delivered");
  });

  test("the rider can pick up before the manager taps Ready; it counts as Ready", async ({ browser }) => {
    const { customer, bm, rider, branchId, riderId } = await setup(browser);
    const id = await placeOrder(customer.req, branchId, "delivery");
    expect((await setStatus(bm.req, id, "accepted")).status()).toBe(200);
    await onDutyAt(rider.req, branchId);
    expect((await assign(bm.req, id, riderId)).status()).toBe(200);

    expect((await setStatus(rider.req, id, "picked_up")).status(), "not blocked by a missing Ready tap").toBe(200);
    const order = (await (await bm.req.get(`${API_BASE}/api/orders/${id}/`)).json()) as {
      status: string;
      status_events: { from_status: string; to_status: string }[];
    };
    expect(order.status).toBe("picked_up");
    expect(order.status_events.map((e) => e.to_status)).toEqual(expect.arrayContaining(["ready", "picked_up"]));
    // Straight to Delivered without On the way is allowed too.
    expect((await setStatus(rider.req, id, "delivered")).status()).toBe(200);
  });

  test("override: manager or super admin only, written reason required, logged", async ({ browser }) => {
    const { customer, bm, rider, admin, branchId, riderId } = await setup(browser);
    const id = await placeOrder(customer.req, branchId, "delivery");
    for (const s of ["accepted", "preparing", "ready"]) await setStatus(bm.req, id, s);
    await onDutyAt(rider.req, branchId);
    await assign(bm.req, id, riderId);
    await setStatus(rider.req, id, "picked_up");

    expect((await override(rider.req, id, "delivered", "Rider phone died")).status(), "not the rider").toBe(403);
    expect((await override(customer.req, id, "delivered", "Rider phone died")).status(), "not the customer").toBe(403);
    expect((await override(bm.req, id, "delivered", "x")).status(), "reason required").toBe(400);
    expect((await override(bm.req, id, "pending", "Back to the start")).status(), "never back to Pending").toBe(409);

    const ok = await override(bm.req, id, "delivered", "Rider phone died at the door");
    expect(ok.status()).toBe(200);
    expect(await statusOf(customer.req, id)).toBe("delivered");
    // Final once delivered.
    expect((await override(admin.req, id, "on_the_way", "Change of mind here")).status()).toBe(409);

    const logs = (await (await admin.req.get(`${API_BASE}/api/activity-logs/?page_size=20`)).json()) as {
      results: { description: string; manager_username: string }[];
    };
    const entry = logs.results.find((l) => l.description.includes("Rider phone died at the door"));
    expect(entry, "override logged").toBeTruthy();
    expect(entry!.manager_username).toBe("branch_manager");
    expect(entry!.description).toMatch(/picked_up → delivered/);
  });

  test("pickup: the manager runs it to Collected, with no rider", async ({ browser }) => {
    const { customer, bm, rider, branchId, riderId } = await setup(browser);
    const id = await placeOrder(customer.req, branchId, "pickup");
    for (const s of ["accepted", "preparing", "ready", "delivered"]) {
      expect((await setStatus(bm.req, id, s)).status(), s).toBe(200);
    }
    expect(await statusOf(customer.req, id)).toBe("delivered");
    const another = await placeOrder(customer.req, branchId, "pickup");
    await setStatus(bm.req, another, "accepted");
    expect((await assign(bm.req, another, riderId)).status(), "pickup orders have no rider").toBe(400);
    expect((await setStatus(rider.req, another, "picked_up")).status()).toBe(403);
  });
});
