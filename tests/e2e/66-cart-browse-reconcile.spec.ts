import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

import { newSession, setLocale, inNightOrderBlackout, NIGHT_BLACKOUT_REASON } from "./helpers";

/**
 * ITEM 1 — the cart's fulfillment branch used to be deaf to "Browsing".
 *
 * Before this fix: cartBranchId was derived ONLY from whatever products were
 * already in the cart; switching the "Browsing" control changed the header and
 * the product grid but never touched an existing cart, so checkout kept
 * checking coverage against the OLD branch while the header said something
 * else. This spec pins the fix: switching Browsing to a branch that conflicts
 * with a non-empty cart now surfaces the same switch/cancel choice an
 * add-conflict already showed, and confirming re-binds the cart (and therefore
 * every coverage/fee check) to the newly browsed branch.
 */

test.beforeEach(async ({ context }) => {
  test.skip(inNightOrderBlackout(), NIGHT_BLACKOUT_REASON);
  await setLocale(context, "en");
});

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

function pointForBranchId(id: number): { lat: number; lng: number } {
  return { lat: 25 + (id % 100) * 0.03, lng: 93 + (Math.floor(id / 100) % 100) * 0.03 };
}

async function setLocation(req: APIRequestContext, point: { lat: number; lng: number }) {
  const res = await req.post("/api/customer/location", {
    data: { lat: point.lat, lng: point.lng, accuracy: 10, captured_at: Date.now() },
  });
  expect(res.status(), "location saved").toBe(200);
}

async function makeBranch(req: APIRequestContext) {
  const res = await req.post("/api/branches/", {
    data: {
      name: uniq("RB"),
      address: "Dhaka",
      phone: "01711111112",
      brand_type: "cheez",
      latitude: "25",
      longitude: "93",
      delivery_radius_km: "1",
    },
  });
  expect(res.status(), "branch created").toBe(201);
  const branch = (await res.json()) as { id: number; name: string };
  const point = pointForBranchId(branch.id);
  const moved = await req.patch(`/api/branches/${branch.id}/`, {
    data: { latitude: String(point.lat), longitude: String(point.lng) },
  });
  expect(moved.status()).toBe(200);
  return { ...branch, point };
}

async function makeProduct(req: APIRequestContext, branchId: number) {
  const cat = await req.post("/api/categories/", {
    data: { name: uniq("RBCat"), branch_id: branchId, is_active: true },
  });
  expect(cat.status()).toBe(201);
  const { id: categoryId } = (await cat.json()) as { id: number };
  const res = await req.post("/api/products/", {
    data: {
      branch_id: branchId,
      name: uniq("RBProd"),
      brand: "cheez",
      category: categoryId,
      is_available: true,
      variations: JSON.stringify([{ name: "Std", price: 199, isDefault: true, isEnabled: true }]),
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: number; name: string };
}

async function addToCartFromHome(page: Page, productName: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const card = page.locator("article", { hasText: productName }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByTestId("card-place-order").click();
  // Adding opens the drawer (openCart()); close it so it does not intercept
  // clicks on the Browsing picker underneath.
  await page.getByTestId("drawer-close").click();
  await expect(page.getByTestId("drawer-checkout-address-step")).toHaveCount(0);
}

test.describe("Cart re-binds to the branch actually being browsed", () => {
  test("confirming the switch clears the cart and re-binds it to the new branch", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const branchA = await makeBranch(admin.req);
    const branchB = await makeBranch(admin.req);
    const productA = await makeProduct(admin.req, branchA.id);
    await admin.context.close();

    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, branchA.point);

    // 1. Add an item from branch A — the cart locks onto it.
    await addToCartFromHome(customer.page, productA.name);
    await expect(customer.page.getByTestId("home-cart-button")).toContainText("1");

    // 2. Switch Browsing to branch B via the picker — the exact user action item 1 reports.
    await customer.page.getByTestId("home-browse-branch").click();
    await customer.page.getByTestId(`browse-branch-${branchB.id}`).click();

    // 3. The reconciliation dialog appears: the cart (branch A) now disagrees
    // with what is being browsed (branch B).
    const dialog = customer.page.getByTestId("branch-switch-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toHaveAttribute("data-switch-kind", "browse");
    await expect(dialog).toContainText(branchB.name);

    // 4. Confirm: the cart is cleared and browsing settles on branch B.
    await customer.page.getByTestId("branch-switch-confirm").click();
    await expect(dialog).toBeHidden();
    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(branchB.name);
    // The cart button shows no badge/count once empty.
    await expect(customer.page.getByTestId("home-cart-button")).not.toContainText("1");

    await customer.context.close();
  });

  test("cancelling the switch keeps the cart and reverts browsing to the cart's branch", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const branchA = await makeBranch(admin.req);
    const branchB = await makeBranch(admin.req);
    const productA = await makeProduct(admin.req, branchA.id);
    await admin.context.close();

    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, branchA.point);

    await addToCartFromHome(customer.page, productA.name);
    await customer.page.getByTestId("home-browse-branch").click();
    await customer.page.getByTestId(`browse-branch-${branchB.id}`).click();

    const dialog = customer.page.getByTestId("branch-switch-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await customer.page.getByTestId("branch-switch-cancel").click();
    await expect(dialog).toBeHidden();

    // Browsing is back on branch A — the branch the cart actually belongs to —
    // and the item is still there; checkout and the header can never disagree.
    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(branchA.name);
    await expect(customer.page.getByTestId("home-cart-button")).toContainText("1");

    await customer.context.close();
  });

  test("switching to a branch that matches the cart never prompts", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const branchA = await makeBranch(admin.req);
    const productA = await makeProduct(admin.req, branchA.id);
    await admin.context.close();

    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, branchA.point);
    await addToCartFromHome(customer.page, productA.name);

    // Explicitly choosing the SAME branch the cart already belongs to.
    await customer.page.getByTestId("home-browse-branch").click();
    await customer.page.getByTestId(`browse-branch-${branchA.id}`).click();
    await customer.page.waitForLoadState("networkidle").catch(() => {});

    await expect(customer.page.getByTestId("branch-switch-dialog")).toHaveCount(0);
    await expect(customer.page.getByTestId("home-cart-button")).toContainText("1");

    await customer.context.close();
  });
});
