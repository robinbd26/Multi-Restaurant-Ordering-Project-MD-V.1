import { test, expect, type APIRequestContext } from "@playwright/test";

import { activeZoneId, apiLogin, archiveBranch, branchMap, openBranchAllDay } from "./helpers";

/**
 * Reviews, complaints and delivery areas round (server rules, API level):
 *
 *  - review eligibility: only a customer with a Delivered/Collected order
 *    containing the product may review it; one review per product, edited
 *    afterwards; the public payload never carries private customer data;
 *  - review moderation: marketing / super admin hide and restore, a branch
 *    manager may only flag; hidden reviews leave the rating;
 *  - complaint routing: a customer's complaint goes to the manager of the
 *    selected order's branch only; no manager there, or no order → super admin;
 *  - no hours set → the brand is closed to customers;
 *  - one delivery area per branch, and a temporary block that turns delivery
 *    into pickup-only for pins inside it until removed.
 */

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

// Fresh branches sit far from every Dhaka fixture (so they never become another
// spec's nearest branch) and are archived after each test.
const FAR = { lat: 22.35, lng: 91.8 };
const created: number[] = [];
test.afterEach(async ({ browser }) => {
  if (!created.length) return;
  const admin = await apiLogin(browser, "super_admin");
  for (const id of created.splice(0)) await archiveBranch(admin.req, id);
  await admin.context.close();
});

