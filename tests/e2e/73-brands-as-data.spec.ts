import { test, expect, type APIRequestContext } from "@playwright/test";

import { activeZoneId, apiLogin, login } from "./helpers";

/**
 * Brands are data (Part 1 of the brands / hours / statuses round).
 *
 *  - Only the super admin can create, edit, reorder, archive or delete a brand;
 *    a branch manager can READ the list but every write is refused server-side.
 *  - A brand with products cannot be deleted, only archived; an unused one can.
 *  - A new active brand shows up on the storefront with no code change, and a
 *    branch can serve it.
 *  - Products on a single-brand branch are pinned to that brand; a branch
 *    cannot drop a brand it still sells.
 */

const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

async function createBrand(req: APIRequestContext, slug: string, extra: Record<string, string> = {}) {
  return req.post("/api/brands", {
    multipart: { slug, name: `Brand ${slug}`, accent_color: "#3366ff", description: "Test brand", ...extra },
  });
}

test.describe("brands as data", () => {
  test("only the super admin can manage brands; a branch manager can read them", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const bm = await apiLogin(browser, "branch_manager");

    const list = await bm.req.get("/api/brands");
    expect(list.status()).toBe(200);
    const slugs = ((await list.json()) as { results: { slug: string }[] }).results.map((b) => b.slug);
    expect(slugs).toEqual(expect.arrayContaining(["cheez", "madchef"]));

    const slug = uniq("bm");
    expect((await createBrand(bm.req, slug)).status(), "BM cannot create").toBe(403);
    const cheez = ((await (await admin.req.get("/api/brands")).json()) as { results: { id: number; slug: string }[] }).results.find(
      (b) => b.slug === "cheez",
    )!;
    expect((await bm.req.patch(`/api/brands/${cheez.id}`, { data: { name: "Hijacked" } })).status(), "BM cannot edit").toBe(403);
    expect((await bm.req.post(`/api/brands/${cheez.id}/archive`)).status(), "BM cannot archive").toBe(403);
    expect((await bm.req.post("/api/brands/reorder", { data: { ids: [cheez.id] } })).status(), "BM cannot reorder").toBe(403);

    await admin.context.close();
    await bm.context.close();
  });

  test("a new brand appears on the storefront and branches can serve it", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const slug = uniq("nb");
    const res = await createBrand(admin.req, slug, { tagline: "Fresh Tagline" });
    expect(res.status()).toBe(201);
    const brand = (await res.json()) as { id: number; slug: string; accent_foreground: string };
    expect(brand.slug).toBe(slug);
    expect(brand.accent_foreground).toMatch(/^#/);

    // The slug is fixed once created.
    const slugChange = await admin.req.patch(`/api/brands/${brand.id}`, { multipart: { slug: `${slug}x` } });
    expect(slugChange.status()).toBe(400);

    // A branch can serve it, alone.
    const branchRes = await admin.req.post("/api/branches/", {
      data: {
        zone_id: String(await activeZoneId(admin.req)),
        name: uniq("BrandBr"),
        address: "Dhaka",
        phone: "01711119990",
        brands: slug,
        latitude: "23.78",
        longitude: "90.41",
      },
    });
    expect(branchRes.status()).toBe(201);
    const branch = (await branchRes.json()) as { id: number; brands: string[]; brand_type: string };
    expect(branch.brands).toEqual([slug]);
    expect(branch.brand_type).toBe(slug);

    // The guest storefront shows a hero card for every live brand.
    const page = await browser.newPage();
    await page.goto("/");
    await expect(page.getByTestId(`hero-brand-card-${slug}`)).toBeVisible();
    await expect(page.getByTestId(`hero-brand-card-${slug}`)).toContainText("Fresh Tagline");

    // Deactivated → gone from the storefront.
    expect((await admin.req.patch(`/api/brands/${brand.id}`, { data: { is_active: "false" } })).status()).toBe(200);
    await page.goto("/");
    await expect(page.getByTestId(`hero-brand-card-${slug}`)).toHaveCount(0);

    await page.close();
    await admin.context.close();
  });

  test("a brand with products can only be archived; an unused one can be deleted", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");

    const unusedSlug = uniq("un");
    const unused = (await (await createBrand(admin.req, unusedSlug)).json()) as { id: number };
    const usage = (await (await admin.req.get(`/api/brands/${unused.id}/usage`)).json()) as { deletable: boolean };
    expect(usage.deletable).toBe(true);
    expect((await admin.req.delete(`/api/brands/${unused.id}`)).status()).toBe(204);

    // A brand with a product: delete refused, archive allowed.
    const usedSlug = uniq("us");
    const used = (await (await createBrand(admin.req, usedSlug)).json()) as { id: number };
    const branch = (await (
      await admin.req.post("/api/branches/", {
        data: {
          zone_id: String(await activeZoneId(admin.req)),
          name: uniq("UsedBr"),
          address: "Dhaka",
          phone: "01711119990",
          brands: usedSlug,
          latitude: "23.78",
          longitude: "90.41",
        },
      })
    ).json()) as { id: number };
    const product = await admin.req.post("/api/products/", {
      data: {
        branch_id: branch.id,
        name: uniq("UsedProd"),
        // Ignored on a single-brand branch: the product is pinned to its brand.
        brand: "cheez",
        is_available: true,
        price: "100",
      },
    });
    expect(product.status()).toBe(201);
    expect(((await product.json()) as { brand: string }).brand).toBe(usedSlug);

    // The branch cannot drop the brand it still sells.
    const drop = await admin.req.patch(`/api/branches/${branch.id}/`, { multipart: { brands: "cheez" } });
    expect(drop.status()).toBe(400);

    expect((await admin.req.delete(`/api/brands/${used.id}`)).status()).toBe(409);
    const archived = await admin.req.post(`/api/brands/${used.id}/archive`);
    expect(archived.status()).toBe(200);
    expect(((await archived.json()) as { is_archived: boolean }).is_archived).toBe(true);

    // Archiving is logged.
    const logs = (await (await admin.req.get("/api/activity-logs/?page_size=20")).json()) as { results: { description: string }[] };
    expect(logs.results.map((l) => l.description)).toContainEqual(expect.stringContaining(`Archived brand "Brand ${usedSlug}"`));

    await admin.context.close();
  });

  test("the super admin Brands page lists brands and opens the editor", async ({ page }) => {
    await login(page, "super_admin");
    await page.goto("/admin/brands");
    await expect(page.getByTestId("brand-row-cheez")).toBeVisible();
    await expect(page.getByTestId("brand-row-madchef")).toBeVisible();
    await page.getByTestId("brand-new").click();
    await expect(page.getByTestId("brand-form")).toBeVisible();
    await page.getByTestId("brand-name").fill("Spice Route");
    await expect(page.getByTestId("brand-slug")).toHaveValue("spice-route");
  });
});
