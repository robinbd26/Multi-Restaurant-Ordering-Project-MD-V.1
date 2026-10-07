import { test, expect, type APIRequestContext } from "@playwright/test";

import { activeZoneId, apiLogin, setLocale } from "./helpers";

/**
 * Ordering hours per brand and per channel (Part 2 of the brands / hours /
 * statuses round). Replaces specs 57 (single opening/closing pair) and 67 (the
 * hardcoded 04:00-11:00 platform closure), whose rules no longer exist.
 *
 *  - Only the branch's own manager or the super admin may change its hours, and
 *    every change is logged.
 *  - Placing an order checks every brand in the cart on the chosen channel,
 *    on the Asia/Dhaka clock, and names the closed brand and when it opens.
 *  - Slots crossing midnight are stored as given.
 *  - The branch delivery pause still stops delivery on top of the schedule.
 *
 * Time-independent: slots are built relative to the current Dhaka time.
 */

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

function dhakaMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return hh * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? "0");
}
const hm = (m: number) => {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};
const slot = (start: number, end: number, delivery: boolean, pickup: boolean) => ({ start: hm(start), end: hm(end), delivery, pickup });

async function world(admin: APIRequestContext) {
  const branchRes = await admin.post("/api/branches/", {
    data: {
      zone_id: String(await activeZoneId(admin)),
      name: uniq("HoursBr"),
      address: "Dhaka",
      phone: "01711119990",
      brands: "cheez,madchef",
      latitude: "23.78",
      longitude: "90.41",
      pickup_enabled: "true",
    },
  });
  expect(branchRes.status()).toBe(201);
  const branch = (await branchRes.json()) as { id: number; name: string };
  const product = async (brand: string) => {
    const res = await admin.post("/api/products/", {
      data: { branch_id: branch.id, name: uniq(`Hrs-${brand}`), brand, is_available: true, price: "150" },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as { id: number };
  };
  return { branch, cheez: await product("cheez"), madchef: await product("madchef") };
}

const pickupOrder = (customer: APIRequestContext, branchId: number, productId: number) =>
  customer.post("/api/orders/", {
    data: {
      branch_id: branchId,
      payment_method: "cash",
      delivery_address: "Pickup",
      fulfillment_type: "pickup",
      items: [{ product_id: productId, quantity: 1, variation_type: "THICK" }],
    },
  });

test.describe("brand hours", () => {
  test("only the branch's manager or the super admin may change hours; changes are logged", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const bm = await apiLogin(browser, "branch_manager");
    const customer = await apiLogin(browser, "customer");
    const { branch } = await world(admin.req);

    const hours = { brands: { cheez: { everyDay: [slot(660, 240, true, true)], days: {} } } };
    // The seeded branch manager does not manage this new branch.
    expect((await bm.req.put(`/api/branches/${branch.id}/hours`, { data: hours })).status()).toBe(403);
    expect((await customer.req.put(`/api/branches/${branch.id}/hours`, { data: hours })).status()).toBe(403);
    expect((await customer.req.get(`/api/branches/${branch.id}/hours`)).status()).toBe(403);

    // A slot crossing midnight (11:00 AM -> 4:00 AM) is stored as given.
    const saved = await admin.req.put(`/api/branches/${branch.id}/hours`, { data: hours });
    expect(saved.status()).toBe(200);
    const view = (await saved.json()) as { brands: { brand: { slug: string }; hours: { everyDay: { start: string; end: string }[] } | null }[] };
    expect(view.brands.find((b) => b.brand.slug === "cheez")?.hours?.everyDay[0]).toMatchObject({ start: "11:00", end: "04:00" });
    expect(view.brands.find((b) => b.brand.slug === "madchef")?.hours, "untouched brand stays unset").toBeNull();

    // Overlapping slots on one day are refused.
    const overlap = await admin.req.put(`/api/branches/${branch.id}/hours`, {
      data: { brands: { madchef: { everyDay: [slot(660, 960, true, true), slot(900, 1200, true, true)], days: {} } } },
    });
    expect(overlap.status()).toBe(400);

    // The old single opening/closing pair is refused with a pointer to the Hours page.
    const legacy = await admin.req.patch(`/api/branches/${branch.id}/`, { multipart: { opening_time: "10:00" } });
    expect(legacy.status()).toBe(400);

    const logs = (await (await admin.req.get("/api/activity-logs/?page_size=20")).json()) as { results: { description: string }[] };
    expect(logs.results.map((l) => l.description)).toContainEqual(expect.stringContaining(`hours at "${branch.name}"`));

    // The branch manager CAN edit their own branch.
    const own = (await (await bm.req.get("/api/branch-manager/delivery-settings")).json()) as { branch_id: number };
    expect((await bm.req.get(`/api/branches/${own.branch_id}/hours`)).status()).toBe(200);

    await Promise.all([admin.context.close(), bm.context.close(), customer.context.close()]);
  });

  test("checkout checks each brand on the chosen channel and names when it opens", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const customer = await apiLogin(browser, "customer");
    await setLocale(customer.context, "en");
    const { branch, cheez, madchef } = await world(admin.req);
    const now = dhakaMinutes();

    // Cheez: open now for pickup only. Madchef: opens in two hours.
    expect(
      (
        await admin.req.put(`/api/branches/${branch.id}/hours`, {
          data: {
            brands: {
              cheez: { everyDay: [slot(now - 60, now + 60, false, true)], days: {} },
              madchef: { everyDay: [slot(now + 120, now + 180, true, true)], days: {} },
            },
          },
        })
      ).status(),
    ).toBe(200);

    const availability = (await (await customer.req.get(`/api/branches/${branch.id}/availability`)).json()) as {
      brands: { slug: string; delivery: { open: boolean; reason: string | null }; pickup: { open: boolean; opens_at: { time: string } | null } }[];
    };
    const a = Object.fromEntries(availability.brands.map((b) => [b.slug, b]));
    expect(a.cheez.pickup.open).toBe(true);
    expect(a.cheez.delivery.open, "pickup-only slot: delivery is closed").toBe(false);
    expect(a.madchef.pickup.open).toBe(false);
    expect(a.madchef.pickup.opens_at?.time).toBe(hm(now + 120));

    const refused = await pickupOrder(customer.req, branch.id, madchef.id);
    expect(refused.status()).toBe(400);
    const message = JSON.stringify(await refused.json());
    expect(message).toContain("Madchef");
    expect(message).toMatch(/opens/i);

    const placed = await pickupOrder(customer.req, branch.id, cheez.id);
    expect(placed.status(), JSON.stringify(await placed.json())).toBe(201);

    // A mixed cart is refused because of the closed brand, naming it.
    const mixed = await customer.req.post("/api/orders/", {
      data: {
        branch_id: branch.id,
        payment_method: "cash",
        delivery_address: "Pickup",
        fulfillment_type: "pickup",
        items: [
          { product_id: cheez.id, quantity: 1, variation_type: "THICK" },
          { product_id: madchef.id, quantity: 1, variation_type: "THICK" },
        ],
      },
    });
    expect(mixed.status()).toBe(400);
    expect(JSON.stringify(await mixed.json())).toContain("Madchef");

    await Promise.all([admin.context.close(), customer.context.close()]);
  });

  test("the delivery pause still stops delivery on top of an open schedule", async ({ browser }) => {
    const admin = await apiLogin(browser, "super_admin");
    const { branch } = await world(admin.req);
    const now = dhakaMinutes();
    await admin.req.put(`/api/branches/${branch.id}/hours`, {
      data: { brands: { cheez: { everyDay: [slot(now - 60, now + 60, true, true)], days: {} } } },
    });
    const before = (await (await admin.req.get(`/api/branches/${branch.id}/availability`)).json()) as {
      brands: { slug: string; delivery: { open: boolean; reason: string | null }; pickup: { open: boolean } }[];
    };
    expect(before.brands.find((b) => b.slug === "cheez")?.delivery.open).toBe(true);

    expect((await admin.req.post("/api/branch-manager/delivery-pause", { data: { mode: "30m", branch_id: branch.id } })).status()).toBe(200);
    const paused = (await (await admin.req.get(`/api/branches/${branch.id}/availability`)).json()) as typeof before;
    const cheez = paused.brands.find((b) => b.slug === "cheez")!;
    expect(cheez.delivery.open).toBe(false);
    expect(cheez.delivery.reason).toBe("delivery_paused");
    expect(cheez.pickup.open, "pickup stays open during a delivery pause").toBe(true);

    await admin.req.delete(`/api/branch-manager/delivery-pause?branch_id=${branch.id}`);
    await admin.context.close();
  });
});
