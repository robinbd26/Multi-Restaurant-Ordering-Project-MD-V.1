import { test, expect, type APIRequestContext } from "@playwright/test";

import { newSession, API_BASE, activeZoneId } from "./helpers";

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

// Keeps the helper import used even if a describe above is skipped.
void activeZoneId;
