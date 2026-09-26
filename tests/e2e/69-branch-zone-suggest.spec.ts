import { test, expect, type APIRequestContext } from "@playwright/test";

import { API_BASE, newSession, setLocale } from "./helpers";

/**
 * ITEM 7 — a branch's location tag (Branch.zoneId, a master DeliveryZone),
 * set on the branch add/edit form. The zone is REQUIRED: a branch cannot be
 * created without one, and it cannot be cleared. (The "Suggest areas for my
 * branch" helper it used to feed was replaced by map-drawn delivery areas.)
 */

test.beforeEach(async ({ context }) => setLocale(context, "en"));

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

/** Active zones, first two. The master list no longer carries localities. */
async function activeZones(req: APIRequestContext) {
  const res = await req.get(`${API_BASE}/api/area-zones`);
  expect(res.status()).toBe(200);
  const zones = ((await res.json()).results as { id: number; name: string; isActive: boolean }[]).filter((z) => z.isActive);
  expect(zones.length, "the seed has at least two active zones").toBeGreaterThanOrEqual(2);
  return zones;
}
async function firstActiveZone(req: APIRequestContext) {
  return (await activeZones(req))[0];
}

/** A branch in an active zone (a zone is required); `extra` may name another. */
async function makeBranch(req: APIRequestContext, extra: Record<string, string> = {}) {
  const res = await req.post(`${API_BASE}/api/branches/`, {
    data: {
      zone_id: String((await firstActiveZone(req)).id),
      name: uniq("ZoneTagBr"),
      address: "Dhaka",
      phone: "01711119992",
      brand_type: "cheez",
      ...extra,
    },
  });
  expect(res.status(), "branch created").toBe(201);
  return (await res.json()) as { id: number; name: string; zone_id: number | null; zone_name: string | null };
}

test.describe("Branch location tag (zone)", () => {
  test("a branch may be created with a zone tag, which round-trips", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const zone = await firstActiveZone(admin.req);
    const branch = await makeBranch(admin.req, { zone_id: String(zone.id) });
    expect(branch.zone_id).toBe(zone.id);
    expect(branch.zone_name).toBe(zone.name);

    const fetched = await (await admin.req.get(`${API_BASE}/api/branches/${branch.id}/`)).json();
    expect(fetched.zone_id).toBe(zone.id);

    // The branch VIEW page (distinct from the edit form) also shows the tag.
    await admin.page.goto(`/admin/branches/${branch.id}`, { waitUntil: "domcontentloaded" });
    await expect(admin.page.getByText(zone.name, { exact: true })).toBeVisible();

    await admin.context.close();
  });

  test("a zone is required: no branch without one, and it can be changed but never cleared", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");

    // Creating a branch with no zone is refused, on the zone field.
    const noZone = await admin.req.post(`${API_BASE}/api/branches/`, {
      data: { name: uniq("NoZoneBr"), address: "Dhaka", phone: "01711119994", brand_type: "cheez" },
    });
    expect(noZone.status(), "a branch without a zone is refused").toBe(400);
    expect(await noZone.text()).toContain("zone_id");

    const [first, second] = await activeZones(admin.req);
    const branch = await makeBranch(admin.req, { zone_id: String(first.id) });
    expect(branch.zone_id).toBe(first.id);

    // Changing it to another active zone works.
    const moved = await admin.req.patch(`${API_BASE}/api/branches/${branch.id}/`, { data: { zone_id: String(second.id) } });
    expect(moved.status()).toBe(200);
    expect(((await moved.json()) as { zone_id: number | null }).zone_id).toBe(second.id);

    // Clearing it is refused, and the branch keeps its zone.
    const cleared = await admin.req.patch(`${API_BASE}/api/branches/${branch.id}/`, { data: { zone_id: "" } });
    expect(cleared.status(), "a zone cannot be cleared").toBe(400);
    const after = await (await admin.req.get(`${API_BASE}/api/branches/${branch.id}/`)).json();
    expect(after.zone_id, "unchanged after the refused clear").toBe(second.id);

    await admin.context.close();
  });

  test("an invalid or inactive zone id is refused", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const res = await admin.req.post(`${API_BASE}/api/branches/`, {
      data: { name: uniq("BadZoneBr"), address: "Dhaka", phone: "01711119993", brand_type: "cheez", zone_id: "99999999" },
    });
    expect(res.status(), "an id that names no zone is refused").toBe(400);

    await admin.context.close();
  });

  test("only a super admin may set it", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const zone = await firstActiveZone(admin.req);
    const branch = await makeBranch(admin.req);

    const manager = await newSession(browser, "branch_manager");
    const attempt = await manager.req.patch(`${API_BASE}/api/branches/${branch.id}/`, { data: { zone_id: String(zone.id) } });
    expect(attempt.status()).toBe(403);

    await admin.context.close();
    await manager.context.close();
  });
});
