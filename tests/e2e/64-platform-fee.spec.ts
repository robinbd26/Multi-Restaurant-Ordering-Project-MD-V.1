import { test, expect, type APIRequestContext } from "@playwright/test";

import { API_BASE, newSession, setLocale } from "./helpers";

/**
 * PHASE 4 — the platform fee.
 *
 * A flat fee added to EVERY order, delivery and pickup alike; ৳5 by default,
 * set platform-wide by the super admin with an optional per-branch override.
 * These tests use PICKUP orders at the seeded Main Branch, so the fee is proven
 * independently of delivery coverage and of any delivery charge.
 *
 * Every test restores the global fee to its default and clears the override it
 * set, so the suite leaves the shared test database as it found it.
 */

test.beforeEach(async ({ context }) => setLocale(context, "en"));

const DEFAULT_FEE = "5.00";

async function mainBranchProduct(admin: APIRequestContext) {
  const branches = (await (await admin.get(`${API_BASE}/api/branches/?search=Main%20Branch&page_size=100`)).json()).results as {
    id: number;
    name: string;
  }[];
  const main = branches.find((b) => b.name === "Main Branch");
  expect(main, "seeded Main Branch exists").toBeTruthy();
  const products = (await (await admin.get(`${API_BASE}/api/products/?branch_id=${main!.id}&page_size=100`)).json())
    .results as { id: number; is_available: boolean; variation_type?: string }[];
  const product = products.find((p) => p.is_available);
  expect(product, "Main Branch has an orderable product").toBeTruthy();
  return { branchId: main!.id, product: product! };
}

function pickupItems(product: { id: number; variation_type?: string }) {
  const crust = product.variation_type === "THIN" ? "THIN" : "THICK";
  return [{ product_id: product.id, quantity: 1, variation_type: crust }];
}

async function pickupQuote(customer: APIRequestContext, branchId: number, product: { id: number; variation_type?: string }) {
  const res = await customer.post(`${API_BASE}/api/delivery/quote/`, {
    data: { branch_id: branchId, fulfillment_type: "pickup", items: pickupItems(product) },
  });
  expect(res.status(), "pickup quote").toBe(200);
  return (await res.json()) as { subtotal: number; delivery_charge: number; platform_fee: number; total: number };
}

async function setGlobal(admin: APIRequestContext, fee: string | number) {
  const res = await admin.put(`${API_BASE}/api/admin/settings/platform-fee`, { data: { platform_fee: fee } });
  expect(res.status(), `global fee → ${fee}`).toBe(200);
}

test.describe("Platform fee", () => {
  test("defaults to ৳5 and is added on top of a pickup order", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    await setGlobal(admin.req, DEFAULT_FEE);
    const rules = await (await admin.req.get(`${API_BASE}/api/admin/settings/platform-fee`)).json();
    expect(rules.platform_fee).toBe(DEFAULT_FEE);

    const { branchId, product } = await mainBranchProduct(admin.req);
    const customer = await newSession(browser, "customer");
    const quote = await pickupQuote(customer.req, branchId, product);
    expect(quote.delivery_charge, "pickup carries no delivery charge").toBe(0);
    expect(quote.platform_fee, "the platform fee applies to pickup too").toBe(5);
    expect(quote.total).toBe(Math.round((quote.subtotal + 5) * 100) / 100);

    // And the order snapshots it, inside the total.
    const placed = await customer.req.post(`${API_BASE}/api/orders/`, {
      data: {
        branch_id: branchId,
        payment_method: "cash",
        delivery_address: "Pickup",
        fulfillment_type: "pickup",
        items: pickupItems(product),
      },
    });
    expect(placed.status(), "pickup order placed").toBe(201);
    const order = (await placed.json()) as { platform_fee: string; total_amount: string };
    expect(Number(order.platform_fee)).toBe(5);
    expect(Number(order.total_amount)).toBe(quote.total);

    await admin.context.close();
    await customer.context.close();
  });

  test("a branch override wins, and clearing it falls back to the global fee", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    await setGlobal(admin.req, DEFAULT_FEE);
    const { branchId, product } = await mainBranchProduct(admin.req);
    const customer = await newSession(browser, "customer");

    const set = await admin.req.put(`${API_BASE}/api/admin/settings/platform-fee`, {
      data: { branch_id: branchId, platform_fee: 12 },
    });
    expect(set.status()).toBe(200);
    const rule = ((await set.json()).branches as { branch_id: number; override: string | null; effective: string }[])
      .find((b) => b.branch_id === branchId);
    expect(rule?.override).toBe("12.00");
    expect((await pickupQuote(customer.req, branchId, product)).platform_fee, "override applies").toBe(12);

    // Changing the GLOBAL fee does not move a branch that has its own.
    await setGlobal(admin.req, 7);
    expect((await pickupQuote(customer.req, branchId, product)).platform_fee, "override still wins").toBe(12);

    const cleared = await admin.req.put(`${API_BASE}/api/admin/settings/platform-fee`, {
      data: { branch_id: branchId, platform_fee: null },
    });
    expect(cleared.status()).toBe(200);
    expect((await pickupQuote(customer.req, branchId, product)).platform_fee, "inherits the global fee again").toBe(7);

    await setGlobal(admin.req, DEFAULT_FEE);
    await admin.context.close();
    await customer.context.close();
  });

  test("only the super admin can change it, and nonsense is refused", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    for (const bad of [-1, 5000, "abc"]) {
      const res = await admin.req.put(`${API_BASE}/api/admin/settings/platform-fee`, { data: { platform_fee: bad } });
      expect(res.status(), `refuses ${bad}`).toBe(400);
    }

    for (const role of ["branch_manager", "customer"]) {
      const session = await newSession(browser, role);
      const read = await session.req.get(`${API_BASE}/api/admin/settings/platform-fee`);
      expect(read.status(), `${role} cannot read`).toBe(403);
      const write = await session.req.put(`${API_BASE}/api/admin/settings/platform-fee`, { data: { platform_fee: 0 } });
      expect(write.status(), `${role} cannot write`).toBe(403);
      await session.context.close();
    }

    const rules = await (await admin.req.get(`${API_BASE}/api/admin/settings/platform-fee`)).json();
    expect(rules.platform_fee, "a refused write changed nothing").toBe(DEFAULT_FEE);
    await admin.context.close();
  });
});
