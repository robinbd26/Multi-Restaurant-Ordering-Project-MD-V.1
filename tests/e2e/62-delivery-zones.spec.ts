import { test, expect, type APIRequestContext } from "@playwright/test";

import { API_BASE, newSession, setLocale } from "./helpers";

/**
 * DELIVERY ZONES — the master list of places, and coverage by name.
 *
 * Two rules are pinned here:
 *   1. the master list is the SUPER ADMIN's, and nothing else may edit it;
 *   2. a branch that lists a locality covers an address naming that locality,
 *      even when the address has no map pin at all — which is the entire point
 *      of moving coverage off geometry.
 *
 * Coverage is the UNION of the two rules during this phase, so the geometry
 * tests in 41/55/57 must keep passing untouched: nothing here removes coverage
 * that a radius already granted.
 */

test.beforeEach(async ({ context }) => setLocale(context, "en"));

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

interface ZoneRow {
  id: number;
  name: string;
  isActive: boolean;
  localities: { id: number; name: string; isActive: boolean; coverageCount: number }[];
}

async function zones(req: APIRequestContext): Promise<ZoneRow[]> {
  const res = await req.get(`${API_BASE}/api/area-zones`);
  expect(res.status(), "master list readable by super admin").toBe(200);
  return (await res.json()).results as ZoneRow[];
}

/**
 * Clear this test account saved addresses.
 *
 * Saved addresses are capped at five and the test database persists, so probes
 * left by earlier runs would fill the quota and fail every later run. These
 * tests own the qa_upload_2 account, so clearing it first keeps them idempotent.
 */
async function clearAddresses(req: APIRequestContext) {
  const res = await req.get(`${API_BASE}/api/customer/addresses/?page_size=100`);
  if (res.status() !== 200) return;
  const payload = (await res.json()) as { results?: { id: number }[]; addresses?: { id: number }[] };
  for (const row of payload.results ?? payload.addresses ?? []) {
    await req.delete(`${API_BASE}/api/customer/addresses/${row.id}/`);
  }
}

/**
 * Retire a zone a test created.
 *
 * Zones have no cap, so a leftover never fails a later run outright — but the
 * customer address form offers every ACTIVE zone, so without this each run adds
 * another throwaway name to a real picker in this database.
 */
async function retireZone(req: APIRequestContext, zoneId: number) {
  await req.patch(`${API_BASE}/api/area-zones/${zoneId}`, { data: { is_active: false } });
}

/** A branch placed far from everything, so ONLY a named locality can cover it. */
async function makeBranch(req: APIRequestContext) {
  const res = await req.post(`${API_BASE}/api/branches/`, {
    data: {
      name: uniq("ZoneBr"),
      address: "Dhaka",
      phone: "01711111111",
      brand_type: "cheez",
      // Far out in the Bay of Bengal: no customer point is ever inside this
      // radius, so any coverage this branch gets came from the locality list.
      latitude: "20.5",
      longitude: "90.9",
      delivery_radius_km: "1",
    },
  });
  expect(res.status(), "branch created").toBe(201);
  return (await res.json()) as { id: number; name: string };
}

async function makeMenu(req: APIRequestContext, branchId: number) {
  const cat = await req.post(`${API_BASE}/api/categories/`, {
    data: { name: uniq("ZoneCat"), branch_id: branchId, is_active: true },
  });
  expect(cat.status()).toBe(201);
  const categoryId = ((await cat.json()) as { id: number }).id;
  const product = await req.post(`${API_BASE}/api/products/`, {
    data: {
      branch_id: branchId,
      name: uniq("ZoneItem"),
      brand: "cheez",
      category: categoryId,
      is_available: true,
      variations: JSON.stringify([{ name: "Std", price: 300, isDefault: true, isEnabled: true }]),
    },
  });
  expect(product.status()).toBe(201);
  return (await product.json()) as { id: number; name: string };
}

