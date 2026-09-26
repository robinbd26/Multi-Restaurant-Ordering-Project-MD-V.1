import { test, expect, type APIRequestContext } from "@playwright/test";

import { API_BASE, newSession, setLocale, isDhakaFullClosureWindow, FULL_CLOSURE_REASON, activeZoneId } from "./helpers";

/**
 * PHASE 5 — ONE coupon system.
 *
 *  - scope: branch_id null = platform-wide; set = only that branch's orders;
 *  - one redemption per customer by default (editable), plus an optional total cap;
 *  - a scheduled end AND a manual "End now".
 *
 * ITEM 3 — a branch manager is READ-ONLY: they see which coupons apply to
 * their branch, but create/edit/end/delete are super admin and marketing
 * only. That role restriction is pinned here.
 *
 * Orders are PICKUP at the seeded Main Branch (managed by the seeded
 * branch_manager), so no delivery coverage is involved.
 */

test.beforeEach(async ({ context }) => setLocale(context, "en"));
// ITEM 5 — 04:00–11:00 Dhaka, the whole platform (delivery AND pickup) is
// closed on purpose. Skip an order/quote-touching test rather than fail it.
test.beforeEach(() => {
  test.skip(isDhakaFullClosureWindow(), FULL_CLOSURE_REASON);
});

