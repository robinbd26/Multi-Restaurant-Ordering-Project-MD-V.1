import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  newSession,
  setLocale,
  ROLE_HOME,
  atPath,
  login,
  E2E_ORIGIN,
  inNightOrderBlackout,
  NIGHT_BLACKOUT_REASON,
  isDhakaFullClosureWindow,
  FULL_CLOSURE_REASON, activeZoneId } from "./helpers";

/**
 * NEAREST-BRANCH HOMEPAGE — an authenticated customer sees, and can order, the
 * catalogue of exactly ONE branch: their nearest eligible one, resolved
 * server-side from their own trusted coordinates.
 *
 * The storefront previously rendered every live branch's products mixed
 * together, so a customer in Dhanmondi was shown (and could add) items only
 * sold in Banani. These tests pin the whole chain: homepage, category sections,
 * nav search, product detail, the products/categories APIs, the cart, the quote
 * and order creation.
 */

test.beforeEach(async ({ context }) => setLocale(context, "en"));

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

/**
 * Every fixture branch is placed at coordinates derived from its OWN database id.
 *
 * This matters more than it looks. Two branches at the same coordinates are the
 * same distance from the customer, and the deterministic lowest-id tie-break then
 * resolves to whichever was created first — correct behaviour, but not the branch
 * the test meant to assert about. The test database is persistent, so branches
 * left by earlier runs are real competitors; any fixed point, or any small set of
 * bands, is eventually occupied by one of them.
 *
 * Branch ids are unique and monotonic forever, so an id-derived grid gives every
 * branch ever created its own slot: 100 latitude steps x 100 longitude steps of
 * 0.03 degrees (~3.3 km) each, far outside the seeded Dhaka branches (23.7x,
 * 90.4x) and well beyond the 1 km delivery radius used below. Only the branch a
 * test just created covers its own point.
 */
function pointForBranchId(id: number): { lat: number; lng: number } {
  return {
    lat: 24 + (id % 100) * 0.03,
    lng: 91 + (Math.floor(id / 100) % 100) * 0.03,
  };
}
const FAR_AWAY = { lat: 21.4272, lng: 92.0058 }; // Cox's Bazar — outside everything

async function setLocation(req: APIRequestContext, point: { lat: number; lng: number }) {
  const res = await req.post("/api/customer/location", {
    data: { lat: point.lat, lng: point.lng, accuracy: 10, captured_at: Date.now() },
  });
  expect(res.status(), "location saved").toBe(200);
}

/**
 * Creates a branch and then moves it onto its own id-derived slot, so no two
 * fixture branches — in this run or any earlier one — can share coordinates.
 * Returns the branch together with the point it now occupies.
 */
async function makeBranch(req: APIRequestContext, overrides: Record<string, string> = {}) {
  const res = await req.post("/api/branches/", {
    data: {
      // Branch creation requires a zone (ITEM 7).
      zone_id: String(await activeZoneId(req)),
      name: uniq("NB"),
      address: "Dhaka",
      phone: "01711111111",
      brand_type: "cheez",
      latitude: "24",
      longitude: "91",
      // 1 km — well inside the ~3.3 km grid spacing, so slots never overlap.
      delivery_radius_km: "1",
      ...overrides,
    },
  });
  expect(res.status(), "branch created").toBe(201);
  const branch = (await res.json()) as { id: number; name: string };
  const point = pointForBranchId(branch.id);
  const moved = await req.patch(`/api/branches/${branch.id}/`, {
    data: { latitude: String(point.lat), longitude: String(point.lng) },
  });
  expect(moved.status(), "branch placed on its own slot").toBe(200);
  return { ...branch, point };
}

async function makeCategory(req: APIRequestContext, branchId: number | null, name?: string) {
  const res = await req.post("/api/categories/", {
    data: { name: name ?? uniq("NBCat"), branch_id: branchId ?? "global", is_active: true },
  });
  expect(res.status(), "category created").toBe(201);
  return (await res.json()) as { id: number; name: string };
}

