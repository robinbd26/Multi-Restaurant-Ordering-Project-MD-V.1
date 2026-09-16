import { test, expect, type APIRequestContext } from "@playwright/test";

import { API_BASE, newSession, setLocale } from "./helpers";

/**
 * PHASE 3 — checkout enforces coverage by NAME as well as by geometry.
 *
 * The live check the checkout drawer shows (/api/delivery/address-coverage), the
 * quote, and the order all run the same decision, so these tests drive the API
 * directly and assert all three agree. The rules pinned here:
 *   - a saved address with NO map pin can be quoted and ordered, when the cart's
 *     branch lists its locality for the shift running now, and is priced by that
 *     branch's own row for the locality;
 *   - an address the branch does not list is refused for delivery — no other
 *     branch is substituted, because the cart belongs to this one;
 *   - coverage follows the SHIFT;
 *   - a hand-typed locality is covered by nobody;
 *   - an address id belonging to someone else grants nothing.
 *
 * The branch is parked far out in the Bay of Bengal, so its radius reaches
 * nobody: every "covered" below can only have come from the locality list.
 */

test.beforeEach(async ({ context }) => setLocale(context, "en"));

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

async function clearAddresses(req: APIRequestContext) {
  const res = await req.get(`${API_BASE}/api/customer/addresses/?page_size=100`);
  if (res.status() !== 200) return;
  const payload = (await res.json()) as { results?: { id: number }[] };
  for (const row of payload.results ?? []) {
    await req.delete(`${API_BASE}/api/customer/addresses/${row.id}/`);
  }
}