const uniqCode = (prefix: string) => `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;

interface CouponJson {
  id: number;
  code: string;
  branch_id: number | null;
  branch_name: string | null;
  per_customer_limit: number | null;
  state: string;
  ends_at: string | null;
}

async function mainBranch(admin: APIRequestContext) {
  const branches = (await (await admin.get(`${API_BASE}/api/branches/?search=Main%20Branch&page_size=100`)).json())
    .results as { id: number; name: string }[];
  const main = branches.find((b) => b.name === "Main Branch");
  expect(main, "seeded Main Branch exists").toBeTruthy();
  const products = (await (await admin.get(`${API_BASE}/api/products/?branch_id=${main!.id}&page_size=100`)).json())
    .results as { id: number; is_available: boolean; variation_type?: string }[];
  const product = products.find((p) => p.is_available);
  expect(product, "Main Branch has an orderable product").toBeTruthy();
  return { branchId: main!.id, product: product! };
}

async function otherBranch(admin: APIRequestContext) {
  const res = await admin.post(`${API_BASE}/api/branches/`, {
    multipart: {
      // Branch creation requires a zone (ITEM 7).
      zone_id: String(await activeZoneId(admin)),
      name: `CouponElsewhere ${Date.now()}`,
      address: "Coupon Rd, Dhaka",
      phone: `016${Math.floor(10000000 + Math.random() * 89999999)}`,
      brand_type: "cheez",
    },
  });
  expect(res.status(), "second branch created").toBe(201);
  return ((await res.json()) as { id: number }).id;
}

function pickupOrder(branchId: number, product: { id: number; variation_type?: string }, couponCode: string) {
  const crust = product.variation_type === "THIN" ? "THIN" : "THICK";
  return {
    branch_id: branchId,
    payment_method: "cash",
    delivery_address: "Pickup",
    fulfillment_type: "pickup",
    coupon_code: couponCode,
    items: [{ product_id: product.id, quantity: 1, variation_type: crust }],
  };
}

async function createCoupon(req: APIRequestContext, body: Record<string, unknown>) {
  const res = await req.post(`${API_BASE}/api/marketing/coupons/`, {
    data: { discount_type: "fixed", value: "10", min_order: "0", max_uses: 0, ...body },
  });
  expect(res.status(), `coupon ${String(body.code)} created`).toBe(201);
  return (await res.json()) as CouponJson;
}

test.describe("Coupons — one system", () => {
  test("new coupons default to one use per customer, and the second use is refused", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId, product } = await mainBranch(admin.req);
    const coupon = await createCoupon(admin.req, { code: uniqCode("ONCE") });
    expect(coupon.per_customer_limit, "the default is one per customer").toBe(1);
    expect(coupon.branch_id, "no branch = platform-wide").toBeNull();
    expect(coupon.state).toBe("live");

    const customer = await newSession(browser, "customer");
    const first = await customer.req.post(`${API_BASE}/api/orders/`, { data: pickupOrder(branchId, product, coupon.code) });
    expect(first.status(), "first use works").toBe(201);
    const second = await customer.req.post(`${API_BASE}/api/orders/`, { data: pickupOrder(branchId, product, coupon.code) });
    expect(second.status(), "second use by the same customer is refused").toBe(400);

    // An explicit 0 still means "no per-customer cap".
    const open = await createCoupon(admin.req, { code: uniqCode("OPEN"), per_customer_limit: 0 });
    expect(open.per_customer_limit).toBeNull();

    await admin.context.close();
    await customer.context.close();
  });

  test("a branch coupon only works at its own branch", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId, product } = await mainBranch(admin.req);
    const elsewhere = await otherBranch(admin.req);

    const foreign = await createCoupon(admin.req, { code: uniqCode("ELSE"), branch_id: elsewhere });
    expect(foreign.branch_id).toBe(elsewhere);
    const local = await createCoupon(admin.req, { code: uniqCode("MAIN"), branch_id: branchId });
    expect(local.branch_name).toBe("Main Branch");

    const customer = await newSession(browser, "customer");
    const refused = await customer.req.post(`${API_BASE}/api/orders/`, { data: pickupOrder(branchId, product, foreign.code) });
    expect(refused.status(), "another branch's coupon is refused").toBe(400);
    expect(await refused.text()).toMatch(/not valid at this branch|couponWrongBranch/);

    const accepted = await customer.req.post(`${API_BASE}/api/orders/`, { data: pickupOrder(branchId, product, local.code) });
    expect(accepted.status(), "this branch's coupon works here").toBe(201);

    await admin.context.close();
    await customer.context.close();
  });

  test("End now ends a coupon immediately, and it can no longer be used", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId, product } = await mainBranch(admin.req);
    const coupon = await createCoupon(admin.req, {
      code: uniqCode("STOP"),
      per_customer_limit: 0,
      ends_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    });
    expect(coupon.state).toBe("live");

    const ended = await admin.req.post(`${API_BASE}/api/marketing/coupons/${coupon.id}/end`);
    expect(ended.status()).toBe(200);
    const after = (await ended.json()) as CouponJson;
    expect(after.state).toBe("ended");
    expect(new Date(after.ends_at!).getTime()).toBeLessThanOrEqual(Date.now());

    const customer = await newSession(browser, "customer");
    const refused = await customer.req.post(`${API_BASE}/api/orders/`, { data: pickupOrder(branchId, product, coupon.code) });
    expect(refused.status(), "an ended coupon is refused").toBe(400);

    // A scheduled coupon reports itself as scheduled, and an end before the start is refused.
    const later = await createCoupon(admin.req, {
      code: uniqCode("SOON"),
      starts_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    });
    expect(later.state).toBe("scheduled");
    const backwards = await admin.req.post(`${API_BASE}/api/marketing/coupons/`, {
      data: {
        code: uniqCode("BACK"),
        discount_type: "fixed",
        value: "10",
        starts_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
        ends_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      },
    });
    expect(backwards.status()).toBe(400);

    await admin.context.close();
    await customer.context.close();
  });

  test("a branch manager reads only their own branch's coupons, and cannot write at all", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branchId } = await mainBranch(admin.req);
    const elsewhere = await otherBranch(admin.req);
    const platform = await createCoupon(admin.req, { code: uniqCode("PLAT") });
    const foreign = await createCoupon(admin.req, { code: uniqCode("THEIRS"), branch_id: elsewhere });
    const mine = await createCoupon(admin.req, { code: uniqCode("MINE"), branch_id: branchId });

    const manager = await newSession(browser, "branch_manager");

    // ITEM 3 — read is still scoped to the manager's own branch…
    const list = (await (await manager.req.get(`${API_BASE}/api/marketing/coupons/`)).json()).results as CouponJson[];
    expect(list.every((c) => c.branch_id === branchId), "list is scoped to the manager's branch").toBe(true);
    expect(list.some((c) => c.id === mine.id)).toBe(true);
    expect(list.some((c) => c.id === platform.id || c.id === foreign.id), "no platform/other-branch coupons").toBe(false);
    expect((await manager.req.get(`${API_BASE}/api/marketing/coupons/${mine.id}/`)).status(), "reading their own is fine").toBe(200);

    // …but every write is refused outright, own-branch coupon or not.
    const createAttempt = await manager.req.post(`${API_BASE}/api/marketing/coupons/`, {
      data: { code: uniqCode("NOPE"), discount_type: "fixed", value: "10", min_order: "0", max_uses: 0, branch_id: branchId },
    });
    expect(createAttempt.status(), "cannot create, even for their own branch").toBe(403);
    expect(
      (await manager.req.patch(`${API_BASE}/api/marketing/coupons/${mine.id}/`, { data: { value: "1" } })).status(),
      "cannot edit their own branch's coupon",
    ).toBe(403);
    expect(
      (await manager.req.delete(`${API_BASE}/api/marketing/coupons/${mine.id}/`)).status(),
      "cannot delete their own branch's coupon",
    ).toBe(403);
    expect(
      (await manager.req.post(`${API_BASE}/api/marketing/coupons/${mine.id}/end`)).status(),
      "cannot end their own branch's coupon",
    ).toBe(403);
    // Another branch's / platform-wide coupons: also refused (403, since the
    // write check runs before any scope lookup — never leaks a 404-vs-403 tell).
    for (const other of [platform, foreign]) {
      expect((await manager.req.patch(`${API_BASE}/api/marketing/coupons/${other.id}/`, { data: { value: "1" } })).status()).toBe(403);
      expect((await manager.req.post(`${API_BASE}/api/marketing/coupons/${other.id}/end`)).status()).toBe(403);
    }

    // The page renders read-only: the coupon shows, no Edit/Delete link, no create action.
    await manager.page.goto("/branch-manager/coupons");
    const row = manager.page.getByTestId(`coupon-row-${mine.code}`);
    await expect(row).toBeVisible();
    await expect(manager.page.getByTestId(`coupon-row-${foreign.code}`)).toHaveCount(0);
    await expect(row.getByRole("link", { name: /edit/i })).toHaveCount(0);
    await expect(manager.page.getByRole("link", { name: /new coupon/i })).toHaveCount(0);
    await expect(manager.page.getByTestId("bm-coupon-create")).toHaveCount(0);

    // The old create/edit routes are gone entirely for this role.
    const createPage = await manager.page.goto("/branch-manager/coupons/create");
    expect(createPage?.status(), "the create route no longer exists").toBe(404);

    // Customers still cannot touch the coupon API at all.
    const customer = await newSession(browser, "customer");
    expect((await customer.req.get(`${API_BASE}/api/marketing/coupons/`)).status()).toBe(403);

    await admin.context.close();
    await manager.context.close();
    await customer.context.close();
  });

  test("the coupon form: scope choice for marketing, and super admin's own entry point", async ({ browser }) => {
    const marketing = await newSession(browser, "marketing");
    await marketing.page.goto("/marketing/coupons/create");
    await expect(marketing.page.getByTestId("coupon-scope")).toBeVisible();
    await expect(marketing.page.getByTestId("coupon-per-customer")).toHaveValue("1");
    const code = uniqCode("UIFORM");
    await marketing.page.getByTestId("coupon-code").fill(code);
    await marketing.page.locator('input[name="value"]').fill("15");
    await marketing.page.getByTestId("coupon-save").click();
    await expect(marketing.page).toHaveURL(/\/marketing\/coupons$/);
    const row = marketing.page.getByTestId(`coupon-row-${code}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("coupon-state")).toHaveText(/Live/i);
    await marketing.context.close();

    // Super admin keeps its own full read/write entry point (item 3 only
    // narrows branch_manager; super admin and marketing are unaffected).
    const admin = await newSession(browser, "super_admin");
    await admin.page.goto("/admin/coupons/create");
    await expect(admin.page.getByTestId("coupon-scope")).toBeVisible();
    await admin.context.close();
  });
});