async function makeProduct(
  req: APIRequestContext,
  branchId: number,
  categoryId: number,
  overrides: Record<string, string | number | boolean> = {},
) {
  const res = await req.post("/api/products/", {
    data: {
      branch_id: branchId,
      name: uniq("NBProd"),
      brand: "cheez",
      category: categoryId,
      is_available: true,
      variations: JSON.stringify([{ name: "Std", price: 250, isDefault: true, isEnabled: true }]),
      ...overrides,
    },
  });
  expect(res.status(), "product created").toBe(201);
  return (await res.json()) as { id: number; name: string };
}

/** Product names the storefront actually renders (the card headings). */
async function homeNames(page: Page): Promise<string[]> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return page.locator("article h4").allInnerTexts();
}

/**
 * A world with two disjoint branches, a shared GLOBAL category, and the full set
 * of ineligible products. Built once per test so nothing leaks between them.
 */
async function buildWorld(admin: { req: APIRequestContext }) {
  const branchA = await makeBranch(admin.req);
  const branchB = await makeBranch(admin.req);
  const inactive = await makeBranch(admin.req);
  const archived = await makeBranch(admin.req);
  const pointA = branchA.point;
  const pointB = branchB.point;

  // One GLOBAL category used by BOTH branches — the case that must not merge.
  const global = await makeCategory(admin.req, null, uniq("GlobalPizza"));
  const catA = await makeCategory(admin.req, branchA.id);
  const catB = await makeCategory(admin.req, branchB.id);

  const aProduct = await makeProduct(admin.req, branchA.id, catA.id);
  const bProduct = await makeProduct(admin.req, branchB.id, catB.id);
  const aGlobal = await makeProduct(admin.req, branchA.id, global.id);
  const bGlobal = await makeProduct(admin.req, branchB.id, global.id);

  // Products that must never surface, all on branch A.
  const heldProduct = await makeProduct(admin.req, branchA.id, catA.id);
  expect((await admin.req.post(`/api/products/${heldProduct.id}/hold/`)).status()).toBe(200);

  const inactiveProduct = await makeProduct(admin.req, branchA.id, catA.id, { is_available: false });

  const deletedProduct = await makeProduct(admin.req, branchA.id, catA.id);
  expect((await admin.req.delete(`/api/products/${deletedProduct.id}/`)).status()).toBe(200);

  const inactiveBranchProduct = await makeProduct(admin.req, inactive.id, global.id);
  expect(
    (await admin.req.post(`/api/branches/${inactive.id}/deactivate/`, { data: { reason: "test" } })).status(),
  ).toBe(200);

  const archivedBranchProduct = await makeProduct(admin.req, archived.id, global.id);
  expect((await admin.req.post(`/api/branches/${archived.id}/archive`)).status()).toBe(200);

  return {
    pointA,
    pointB,
    branchA,
    branchB,
    global,
    aProduct,
    bProduct,
    aGlobal,
    bGlobal,
    heldProduct,
    inactiveProduct,
    deletedProduct,
    inactiveBranchProduct,
    archivedBranchProduct,
  };
}

