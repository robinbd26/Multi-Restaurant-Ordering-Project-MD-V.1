import { test, expect, type APIRequestContext } from "@playwright/test";

import {
  API_BASE,
  newSession,
  setLocale,
  inNightOrderBlackout,
  NIGHT_BLACKOUT_REASON,
  isDhakaFullClosureWindow,
  FULL_CLOSURE_REASON,
} from "./helpers";

/**
 * ITEM 8 — a ONE-TIME address for this order only. "Add new address" always
 * saved to the 5-address book and died at the cap; this is the escape hatch:
 * typed for a single checkout, coverage-checked by name exactly like a
 * pinless saved address (lib/services/address-coverage.ts), but never
 * persisted — no /api/customer/addresses row, no cap interaction, and it does
 * not carry over to the customer's next order.
 *
 * These drive the API directly (same style as 63-checkout-coverage.spec.ts),
 * since the one-time address's contract is the coverage/quote/order pipeline
 * agreeing on a NAME instead of a customer_address_id.
 */

test.beforeEach(async ({ context }) => setLocale(context, "en"));

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

test.beforeEach(() => {
  test.skip(inNightOrderBlackout(), NIGHT_BLACKOUT_REASON);
  test.skip(isDhakaFullClosureWindow(), FULL_CLOSURE_REASON);
});

async function clearAddresses(req: APIRequestContext) {
  const res = await req.get(`${API_BASE}/api/customer/addresses/?page_size=100`);
  if (res.status() !== 200) return;
  const payload = (await res.json()) as { results?: { id: number }[] };
  for (const row of payload.results ?? []) {
    await req.delete(`${API_BASE}/api/customer/addresses/${row.id}/`);
  }
}

async function locality(req: APIRequestContext, zoneName: string, localityName: string) {
  const res = await req.get(`${API_BASE}/api/area-zones`);
  expect(res.status()).toBe(200);
  const zones = (await res.json()).results as {
    name: string;
    isActive: boolean;
    localities: { id: number; name: string; isActive: boolean }[];
  }[];
  const zone = zones.find((z) => z.name === zoneName && z.isActive);
  const hit = zone?.localities.find((l) => l.name === localityName && l.isActive);
  expect(hit, `${zoneName} / ${localityName} is on the seeded master list`).toBeTruthy();
  return hit!;
}

/** A branch whose radius reaches nobody, with one orderable product. */
async function farBranchWithProduct(req: APIRequestContext) {
  const branchRes = await req.post(`${API_BASE}/api/branches/`, {
    data: {
      name: uniq("OtBr"),
      address: "Dhaka",
      phone: "01711111111",
      brand_type: "cheez",
      latitude: "20.5",
      longitude: "90.9",
      delivery_radius_km: "1",
      pickup_enabled: "true",
    },
  });
  expect(branchRes.status(), "branch created").toBe(201);
  const branch = (await branchRes.json()) as { id: number; name: string };

  const cat = await req.post(`${API_BASE}/api/categories/`, {
    data: { name: uniq("OtCat"), branch_id: branch.id, is_active: true },
  });
  expect(cat.status()).toBe(201);
  const product = await req.post(`${API_BASE}/api/products/`, {
    data: {
      branch_id: branch.id,
      name: uniq("OtItem"),
      brand: "cheez",
      category: ((await cat.json()) as { id: number }).id,
      is_available: true,
      variations: JSON.stringify([{ name: "Std", price: 300, isDefault: true, isEnabled: true }]),
    },
  });
  expect(product.status(), "product created").toBe(201);
  return { branch, product: (await product.json()) as { id: number; name: string } };
}

async function listLocality(
  req: APIRequestContext,
  branchId: number,
  loc: { id: number; name: string },
  window: "day" | "night" | "both",
  charge: number,
) {
  const res = await req.post(`${API_BASE}/api/delivery-areas`, {
    data: {
      branch_id: branchId,
      name: loc.name,
      locality_id: loc.id,
      coverage_window: window,
      estimated_delivery_minutes: 40,
      delivery_charge: charge,
    },
  });
  expect(res.status(), `coverage row (${window}) created`).toBe(201);
  return (await res.json()) as { id: number };
}

