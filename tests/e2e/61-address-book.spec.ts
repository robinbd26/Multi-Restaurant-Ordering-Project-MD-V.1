import { test, expect } from "@playwright/test";
import { newSession } from "./helpers";

/**
 * Customer Address Book — compact two-column flow.
 *
 * PHASE 3 changed two fields, and this suite pins both:
 *   - the nickname is a CHOICE (Home / Office / Custom), with a typed name only
 *     for Custom, stored canonically rather than as whatever word was typed;
 *   - the main area is the DATABASE master list only. "+ Add your Own" is gone
 *     from it, because that is the zone coverage is matched on; the sub-area
 *     still offers it, and a custom sub-area is covered by nobody until a branch
 *     manager adds it.
 */
const SEEDED_ZONES = [
  "Banani",
  "Gulshan",
  "Dhanmondi",
  "Mohammodpur",
  "Khilgaon",
  "Bailey Road",
  "Mirpur",
  "Uttara",
  "Basundhara",
];

test.describe("Customer address book (English locale)", () => {
  test("nickname choice, master-list main area, sub-area keeps + Add your Own", async ({ browser }) => {
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
    await page.getByTestId("mode-map").click();
    await expect(page.getByTestId("selected-location")).toBeVisible();
    await expect(page.getByTestId("confirm-location")).toBeDisabled();
    await page.getByTestId("mode-manual").click();

    // Nickname: a three-way choice. The typed name only appears for Custom.
    const nickname = page.getByTestId("addr-nickname");
    await expect(nickname).toBeVisible();
    const nicknameOptions = (await nickname.locator("option").allTextContents()).map((s) => s.trim());
    expect(nicknameOptions).toEqual(["Home", "Office", "Custom"]);
    await expect(nickname).toHaveValue("home");
    await expect(page.getByTestId("addr-location-name")).toHaveCount(0);
    await nickname.selectOption("custom");
    await expect(page.getByTestId("addr-location-name")).toBeVisible();
    await nickname.selectOption("home");
    await expect(page.getByTestId("addr-location-name")).toHaveCount(0);

    const mainSelect = page.getByTestId("addr-main-area");
    const subSelect = page.getByTestId("addr-sub-area");

    // Main area: placeholder first, nothing preselected, then the master list in
    // operations' order. No free text here — this is what coverage matches on.
    await expect(mainSelect).toHaveValue("");
    const mainOptions = (await mainSelect.locator("option").allTextContents()).map((s) => s.trim());
    expect(mainOptions[0]).toBe("Select Your Area");
    expect(mainOptions.slice(1, 1 + SEEDED_ZONES.length)).toEqual(SEEDED_ZONES);
    expect(mainOptions, "no custom main area").not.toContain("+ Add your Own");
    expect(await page.getByTestId("addr-custom-main-area").count()).toBe(0);

    // The sub-area waits for a main area.
    await expect(subSelect).toBeDisabled();

    // Basundhara → its real localities from the sheets, then its own custom entry.
    await mainSelect.selectOption("Basundhara");
    await expect(subSelect).toBeEnabled();
    await expect
      .poll(async () => (await subSelect.locator("option").allTextContents()).map((s) => s.trim()).slice(1))
      .toEqual(["All Bashundhara", "Nikonjo-1", "Nikonjo-2", "+ Add your Own"]);

    // Banani → only Banani localities, never another zone's, and custom last.
    await mainSelect.selectOption("Banani");
    const bananiSubs = (await subSelect.locator("option").allTextContents()).map((s) => s.trim());
    expect(bananiSubs).toContain("All Over Banani");
    expect(bananiSubs).not.toContain("Gulshan-1");
    expect(bananiSubs).not.toContain("Mirpur-1");
    expect(bananiSubs).not.toContain("Sector-1");
    expect(bananiSubs.at(-1)).toBe("+ Add your Own");

    // A custom SUB-area is still allowed, as its own free-text input.
    await subSelect.selectOption({ value: "__custom__" });
    const customSubArea = page.getByLabel("Enter Area Name");
    await expect(customSubArea).toBeVisible();
    await customSubArea.fill("New Custom Sub-Area");
    await expect(page.getByTestId("preview-sub-area")).toContainText("New Custom Sub-Area");

    // Road/Lane + House/Plot are optional free-text fields.
    expect(await page.locator('select[name="road_lane"]').count()).toBe(0);
    await expect(page.getByTestId("addr-road-lane")).toBeVisible();
    await expect(page.getByTestId("addr-house-plot")).toBeVisible();
    expect(await page.getByText(/Select Road\/Lane Number \*/).count()).toBe(0);
    expect(await page.getByText(/House \/ Plot Number \*/).count()).toBe(0);

    await page.getByTestId("cancel-address").click();
    await expect(form).toBeHidden();
  });

  test("save flow: a Custom nickname round-trips through save and edit", async ({ browser }) => {
    const { page } = await newSession(browser, "customer");
    await page.goto("/customer/addresses");
    await page.getByTestId("add-address").click();
    await page.getByTestId("mode-manual").click();

    await page.getByTestId("addr-nickname").selectOption("custom");
    await page.getByTestId("addr-location-name").fill("Parents' House");

    await page.getByTestId("addr-main-area").selectOption("Banani");
    await page.getByTestId("addr-sub-area").selectOption("All Over Banani");
    await page.getByTestId("addr-road-lane").fill("Lane 5");
    await page.getByTestId("addr-flat-number").fill("3A");
    await page.getByTestId("addr-landmark").fill("Near Banani Lake");

    await page.getByTestId("save-address").click();
    await expect(page.getByTestId("address-form")).toBeHidden();

    const savedCard = page.locator('[data-testid^="saved-address-"]', { hasText: "Parents' House" }).first();
    await expect(savedCard).toBeVisible();
    await expect(savedCard).toContainText("All Over Banani");

    // Stored canonically: a custom name is label "Others" + custom_label.
    const list = (await (await page.request.get("/api/customer/addresses/")).json()) as {
      results: { id: number; label: string; custom_label: string }[];
    };
    const stored = list.results.find((r) => r.custom_label === "Parents' House");
    expect(stored?.label, "custom nickname stored canonically").toBe("Others");

    // Edit round-trips the choice AND the typed name.
    await savedCard.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByTestId("address-form")).toBeVisible();
    await expect(page.getByTestId("mode-manual")).toHaveClass(/border-brand-500/);
    await expect(page.getByTestId("map-mode-section")).toHaveCount(0);
    await expect(page.getByTestId("addr-nickname")).toHaveValue("custom");
    await expect(page.getByTestId("addr-location-name")).toHaveValue("Parents' House");
    await expect(page.getByTestId("addr-main-area")).toHaveValue("Banani");
    await expect(page.getByTestId("addr-sub-area")).toHaveValue("All Over Banani");
    await expect(page.getByTestId("addr-road-lane")).toHaveValue("Lane 5");
    await expect(page.getByTestId("addr-flat-number")).toHaveValue("3A");
    await expect(page.getByTestId("addr-landmark")).toHaveValue("Near Banani Lake");
    await page.getByTestId("cancel-address").click();

    // Clean up so repeat runs never accumulate probes against the 5-address cap.
    for (const a of list.results.filter(
      (r) => r.custom_label === "Parents' House" || r.label === "Parents' House",
    )) {
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
    expect(created.main_area).toBe("Banani");
    expect(created.road_lane).toBe("76");
    expect(created.latitude).toBeCloseTo(23.7805, 4);
    expect(created.longitude).toBeCloseTo(90.4123, 4);
    expect(created.map_address).toBe("House 25, Road 11, Banani, Dhaka 1212, Bangladesh");
    expect(created.place_id).toBe("ChIJ0V1o4VWFTjERU93xZ8vCTBE");
    expect(created.latitude).not.toBe(0);
    expect(created.longitude).not.toBe(0);

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

    await page.goto("/customer/addresses");
    const saved = page.locator('[data-testid^="saved-address-"]', { hasText: "Road 7, Gulshan 2" }).first();
    await expect(saved).toBeVisible();
    await expect(saved.getByTestId("saved-map-address")).toContainText("Road 7, Gulshan 2, Dhaka 1212, Bangladesh");

    await page.reload();
    await expect(saved).toBeVisible();
    const listResp = await page.request.get("/api/customer/addresses/");
    expect(listResp.status()).toBe(200);
    const listJson = (await listResp.json()) as {
      results: { id: number; place_id: string; latitude?: number | null; longitude?: number | null }[];
    };
    const record = listJson.results.find((r) => r.id === created.id);
    expect(record?.latitude).toBeCloseTo(23.7949, 4);
    expect(record?.longitude).toBeCloseTo(90.4127, 4);
    expect(record?.place_id).toBe("ChIJ4TdPxFu3VTcR2M1sxgVvjjA");

    const del = await page.request.delete(`/api/customer/addresses/${created.id}/`);
    expect(del.status()).toBe(204);
  });
});