test.describe("Homepage is scoped to the nearest eligible branch", () => {
  test("customers near different branches see disjoint catalogues", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);

    const nearA = await newSession(browser, "customer");
    await setLocation(nearA.req, world.pointA);
    const aNames = await homeNames(nearA.page);

    expect(aNames, "own branch product").toContain(world.aProduct.name);
    expect(aNames, "own branch global-category product").toContain(world.aGlobal.name);
    expect(aNames, "other branch product").not.toContain(world.bProduct.name);
    expect(aNames, "other branch, SAME global category").not.toContain(world.bGlobal.name);

    const nearB = await newSession(browser, "qa_upload_1");
    await setLocation(nearB.req, world.pointB);
    const bNames = await homeNames(nearB.page);

    expect(bNames, "own branch product").toContain(world.bProduct.name);
    expect(bNames, "other branch product").not.toContain(world.aProduct.name);
    expect(bNames, "other branch, SAME global category").not.toContain(world.aGlobal.name);

    // The two catalogues share nothing — the exact leak this guards against.
    expect(aNames.filter((n) => bNames.includes(n)), "no overlap").toEqual([]);

    await admin.context.close();
    await nearA.context.close();
    await nearB.context.close();
  });

  test("ineligible products and branches never appear", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);
    const names = await homeNames(customer.page);

    expect(names, "held").not.toContain(world.heldProduct.name);
    expect(names, "inactive").not.toContain(world.inactiveProduct.name);
    expect(names, "soft-deleted").not.toContain(world.deletedProduct.name);
    expect(names, "inactive branch").not.toContain(world.inactiveBranchProduct.name);
    expect(names, "archived branch").not.toContain(world.archivedBranchProduct.name);

    await admin.context.close();
    await customer.context.close();
  });

  test("the branch bar names the resolved branch", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    await customer.page.goto("/", { waitUntil: "domcontentloaded" });
    const bar = customer.page.getByTestId("home-branch-bar");
    await expect(bar).toHaveAttribute("data-branch-state", "ok");
    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(world.branchA.name);
    await expect(customer.page.getByTestId("home-branch-distance")).toBeVisible();

    await admin.context.close();
    await customer.context.close();
  });

  test("moving the customer moves the catalogue", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");

    await setLocation(customer.req, world.pointA);
    expect(await homeNames(customer.page)).toContain(world.aProduct.name);

    await setLocation(customer.req, world.pointB);
    const after = await homeNames(customer.page);
    expect(after, "new branch's product").toContain(world.bProduct.name);
    expect(after, "old branch's product is gone").not.toContain(world.aProduct.name);

    await admin.context.close();
    await customer.context.close();
  });
});

test.describe("Location and coverage states", () => {
  test("no location at all shows the location-setup state, not a catalogue", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    // A fresh customer with no GPS fix and no default address with coordinates.
    const customer = await newSession(browser, "qa_upload_2");

    await customer.page.goto("/", { waitUntil: "domcontentloaded" });
    const state = await customer.page.getByTestId("home-branch-bar").getAttribute("data-branch-state");
    // Either they genuinely have no location, or a saved default address gives
    // them one. Both are legitimate; what must NEVER happen is a mixed catalogue.
    const names = await customer.page.locator("article h4").allInnerTexts();
    if (state === "no-location") {
      await expect(customer.page.getByTestId("home-use-location")).toBeVisible();
      await expect(customer.page.getByTestId("home-select-address")).toBeVisible();
      // WS-8.14 — a signed-in customer with NO location browses the SAME guest
      // showcase, because seeing less than a logged-out visitor is backwards.
      // The location strip is the invitation; ordering still enforces coverage
      // server-side. This used to assert an empty grid, which stopped being true
      // when that rule shipped and left the test failing against real behaviour.
      expect(names.length, "browsing is open without a location").toBeGreaterThan(0);
    } else {
      // A LOCATED customer is scoped to one branch, so a mixed catalogue there
      // would be the leak this suite guards against. A no-location customer is
      // deliberately shown every branch (above), so the check only applies here.
      expect(
        names.includes(world.aProduct.name) && names.includes(world.bProduct.name),
        "never both branches at once",
      ).toBe(false);
    }

    await admin.context.close();
    await customer.context.close();
  });

  test("a location outside every zone shows out-of-zone and no catalogue", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, FAR_AWAY);

    await customer.page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(customer.page.getByTestId("home-branch-bar")).toHaveAttribute(
      "data-branch-state",
      "out-of-zone",
    );
    await expect(customer.page.getByTestId("home-retry-location")).toBeVisible();
    await expect(customer.page.getByTestId("home-browse-branch")).toBeVisible();

    const names = await customer.page.locator("article h4").allInnerTexts();
    expect(names, "no fallback catalogue whatsoever").toEqual([]);
    expect(names).not.toContain(world.aProduct.name);

    await admin.context.close();
    await customer.context.close();
  });

  test("out of zone, ordering is refused server-side", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, FAR_AWAY);

    const res = await customer.req.post("/api/orders/", {
      data: {
        branch_id: world.branchA.id,
        payment_method: "cash",
        delivery_address: "Nowhere",
        fulfillment_type: "delivery",
        ...FAR_AWAY,
        items: [{ product_id: world.aProduct.id, quantity: 1 }],
      },
    });
    expect(res.status(), "no eligible branch → rejected").toBeGreaterThanOrEqual(400);

    await admin.context.close();
    await customer.context.close();
  });
});

