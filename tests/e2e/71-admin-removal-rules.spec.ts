import { test, expect, type APIRequestContext } from "@playwright/test";

import { newSession, API_BASE, activeZoneId, branchMap } from "./helpers";

/**
 * The admin removal rule: ANYTHING WITH HISTORY IS ARCHIVED, ONLY PURE SETUP
 * IS DELETED, and every delete and archive lands in Activity Logs.
 * (Branches are covered in 45-branch-sequential-delete.)
 */

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function logged(req: APIRequestContext, type: "archive" | "delete", needle: string): Promise<boolean> {
  const body = await (await req.get(`${API_BASE}/api/activity-logs/?activity_type=${type}&page_size=30`)).json();
  return ((body.results ?? []) as { description: string }[]).some((r) => r.description.includes(needle));
}

test.describe("delivery zones", () => {
  test("an unused zone is deleted and logged; a zone in use is refused with its branches named", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");

    const unused = await (await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: uniq("TmpZone") } })).json();
    expect((await admin.req.delete(`${API_BASE}/api/area-zones/${unused.id}`)).status()).toBe(204);
    expect(await logged(admin.req, "delete", unused.name)).toBe(true);

    const used = await (await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: uniq("UsedZone") } })).json();
    const branchName = uniq("ZoneUser");
    const branch = await admin.req.post(`${API_BASE}/api/branches/`, {
      multipart: {
        name: branchName,
        address: "Zone Rd, Dhaka",
        phone: `015${Math.floor(10000000 + Math.random() * 89999999)}`,
        brand_type: "cheez",
        zone_id: String(used.id),
      },
    });
    expect(branch.status(), "branch created in the new zone").toBe(201);
    const refused = await admin.req.delete(`${API_BASE}/api/area-zones/${used.id}`);
    expect(refused.status(), "zone in use → 409").toBe(409);
    expect(await refused.text(), "the refusal names the branch to reassign").toContain(branchName);

    // The dialog lists the branch and offers no delete.
    await admin.page.goto("/admin/delivery-zones");
    await admin.page.getByTestId(`zone-delete-${used.id}`).click();
    await expect(admin.page.getByTestId(`zone-delete-branches-${used.id}`)).toContainText(branchName);
    await expect(admin.page.getByRole("button", { name: /delete zone/i })).toBeDisabled();

    // Clean up: the test branch has no history, so it can go, then the zone.
    const b = await branch.json();
    await admin.req.post(`${API_BASE}/api/branches/${b.id}/permanent-delete`, { data: { confirm_name: branchName } });
    expect((await admin.req.delete(`${API_BASE}/api/area-zones/${used.id}`)).status()).toBe(204);
    await admin.context.close();
  });

  test("deactivating a zone is logged as an archive; only a super admin can delete", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const zone = await (await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: uniq("ArchZone") } })).json();
    expect((await admin.req.patch(`${API_BASE}/api/area-zones/${zone.id}`, { data: { is_active: false } })).status()).toBe(200);
    expect(await logged(admin.req, "archive", zone.name)).toBe(true);
    const bm = await newSession(browser, "branch_manager");
    expect((await bm.req.delete(`${API_BASE}/api/area-zones/${zone.id}`)).status()).toBe(403);
    expect((await admin.req.delete(`${API_BASE}/api/area-zones/${zone.id}`)).status()).toBe(204);
    await admin.context.close();
    await bm.context.close();
  });
});

