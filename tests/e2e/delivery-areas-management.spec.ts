import { expect, test } from "@playwright/test";

import { apiLogin, branchMap, setLocale } from "./helpers";

/**
 * Delivery areas: ONE area per branch (reviews-complaints-addresses round).
 * The super admin sees one row per branch and edits any branch's area on a
 * full-width page; a branch manager edits only their own, on a single page.
 */
test.describe("Delivery area management (one area per branch)", () => {
  test("admin list: one row per branch, no area-name field, no horizontal overflow", async ({ browser }) => {
    const { context } = await apiLogin(browser, "super_admin");
    await setLocale(context, "en");
    const page = await context.newPage();

    await page.goto("/admin/delivery-areas", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Delivery Areas", level: 1 })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Area name" })).toHaveCount(0);
    const list = page.getByTestId("area-branch-list");
    await expect(list).toBeVisible();
    await expect(list.getByRole("link", { name: /edit area|draw area/i }).first()).toBeVisible();

    for (const width of [320, 375, 414, 768, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        `horizontal overflow at ${width}px`,
      ).toBeLessThanOrEqual(1);
    }
    await context.close();
  });

  test("GET applies trimmed server search and returns pagination metadata", async ({ browser }) => {
    const { context, req } = await apiLogin(browser, "super_admin");
    const response = await req.get("/api/delivery-areas?search=%20no-such-area-9f67a%20&page=2");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ count: 0, page: 1, page_size: 20, results: [] });
    expect(body.summary).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
      held: expect.any(Number),
      inactive: expect.any(Number),
    });
    await context.close();
  });

  test("super admin edits a branch's area on the full-width page, with a live km radius, and holds/resumes it", async ({ browser }) => {
    const { context, req } = await apiLogin(browser, "super_admin");
    await setLocale(context, "en");
    const page = await context.newPage();
    const main = (await branchMap(req))["Main Branch"];
    const areas = await (await req.get(`/api/delivery-areas?branch_id=${main}&page_size=10`)).json();
    expect(areas.results).toHaveLength(1);
    const area = areas.results[0] as { id: number };

    await page.goto(`/admin/delivery-areas/${area.id}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("delivery-area-editor")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Area name" })).toHaveCount(0);
    await expect(page.getByTestId("shape-editor-radius-value")).toContainText(/km radius/);

    await page.getByRole("spinbutton", { name: /delivery time/i }).fill("41");
    await page.getByTestId("delivery-area-save").click();
    await expect(page.getByText("Delivery area saved.")).toBeVisible();
    const after = await (await req.get(`/api/delivery-areas?branch_id=${main}&page_size=10`)).json();
    expect(after.results[0].estimated_delivery_minutes).toBe(41);

    await page.getByTestId("delivery-area-hold").click();
    await expect(page.getByTestId("delivery-area-resume")).toBeVisible();
    await page.getByTestId("delivery-area-resume").click();
    await expect(page.getByTestId("delivery-area-hold")).toBeVisible();

    // /new for a branch that already has its area goes to editing it.
    await page.goto(`/admin/delivery-areas/new?branch=${main}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`/admin/delivery-areas/${area.id}/edit$`));
    await context.close();
  });

  test("branch manager: own branch only; old routes redirect; foreign writes are refused", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const manager = await apiLogin(browser, "branch_manager");
    await setLocale(manager.context, "en");
    const page = await manager.context.newPage();

    const own = await (await manager.req.get("/api/delivery-areas?page_size=100")).json();
    expect(own.results.length).toBe(1);
    const ownArea = own.results[0] as { id: number; branch: number; branch_name: string };
    const spoofed = await (await manager.req.get("/api/delivery-areas?branch=999999&page_size=100")).json();
    expect(spoofed.results.map((a: { id: number }) => a.id)).toEqual([ownArea.id]);

    await page.goto("/branch-manager/delivery-areas", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(ownArea.branch_name);
    for (const old of ["/branch-manager/delivery-areas/new", `/branch-manager/delivery-areas/${ownArea.id}/edit`]) {
      await page.goto(old, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/branch-manager\/delivery-areas$/);
    }

    const all = await (await admin.req.get("/api/delivery-areas?page_size=100")).json();
    const foreign = (all.results as { id: number; branch: number }[]).find((a) => a.branch !== ownArea.branch);
    if (foreign) {
      expect((await manager.req.patch(`/api/delivery-areas/${foreign.id}/`, { data: { delivery_charge: "1" } })).status()).toBe(403);
      expect((await manager.req.post(`/api/delivery-areas/${foreign.id}/exclusions`, { data: { shape: "{}" } })).status()).toBe(403);
    }
    await admin.context.close();
    await manager.context.close();
  });
});
