import { test, expect, type APIRequestContext } from "@playwright/test";

import {
  login,
  newSession,
  setLocale,
  isDhakaFullClosureWindow,
  FULL_CLOSURE_REASON,
  NOT_CLOSED_REASON,
} from "./helpers";

/**
 * ITEM 5 — 04:00–11:00 Dhaka: the whole platform is closed. No branch takes a
 * new order, delivery or pickup, whatever that branch's own opening hours say
 * — most seeded/fixture branches have none configured, which previously made
 * them orderable around the clock. Browsing and adding to cart stay open the
 * whole time; only PLACING an order is blocked, both server-side
 * (resolveBranchForCart, the single choke point quote AND order share) and in
 * the checkout drawer (a proactive banner, reusing the outside-delivery-area
 * visual pattern, rather than only a failed request after the fact).
 *
 * Time-dependent by nature: the tests below run for real only inside/outside
 * the actual window and skip themselves (with a printed reason) otherwise,
 * the same convention 57/63/etc. use for the night cutoff.
 */

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

async function branchWithProduct(req: APIRequestContext) {
  const branchRes = await req.post(`/api/branches/`, {
    data: {
      name: uniq("ClosureBr"),
      address: "Dhaka",
      phone: "01711119990",
      brand_type: "combined",
      latitude: "23.78",
      longitude: "90.41",
      delivery_radius_km: "50",
      pickup_enabled: "true",
    },
  });
  expect(branchRes.status()).toBe(201);
  const branch = (await branchRes.json()) as { id: number; name: string };
  const cat = await req.post(`/api/categories/`, { data: { name: uniq("ClosureCat"), branch_id: branch.id, is_active: true } });
  const { id: categoryId } = (await cat.json()) as { id: number };
  const productRes = await req.post(`/api/products/`, {
    data: {
      branch_id: branch.id,
      name: uniq("ClosureProd"),
      brand: "cheez",
      category: categoryId,
      is_available: true,
      variations: JSON.stringify([{ name: "Std", price: 150, isDefault: true, isEnabled: true }]),
    },
  });
  const product = (await productRes.json()) as { id: number; name: string };
  return { branch, product };
}

test.describe("Platform closure, 04:00–11:00 Dhaka", () => {
  test("both delivery and pickup are refused, at a branch with no hours configured", async ({ browser }) => {
    test.skip(!isDhakaFullClosureWindow(), NOT_CLOSED_REASON);
    const admin = await newSession(browser, "super_admin");
    const { branch, product } = await branchWithProduct(admin.req);

    const customer = await newSession(browser, "qa_upload_2");
    const setLoc = await customer.req.post(`/api/customer/location`, {
      data: { lat: 23.78, lng: 90.41, accuracy: 10, captured_at: Date.now() },
    });
    expect(setLoc.status()).toBe(200);

    const pickup = await customer.req.post(`/api/orders/`, {
      data: {
        branch_id: branch.id,
        payment_method: "cash",
        delivery_address: "Pickup",
        fulfillment_type: "pickup",
        items: [{ product_id: product.id, quantity: 1 }],
      },
    });
    expect(pickup.status(), "pickup refused during closure").toBe(400);

    const deliveryQuote = await customer.req.post(`/api/delivery/quote/`, {
      data: { branch_id: branch.id, fulfillment_type: "delivery", lat: 23.78, lng: 90.41, items: [{ product_id: product.id, quantity: 1 }] },
    });
    expect(deliveryQuote.status(), "delivery quote refused during closure").toBe(400);

    await admin.context.close();
    await customer.context.close();
  });

  test("browsing and adding to cart still work during closure", async ({ browser }) => {
    test.skip(!isDhakaFullClosureWindow(), NOT_CLOSED_REASON);
    const admin = await newSession(browser, "super_admin");
    const { product } = await branchWithProduct(admin.req);
    await admin.context.close();

    const context = await browser.newContext();
    await setLocale(context, "en");
    const page = await context.newPage();
    await login(page, "qa_upload_2");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.locator("article", { hasText: product.name }).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByTestId("card-place-order").click();
    await expect(page.getByTestId("home-cart-button")).toContainText("1");
    await context.close();
  });

  for (const [tag, width] of [["desktop", 1280], ["mobile", 390]] as const) {
    test(`checkout shows the closed notice and blocks both buttons (${tag})`, async ({ browser }) => {
      test.skip(!isDhakaFullClosureWindow(), NOT_CLOSED_REASON);
      const admin = await newSession(browser, "super_admin");
      const { product } = await branchWithProduct(admin.req);
      await admin.context.close();

      const mobile = width < 600;
      const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
      await setLocale(context, "en");
      const page = await context.newPage();
      await login(page, "qa_upload_2");
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const card = page.locator("article", { hasText: product.name }).first();
      await expect(card).toBeVisible({ timeout: 15000 });
      await card.getByTestId("card-place-order").click();

      await expect(page.getByTestId("drawer-platform-closed")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("place-an-order")).toBeDisabled();
      await expect(page.getByTestId("self-pickup")).toBeDisabled();

      await context.close();
    });
  }

  test("outside the window, a pickup order at an otherwise-eligible branch is unaffected", async ({ browser }) => {
    test.skip(isDhakaFullClosureWindow(), FULL_CLOSURE_REASON);
    const admin = await newSession(browser, "super_admin");
    const { branch, product } = await branchWithProduct(admin.req);

    const customer = await newSession(browser, "qa_upload_2");
    const pickup = await customer.req.post(`/api/orders/`, {
      data: {
        branch_id: branch.id,
        payment_method: "cash",
        delivery_address: "Pickup",
        fulfillment_type: "pickup",
        items: [{ product_id: product.id, quantity: 1 }],
      },
    });
    expect(pickup.status(), "pickup works outside the closure window").toBe(201);

    await admin.context.close();
    await customer.context.close();
  });
});
