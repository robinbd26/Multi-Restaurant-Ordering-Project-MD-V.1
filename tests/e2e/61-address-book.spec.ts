import { test, expect } from "@playwright/test";
import { newSession } from "./helpers";

/**
 * Customer Address Book — compact two-column flow (free-text "Location Name" /
 * "Select Your Area" / custom area / dynamic "Select Area" with its own
 * "+ Add your Own" / optional free-text Road+Lane & House-Plot / right-side
 * preview / direct save, no intermediate address-type modal).
 */
test.describe("Customer address book (English locale)", () => {
  test("dropdown spec: + Add your Own first, custom area input, dynamic sub-areas, Basundhara", async ({
    browser,
  }) => {
    const { page } = await newSession(browser, "customer");
    await page.goto("/customer/addresses");
    await page.getByTestId("add-address").click();
    const form = page.getByTestId("address-form");
    await expect(form).toBeVisible();

    // Method chooser: map-first, with "Add Manually" as a first-class
    // alternative that hides the map entirely.
    await expect(page.getByTestId("entry-mode")).toBeVisible();
    await expect(page.getByTestId("mode-map")).toBeVisible();
    await expect(page.getByTestId("mode-manual")).toBeVisible();
    await page.getByTestId("mode-manual").click();
    await expect(page.getByTestId("manual-mode-hint")).toBeVisible();
    await expect(page.getByTestId("map-mode-section")).toHaveCount(0);
    // Map mode exposes the Selected Location block with a disabled Confirm
    // button until a pin exists (no fake coordinates ever).
    await page.getByTestId("mode-map").click();
    await expect(page.getByTestId("selected-location")).toBeVisible();
    await expect(page.getByTestId("confirm-location")).toBeDisabled();
    await page.getByTestId("mode-manual").click();

    const mainSelect = page.getByTestId("addr-main-area");
    const subSelect = page.getByTestId("addr-sub-area");

    // Main area dropdown order: (hidden placeholder) → "+ Add your Own" → 9 curated areas.
    const mainOptions = (await mainSelect.locator("option").allTextContents()).map((s) => s.trim());
    expect(mainOptions[1]).toBe("+ Add your Own");
    expect(mainOptions).toEqual([
      "Select Your Area",
      "+ Add your Own",
      "Banani",
      "Gulshan",
      "Dhanmondi",
      "Mohammodpur",
      "Khilgaon",
      "Beaily road",
      "Mirpur",
      "Uttara",
      "Basundhara",
    ]);
    // "+ Add your Own" is the first selectable option and never at the bottom.
    expect(mainOptions.at(-1)).toBe("Basundhara");
    expect(mainOptions[mainOptions.length - 2]).toBe("Uttara");

    // Selecting "+ Add your Own" reveals the "Enter Your Area Name" text input
    // (NOT a dropdown option) with the required placeholder.
    await mainSelect.selectOption({ value: "__custom__" });
    const customArea = page.getByLabel("Enter Your Area Name");
    await expect(customArea).toBeVisible();
    await expect(customArea).toHaveAttribute("placeholder", "e.g. Bashundhara Residential Area");
    await customArea.fill("Shyamoli");
    // Custom area appears in the live preview — under its clear "Area" label,
    // with no empty optional rows (Road/Lane, House/Plot etc. stay hidden).
    await expect(page.getByTestId("preview-area")).toContainText("Area");
    await expect(page.getByTestId("preview-area")).toContainText("Shyamoli");
    await expect(page.getByTestId("preview-road-lane")).toHaveCount(0);
    await expect(page.getByTestId("preview-house-plot")).toHaveCount(0);

    // Per req #4–6, "Select Area" only ever shows the predefined sub-areas for
    // the chosen MAIN area. A custom main area ("+ Add your Own") has no
    // curated sub-area list, so the dropdown is DISABLED and contains neither a
    // "+ Add your Own" option nor an "Enter Area Name" choice — the custom-area
    // text input ("Enter Your Area Name") is the only custom entry point.
    await expect(subSelect).toBeDisabled();
    const subForCustom = (await subSelect.locator("option").allTextContents()).map((s) => s.trim());
    expect(subForCustom).toEqual(["Select Area"]);
    expect(await page.getByTestId("addr-custom-area").count()).toBe(0);

    // Basundhara → its three sub-areas, then its own "+ Add your Own" at the end.
    await mainSelect.selectOption("Basundhara");
    await expect(customArea).toBeHidden();
    await expect(subSelect).toBeEnabled();
    await expect
      .poll(async () => (await subSelect.locator("option").allTextContents()).map((s) => s.trim()).slice(1))
      .toEqual(["Basundhara ALL", "Nikunju-1", "Nikunju-2", "+ Add your Own"]);

    // Banani → only Banani-related sub-areas, never another area's, plus its
    // own "+ Add your Own" at the end (same sentinel the main area offers).
    await mainSelect.selectOption("Banani");
    const bananiSubs = (await subSelect.locator("option").allTextContents()).map((s) => s.trim());
    expect(bananiSubs.slice(1, -1)).toContain("All Over Banani");
    expect(bananiSubs).not.toContain("Gulshan-1");
    expect(bananiSubs).not.toContain("Mirpur -1");
    expect(bananiSubs).not.toContain("Sector -1");
    expect(bananiSubs.at(-1)).toBe("+ Add your Own");

    // Selecting "+ Add your Own" on the SUB-area reveals its own "Enter Area
    // Name" free-text input (req: every area's sub-area list gets this).
    await subSelect.selectOption({ value: "__custom__" });
    const customSubArea = page.getByLabel("Enter Area Name");
    await expect(customSubArea).toBeVisible();
    await customSubArea.fill("New Custom Sub-Area");
    await expect(page.getByTestId("preview-sub-area")).toContainText("New Custom Sub-Area");

    // "Select Area *" label (old "Select Your Area Name" wording gone).
    await expect(page.getByLabel("Select Area")).toBeAttached();

    // Road/Lane + House/Plot are free-text fields with NO required asterisk.
    expect(await page.locator('select[name="road_lane"]').count()).toBe(0);
    await expect(page.getByTestId("addr-road-lane")).toBeVisible();
    await expect(page.getByTestId("addr-house-plot")).toBeVisible();
    expect(await page.getByText(/Select Road\/Lane Number \*/).count()).toBe(0);
    expect(await page.getByText(/House \/ Plot Number \*/).count()).toBe(0);

    await page.getByTestId("cancel-address").click();
    await expect(form).toBeHidden();
  });

  test("save flow: Location Name input, direct save with no address-type modal", async ({ browser }) => {
    const { page } = await newSession(browser, "customer");
    await page.goto("/customer/addresses");
    await page.getByTestId("add-address").click();
    await page.getByTestId("mode-manual").click();

    // Location Name is a free-text input, not a preset dropdown/modal.
    const locationName = page.getByTestId("addr-location-name");
    await expect(locationName).toBeVisible();
    await locationName.fill("Parents' House");

    await page.getByTestId("addr-main-area").selectOption("Banani");
    await page.getByTestId("addr-sub-area").selectOption("All Over Banani");
    // Road/Lane and House/Plot both optional — leave House/Plot empty on purpose.
    await page.getByTestId("addr-road-lane").fill("Lane 5");
    await page.getByTestId("addr-flat-number").fill("3A");
    await page.getByTestId("addr-landmark").fill("Near Banani Lake");

    // Save submits directly — no intermediate "What Kind of Address is This?" step.
    await page.getByTestId("save-address").click();
    await expect(page.getByTestId("address-form")).toBeHidden();

    const savedCard = page.locator('[data-testid^="saved-address-"]', { hasText: "Parents' House" }).first();
    await expect(savedCard).toBeVisible();
    await expect(savedCard).toContainText("All Over Banani");

    // Edit round-trips every field back into the form, including the typed
    // Location Name. No coordinates were picked, so the address reopens in
    // MANUAL mode with no map section.
    await savedCard.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByTestId("address-form")).toBeVisible();
    await expect(page.getByTestId("mode-manual")).toHaveClass(/border-brand-500/);
    await expect(page.getByTestId("map-mode-section")).toHaveCount(0);
    await expect(page.getByTestId("addr-location-name")).toHaveValue("Parents' House");
    await expect(page.getByTestId("addr-main-area")).toHaveValue("Banani");
    await expect(page.getByTestId("addr-sub-area")).toHaveValue("All Over Banani");
    await expect(page.getByTestId("addr-road-lane")).toHaveValue("Lane 5");
    await expect(page.getByTestId("addr-flat-number")).toHaveValue("3A");
    await expect(page.getByTestId("addr-landmark")).toHaveValue("Near Banani Lake");
    await page.getByTestId("cancel-address").click();

    // Clean up via the authenticated API (robuster than clicking each card) so
    // repeat runs never accumulate "Parents' House" records in the test DB.
    const listResp = await page.request.get("/api/customer/addresses/");
    expect(listResp.status()).toBe(200);
    const listJson = (await listResp.json()) as { results: { id: number; label: string }[] };
    for (const a of listJson.results.filter((r) => r.label === "Parents' House")) {
      const res = await page.request.delete(`/api/customer/addresses/${a.id}/`);
      expect(res.status()).toBe(204);
    }
    await page.reload();
    await expect(page.locator('[data-testid^="saved-address-"]', { hasText: "Parents' House" })).toHaveCount(0);
  });

  test("map address round-trip: coordinates + reverse-geocoded map address are stored and returned", async ({
    browser,
  }) => {
    const { page } = await newSession(browser, "customer");

    // Simulates exactly what the Pick-on-Map flow posts: a real coordinate pair
    // together with the reverse-geocoded Google Maps address text and the
    // Google place id — all in ONE address record.
    const createResp = await page.request.post("/api/customer/addresses/", {
      data: {
        label: "Home",
        custom_label: "",
        address: "House/Plot 8, Flat B10\nRoad/Lane 76\nFalcon Tower\nBanani\nDhaka",
        area: "Banani",
        main_area: "Banani",
        sub_area: "Falcon Tower",
        road_lane: "76",
        house_plot: "8",
        flat_number: "B10",
        landmark: "Near Banani Lake",
        map_address: "House 25, Road 11, Banani, Dhaka 1212, Bangladesh",
        place_id: "ChIJ0V1o4VWFTjERU93xZ8vCTBE",
        latitude: 23.7805,
        longitude: 90.4123,
        is_default: false,
      },
    });
    expect(createResp.status()).toBe(201);
    const created = (await createResp.json()) as {
      id: number;
      main_area: string;
      road_lane: string;
      map_address: string;
      place_id: string;
      latitude?: number | null;
      longitude?: number | null;
    };
    // The coordinates, the Google Maps text AND the place id must come back
    // from the API — this is the exact data that was reported lost.
    expect(created.main_area).toBe("Banani");
    expect(created.road_lane).toBe("76");
    expect(created.latitude).toBeCloseTo(23.7805, 4);
    expect(created.longitude).toBeCloseTo(90.4123, 4);
    expect(created.map_address).toBe("House 25, Road 11, Banani, Dhaka 1212, Bangladesh");
    expect(created.place_id).toBe("ChIJ0V1o4VWFTjERU93xZ8vCTBE");

    // No fake 0,0 coordinates, ever.
    expect(created.latitude).not.toBe(0);
    expect(created.longitude).not.toBe(0);

    // A later pick (pin moved on the map) MUST overwrite the saved coordinates
    // AND the place id — the flow is stateful per pin, never "first pin wins".
    const patchResp = await page.request.patch(`/api/customer/addresses/${created.id}/`, {
      data: {
        label: "Home",
        map_address: "Road 7, Gulshan 2, Dhaka 1212, Bangladesh",
        place_id: "ChIJ4TdPxFu3VTcR2M1sxgVvjjA",
        latitude: 23.7949,
        longitude: 90.4127,
        is_default: false,
      },
    });
    expect(patchResp.status()).toBe(200);
    const updated = (await patchResp.json()) as {
      map_address: string;
      place_id: string;
      latitude?: number | null;
      longitude?: number | null;
    };
    expect(updated.latitude).toBeCloseTo(23.7949, 4);
    expect(updated.longitude).toBeCloseTo(90.4127, 4);
    expect(updated.map_address).toBe("Road 7, Gulshan 2, Dhaka 1212, Bangladesh");
    expect(updated.place_id).toBe("ChIJ4TdPxFu3VTcR2M1sxgVvjjA");

    // The saved card renders the stored map location (labeled, not a raw list).
    await page.goto("/customer/addresses");
    const saved = page.locator('[data-testid^="saved-address-"]', { hasText: "Road 7, Gulshan 2" }).first();
    await expect(saved).toBeVisible();
    await expect(saved.getByTestId("saved-map-address")).toContainText("Road 7, Gulshan 2, Dhaka 1212, Bangladesh");

    // A full reload must NOT reset the stored location — the record re-reads
    // from the DB with coordinates + place id intact.
    await page.reload();
    await expect(saved).toBeVisible();
    const listResp = await page.request.get("/api/customer/addresses/");
    expect(listResp.status()).toBe(200);
    const listJson = (await listResp.json()) as {
      results: {
        id: number;
        place_id: string;
        latitude?: number | null;
        longitude?: number | null;
      }[];
    };
    const record = listJson.results.find((r) => r.id === created.id);
    expect(record?.latitude).toBeCloseTo(23.7949, 4);
    expect(record?.longitude).toBeCloseTo(90.4127, 4);
    expect(record?.place_id).toBe("ChIJ4TdPxFu3VTcR2M1sxgVvjjA");

    // Clean up via the authenticated API.
    const del = await page.request.delete(`/api/customer/addresses/${created.id}/`);
    expect(del.status()).toBe(204);
  });
});