test.describe("The master list belongs to the super admin", () => {
  test("a zone and a locality can be added, and duplicates are refused", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");

    const zoneName = uniq("ZoneMaster");
    const created = await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: zoneName } });
    expect(created.status(), "zone created").toBe(201);
    const zoneId = ((await created.json()) as { id: number }).id;

    const dupe = await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: zoneName } });
    expect(dupe.status(), "same zone name refused").toBe(400);

    const localityName = uniq("Locality");
    const locality = await admin.req.post(`${API_BASE}/api/area-localities`, {
      data: { zone_id: zoneId, name: localityName },
    });
    expect(locality.status(), "locality created").toBe(201);

    const localityDupe = await admin.req.post(`${API_BASE}/api/area-localities`, {
      data: { zone_id: zoneId, name: localityName.toUpperCase() },
    });
    expect(localityDupe.status(), "same locality refused case-insensitively").toBe(400);

    const list = await zones(admin.req);
    const mine = list.find((z) => z.id === zoneId);
    expect(mine?.localities.map((l) => l.name), "the locality is on the list").toContain(localityName);

    await retireZone(admin.req, zoneId);
    await admin.context.close();
  });

  test("nobody else may read or edit it", async ({ browser }) => {
    const manager = await newSession(browser, "branch_manager");
    const customer = await newSession(browser, "customer");

    for (const [who, session] of [["branch manager", manager], ["customer", customer]] as const) {
      const read = await session.req.get(`${API_BASE}/api/area-zones`);
      expect(read.status(), `${who} cannot read the master list`).toBe(403);
      const write = await session.req.post(`${API_BASE}/api/area-zones`, { data: { name: uniq("Nope") } });
      expect(write.status(), `${who} cannot add a zone`).toBe(403);
    }

    await manager.context.close();
    await customer.context.close();
  });

  test("a retired locality is deactivated, never deleted", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const zoneRes = await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: uniq("RetireZone") } });
    const zoneId = ((await zoneRes.json()) as { id: number }).id;
    const localityRes = await admin.req.post(`${API_BASE}/api/area-localities`, {
      data: { zone_id: zoneId, name: uniq("RetireArea") },
    });
    const localityId = ((await localityRes.json()) as { id: number }).id;

    const off = await admin.req.patch(`${API_BASE}/api/area-localities/${localityId}`, {
      data: { is_active: false },
    });
    expect(off.status()).toBe(200);

    const list = await zones(admin.req);
    const row = list.find((z) => z.id === zoneId)?.localities.find((l) => l.id === localityId);
    expect(row, "the row still exists").toBeTruthy();
    expect(row?.isActive, "but is inactive").toBe(false);

    await retireZone(admin.req, zoneId);
    await admin.context.close();
  });
});