async function product(admin: APIRequestContext, branchId: number, brand = "madchef") {
  const res = await admin.post("/api/products/", {
    data: { branch_id: branchId, name: uniq(`Rv-${brand}`), brand, is_available: true, price: "150" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: number };
}

const pickupOrder = (customer: APIRequestContext, branchId: number, productId: number) =>
  customer.post("/api/orders/", {
    data: {
      branch_id: branchId,
      payment_method: "cash",
      delivery_address: "Pickup",
      fulfillment_type: "pickup",
      items: [{ product_id: productId, quantity: 1, variation_type: "THICK" }],
    },
  });

/** A new branch with no manager. Hours are NOT set unless `open` is true. */
async function newBranch(admin: APIRequestContext, open: boolean) {
  const res = await admin.post("/api/branches/", {
    data: {
      zone_id: String(await activeZoneId(admin)),
      name: uniq("RCA"),
      address: "Dhaka",
      phone: "01711119991",
      brands: "madchef",
      latitude: String(FAR.lat),
      longitude: String(FAR.lng),
      pickup_enabled: "true",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const branch = (await res.json()) as { id: number; name: string };
  created.push(branch.id);
  if (open) await openBranchAllDay(admin, branch.id, ["madchef"]);
  return branch;
}

test.describe("reviews, complaints and delivery areas", () => {
  test("review eligibility, one review per product, and no private data in public", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const bm = await apiLogin(browser, "branch_manager");
    const customer = await apiLogin(browser, "customer");
    const main = (await branchMap(admin.req))["Main Branch"];
    const dish = await product(admin.req, main);

    const review = (rating: number, comment: string) =>
      customer.req.post(`/api/products/${dish.id}/reviews`, { multipart: { rating: String(rating), comment } });

    // Not ordered yet → refused.
    expect((await review(5, "never had it")).status()).toBe(403);

    // Ordered but not finished → still refused.
    const placed = await pickupOrder(customer.req, main, dish.id);
    expect(placed.status(), await placed.text()).toBe(201);
    const order = (await placed.json()) as { id: number };
    expect((await review(5, "too early")).status()).toBe(403);

    // Collected (pickup run to the end by the manager) → allowed.
    for (const status of ["accepted", "preparing", "ready", "delivered"]) {
      const res = await bm.req.post(`/api/orders/${order.id}/update-status`, { data: { status } });
      expect(res.status(), `${status}: ${await res.text()}`).toBe(200);
    }
    const first = await review(4, "Good");
    expect(first.status()).toBe(201);
    const created = (await first.json()) as { id: number };

    // A second submit edits the same review instead of adding one.
    const second = await review(5, "Even better the second time");
    expect(second.status()).toBe(200);
    expect(((await second.json()) as { id: number }).id).toBe(created.id);

    // Invalid rating is refused.
    expect((await review(6, "x")).status()).toBe(400);

    // Public read works logged out and shows only public fields.
    const anon = await browser.newContext();
    const pub = await (await anon.request.get(`/api/products/${dish.id}/reviews`)).json();
    expect(pub.summary).toMatchObject({ count: 1, average: 5 });
    const row = pub.results[0];
    expect(row.comment).toBe("Even better the second time");
    expect(Object.keys(row.author).sort()).toEqual(["avatar_url", "first_name"]);
    const text = JSON.stringify(pub);
    expect(text).not.toMatch(/@example\.com|01711111111|customer_id|"email"|"phone"/);
    await anon.close();

    await Promise.all([admin.context.close(), bm.context.close(), customer.context.close()]);
  });

  test("moderation: marketing and super admin hide/restore; a branch manager only flags", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const bm = await apiLogin(browser, "branch_manager");
    const marketing = await apiLogin(browser, "marketing");
    const customer = await apiLogin(browser, "customer");
    const main = (await branchMap(admin.req))["Main Branch"];
    const dish = await product(admin.req, main);
    const order = (await (await pickupOrder(customer.req, main, dish.id)).json()) as { id: number };
    for (const status of ["accepted", "preparing", "ready", "delivered"]) {
      await bm.req.post(`/api/orders/${order.id}/update-status`, { data: { status } });
    }
    const posted = await customer.req.post(`/api/products/${dish.id}/reviews`, { multipart: { rating: "1", comment: "spam spam" } });
    expect(posted.status()).toBe(201);
    const { id } = (await posted.json()) as { id: number };
    const count = async () =>
      ((await (await customer.req.get(`/api/products/${dish.id}/reviews`)).json()) as { summary: { count: number } }).summary.count;
    expect(await count()).toBe(1);

    // Who may not.
    expect((await bm.req.post(`/api/reviews/${id}/hide`, { data: { reason: "bm" } })).status()).toBe(403);
    expect((await customer.req.post(`/api/reviews/${id}/hide`, { data: {} })).status()).toBe(403);
    expect((await marketing.req.post(`/api/reviews/${id}/flag`, { data: {} })).status()).toBe(403);
    expect((await customer.req.post(`/api/reviews/${id}/flag`, { data: {} })).status()).toBe(403);

    // The branch's own manager flags; marketing sees it in the flagged filter list (service).
    expect((await bm.req.post(`/api/reviews/${id}/flag`, { data: { reason: "looks like spam" } })).status()).toBe(200);

    // Marketing hides: it leaves the public list and the rating.
    expect((await marketing.req.post(`/api/reviews/${id}/hide`, { data: { reason: "spam" } })).status()).toBe(200);
    expect(await count()).toBe(0);
    // A hidden review's photo/avatar routes answer 404 to the public.
    const anon = await browser.newContext();
    expect((await anon.request.get(`/api/reviews/${id}/photos/0`)).status()).toBe(404);
    await anon.close();

    // Super admin restores it.
    expect((await admin.req.post(`/api/reviews/${id}/restore`, {})).status()).toBe(200);
    expect(await count()).toBe(1);

    // Hide and restore are in the Activity Logs.
    const logs = (await (await admin.req.get(`/api/activity-logs/?page_size=50`)).json()) as { results: { description: string }[] };
    const texts = logs.results.map((l) => l.description);
    expect(texts).toContainEqual(expect.stringContaining(`Hid review #${id}`));
    expect(texts).toContainEqual(expect.stringContaining(`Restored review #${id}`));

    await Promise.all([admin.context.close(), bm.context.close(), marketing.context.close(), customer.context.close()]);
  });

  test("complaints from customers go only to the order's branch manager", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const customer = await apiLogin(browser, "customer");
    const main = (await branchMap(admin.req))["Main Branch"];
    const mainOrder = (await (await pickupOrder(customer.req, main, (await product(admin.req, main)).id)).json()) as { id: number };

    const file = (data: Record<string, unknown>) =>
      customer.req.post("/api/complaints/", {
        data: { category: "rider_behavior", subject: uniq("Subj"), message: "details", ...data },
      });

    // About a Main Branch order: its manager, even if the client asks for someone else.
    const toMain = await file({ order_id: mainOrder.id, recipient_role: "marketing" });
    expect(toMain.status(), await toMain.text()).toBe(201);
    expect(await toMain.json()).toMatchObject({ recipient_role: "branch_manager", branch: main, category: "rider_behavior" });

    // A branch with no manager: the super admin, branch kept.
    const lonely = await newBranch(admin.req, true);
    const lonelyOrder = await pickupOrder(customer.req, lonely.id, (await product(admin.req, lonely.id)).id);
    expect(lonelyOrder.status(), await lonelyOrder.text()).toBe(201);
    const toAdmin = await file({ order_id: ((await lonelyOrder.json()) as { id: number }).id });
    expect(await toAdmin.json()).toMatchObject({ recipient_role: "super_admin", branch: lonely.id });

    // No order: the super admin, never every branch manager.
    const noOrder = await file({});
    expect(await noOrder.json()).toMatchObject({ recipient_role: "super_admin", branch: null });

    await Promise.all([admin.context.close(), customer.context.close()]);
  });

  test("no hours set means the brand takes no orders until hours are added", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const customer = await apiLogin(browser, "customer");
    const branch = await newBranch(admin.req, false);
    const dish = await product(admin.req, branch.id);

    const closed = await pickupOrder(customer.req, branch.id, dish.id);
    expect(closed.status()).toBe(400);
    // Names the brand (the wording follows the session language).
    expect(await closed.text()).toContain("Madchef");
    const status = await (await customer.req.get(`/api/branches/${branch.id}/availability`)).json();
    expect(status.brands[0].pickup).toMatchObject({ open: false, reason: "hours_not_set" });

    await openBranchAllDay(admin.req, branch.id, ["madchef"]);
    expect((await pickupOrder(customer.req, branch.id, dish.id)).status()).toBe(201);

    await Promise.all([admin.context.close(), customer.context.close()]);
  });

  test("one delivery area per branch; a temporary block makes its pins pickup only until removed", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const customer = await apiLogin(browser, "customer");
    const branch = await newBranch(admin.req, true);
    const circle = (km: number) => JSON.stringify({ type: "Circle", coordinates: [FAR.lng, FAR.lat], radiusKm: km });

    const first = await admin.req.post("/api/delivery-areas/", { data: { branch_id: branch.id, shape: circle(2), delivery_charge: "50", estimated_delivery_minutes: 40 } });
    expect(first.status(), await first.text()).toBe(201);
    const area = (await first.json()) as { id: number; name: string };
    expect(area.name).toBe(branch.name);
    // Saving again updates the same area: a branch never gets a second one.
    const again = await admin.req.post("/api/delivery-areas/", { data: { branch_id: branch.id, shape: circle(2.5) } });
    expect(again.status()).toBe(200);
    expect(((await again.json()) as { id: number }).id).toBe(area.id);

    const check = async () =>
      (await (await customer.req.post("/api/delivery/address-coverage", { data: { branch_id: branch.id, lat: FAR.lat, lng: FAR.lng } })).json()) as {
        covered: boolean;
        status: string;
        reason: string;
        hold_reason: string;
      };
    expect((await check()).covered).toBe(true);

    const block = await admin.req.post(`/api/delivery-areas/${area.id}/exclusions`, {
      data: { shape: JSON.stringify({ type: "Circle", coordinates: [FAR.lng, FAR.lat], radiusKm: 0.3 }), reason: "Road closed" },
    });
    expect(block.status(), await block.text()).toBe(201);
    const blocked = await check();
    // This endpoint groups every pickup-only cause as "on_hold"; the reason text
    // is the block's own.
    expect(blocked).toMatchObject({ covered: false, status: "pickup_only", reason: "on_hold", hold_reason: "Road closed" });

    // An end time in the past is refused.
    expect(
      (
        await admin.req.post(`/api/delivery-areas/${area.id}/exclusions`, {
          data: { shape: circle(0.2), ends_at: new Date(Date.now() - 60_000).toISOString() },
        })
      ).status(),
    ).toBe(400);

    // Removing the block restores delivery exactly.
    const { id: blockId } = (await block.json()) as { id: number };
    expect((await admin.req.delete(`/api/delivery-areas/${area.id}/exclusions/${blockId}`)).status()).toBe(200);
    expect((await check()).covered).toBe(true);

    await Promise.all([admin.context.close(), customer.context.close()]);
  });
});