async function locality(req: APIRequestContext, zoneName: string, localityName: string) {
  const res = await req.get(`${API_BASE}/api/delivery-zones`);
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
      name: uniq("ChkBr"),
      address: "Dhaka",
      phone: "01711111111",
      brand_type: "cheez",
      latitude: "20.5",
      longitude: "90.9",
      delivery_radius_km: "1",
    },
  });
  expect(branchRes.status(), "branch created").toBe(201);
  const branch = (await branchRes.json()) as { id: number; name: string };

  const cat = await req.post(`${API_BASE}/api/categories/`, {
    data: { name: uniq("ChkCat"), branch_id: branch.id, is_active: true },
  });
  expect(cat.status()).toBe(201);
  const product = await req.post(`${API_BASE}/api/products/`, {
    data: {
      branch_id: branch.id,
      name: uniq("ChkItem"),
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

async function pinlessAddress(req: APIRequestContext, mainArea: string, subArea: string) {
  const res = await req.post(`${API_BASE}/api/customer/addresses/`, {
    data: { label: "Home", address: uniq("Pinless Rd"), main_area: mainArea, sub_area: subArea },
  });
  expect(res.status(), "pinless address saved").toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function coverageOf(req: APIRequestContext, branchId: number, addressId: number) {
  const res = await req.post(`${API_BASE}/api/delivery/address-coverage`, {
    data: { branch_id: branchId, customer_address_id: addressId },
  });
  expect(res.status(), "coverage check answered").toBe(200);
  return (await res.json()) as {
    covered: boolean;
    via: string | null;
    reason: string;
    window: "day" | "night";
    delivery_fee: number | null;
  };
}

function items(productId: number) {
  return [{ product_id: productId, quantity: 1, variation_type: "THICK" }];
}

test.describe("Checkout enforces coverage by name", () => {
  test("a pinless address the branch lists can be quoted and ordered", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branch, product } = await farBranchWithProduct(admin.req);
    const mirpur10 = await locality(admin.req, "Mirpur", "Mirpur-10");
    await listLocality(admin.req, branch.id, mirpur10, "both", 55);

    const customer = await newSession(browser, "qa_upload_2");
    await clearAddresses(customer.req);
    const addressId = await pinlessAddress(customer.req, "Mirpur", "Mirpur-10");

    // 1. The live check the drawer shows.
    const live = await coverageOf(customer.req, branch.id, addressId);
    expect(live.covered, "covered by name").toBe(true);
    expect(live.via).toBe("locality");
    expect(live.delivery_fee, "priced by the branch row for that locality").toBe(55);

    // 2. The quote agrees, at the same price.
    const quote = await customer.req.post(`${API_BASE}/api/delivery/quote/`, {
      data: {
        branch_id: branch.id,
        fulfillment_type: "delivery",
        customer_address_id: addressId,
        items: items(product.id),
      },
    });
    expect(quote.status(), "a pinless address is quotable").toBe(200);
    const quoted = (await quote.json()) as { branch: { id: number }; delivery_charge: number };
    expect(quoted.branch.id).toBe(branch.id);
    expect(quoted.delivery_charge).toBe(55);

    // 3. And the order goes through, with honest snapshots.
    const placed = await customer.req.post(`${API_BASE}/api/orders/`, {
      data: {
        branch_id: branch.id,
        payment_method: "cash",
        delivery_address: "Pinless Rd, Mirpur-10",
        fulfillment_type: "delivery",
        customer_address_id: addressId,
        coord_source: "saved_address",
        items: items(product.id),
      },
    });
    expect(placed.status(), "a pinless address can be ordered to").toBe(201);
    const order = (await placed.json()) as {
      branch: number;
      delivery_charge: string | number;
      delivery_area_name: string;
      delivery_coord_source: string;
      customer_address: number | null;
      delivery_lat: number | null;
    };
    expect(order.branch).toBe(branch.id);
    expect(Number(order.delivery_charge)).toBe(55);
    expect(order.delivery_area_name).toBe("Mirpur-10");
    expect(order.delivery_coord_source, "provenance recorded").toBe("saved_address");
    expect(order.customer_address).toBe(addressId);
    expect(order.delivery_lat, "no coordinate is invented").toBeNull();

    await admin.context.close();
    await customer.context.close();
  });

  test("an address the branch does not list is refused for delivery", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branch, product } = await farBranchWithProduct(admin.req);
    const mirpur10 = await locality(admin.req, "Mirpur", "Mirpur-10");
    await listLocality(admin.req, branch.id, mirpur10, "both", 55);

    const customer = await newSession(browser, "qa_upload_2");
    await clearAddresses(customer.req);
    // A real locality on the master list — just not one this branch lists.
    const addressId = await pinlessAddress(customer.req, "Mirpur", "Mirpur-12");

    const live = await coverageOf(customer.req, branch.id, addressId);
    expect(live.covered).toBe(false);
    expect(live.reason).toBe("not_covered");

    const quote = await customer.req.post(`${API_BASE}/api/delivery/quote/`, {
      data: {
        branch_id: branch.id,
        fulfillment_type: "delivery",
        customer_address_id: addressId,
        items: items(product.id),
      },
    });
    expect(quote.status(), "quote refused").toBe(400);
    expect(JSON.stringify(await quote.json()), "the pickup-only explanation").toContain("does not deliver");

    const placed = await customer.req.post(`${API_BASE}/api/orders/`, {
      data: {
        branch_id: branch.id,
        payment_method: "cash",
        delivery_address: "Pinless Rd, Mirpur-12",
        fulfillment_type: "delivery",
        customer_address_id: addressId,
        items: items(product.id),
      },
    });
    expect(placed.status(), "order refused — no other branch is substituted").toBe(400);

    await admin.context.close();
    await customer.context.close();
  });

  test("coverage follows the shift running now", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branch } = await farBranchWithProduct(admin.req);
    const mirpur11 = await locality(admin.req, "Mirpur", "Mirpur-11");
    const customer = await newSession(browser, "qa_upload_2");
    await clearAddresses(customer.req);
    const addressId = await pinlessAddress(customer.req, "Mirpur", "Mirpur-11");

    // Ask the server which shift is active, so the test holds at any hour.
    const probe = await coverageOf(customer.req, branch.id, addressId);
    const active = probe.window;
    const other = active === "day" ? "night" : "day";

    // Listed only on the OTHER shift → not covered now.
    const row = await listLocality(admin.req, branch.id, mirpur11, other, 30);
    expect((await coverageOf(customer.req, branch.id, addressId)).covered, `a ${other}-only row`).toBe(false);

    // Moved onto the active shift → covered.
    const moved = await admin.req.patch(`${API_BASE}/api/delivery-areas/${row.id}`, {
      data: { coverage_window: active },
    });
    expect(moved.status()).toBe(200);
    expect((await coverageOf(customer.req, branch.id, addressId)).covered, `a ${active} row`).toBe(true);

    await admin.context.close();
    await customer.context.close();
  });

  test("a hand-typed locality is covered by nobody", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branch } = await farBranchWithProduct(admin.req);
    const mirpur10 = await locality(admin.req, "Mirpur", "Mirpur-10");
    await listLocality(admin.req, branch.id, mirpur10, "both", 55);

    const customer = await newSession(browser, "qa_upload_2");
    await clearAddresses(customer.req);
    const typed = await customer.req.post(`${API_BASE}/api/customer/addresses/`, {
      data: {
        label: "Others",
        custom_label: "Typed",
        address: uniq("Typed Rd"),
        main_area: "Mirpur",
        sub_area: "",
        custom_area: uniq("NotOnTheList"),
      },
    });
    expect(typed.status()).toBe(201);
    const addressId = ((await typed.json()) as { id: number }).id;

    const live = await coverageOf(customer.req, branch.id, addressId);
    expect(live.covered, "a custom locality never grants coverage").toBe(false);

    await admin.context.close();
    await customer.context.close();
  });

  test("someone else's address id grants nothing", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { branch } = await farBranchWithProduct(admin.req);
    const mirpur10 = await locality(admin.req, "Mirpur", "Mirpur-10");
    await listLocality(admin.req, branch.id, mirpur10, "both", 55);

    const owner = await newSession(browser, "qa_upload_1");
    await clearAddresses(owner.req);
    const theirs = await pinlessAddress(owner.req, "Mirpur", "Mirpur-10");
    expect((await coverageOf(owner.req, branch.id, theirs)).covered, "covered for its owner").toBe(true);

    const intruder = await newSession(browser, "qa_upload_2");
    await clearAddresses(intruder.req);
    const borrowed = await coverageOf(intruder.req, branch.id, theirs);
    expect(borrowed.covered, "a borrowed address id is inert").toBe(false);

    await clearAddresses(owner.req);
    await admin.context.close();
    await owner.context.close();
    await intruder.context.close();
  });
});
