import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { newSession, API_BASE } from "./helpers";

/**
 * B4 reservation chat verification + B7/B8/B9 Ramadan system. Server rules are
 * the source of truth → asserted at the API layer. Bookings use future dates
 * inside the seeded config range and distinct tables/dates to stay isolated.
 */

async function branches(req: APIRequestContext) {
  const { results } = await (await req.get(`${API_BASE}/api/branches/?page_size=100`)).json();
  const map: Record<string, number> = {};
  for (const b of results as { id: number; name: string }[]) map[b.name] = b.id;
  return map;
}
// A YYYY-MM-DD n days ahead (UTC), within the seeded 45-day config window.
function futureDate(days: number): string {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}
async function available(req: APIRequestContext, branchId: number, date?: string, slotId?: number) {
  const qs = new URLSearchParams({ branch_id: String(branchId) });
  if (date) qs.set("date", date);
  if (slotId) qs.set("slot_id", String(slotId));
  return (await req.get(`${API_BASE}/api/ramadan/available?${qs}`)).json();
}

test.describe("B4 — reservation chat", () => {
  async function makeReservation(browser: Browser) {
    const cust = await newSession(browser, "customer");
    const main = (await branches(cust.req))["Main Branch"];
    const r = await cust.req.post(`${API_BASE}/api/reservations/`, {
      data: { branch_id: main, guest_name: "Chat Guest", guest_phone: "01700000000", party_size: 2, requested_at: `${futureDate(3)}T19:00` },
    });
    expect(r.status()).toBe(201);
    return { cust, id: (await r.json()).id };
  }

  test("customer + branch manager can chat; other roles get 403; history persists", async ({ browser }) => {
    const { cust, id } = await makeReservation(browser);
    const bm = await newSession(browser, "branch_manager");
    const other = await newSession(browser, "rider");

    // Both participants can post + read.
    expect((await cust.req.post(`${API_BASE}/api/reservations/${id}/messages`, { data: { body: "Hi, table for 2?" } })).status()).toBe(201);
    expect((await bm.req.post(`${API_BASE}/api/reservations/${id}/messages`, { data: { body: "Confirmed" } })).status()).toBe(201);
    const hist = await (await cust.req.get(`${API_BASE}/api/reservations/${id}/messages`)).json();
    expect(hist.results.length).toBeGreaterThanOrEqual(2);
    // Unrelated role → 403 on read and write.
    expect((await other.req.get(`${API_BASE}/api/reservations/${id}/messages`)).status()).toBe(403);
    expect((await other.req.post(`${API_BASE}/api/reservations/${id}/messages`, { data: { body: "x" } })).status()).toBe(403);

    await cust.context.close(); await bm.context.close(); await other.context.close();
  });

  test("chat page auto-refreshes new messages (polling)", async ({ browser }) => {
    const { cust, id } = await makeReservation(browser);
    const bm = await newSession(browser, "branch_manager");
    await cust.page.goto(`/customer/reservations/${id}`);
    await expect(cust.page.getByTestId("reservation-messages")).toBeVisible();
    // BM posts via API; the customer page should pick it up by polling (5s).
    await bm.req.post(`${API_BASE}/api/reservations/${id}/messages`, { data: { body: "Auto refresh check" } });
    await expect(cust.page.getByText("Auto refresh check")).toBeVisible({ timeout: 12_000 });
    await cust.context.close(); await bm.context.close();
  });
});