test.describe("Search and category scoping", () => {
  test("nav search only finds the resolved branch's products", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    await customer.page.goto("/", { waitUntil: "domcontentloaded" });
    const search = customer.page.getByRole("textbox", {
      name: /search any item across all menus/i,
    });

    await search.fill(world.aProduct.name);
    await expect(customer.page.getByText(world.aProduct.name).first()).toBeVisible();

    // A product that exists, is eligible, but belongs to the other branch.
    await search.fill(world.bProduct.name);
    await expect(customer.page.getByText(world.bProduct.name)).toHaveCount(0);

    await admin.context.close();
    await customer.context.close();
  });

  test("a global category never merges two branches' products", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    await customer.page.goto("/", { waitUntil: "domcontentloaded" });
    // The global category's section exists exactly once and holds only branch A.
    const section = customer.page.locator("h3").filter({ hasText: world.global.name });
    await expect(section).toHaveCount(1);

    const names = await customer.page.locator("article h4").allInnerTexts();
    expect(names).toContain(world.aGlobal.name);
    expect(names).not.toContain(world.bGlobal.name);

    await admin.context.close();
    await customer.context.close();
  });
});

test.describe("Forged requests are refused", () => {
  test("a forged branch query parameter is ignored", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    // Asking the products API for the OTHER branch must not return it.
    const res = await customer.req.get(`/api/products/?branch_id=${world.branchB.id}&page_size=200`);
    expect(res.status()).toBe(200);
    const names = ((await res.json()).results as { name: string }[]).map((p) => p.name);
    expect(names, "forged branch yields the resolved branch only").not.toContain(world.bProduct.name);
    expect(names).toContain(world.aProduct.name);

    await admin.context.close();
    await customer.context.close();
  });

  test("another branch's product detail is not readable", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    expect((await customer.req.get(`/api/products/${world.aProduct.id}/`)).status()).toBe(200);
    expect(
      (await customer.req.get(`/api/products/${world.bProduct.id}/`)).status(),
      "other branch's product is not found for this customer",
    ).toBe(404);

    await admin.context.close();
    await customer.context.close();
  });

  test("another branch's menu URL is refused", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    await customer.page.goto(`/customer/branches/${world.branchB.id}/menu`, {
      waitUntil: "domcontentloaded",
    });
    // Asserted on the RENDERED result, not the HTTP status. The route is a
    // dynamic server component, so Next has already begun streaming the shell by
    // the time the guard calls notFound() and the response stays 200 while the
    // not-found UI is what actually renders. The contract that matters is that
    // the other branch's menu is not served: nothing of it reaches the customer.
    const body = customer.page.locator("body");
    await expect(body).toContainText(/page not found/i);
    await expect(body, "no other-branch product leaks").not.toContainText(world.bProduct.name);
    await expect(body, "no other-branch name leaks").not.toContainText(world.branchB.name);

    await admin.context.close();
    await customer.context.close();
  });

  test("ordering another branch's product is rejected", async ({ browser }) => {
    // Needs a SUCCESSFUL own-branch order as its control, so it cannot run in
    // the 03:45–04:00 window where delivery orders are refused by design, nor
    // in the 04:00–11:00 full-platform-closure window (item 5).
    test.skip(inNightOrderBlackout(), NIGHT_BLACKOUT_REASON);
    test.skip(isDhakaFullClosureWindow(), FULL_CLOSURE_REASON);
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    const body = {
      payment_method: "cash",
      delivery_address: "Dhaka",
      fulfillment_type: "delivery",
      ...world.pointA,
    };

    // Own branch: accepted.
    const ok = await customer.req.post("/api/orders/", {
      data: { ...body, branch_id: world.branchA.id, items: [{ product_id: world.aProduct.id, quantity: 1 }] },
    });
    expect(ok.status(), "own branch order").toBe(201);

    // Other branch's product, however the branch_id is forged.
    for (const branchId of [world.branchA.id, world.branchB.id]) {
      const res = await customer.req.post("/api/orders/", {
        data: { ...body, branch_id: branchId, items: [{ product_id: world.bProduct.id, quantity: 1 }] },
      });
      expect(res.status(), `cross-branch order refused (branch_id=${branchId})`).toBeGreaterThanOrEqual(400);
    }

    // A cart mixing both branches is refused too.
    const mixed = await customer.req.post("/api/orders/", {
      data: {
        ...body,
        branch_id: world.branchA.id,
        items: [
          { product_id: world.aProduct.id, quantity: 1 },
          { product_id: world.bProduct.id, quantity: 1 },
        ],
      },
    });
    expect(mixed.status(), "mixed-branch cart refused").toBeGreaterThanOrEqual(400);

    await admin.context.close();
    await customer.context.close();
  });

  test("a quote for another branch's product is refused", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    const quote = await customer.req.post("/api/delivery/quote", {
      data: {
        branch_id: world.branchB.id,
        fulfillment_type: "delivery",
        ...world.pointA,
        items: [{ product_id: world.bProduct.id, quantity: 1 }],
      },
    });
    expect(quote.status(), "quote pinned to the resolved branch").toBeGreaterThanOrEqual(400);

    await admin.context.close();
    await customer.context.close();
  });

  test("a held product cannot be ordered even by direct id", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    const res = await customer.req.post("/api/orders/", {
      data: {
        branch_id: world.branchA.id,
        payment_method: "cash",
        delivery_address: "Dhaka",
        fulfillment_type: "delivery",
        ...world.pointA,
        items: [{ product_id: world.heldProduct.id, quantity: 1 }],
      },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);

    await admin.context.close();
    await customer.context.close();
  });
});

