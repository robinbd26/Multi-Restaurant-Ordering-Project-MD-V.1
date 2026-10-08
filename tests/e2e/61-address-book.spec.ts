import { test, expect } from "@playwright/test";
import { clearCustomerAddresses, newSession, setLocale } from "./helpers";

/**
 * Customer Address Book (reviews-complaints-addresses round).
 *
 * Adding an address has TWO SEPARATE MODES:
 *   - Pick on map: "Use my current location" first, search, drag; the address
 *     fills itself; only a label and one optional flat/floor/landmark line.
 *   - Enter manually: area (required), road, house, the same optional line, and
 *     its own pin step ("Find on map"), because coverage is decided by the pin.
 * Switching modes never hides a control the active mode needs (the old form hid
 * the map, and with it the pin, in manual mode).
 *
 * Addresses are created with a marker so cleanup only removes this spec's rows.
 */
const MARK = /e2e-61/;

test.describe("Customer address book (English locale)", () => {
  // The seeded customer is shared and other specs leave addresses behind, so
  // this spec starts from an empty book (the fixture doc asks every spec that
  // adds addresses to do so) and cleans its own rows up afterwards.
  test.beforeEach(async ({ browser }) => {
    const { req, context } = await newSession(browser, "customer");
    await clearCustomerAddresses(req);
    await context.close();
  });

  test("two clean modes: map mode leads with current location; manual mode keeps its own pin map", async ({ browser }) => {
    const { page, context } = await newSession(browser, "customer");
    await setLocale(context, "en");
    await page.goto("/customer/addresses");
    // My Addresses manages saved addresses only: no live-location card here.
    await expect(page.getByText(/count of|of 5 saved/i).first()).toBeVisible();
    await page.getByTestId("add-address").click();
    const form = page.getByTestId("address-form");
    await expect(form).toBeVisible();

    // Map mode (default): current location first, no manual fields.
    await expect(page.getByTestId("map-mode-section")).toBeVisible();
    await expect(page.getByTestId("addr-map-gps")).toBeVisible();
    await expect(page.getByTestId("addr-main-area")).toHaveCount(0);
    await expect(page.getByTestId("addr-flat-number")).toBeVisible();
    await expect(page.getByTestId("save-address")).toHaveText(/confirm location/i);

    // Manual mode: the typed fields AND its own map; the map-mode section is gone.
    await page.getByTestId("mode-manual").click();
    await expect(page.getByTestId("manual-mode-section")).toBeVisible();
    await expect(page.getByTestId("map-mode-section")).toHaveCount(0);
    await expect(page.getByTestId("addr-main-area")).toBeVisible();
    await expect(page.getByTestId("addr-road-lane")).toBeVisible();
    await expect(page.getByTestId("addr-house-plot")).toBeVisible();
    await expect(page.getByTestId("addr-manual-map")).toBeVisible();
    await expect(page.getByTestId("addr-find-on-map")).toBeVisible();

    // Saving manually without area or pin explains both, and does not save.
    await page.getByTestId("save-address").click();
    await expect(form).toBeVisible();
    await expect(page.getByText(/place the pin first/i)).toBeVisible();

    // Labels: Home / Work / Other; Other's name is optional.
    for (const kind of ["home", "office", "custom"]) await expect(page.getByTestId(`addr-nickname-${kind}`)).toBeVisible();
    await page.getByTestId("addr-nickname-custom").click();
    await expect(page.getByTestId("addr-location-name")).toBeVisible();

    await page.getByTestId("cancel-address").click();
    await expect(form).toBeHidden();
    await context.close();
  });

  test("a manual address with a pin saves, and its label and extra line round-trip through edit", async ({ browser }) => {
    const { page, req, context } = await newSession(browser, "customer");
    await setLocale(context, "en");
    // A pinned address made through the API, then edited in the form.
    const created = await req.post("/api/customer/addresses/", {
      data: {
        label: "Others",
        custom_label: "Parents",
        address: "Flat 3A, House 8, Lane 5, Banani, Dhaka e2e-61",
        main_area: "Banani",
        road_lane: "Lane 5",
        house_plot: "House 8",
        flat_number: "Flat 3A",
        latitude: 23.7937,
        longitude: 90.4066,
        is_default: false,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const row = (await created.json()) as { id: number; label: string; custom_label: string };
    expect(row.label).toBe("Others");

    await page.goto("/customer/addresses");
    const card = page.getByTestId(`saved-address-${row.id}`);
    await expect(card).toContainText("Parents");
    await card.getByRole("button", { name: "Edit" }).click();
    // A typed (no map text) address reopens in manual mode, values intact.
    await expect(page.getByTestId("manual-mode-section")).toBeVisible();
    await expect(page.getByTestId("addr-main-area")).toHaveValue("Banani");
    await expect(page.getByTestId("addr-road-lane")).toHaveValue("Lane 5");
    await expect(page.getByTestId("addr-flat-number")).toHaveValue("Flat 3A");
    await expect(page.getByTestId("addr-location-name")).toHaveValue("Parents");

    await page.getByTestId("addr-flat-number").fill("Flat 4B");
    await page.getByTestId("save-address").click();
    await expect(page.getByTestId("address-form")).toBeHidden();
    const after = (await (await req.get("/api/customer/addresses/")).json()) as {
      results: { id: number; flat_number: string; address: string; custom_label: string }[];
    };
    const updated = after.results.find((r) => r.id === row.id)!;
    expect(updated.flat_number).toBe("Flat 4B");
    expect(updated.address).toContain("Flat 4B");
    expect(updated.custom_label).toBe("Parents");

    await clearCustomerAddresses(req, MARK);
    await clearCustomerAddresses(req, /Flat 4B/);
    await context.close();
  });

  test("the 5-address cap disables Add, and the server still refuses a sixth", async ({ browser }) => {
    const { page, req, context } = await newSession(browser, "customer");
    await setLocale(context, "en");
    const existing = ((await (await req.get("/api/customer/addresses/?active=1")).json()) as { results: unknown[] }).results.length;
    for (let i = existing; i < 5; i++) {
      const res = await req.post("/api/customer/addresses/", {
        data: { label: "Home", address: `Cap ${i} e2e-61`, latitude: 23.79, longitude: 90.41, is_default: false },
      });
      expect(res.status()).toBe(201);
    }
    await page.goto("/customer/addresses");
    await expect(page.getByTestId("add-address")).toBeDisabled();
    const sixth = await req.post("/api/customer/addresses/", {
      data: { label: "Home", address: "Cap 6 e2e-61", latitude: 23.79, longitude: 90.41, is_default: false },
    });
    expect(sixth.status()).toBe(400);
    await clearCustomerAddresses(req, MARK);
    await context.close();
  });

  test("map address round-trip: coordinates + reverse-geocoded map address are stored and returned", async ({ browser }) => {
    const { req, context } = await newSession(browser, "customer");
    const createResp = await req.post("/api/customer/addresses/", {
      data: {
        label: "Home",
        address: "Flat B10, House 25, Road 11, Banani, Dhaka e2e-61",
        area: "Banani",
        main_area: "Banani",
        flat_number: "Flat B10",
        map_address: "House 25, Road 11, Banani, Dhaka 1212, Bangladesh",
        place_id: "ChIJ0V1o4VWFTjERU93xZ8vCTBE",
        latitude: 23.7805,
        longitude: 90.4123,
        is_default: false,
      },
    });
    expect(createResp.status()).toBe(201);
    const created = (await createResp.json()) as { id: number; map_address: string; latitude: number; longitude: number };
    expect(created.latitude).toBeCloseTo(23.7805, 4);
    expect(created.map_address).toBe("House 25, Road 11, Banani, Dhaka 1212, Bangladesh");

    const patchResp = await req.patch(`/api/customer/addresses/${created.id}/`, {
      data: { label: "Home", map_address: "Road 7, Gulshan 2, Dhaka 1212, Bangladesh", latitude: 23.7949, longitude: 90.4127 },
    });
    expect(patchResp.status()).toBe(200);
    const updated = (await patchResp.json()) as { map_address: string; latitude: number };
    expect(updated.latitude).toBeCloseTo(23.7949, 4);
    expect(updated.map_address).toBe("Road 7, Gulshan 2, Dhaka 1212, Bangladesh");
    await clearCustomerAddresses(req, MARK);
    await context.close();
  });
});
