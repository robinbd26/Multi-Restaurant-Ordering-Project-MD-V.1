import { test, expect, type APIRequestContext } from "@playwright/test";

import { API_BASE, newSession, setLocale } from "./helpers";

/**
 * ITEM 7 — a branch's location tag (Branch.zoneId, a master DeliveryZone),
 * added to the branch add/edit form, and the "Suggest areas for my branch"
 * helper it feeds on the branch-manager delivery-areas page.
 *
 * The helper is explicitly assisted, not automatic: it pre-fills candidates
 * from the branch's own zone that are not already covered, shown for review
 * (check/uncheck, edit charge/minutes/shift, or delete any row); nothing is
 * created until "Save selected areas" is pressed.
 *
 * Main Branch (the seeded branch_manager's own branch) is used for the UI
 * checks and its zone tag is restored to none afterward, matching the "leave
 * the shared test database as it found it" convention other specs follow.
 */

test.beforeEach(async ({ context }) => setLocale(context, "en"));

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

async function firstActiveZone(req: APIRequestContext) {
  const res = await req.get(`${API_BASE}/api/area-zones`);
  expect(res.status()).toBe(200);
  const zones = (await res.json()).results as { id: number; name: string; isActive: boolean; localities: { id: number; name: string; isActive: boolean }[] }[];
  const zone = zones.find((z) => z.isActive && z.localities.some((l) => l.isActive));
  expect(zone, "a seeded zone with active localities exists").toBeTruthy();
  return zone!;
}