test.describe("Ramadan (B7/B8/B9)", () => {
  // ── Config permissions ─────────────────────────────────────────────────
  test("B7: BM manages only own branch config; cross-branch config is 403", async ({ browser }) => {
    const bm = await newSession(browser, "branch_manager");
    const cfg = await bm.req.patch(`${API_BASE}/api/ramadan/config`, { data: { is_enabled: true, advance_type: "percent", advance_value: 20, advance_guest_threshold: 4, booking_start_date: futureDate(0), booking_end_date: futureDate(45) } });
    expect(cfg.status()).toBe(200);
    // A slot on another branch (created by SA) cannot be edited by this BM.
    const admin = await newSession(browser, "super_admin");
    const cheez = (await branches(admin.req))["Cheez Gulshan"];
    const slot = await (await admin.req.post(`${API_BASE}/api/ramadan/slots`, { data: { branch_id: cheez, label: "X", start_time: "18:00", end_time: "19:00" } })).json();
    const idor = await bm.req.patch(`${API_BASE}/api/ramadan/slots/${slot.id}`, { data: { label: "hijack" } });
    expect(idor.status()).toBe(403);
    await bm.context.close(); await admin.context.close();
  });

  // ── Booking rules ───────────────────────────────────────────────────────
  test("B7: capacity, out-of-range date, double-booking and normal-overlap are enforced", async ({ browser }) => {
    const cust = await newSession(browser, "customer");
    const main = (await branches(cust.req))["Main Branch"];
    const av = await available(cust.req, main, futureDate(5));
    const slot = av.slots[0], menu = av.menus[0];
    const small = av.tables.find((t: { seats: number }) => t.seats === 2) ?? av.tables[0];

    const base = (extra: Record<string, unknown>) => ({ branch_id: main, booking_date: futureDate(5), slot_id: slot.id, table_id: small.id, menu_id: menu.id, guest_name: "G", guest_phone: "01700000000", ...extra });

    // Capacity: party exceeds the 2-seat table.
    expect((await cust.req.post(`${API_BASE}/api/ramadan/reservations`, { data: base({ party_size: 5 }) })).status()).toBe(400);
    // Out-of-range date (far future beyond the window).
    expect((await cust.req.post(`${API_BASE}/api/ramadan/reservations`, { data: base({ party_size: 2, booking_date: futureDate(400) }) })).status()).toBe(400);
    // Past date.
    expect((await cust.req.post(`${API_BASE}/api/ramadan/reservations`, { data: base({ party_size: 2, booking_date: "2000-01-01" }) })).status()).toBe(400);

    // Valid booking.
    const ok = await cust.req.post(`${API_BASE}/api/ramadan/reservations`, { data: base({ party_size: 2 }) });
    expect(ok.status()).toBe(201);
    // Double-booking the same table/slot/date → 409.
    const dupe = await cust.req.post(`${API_BASE}/api/ramadan/reservations`, { data: base({ party_size: 2 }) });
    expect(dupe.status()).toBe(409);

    // Normal reservation on the same physical table at the Ramadan slot time → blocked.
    const normal = await cust.req.post(`${API_BASE}/api/reservations/`, {
      data: { branch_id: main, guest_name: "N", guest_phone: "01700000000", party_size: 2, requested_at: `${futureDate(5)}T18:20`, table_id: small.id },
    });
    expect(normal.status()).toBe(400);
    await cust.context.close();
  });

  // ── Menus + immutable snapshot ──────────────────────────────────────────
  test("B8: eligible menus filter + immutable price snapshot after menu edit", async ({ browser }) => {
    const cust = await newSession(browser, "customer");
    const bm = await newSession(browser, "branch_manager");
    const main = (await branches(cust.req))["Main Branch"];
    const av = await available(cust.req, main, futureDate(6));
    expect(av.menus.length).toBeGreaterThan(0);
    const slot = av.slots[0], menu = av.menus[0], table = av.tables[2] ?? av.tables[0];

    const res = await (await cust.req.post(`${API_BASE}/api/ramadan/reservations`, {
      data: { branch_id: main, booking_date: futureDate(6), slot_id: slot.id, table_id: table.id, menu_id: menu.id, party_size: 4, guest_name: "Snap", guest_phone: "01700000000" },
    })).json();
    const originalUnit = res.menu_unit_price;
    expect(Number(originalUnit)).toBeGreaterThan(0);

    // BM raises the menu price; the reservation snapshot must NOT change.
    await bm.req.patch(`${API_BASE}/api/ramadan/menus/${menu.id}`, { multipart: { price: "9999.00" } });
    const after = await (await cust.req.get(`${API_BASE}/api/ramadan/reservations?page_size=50`)).json();
    const mine = (after.results as { id: number; menu_unit_price: string }[]).find((x) => x.id === res.id);
    expect(mine!.menu_unit_price).toBe(originalUnit);
    // Restore the seeded price.
    await bm.req.patch(`${API_BASE}/api/ramadan/menus/${menu.id}`, { multipart: { price: "1200.00" } });
    await cust.context.close(); await bm.context.close();
  });

  // ── Payments + refunds (WS-1.3 — the client-asserted /pay contract is DEAD) ─
  test("B9: advance rules, client-asserted outcome rejected, role-gated offline record, refund limits + audit", async ({ browser }) => {
    const cust = await newSession(browser, "customer");
    const bm = await newSession(browser, "branch_manager");
    const accounts = await newSession(browser, "accounts");
    const main = (await branches(cust.req))["Main Branch"];

    // Percent 20% advance, threshold 4 (seeded). Family platter 1200, 4 guests → total 1200, advance 240.
    await bm.req.patch(`${API_BASE}/api/ramadan/config`, { data: { is_enabled: true, advance_type: "percent", advance_value: 20, advance_guest_threshold: 4, booking_start_date: futureDate(0), booking_end_date: futureDate(45) } });
    const av = await available(cust.req, main, futureDate(7));
    const slot = av.slots[0], menu = av.menus.find((m: { serving_capacity: number }) => m.serving_capacity === 4) ?? av.menus[0];
    // Re-query WITH the slot so only genuinely free tables are offered — keeps
    // the test correct even when an earlier run's booking still holds a seat.
    // The party is 4, so a free table that actually seats 4 is required.
    const avSlot = await available(cust.req, main, futureDate(7), slot.id);
    const table = (avSlot.tables as { id: number; seats: number }[]).find((t) => t.seats >= 4);
    expect(table, "a free 4-seat table exists for the target date/slot").toBeTruthy();

    const res = await (await cust.req.post(`${API_BASE}/api/ramadan/reservations`, {
      data: { branch_id: main, booking_date: futureDate(7), slot_id: slot.id, table_id: table!.id, menu_id: menu.id, party_size: 4, guest_name: "Pay", guest_phone: "01700000000" },
    })).json();
    expect(res.status).toBe("pending_payment");
    expect(Number(res.advance_required)).toBeCloseTo(240, 1);

    // BM cannot confirm before the advance is paid.
    expect((await bm.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/status`, { data: { status: "confirmed" } })).status()).toBe(409);

    // THE OLD DEMO CONTRACT IS GONE: /pay used to take `{outcome, idempotency_key}`
    // from the body and mark the booking paid on the customer's say-so. It now
    // reads NOTHING from the request body — it only STARTS a gateway payment.
    // With no gateway configured (this repo's demo rule) that is a clean 400
    // field error pointing at the counter, never a fabricated settlement.
    for (const outcome of ["success", "fail"]) {
      const forged = await cust.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/pay`, {
        data: { idempotency_key: `forged-${res.id}-${outcome}`, outcome, gateway_ref: "FAKE-TRX" },
      });
      expect(forged.status(), `client-asserted outcome:"${outcome}" must be rejected`).toBe(400);
      expect(await forged.text()).toContain("payment_method"); // graceful "gateway not configured"
    }
    // …and nothing about those posts changed the money truth.
    const afterForged = await (await cust.req.get(`${API_BASE}/api/ramadan/reservations?page_size=50`)).json();
    const mine = (afterForged.results as { id: number; status: string; payment: { status: string; paid_amount: string } }[]).find((x) => x.id === res.id);
    expect(mine!.status).toBe("pending_payment");
    expect(mine!.payment.status).not.toBe("paid");
    expect(mine!.payment.paid_amount).toBe("0.00");
    expect((await bm.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/status`, { data: { status: "confirmed" } })).status()).toBe(409);

    // The ONLY non-gateway settlement is /record-payment, and a customer can
    // never reach it — that is the whole point of the redesign.
    expect((await cust.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/record-payment`, { data: { reference: "SELF-SERVE" } })).status()).toBe(403);

    // Accounts records the counter payment: reference is mandatory and the
    // amount must match the required advance to the paisa.
    expect((await accounts.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/record-payment`, { data: {} })).status()).toBe(400);
    expect((await accounts.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/record-payment`, { data: { reference: "TRX-BAD-AMT", amount: 100 } })).status()).toBe(400);
    const accountsMe = await (await accounts.req.get(`${API_BASE}/api/auth/me`)).json();
    const rec = await accounts.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/record-payment`, {
      data: { reference: `TRX-${res.id}`, note: "Paid at the counter" },
    });
    expect(rec.status()).toBe(200);
    const recBody = await rec.json();
    expect(recBody.payment.status).toBe("paid");
    expect(recBody.payment.paid_amount).toBe("240.00");
    // Stamped as a hand-entered advance, never mistakable for a gateway settlement.
    expect(recBody.payment.source).toBe("offline_recorded");
    expect(recBody.payment.recorded_by).toBe(accountsMe.id);
    expect(recBody.payment.gateway_ref).toBe(`offline:TRX-${res.id}`);
    // Advance satisfied → booking moves on to await BM acceptance.
    expect(recBody.reservation.status).toBe("pending");
    // Recording the same advance twice is refused — a double-submit can never double-credit.
    expect((await accounts.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/record-payment`, { data: { reference: `TRX-${res.id}-2` } })).status()).toBe(409);

    // Now BM can confirm.
    expect((await bm.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/status`, { data: { status: "confirmed" } })).status()).toBe(200);

    // Accounts sees the transaction and refunds within the paid amount.
    const txns = await (await accounts.req.get(`${API_BASE}/api/ramadan/transactions?status=paid`)).json();
    expect((txns.results as { reservation_id: number }[]).some((x) => x.reservation_id === res.id)).toBe(true);
    const overRefund = await accounts.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/refund`, { data: { amount: 99999 } });
    expect(overRefund.status()).toBe(400); // exceeds refundable
    const refund = await accounts.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/refund`, { data: { amount: 100 } });
    expect(refund.status()).toBe(200);
    expect((await refund.json()).refunded_amount).toBe("100.00");
    // A BM cannot issue a refund.
    expect((await bm.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/refund`, { data: { amount: 10 } })).status()).toBe(403);

    // A fresh booking whose advance is never settled stays unconfirmable —
    // there is no client-reachable way to flip it to paid.
    const avSlot2 = await available(cust.req, main, futureDate(8), slot.id);
    const table2 = (avSlot2.tables as { id: number; seats: number }[]).find((t) => t.seats >= 4);
    expect(table2, "a free 4-seat table exists for the second date/slot").toBeTruthy();
    const res2 = await (await cust.req.post(`${API_BASE}/api/ramadan/reservations`, {
      data: { branch_id: main, booking_date: futureDate(8), slot_id: slot.id, table_id: table2!.id, menu_id: menu.id, party_size: 4, guest_name: "Fail", guest_phone: "01700000000" },
    })).json();
    expect(res2.status).toBe("pending_payment");
    expect((await cust.req.post(`${API_BASE}/api/ramadan/reservations/${res2.id}/pay`, { data: { outcome: "success" } })).status()).toBe(400);
    expect((await bm.req.post(`${API_BASE}/api/ramadan/reservations/${res2.id}/status`, { data: { status: "confirmed" } })).status()).toBe(409);

    // Cleanup: cancel both bookings so their tables go back on the market.
    expect((await cust.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/status`, { data: { status: "cancelled" } })).status()).toBe(200);
    expect((await cust.req.post(`${API_BASE}/api/ramadan/reservations/${res2.id}/status`, { data: { status: "cancelled" } })).status()).toBe(200);

    await cust.context.close(); await bm.context.close(); await accounts.context.close();
  });

  test("B9: no-advance booking is immediately pending; mandatory rejection reason", async ({ browser }) => {
    const cust = await newSession(browser, "customer");
    const bm = await newSession(browser, "branch_manager");
    const main = (await branches(cust.req))["Main Branch"];
    // No advance for < threshold parties (percent 20, threshold 4). 2 guests → no advance.
    await bm.req.patch(`${API_BASE}/api/ramadan/config`, { data: { is_enabled: true, advance_type: "percent", advance_value: 20, advance_guest_threshold: 4, booking_start_date: futureDate(0), booking_end_date: futureDate(45) } });
    const av = await available(cust.req, main, futureDate(9));
    const slot = av.slots[0], menu = av.menus[0], table = av.tables[0];
    const res = await (await cust.req.post(`${API_BASE}/api/ramadan/reservations`, {
      data: { branch_id: main, booking_date: futureDate(9), slot_id: slot.id, table_id: table.id, menu_id: menu.id, party_size: 2, guest_name: "NoAdv", guest_phone: "01700000000" },
    })).json();
    expect(res.status).toBe("pending");
    expect(Number(res.advance_required)).toBe(0);
    // Reject requires a reason.
    expect((await bm.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/status`, { data: { status: "rejected" } })).status()).toBe(400);
    const rej = await bm.req.post(`${API_BASE}/api/ramadan/reservations/${res.id}/status`, { data: { status: "rejected", rejection_reason: "Fully booked" } });
    expect(rej.status()).toBe(200);
    expect((await rej.json()).rejection_reason).toBe("Fully booked");
    await cust.context.close(); await bm.context.close();
  });

  test("management summary reflects real reservation/payment data", async ({ browser }) => {
    const mgmt = await newSession(browser, "management");
    const s = await (await mgmt.req.get(`${API_BASE}/api/ramadan/summary`)).json();
    expect(s.total_reservations).toBeGreaterThan(0);
    expect(Number(s.total_paid)).toBeGreaterThanOrEqual(0);
    // Management is read-only: cannot create config.
    expect((await mgmt.req.patch(`${API_BASE}/api/ramadan/config`, { data: { is_enabled: true } })).status()).toBe(403);
    await mgmt.context.close();
  });

  test("UI: BM and customer Ramadan pages render", async ({ browser }) => {
    const bm = await newSession(browser, "branch_manager");
    await bm.page.goto("/branch-manager/ramadan-bookings");
    await expect(bm.page.getByTestId("ramadan-config")).toBeVisible();
    await bm.context.close();
    const cust = await newSession(browser, "customer");
    await cust.page.goto("/customer/ramadan-bookings");
    await expect(cust.page.locator("h1")).toBeVisible();
    await cust.context.close();
  });
});