test.describe("Coverage by locality name", () => {
  test("a branch covers a pinless address that names a locality it lists", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const branch = await makeBranch(admin.req);
    const item = await makeMenu(admin.req, branch.id);

    // A locality from the seeded master list, so this exercises real data.
    const list = await zones(admin.req);
    const zone = list.find((z) => z.name === "Mirpur" && z.isActive);
    expect(zone, "the seeded Mirpur zone exists").toBeTruthy();
    const locality = zone!.localities.find((l) => l.name === "Mirpur-10" && l.isActive);
    expect(locality, "the seeded Mirpur-10 locality exists").toBeTruthy();

    // The branch declares it delivers there, around the clock.
    const coverage = await admin.req.post(`${API_BASE}/api/delivery-areas`, {
      data: {
        branch_id: branch.id,
        name: locality!.name,
        locality_id: locality!.id,
        coverage_window: "both",
        estimated_delivery_minutes: 40,
        delivery_charge: 55,
      },
    });
    expect(coverage.status(), "coverage row created").toBe(201);

    // A customer with NO usable coordinates anywhere, and an address that names
    // the locality but carries no map pin.
    const customer = await newSession(browser, "qa_upload_2");
    await clearAddresses(customer.req);
    const address = await customer.req.post(`${API_BASE}/api/customer/addresses/`, {
      data: { label: "Home", address: uniq("Pinless Rd"), main_area: "Mirpur", sub_area: "Mirpur-10" },
    });
    expect(address.status(), "pinless address saved").toBe(201);
    const addressId = ((await address.json()) as { id: number }).id;

    await customer.context.addCookies([
      { name: "mad_scope", value: `a:${addressId}`, url: API_BASE },
    ]);
    await customer.page.goto("/", { waitUntil: "domcontentloaded" });

    const bar = customer.page.getByTestId("home-branch-bar");
    await expect(bar, "a named locality resolves a branch with no coordinates").toHaveAttribute(
      "data-branch-state",
      "ok",
    );
    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(branch.name);
    await expect(bar).toHaveAttribute("data-browse-only", "false");
    // No distance is claimed, because there is no honest one to report.
    await expect(customer.page.getByTestId("home-branch-distance")).toHaveCount(0);
    const names = await customer.page.locator("article h4").allInnerTexts();
    expect(names, "and the catalogue is that branch's").toContain(item.name);

    await admin.context.close();
    await customer.context.close();
  });

  test("an area typed by hand is covered by nobody", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const branch = await makeBranch(admin.req);
    await makeMenu(admin.req, branch.id);

    const customer = await newSession(browser, "qa_upload_2");
    await clearAddresses(customer.req);
    const address = await customer.req.post(`${API_BASE}/api/customer/addresses/`, {
      data: {
        label: "Office",
        address: uniq("Invented Rd"),
        main_area: "Mirpur",
        sub_area: uniq("NowhereOnTheList"),
      },
    });
    expect(address.status()).toBe(201);
    const addressId = ((await address.json()) as { id: number }).id;

    await customer.context.addCookies([
      { name: "mad_scope", value: `a:${addressId}`, url: API_BASE },
    ]);
    await customer.page.goto("/", { waitUntil: "domcontentloaded" });

    // Falls back to the customer's own point, which they do not have, so the
    // location gate stays up rather than inventing coverage.
    const state = await customer.page.getByTestId("home-branch-bar").getAttribute("data-branch-state");
    expect(state, "a custom-typed area never resolves coverage").toBe("no-location");

    await admin.context.close();
    await customer.context.close();
  });

  test("coverage rows are filterable by shift", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const branch = await makeBranch(admin.req);
    const dayName = uniq("DayArea");
    const nightName = uniq("NightArea");

    for (const [name, window] of [[dayName, "day"], [nightName, "night"]] as const) {
      const res = await admin.req.post(`${API_BASE}/api/delivery-areas`, {
        data: {
          branch_id: branch.id,
          name,
          coverage_window: window,
          estimated_delivery_minutes: 30,
          delivery_charge: 20,
        },
      });
      expect(res.status(), `${window} row created`).toBe(201);
    }

    const dayList = await admin.req.get(
      `${API_BASE}/api/delivery-areas?branch_id=${branch.id}&window=day&page_size=100`,
    );
    const dayNames = ((await dayList.json()).results as { name: string }[]).map((a) => a.name);
    expect(dayNames).toContain(dayName);
    expect(dayNames, "the night row is not on the day list").not.toContain(nightName);

    const nightList = await admin.req.get(
      `${API_BASE}/api/delivery-areas?branch_id=${branch.id}&window=night&page_size=100`,
    );
    const nightNames = ((await nightList.json()).results as { name: string }[]).map((a) => a.name);
    expect(nightNames).toContain(nightName);
    expect(nightNames).not.toContain(dayName);

    // The same locality name on BOTH shifts is legitimate — different charges —
    // so it must not be refused as a duplicate.
    const shared = uniq("SharedArea");
    for (const window of ["day", "night"] as const) {
      const res = await admin.req.post(`${API_BASE}/api/delivery-areas`, {
        data: {
          branch_id: branch.id,
          name: shared,
          coverage_window: window,
          estimated_delivery_minutes: 30,
          delivery_charge: window === "night" ? 80 : 40,
        },
      });
      expect(res.status(), `${window} copy of the same area accepted`).toBe(201);
    }
    const again = await admin.req.post(`${API_BASE}/api/delivery-areas`, {
      data: {
        branch_id: branch.id,
        name: shared,
        coverage_window: "day",
        estimated_delivery_minutes: 30,
        delivery_charge: 40,
      },
    });
    expect(again.status(), "but a second row in the SAME shift is still a duplicate").toBe(400);

    await admin.context.close();
  });
});