test.describe("Admin changes reach the right branch", () => {
  test("an edit to branch A's product shows for A and never for B", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const nearA = await newSession(browser, "customer");
    const nearB = await newSession(browser, "qa_upload_1");
    await setLocation(nearA.req, world.pointA);
    await setLocation(nearB.req, world.pointB);

    const renamed = uniq("Renamed");
    expect(
      (await admin.req.patch(`/api/products/${world.aProduct.id}/`, { data: { name: renamed } })).status(),
    ).toBe(200);

    expect(await homeNames(nearA.page), "A sees the edit").toContain(renamed);
    expect(await homeNames(nearB.page), "B never sees A's product").not.toContain(renamed);

    await admin.context.close();
    await nearA.context.close();
    await nearB.context.close();
  });

  test("two customers do not receive each other's catalogue from cache", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);

    // A loads first and would warm any shared cache entry.
    const nearA = await newSession(browser, "customer");
    await setLocation(nearA.req, world.pointA);
    const aNames = await homeNames(nearA.page);
    expect(aNames).toContain(world.aProduct.name);

    // B then loads the same URL in a different session.
    const nearB = await newSession(browser, "qa_upload_1");
    await setLocation(nearB.req, world.pointB);
    const bNames = await homeNames(nearB.page);

    expect(bNames, "B must not receive A's branch").not.toContain(world.aProduct.name);
    expect(bNames, "B receives its own branch").toContain(world.bProduct.name);

    // And A is still correct afterwards — the reverse leak.
    expect(await homeNames(nearA.page)).not.toContain(world.bProduct.name);

    await admin.context.close();
    await nearA.context.close();
    await nearB.context.close();
  });

  test("existing orders are unchanged by later product edits", async ({ browser }) => {
    // 03:45–04:00 Dhaka: a delivery order is refused by design (night last order).
    // 04:00–11:00 Dhaka: the whole platform is closed by design (item 5).
    test.skip(inNightOrderBlackout(), NIGHT_BLACKOUT_REASON);
    test.skip(isDhakaFullClosureWindow(), FULL_CLOSURE_REASON);
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    const placed = await customer.req.post("/api/orders/", {
      data: {
        branch_id: world.branchA.id,
        payment_method: "cash",
        delivery_address: "Dhaka",
        fulfillment_type: "delivery",
        ...world.pointA,
        items: [{ product_id: world.aProduct.id, quantity: 1 }],
      },
    });
    expect(placed.status()).toBe(201);
    const order = await placed.json();
    const line = order.items[0];

    await admin.req.patch(`/api/products/${world.aProduct.id}/`, {
      data: {
        name: uniq("Later"),
        variations: JSON.stringify([{ name: "Std", price: 9999, isDefault: true, isEnabled: true }]),
      },
    });

    const readBack = await (await customer.req.get(`/api/orders/${order.id}/`)).json();
    expect(readBack.items[0].product_name, "snapshot name").toBe(line.product_name);
    expect(readBack.items[0].unit_price, "snapshot price").toBe(line.unit_price);

    await admin.context.close();
    await customer.context.close();
  });
});