function items(productId: number) {
  return [{ product_id: productId, quantity: 1, variation_type: "THICK" }];
}

async function oneTimeCoverageOf(req: APIRequestContext, branchId: number, mainArea: string, subArea: string) {
  const res = await req.post(`${API_BASE}/api/delivery/address-coverage`, {
    data: { branch_id: branchId, main_area: mainArea, sub_area: subArea },
  });
  expect(res.status(), "coverage check answered").toBe(200);
  return (await res.json()) as { covered: boolean; via: string | null; reason: string; delivery_fee: number | null };
}

test.describe("One-time address at checkout", () => {
  test("a covered one-time address quotes and orders without a saved-address row", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branch, product } = await farBranchWithProduct(admin.req);
    const mirpur10 = await locality(admin.req, "Mirpur", "Mirpur-10");
    await listLocality(admin.req, branch.id, mirpur10, "both", 45);

    const customer = await newSession(browser, "qa_upload_2");
    await clearAddresses(customer.req);

    // 1. The live check the drawer shows, matched by name — no customer_address_id.
    const live = await oneTimeCoverageOf(customer.req, branch.id, "Mirpur", "Mirpur-10");
    expect(live.covered, "covered by name").toBe(true);
    expect(live.delivery_fee).toBe(45);

    // 2. The quote agrees, at the same price.
    const quote = await customer.req.post(`${API_BASE}/api/delivery/quote/`, {
      data: {
        branch_id: branch.id,
        fulfillment_type: "delivery",
        main_area: "Mirpur",
        sub_area: "Mirpur-10",
        items: items(product.id),
      },
    });
    expect(quote.status(), "a one-time address is quotable").toBe(200);
    const quoted = (await quote.json()) as { branch: { id: number }; delivery_charge: number };
    expect(quoted.branch.id).toBe(branch.id);
    expect(quoted.delivery_charge).toBe(45);

    // 3. The order goes through, storing the typed text as delivery_address,
    //    with NO customer_address on the order and NO row left in the address book.
    const placed = await customer.req.post(`${API_BASE}/api/orders/`, {
      data: {
        branch_id: branch.id,
        payment_method: "cash",
        delivery_address: "One-Time Rd, Mirpur-10, Dhaka",
        fulfillment_type: "delivery",
        main_area: "Mirpur",
        sub_area: "Mirpur-10",
        items: items(product.id),
      },
    });
    expect(placed.status(), "a one-time address can be ordered to").toBe(201);
    const order = (await placed.json()) as {
      branch: number;
      delivery_charge: string | number;
      delivery_area_name: string;
      customer_address: number | null;
      delivery_address: string;
    };
    expect(order.branch).toBe(branch.id);
    expect(Number(order.delivery_charge)).toBe(45);
    expect(order.delivery_area_name).toBe("Mirpur-10");
    expect(order.customer_address, "never tied to a saved-address row").toBeNull();
    expect(order.delivery_address).toBe("One-Time Rd, Mirpur-10, Dhaka");

    const book = await customer.req.get(`${API_BASE}/api/customer/addresses/?page_size=100`);
    const bookPayload = (await book.json()) as { results?: unknown[] };
    expect(bookPayload.results ?? [], "no address-book row was created").toHaveLength(0);

    await admin.context.close();
    await customer.context.close();
  });

  test("a one-time address the branch does not list is refused for delivery", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branch, product } = await farBranchWithProduct(admin.req);
    const mirpur10 = await locality(admin.req, "Mirpur", "Mirpur-10");
    await listLocality(admin.req, branch.id, mirpur10, "both", 45);

    const customer = await newSession(browser, "qa_upload_2");
    await clearAddresses(customer.req);

    // A real locality on the master list — just not one this branch lists.
    const live = await oneTimeCoverageOf(customer.req, branch.id, "Mirpur", "Mirpur-12");
    expect(live.covered).toBe(false);

    const quote = await customer.req.post(`${API_BASE}/api/delivery/quote/`, {
      data: {
        branch_id: branch.id,
        fulfillment_type: "delivery",
        main_area: "Mirpur",
        sub_area: "Mirpur-12",
        items: items(product.id),
      },
    });
    expect(quote.status(), "quote refused").toBe(400);

    const placed = await customer.req.post(`${API_BASE}/api/orders/`, {
      data: {
        branch_id: branch.id,
        payment_method: "cash",
        delivery_address: "One-Time Rd, Mirpur-12, Dhaka",
        fulfillment_type: "delivery",
        main_area: "Mirpur",
        sub_area: "Mirpur-12",
        items: items(product.id),
      },
    });
    expect(placed.status(), "order refused — no other branch is substituted").toBe(400);

    // Pickup from the same branch still works.
    const pickup = await customer.req.post(`${API_BASE}/api/orders/`, {
      data: {
        branch_id: branch.id,
        payment_method: "cash",
        delivery_address: "Pickup",
        fulfillment_type: "pickup",
        items: items(product.id),
      },
    });
    expect(pickup.status(), "pickup still works").toBe(201);

    await admin.context.close();
    await customer.context.close();
  });

  test("a one-time address still works once the 5-address cap is reached", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branch, product } = await farBranchWithProduct(admin.req);
    const mirpur10 = await locality(admin.req, "Mirpur", "Mirpur-10");
    await listLocality(admin.req, branch.id, mirpur10, "both", 45);

    const customer = await newSession(browser, "qa_upload_2");
    await clearAddresses(customer.req);
    try {
      for (let i = 0; i < 5; i++) {
        const res = await customer.req.post(`${API_BASE}/api/customer/addresses/`, {
          data: { label: "Home", address: uniq(`Cap Rd ${i}`), main_area: "Mirpur", sub_area: "Mirpur-10" },
        });
        expect(res.status(), `saved address #${i + 1} created`).toBe(201);
      }
      // The 6th saved address is refused — the cap is real.
      const sixth = await customer.req.post(`${API_BASE}/api/customer/addresses/`, {
        data: { label: "Home", address: uniq("Cap Rd 6th"), main_area: "Mirpur", sub_area: "Mirpur-10" },
      });
      expect(sixth.status(), "a 6th saved address is refused").not.toBe(201);

      // The one-time address is unaffected by the cap.
      const live = await oneTimeCoverageOf(customer.req, branch.id, "Mirpur", "Mirpur-10");
      expect(live.covered, "one-time coverage still works at the cap").toBe(true);

      const placed = await customer.req.post(`${API_BASE}/api/orders/`, {
        data: {
          branch_id: branch.id,
          payment_method: "cash",
          delivery_address: "One-Time Rd, Mirpur-10, Dhaka",
          fulfillment_type: "delivery",
          main_area: "Mirpur",
          sub_area: "Mirpur-10",
          items: items(product.id),
        },
      });
      expect(placed.status(), "a one-time order still succeeds at the cap").toBe(201);
    } finally {
      await clearAddresses(customer.req);
    }

    await admin.context.close();
    await customer.context.close();
  });

  test("someone else's coverage is not leaked by area name — scoped per branch only", async ({ browser }) => {
    // The one-time path carries no address id at all, so there is nothing to
    // borrow; this pins that two different customers asking about the SAME
    // branch/area both get the branch's real answer, independent of each other.
    const admin = await newSession(browser, "super_admin");
    const { branch } = await farBranchWithProduct(admin.req);
    const mirpur10 = await locality(admin.req, "Mirpur", "Mirpur-10");
    await listLocality(admin.req, branch.id, mirpur10, "both", 45);

    const a = await newSession(browser, "qa_upload_1");
    const b = await newSession(browser, "qa_upload_2");
    expect((await oneTimeCoverageOf(a.req, branch.id, "Mirpur", "Mirpur-10")).covered).toBe(true);
    expect((await oneTimeCoverageOf(b.req, branch.id, "Mirpur", "Mirpur-10")).covered).toBe(true);

    await admin.context.close();
    await a.context.close();
    await b.context.close();
  });
});