test.describe("user accounts", () => {
  test("an account with orders cannot be deleted, only deactivated; a fresh one can be deleted", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const users = (await (await admin.req.get(`${API_BASE}/api/auth/users/?search=customer&page_size=50`)).json()).results as {
      id: number;
      username: string;
    }[];
    const customer = users.find((u) => u.username === "customer");
    expect(customer, "the seeded customer (who has orders) exists").toBeTruthy();
    const refused = await admin.req.delete(`${API_BASE}/api/auth/users/${customer!.id}/`);
    expect(refused.status(), "history → 409").toBe(409);
    expect(await refused.text()).toMatch(/deactivate/i);
    expect((await admin.req.get(`${API_BASE}/api/auth/users/${customer!.id}/`)).status(), "still there").toBe(200);

    const username = uniq("fresh").toLowerCase().replace(/[^a-z0-9]/g, "");
    const created = await admin.req.post(`${API_BASE}/api/auth/users/`, {
      multipart: {
        username,
        email: `${username}@example.test`,
        first_name: "Fresh",
        last_name: "User",
        phone: `016${Math.floor(10000000 + Math.random() * 89999999)}`,
        role: "marketing",
        password: "Admin12345@##",
      },
    });
    expect(created.status(), "fresh account created").toBeLessThan(300);
    const fresh = await created.json();
    expect((await admin.req.delete(`${API_BASE}/api/auth/users/${fresh.id}/`)).status()).toBe(204);
    expect(await logged(admin.req, "delete", username)).toBe(true);
    await admin.context.close();
  });
});

test.describe("marketing campaigns", () => {
  test("a never-sent campaign is deleted and the delete is logged", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const title = uniq("TmpCampaign");
    const now = Date.now();
    const created = await admin.req.post(`${API_BASE}/api/marketing/campaigns/`, {
      data: {
        title,
        type: "promotion",
        starts_at: new Date(now).toISOString(),
        ends_at: new Date(now + 86_400_000).toISOString(),
      },
    });
    expect(created.status(), "campaign created").toBeLessThan(300);
    const campaign = await created.json();
    const res = await admin.req.delete(`${API_BASE}/api/marketing/campaigns/${campaign.id}/`);
    expect(res.status()).toBe(200);
    expect((await res.json()).action).toBe("deleted");
    expect(await logged(admin.req, "delete", title)).toBe(true);
    await admin.context.close();
  });
});