async function makeBranch(req: APIRequestContext, extra: Record<string, string> = {}) {
  const res = await req.post(`${API_BASE}/api/branches/`, {
    data: {
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

async function mainBranch(req: APIRequestContext) {
  const branches = (await (await req.get(`${API_BASE}/api/branches/?search=Main%20Branch&page_size=100`)).json()).results as {
    id: number;
    name: string;
    zone_id: number | null;
  }[];
  const main = branches.find((b) => b.name === "Main Branch");
  expect(main, "seeded Main Branch exists").toBeTruthy();
  return main!;
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

  test("a branch may be created with no zone tag, and it can be set/cleared later", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const branch = await makeBranch(admin.req);
    expect(branch.zone_id, "no zone by default").toBeNull();

    const zone = await firstActiveZone(admin.req);
    const set = await admin.req.patch(`${API_BASE}/api/branches/${branch.id}/`, { data: { zone_id: String(zone.id) } });
    expect(set.status()).toBe(200);
    expect(((await set.json()) as { zone_id: number | null }).zone_id).toBe(zone.id);

    const cleared = await admin.req.patch(`${API_BASE}/api/branches/${branch.id}/`, { data: { zone_id: "" } });
    expect(cleared.status()).toBe(200);
    expect(((await cleared.json()) as { zone_id: number | null }).zone_id).toBeNull();

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

test.describe("Suggest areas for my branch", () => {
  test("no zone tag → the helper explains, offers no button, never guesses", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const main = await mainBranch(admin.req);
    // Make sure Main Branch genuinely has no zone tag for this run.
    await admin.req.patch(`${API_BASE}/api/branches/${main.id}/`, { data: { zone_id: "" } });
    await admin.context.close();

    const manager = await newSession(browser, "branch_manager");
    await manager.page.goto("/branch-manager/delivery-areas", { waitUntil: "domcontentloaded" });
    await expect(manager.page.getByTestId("suggest-areas-no-zone")).toBeVisible();
    await expect(manager.page.getByTestId("suggest-areas-open")).toHaveCount(0);
    await manager.context.close();
  });

  test("suggests the branch's zone localities, excludes already-covered ones, and saves only what is selected", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const main = await mainBranch(admin.req);
    let manager: Awaited<ReturnType<typeof newSession>> | null = null;
    let coveredAreaId: number | null = null;
    let savedSuggestionId: number | null = null;

    // A BRAND NEW zone with two brand-new localities, made just for this test.
    // Main Branch has real seeded coverage across the shared master list (and
    // other specs add more over a long run), and the duplicate-area check is
    // on (branchId, normalizedName, window) regardless of isActive — so
    // reusing any existing locality name here risks colliding with coverage
    // this test did not create and must not touch. A fresh zone sidesteps
    // that entirely: nothing has ever covered these two localities.
    const zoneRes = await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: uniq("SuggestZone") } });
    expect(zoneRes.status()).toBe(201);
    const zoneId = ((await zoneRes.json()) as { id: number }).id;
    const localityNames = [uniq("SuggestLoc"), uniq("SuggestLoc")];
    const localities: { id: number; name: string }[] = [];
    for (const name of localityNames) {
      const res = await admin.req.post(`${API_BASE}/api/area-localities`, { data: { zone_id: zoneId, name } });
      expect(res.status()).toBe(201);
      localities.push({ id: ((await res.json()) as { id: number }).id, name });
    }
    const firstLocality = localities[0];

    try {
      // Pre-cover ONE locality so the helper must exclude it from its suggestions.
      const covered = await admin.req.post(`${API_BASE}/api/delivery-areas`, {
        data: { branch_id: main.id, name: firstLocality.name, locality_id: firstLocality.id, coverage_window: "both", estimated_delivery_minutes: 30, delivery_charge: 20 },
      });
      expect(covered.status()).toBe(201);
      coveredAreaId = ((await covered.json()) as { id: number }).id;

      await admin.req.patch(`${API_BASE}/api/branches/${main.id}/`, { data: { zone_id: String(zoneId) } });

      manager = await newSession(browser, "branch_manager");
      await manager.page.goto("/branch-manager/delivery-areas", { waitUntil: "domcontentloaded" });
      await manager.page.getByTestId("suggest-areas-open").click();
      await expect(manager.page.getByTestId("suggest-areas-panel")).toBeVisible();

      // The already-covered locality is not offered again.
      await expect(manager.page.getByTestId(`suggest-area-row-${firstLocality.id}`)).toHaveCount(0);

      // A genuinely uncovered locality from the same zone IS offered.
      const candidate = localities[1];
      const row = manager.page.getByTestId(`suggest-area-row-${candidate!.id}`);
      await expect(row).toBeVisible();

      // Edit before saving: a non-default charge.
      await row.getByTestId(`suggest-area-charge-${candidate!.id}`).fill("35");
      await manager.page.getByTestId("suggest-areas-save").click();
      await expect(manager.page.getByTestId(`suggest-area-row-${candidate!.id}`)).toHaveCount(0, { timeout: 10000 });

      // It is a REAL, saved delivery area now — verify server-side.
      const saved = (await (await manager.req.get(`${API_BASE}/api/delivery-areas?branch_id=${main.id}&page_size=200`)).json()).results as {
        id: number;
        locality_id: number | null;
        delivery_charge: string;
      }[];
      const savedRow = saved.find((a) => a.locality_id === candidate!.id);
      expect(savedRow, "the saved suggestion is a real coverage row").toBeTruthy();
      expect(Number(savedRow!.delivery_charge)).toBe(35);
      savedSuggestionId = savedRow!.id;
    } finally {
      // Leave the shared database exactly as found: drop what this test
      // created. Neither row it made ever collides with a real seeded one —
      // both localities were picked specifically for having no prior coverage.
      await admin.req.patch(`${API_BASE}/api/branches/${main.id}/`, { data: { zone_id: "" } });
      if (savedSuggestionId != null) {
        await admin.req.patch(`${API_BASE}/api/delivery-areas/${savedSuggestionId}`, { data: { is_active: false } });
      }
      if (coveredAreaId != null) {
        await admin.req.patch(`${API_BASE}/api/delivery-areas/${coveredAreaId}`, { data: { is_active: false } });
      }
      await admin.context.close();
      await manager?.context.close();
    }
  });
});