// ITEM 4 — the super-admin master-list page could only add and
// activate/deactivate; there was no way to RENAME an existing zone or
// locality (the API already supported it). Pins the inline edit UI.
test.describe("Renaming an existing zone or locality", () => {
  test("edits a zone's name in place from the master list page", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const create = await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: uniq("EditZone") } });
    expect(create.status()).toBe(201);
    const zone = (await create.json()) as { id: number; name: string };

    await admin.page.goto("/admin/delivery-zones", { waitUntil: "domcontentloaded" });
    const card = admin.page.getByTestId(`zone-card-${zone.id}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(zone.name);

    await admin.page.getByTestId(`zone-edit-${zone.id}`).click();
    const renamed = uniq("RenamedZone");
    const input = admin.page.getByTestId(`zone-edit-name-${zone.id}`);
    await expect(input).toHaveValue(zone.name);
    await input.fill(renamed);
    await admin.page.getByTestId(`zone-edit-save-${zone.id}`).click();

    await expect(card).toContainText(renamed);
    await expect(card).not.toContainText(zone.name);

    // Persisted server-side, not just in the client.
    const rows = await zones(admin.req);
    expect(rows.some((z) => z.id === zone.id && z.name === renamed)).toBe(true);

    await admin.context.close();
  });

  test("edits a locality's name in place, and Cancel discards the draft", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const zoneRes = await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: uniq("EditZoneL") } });
    const zone = (await zoneRes.json()) as { id: number };
    const locRes = await admin.req.post(`${API_BASE}/api/area-localities`, {
      data: { zone_id: zone.id, name: uniq("EditLoc") },
    });
    expect(locRes.status()).toBe(201);
    const locality = (await locRes.json()) as { id: number; name: string };

    await admin.page.goto("/admin/delivery-zones", { waitUntil: "domcontentloaded" });
    const row = admin.page.getByTestId(`locality-row-${locality.id}`);
    await expect(row).toContainText(locality.name);

    // Cancel: the draft is thrown away, the stored name is untouched.
    await admin.page.getByTestId(`locality-edit-${locality.id}`).click();
    await admin.page.getByTestId(`locality-edit-name-${locality.id}`).fill(uniq("Discarded"));
    await row.getByRole("button", { name: /cancel/i }).click();
    await expect(row).toContainText(locality.name);

    // Save: the new name sticks, server-side.
    await admin.page.getByTestId(`locality-edit-${locality.id}`).click();
    const renamed = uniq("RenamedLoc");
    await admin.page.getByTestId(`locality-edit-name-${locality.id}`).fill(renamed);
    await admin.page.getByTestId(`locality-edit-save-${locality.id}`).click();
    await expect(row).toContainText(renamed);

    const rows = await zones(admin.req);
    const savedZone = rows.find((z) => z.id === zone.id);
    expect(savedZone?.localities.some((l) => l.id === locality.id && l.name === renamed)).toBe(true);

    await admin.context.close();
  });

  test("branch manager and customer cannot rename", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const create = await admin.req.post(`${API_BASE}/api/area-zones`, { data: { name: uniq("LockedZone") } });
    const zone = (await create.json()) as { id: number; name: string };

    const manager = await newSession(browser, "branch_manager");
    const bmAttempt = await manager.req.patch(`${API_BASE}/api/area-zones/${zone.id}`, { data: { name: "Nope" } });
    expect(bmAttempt.status()).toBe(403);

    const customer = await newSession(browser, "customer");
    const custAttempt = await customer.req.patch(`${API_BASE}/api/area-zones/${zone.id}`, { data: { name: "Nope" } });
    expect(custAttempt.status()).toBe(403);

    await admin.context.close();
    await manager.context.close();
    await customer.context.close();
  });
});