test.describe("products", () => {
  async function mainBranchId(req: APIRequestContext): Promise<number> {
    // Searched by name: the list is newest first, so a busy test.db can push
    // Main Branch past any fixed page.
    const { results } = await (await req.get(`${API_BASE}/api/branches/?search=Main%20Branch&page_size=100`)).json();
    return (results as { id: number; name: string }[]).find((b) => b.name === "Main Branch")!.id;
  }
  async function makeProduct(req: APIRequestContext, branchId: number) {
    const res = await req.post(`${API_BASE}/api/products/`, {
      multipart: {
        branch_id: String(branchId),
        name: uniq("RmProd"),
        brand: "cheez",
        variations: JSON.stringify([{ name: "Regular", price: 150, isDefault: true, isEnabled: true }]),
      },
    });
    expect(res.status(), "product created").toBe(201);
    return (await res.json()) as { id: number; name: string };
  }

  test("archive → Archived filter → restore (comes back unavailable) → permanent delete, all logged", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const product = await makeProduct(admin.req, await mainBranchId(admin.req));

    // Archive (the soft delete).
    expect((await admin.req.delete(`${API_BASE}/api/products/${product.id}/`)).status()).toBe(200);
    expect(await logged(admin.req, "archive", product.name)).toBe(true);

    // Hidden from the default list, shown under Archived with Restore.
    await admin.page.goto(`/admin/products?search=${encodeURIComponent(product.name)}`);
    await expect(admin.page.getByTestId("responsive-table").getByText(product.name)).toHaveCount(0);
    await admin.page.goto(`/admin/products?status=archived&search=${encodeURIComponent(product.name)}`);
    const table = admin.page.getByTestId("responsive-table");
    await expect(table.getByText(product.name)).toBeVisible();
    await table.getByTestId(`product-actions-${product.id}`).click();
    await table.getByTestId(`product-restore-${product.id}`).click();
    await admin.page.getByRole("dialog").getByRole("button", { name: /^restore$/i }).click();
    await expect(admin.page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });

    const restored = await (await admin.req.get(`${API_BASE}/api/products/${product.id}/`)).json();
    expect(restored.is_available, "a restored product stays off sale until switched on").toBe(false);
    const logs = await (await admin.req.get(`${API_BASE}/api/activity-logs/?activity_type=action&page_size=30`)).json();
    expect((logs.results as { description: string }[]).some((r) => r.description.includes(`Restored archived product "${product.name}"`))).toBe(true);

    // Never ordered → deletable for good.
    const check = await (await admin.req.get(`${API_BASE}/api/products/${product.id}/removal-check`)).json();
    expect(check.deletable).toBe(true);
    const bm = await newSession(browser, "branch_manager");
    expect((await bm.req.post(`${API_BASE}/api/products/${product.id}/permanent-delete`)).status(), "super admin only").toBe(403);
    expect((await admin.req.post(`${API_BASE}/api/products/${product.id}/permanent-delete`)).status()).toBe(200);
    expect((await admin.req.get(`${API_BASE}/api/products/${product.id}/`)).status()).toBe(404);
    expect(await logged(admin.req, "delete", product.name)).toBe(true);
    await admin.context.close();
    await bm.context.close();
  });

  test("a branch manager restores their own branch's archived product, not another branch's", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const bm = await newSession(browser, "branch_manager");
    const own = (await (await bm.req.get(`${API_BASE}/api/dashboard/branch-manager/`)).json()).branch.id as number;
    const otherId = Object.values(await branchMap(admin.req)).find((id) => id !== own)!;
    const ownProduct = await makeProduct(admin.req, own);
    const foreign = await makeProduct(admin.req, otherId);
    for (const p of [ownProduct, foreign]) {
      expect((await admin.req.delete(`${API_BASE}/api/products/${p.id}/`)).status()).toBe(200);
    }

    // Another branch's archived product: refused.
    expect((await bm.req.post(`${API_BASE}/api/products/${foreign.id}/restore`)).status(), "another branch → 403").toBe(403);

    // Their own, from the catalogue's Archived view.
    await bm.page.goto(`/branch-manager/catalog?archived=1&search=${encodeURIComponent(ownProduct.name)}`);
    await bm.page.getByTestId(`product-restore-${ownProduct.id}`).click();
    await bm.page.getByRole("dialog").getByRole("button", { name: /^restore$/i }).click();
    await expect(bm.page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
    const restored = await (await admin.req.get(`${API_BASE}/api/products/${ownProduct.id}/`)).json();
    expect(restored.is_available, "comes back unavailable").toBe(false);

    // Logged under the manager as the actor.
    const logs = await (await admin.req.get(`${API_BASE}/api/activity-logs/?activity_type=action&page_size=30`)).json();
    expect(
      (logs.results as { description: string }[]).some((r) => r.description.includes(`Restored archived product "${ownProduct.name}"`)),
    ).toBe(true);

    // Permanent delete stays super admin only; the admin cleans up.
    expect((await bm.req.post(`${API_BASE}/api/products/${ownProduct.id}/permanent-delete`)).status()).toBe(403);
    for (const p of [ownProduct, foreign]) {
      expect((await admin.req.post(`${API_BASE}/api/products/${p.id}/permanent-delete`)).status()).toBe(200);
    }
    await admin.context.close();
    await bm.context.close();
  });

  test("a product that has been ordered can only stay archived", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const orders = await (await admin.req.get(`${API_BASE}/api/orders/?page_size=5`)).json();
    const productId = (orders.results as { items: { product: number | null }[] }[])
      .flatMap((o) => o.items)
      .find((i) => i.product != null)?.product;
    expect(productId, "the seed has an order with a product").toBeTruthy();
    const check = await (await admin.req.get(`${API_BASE}/api/products/${productId}/removal-check`)).json();
    expect(check.deletable).toBe(false);
    expect(check.order_lines).toBeGreaterThan(0);
    const refused = await admin.req.post(`${API_BASE}/api/products/${productId}/permanent-delete`);
    expect(refused.status(), "history → 409").toBe(409);
    expect((await admin.req.get(`${API_BASE}/api/products/${productId}/`)).status(), "still there").toBe(200);
    await admin.context.close();
  });
});

// Keeps the helper import used even if a describe above is skipped.
void activeZoneId;