test.describe("Login behaviour is unchanged", () => {
  test("a customer still lands on /", async ({ page }) => {
    await login(page, "customer");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page).toHaveURL(atPath("/"));
  });

  for (const role of ["super_admin", "branch_manager", "rider"] as const) {
    test(`${role} still lands on ${ROLE_HOME[role]}`, async ({ page }) => {
      await login(page, role);
      expect(new URL(page.url()).pathname).toBe(ROLE_HOME[role]);
    });
  }
});

/**
 * DELIVER-TO SELECTION — the customer may now point the homepage at one of their
 * own saved addresses, or at any live branch, through the "mad_scope" cookie.
 *
 * The two things these tests hold down are opposites, and both matter:
 *   1. the selection really does move the catalogue, including to a branch that
 *      cannot reach the customer (the whole reason the feature exists);
 *   2. it is a VIEW scope and nothing more — it never widens what the APIs
 *      return, and a scope the customer is not entitled to is ignored rather
 *      than honoured.
 */
test.describe("The homepage follows the customer's deliver-to selection", () => {
  /** Marks addresses this suite creates, so a later run can clear its own leftovers. */
  const PROBE_PREFIX = "ScopeProbe Rd";
  /** Also matches probes written by earlier revisions of this suite. */
  const PROBE_RE = /^Scope(Probe)? Rd-/;

  /** Point a session at a branch or a saved address, the way the picker does. */
  async function setScope(context: BrowserContext, value: string) {
    await context.addCookies([{ name: "mad_scope", value, url: E2E_ORIGIN }]);
  }

  /**
   * A saved address at a given point.
   *
   * Saved addresses are capped (LIMITS.maxSavedAddresses = 5) and the test
   * database is persistent, so probes left by earlier runs eventually fill the
   * quota and every later run fails at creation. Clear this suite own probes
   * first, which keeps the suite idempotent without touching a customer real
   * addresses.
   */
  async function makeAddress(req: APIRequestContext, point: { lat: number; lng: number }) {
    const existing = await (await req.get("/api/customer/addresses/?page_size=100")).json();
    const rows = (existing.results ?? existing.addresses ?? []) as { id: number; address: string }[];
    for (const row of rows) {
      if (typeof row.address === "string" && PROBE_RE.test(row.address)) {
        await req.delete(`/api/customer/addresses/${row.id}/`);
      }
    }
    const res = await req.post("/api/customer/addresses/", {
      data: {
        label: "Office",
        address: uniq(PROBE_PREFIX),
        latitude: String(point.lat),
        longitude: String(point.lng),
      },
    });
    expect(res.status(), `address created (${await res.text()})`).toBe(201);
    return (await res.json()) as { id: number };
  }

  test("browsing another branch swaps the catalogue and says it cannot deliver", async ({
    browser,
  }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    // Standing at A, deliberately looking at B — "I will be there at five".
    await setScope(customer.context, `b:${world.branchB.id}`);
    const names = await homeNames(customer.page);

    expect(names, "the chosen branch's products").toContain(world.bProduct.name);
    expect(names, "not the branch they are standing in").not.toContain(world.aProduct.name);

    const bar = customer.page.getByTestId("home-branch-bar");
    await expect(bar).toHaveAttribute("data-branch-state", "ok");
    await expect(bar).toHaveAttribute("data-browse-only", "true");
    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(world.branchB.name);
    await expect(customer.page.getByTestId("home-browse-only")).toBeVisible();
    // No distance and no fee: both describe a delivery that cannot happen here.
    await expect(customer.page.getByTestId("home-branch-distance")).toHaveCount(0);
    await expect(customer.page.getByTestId("home-branch-fee")).toHaveCount(0);

    await admin.context.close();
    await customer.context.close();
  });

  test("a saved address near another branch reprices, it does not merely browse", async ({
    browser,
  }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);

    // The "ordering for someone across town" case: the destination is a real row.
    const address = await makeAddress(customer.req, world.pointB);
    await setScope(customer.context, `a:${address.id}`);
    const names = await homeNames(customer.page);

    expect(names, "the address's branch").toContain(world.bProduct.name);
    expect(names, "not the phone's branch").not.toContain(world.aProduct.name);

    const bar = customer.page.getByTestId("home-branch-bar");
    await expect(bar).toHaveAttribute("data-browse-only", "false");
    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(world.branchB.name);
    // A real destination, so the delivery facts are real too.
    await expect(customer.page.getByTestId("home-branch-distance")).toBeVisible();

    await admin.context.close();
    await customer.context.close();
  });

  test("another customer's address id is ignored", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);

    const other = await newSession(browser, "qa_upload_1");
    const stolen = await makeAddress(other.req, world.pointB);

    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);
    await setScope(customer.context, `a:${stolen.id}`);
    const names = await homeNames(customer.page);

    // Falls back to their own point rather than honouring a row they do not own.
    expect(names, "their own branch").toContain(world.aProduct.name);
    expect(names, "never the other customer's branch").not.toContain(world.bProduct.name);
    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(world.branchA.name);

    await admin.context.close();
    await other.context.close();
    await customer.context.close();
  });

  test("an archived branch id is ignored", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const doomed = await makeBranch(admin.req);
    expect((await admin.req.post(`/api/branches/${doomed.id}/archive`)).status()).toBe(200);

    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);
    await setScope(customer.context, `b:${doomed.id}`);

    await customer.page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(world.branchA.name);

    await admin.context.close();
    await customer.context.close();
  });

  test("a malformed scope cookie resolves normally", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);
    await setScope(customer.context, "b:not-a-number");

    await customer.page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(world.branchA.name);

    await admin.context.close();
    await customer.context.close();
  });

  test("the scope is a view lens, never an authorisation change", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);
    // Browsing B in the strongest possible sense — and it must buy nothing.
    await setScope(customer.context, `b:${world.branchB.id}`);

    const list = await customer.req.get(`/api/products/?branch_id=${world.branchB.id}&page_size=200`);
    expect(list.status()).toBe(200);
    const names = ((await list.json()).results as { name: string }[]).map((p) => p.name);
    expect(names, "the API still answers for the RESOLVED branch").not.toContain(
      world.bProduct.name,
    );
    expect(names).toContain(world.aProduct.name);

    expect(
      (await customer.req.get(`/api/products/${world.bProduct.id}/`)).status(),
      "the browsed branch's product detail is still not readable",
    ).toBe(404);

    expect(
      (await customer.req.get(`/api/orders/`, { failOnStatusCode: false })).status(),
      "sanity: the session is live",
    ).toBe(200);

    await admin.context.close();
    await customer.context.close();
  });

  test("ordering the browsed branch's product for DELIVERY is still refused", async ({
    browser,
  }) => {
    const admin = await newSession(browser, "super_admin");
    const world = await buildWorld(admin);
    const customer = await newSession(browser, "customer");
    await setLocation(customer.req, world.pointA);
    await setScope(customer.context, `b:${world.branchB.id}`);

    const res = await customer.req.post("/api/orders/", {
      data: {
        branch_id: world.branchB.id,
        items: [{ product_id: world.bProduct.id, quantity: 1 }],
        payment_method: "cash_on_delivery",
        delivery_address: "Scope test",
        fulfillment_type: "delivery",
        lat: world.pointA.lat,
        lng: world.pointA.lng,
      },
    });
    expect(res.status(), "coverage is enforced from the trusted point, not the cookie").toBe(400);

    await admin.context.close();
    await customer.context.close();
  });

  // BUG FIX — a saved address with NO map pin used to be permanently disabled
  // in this picker (gated on hasCoordinates alone), even though resolveDeliverTo
  // already resolves a branch for it by NAME when its area/sub-area matches a
  // master-list locality — exactly how checkout's own coverage-by-name works
  // (coverageForAddress). Pins that a pinless address whose area a branch lists
  // is selectable here too, and that picking it actually moves the catalogue.
  test("a pinless address naming a covered locality is selectable, and moves the catalogue", async ({
    browser,
  }) => {
    const admin = await newSession(browser, "super_admin");
    const branch = await makeBranch(admin.req);
    const cat = await makeCategory(admin.req, branch.id);
    const product = await makeProduct(admin.req, branch.id, cat.id);

    // A BRAND NEW zone + locality, made just for this test. Picking from the
    // shared master list risks a locality Main Branch (or another leftover
    // branch from an earlier run — this test DB is never truly wiped) already
    // covers too, which would make IT the nearest match instead of this test's
    // own branch. A fresh pair guarantees nothing has ever covered it before.
    const zoneRes = await admin.req.post("/api/area-zones", { data: { name: uniq("PinlessZone") } });
    expect(zoneRes.status()).toBe(201);
    const zoneBody = (await zoneRes.json()) as { id: number; name: string };
    const zoneId = zoneBody.id;
    const zoneName = zoneBody.name;
    const localityRes = await admin.req.post("/api/area-localities", {
      data: { zone_id: zoneId, name: uniq("PinlessLoc") },
    });
    expect(localityRes.status()).toBe(201);
    const locality = (await localityRes.json()) as { id: number; name: string };
    const areaRes = await admin.req.post("/api/delivery-areas", {
      data: {
        branch_id: branch.id,
        name: locality.name,
        locality_id: locality.id,
        coverage_window: "both",
        estimated_delivery_minutes: 40,
        delivery_charge: 45,
      },
    });
    expect(areaRes.status()).toBe(201);

    const customer = await newSession(browser, "customer");
    // Standing nowhere near the branch's own geometry — coverage below can only
    // come from the named locality, never the branch's radius. A random point
    // far out at sea, NOT a fixed "parked far away" landmark: several other
    // specs reuse fixed coordinates for that purpose, and this test DB is never
    // truly wiped between runs, so a fixed point can collide with a leftover
    // branch's real geometry from an earlier run and falsely cover the customer.
    await setLocation(customer.req, { lat: -10 + Math.random(), lng: -20 + Math.random() });
    // The 5-address cap is real and this shared fixture account accumulates
    // addresses across the whole suite's runs — free a slot the same way
    // makeAddress() keeps its own probes from piling up.
    const existingAddrs = (await (await customer.req.get("/api/customer/addresses/?page_size=100")).json())
      .results as { id: number }[];
    for (const row of existingAddrs) {
      await customer.req.delete(`/api/customer/addresses/${row.id}/`);
    }
    const addrRes = await customer.req.post("/api/customer/addresses/", {
      data: { label: "Home", address: uniq("PinlessRd"), main_area: zoneName, sub_area: locality.name },
    });
    expect(addrRes.status(), `pinless address saved (${await addrRes.text()})`).toBe(201);
    const address = (await addrRes.json()) as { id: number };

    await customer.page.goto("/", { waitUntil: "domcontentloaded" });
    await customer.page.getByTestId("home-select-address").click();
    const row = customer.page.getByTestId(`deliver-to-address-${address.id}`);
    await expect(row).toBeVisible();
    await expect(row, "a pinless address that names a covered locality must be pickable").toBeEnabled();
    await row.click();

    await expect(customer.page.getByTestId("home-branch-name")).toHaveText(branch.name);
    const names = await customer.page.locator("article h4").allInnerTexts();
    expect(names, "the picked address's branch").toContain(product.name);

    await admin.context.close();
    await customer.context.close();
  });
});
