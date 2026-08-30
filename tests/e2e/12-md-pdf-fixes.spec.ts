import { test, expect, type Page } from "@playwright/test";
import { login, newSession, setLocale, API_BASE, PASSWORD } from "./helpers";
import {
  disconnectResetDb,
  mintResetToken,
  resetTokenRows,
  restoreUserPassword,
} from "./helpers/reset-tokens";

/**
 * Coverage for the MD PROJECT FEATURES LIST punch-list fixes:
 * forgot-password, delete-account, per-label address icons, split reservation
 * date/time, super-admin-only category creation, and the offline-rider guard.
 */

/**
 * Two-step hashed-token password reset. This REPLACES the retired single-page
 * flow (username + email + new password in one POST), which made knowledge of
 * two semi-public identifiers equivalent to owning the account. The contract
 * now: /forgot-password takes ONE identifier and always answers with the same
 * generic success (no account enumeration); possession of the SMS'd link's
 * token — stored server-side only as a SHA-256 — is what authorizes the change
 * at /forgot-password/reset, exactly once.
 *
 * The suite runs the production build, where the raw token is (correctly)
 * never echoed to the client, so the token the spec "receives" is minted at
 * the database exactly as the server mints one — see helpers/reset-tokens.ts.
 */
test.describe("Forgot Password — two-step token reset (customer punch-list #1)", () => {
  const NEW_PASSWORD = "QaReset12345@##";

  async function requestReset(page: Page, identifier: string): Promise<string> {
    await page.goto("/forgot-password");
    await page.fill('input[name="identifier"]', identifier);
    await page.getByRole("button", { name: /send reset link/i }).click();
    const notice = page.getByText(/if an account matches/i);
    await expect(notice).toBeVisible();
    await expect(page).toHaveURL(/\/forgot-password/);
    return (await notice.textContent()) ?? "";
  }

  test.afterAll(async () => {
    // Whatever happened above, leave the seeded customer exactly as every
    // other spec expects it: original password, no live reset tokens.
    await restoreUserPassword("customer", PASSWORD);
    await disconnectResetDb();
  });

  test("login links to a request page with ONE identifier field and no password inputs", async ({ page, context }) => {
    await setLocale(context, "en");
    await page.goto("/login");
    const link = page.getByRole("link", { name: /forgot password/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    // The old one-shot form is GONE: no identity pair, and no password can be
    // chosen here — only the token link's own page may set one.
    for (const name of ["username", "email", "password", "confirm_password"]) {
      await expect(page.locator(`input[name="${name}"]`)).toHaveCount(0);
    }
  });

  test("request step is enumeration-safe and mints only a hashed token", async ({ page, context }) => {
    await setLocale(context, "en");

    const unknown = await requestReset(page, `no-such-user-${Date.now()}@example.com`);
    const real = await requestReset(page, "customer");
    // Same page, same message, byte for byte — the response must not become a
    // customer-database oracle.
    expect(real, "unknown and real identifiers get the identical generic success").toBe(unknown);

    // Production build: the raw link/token is never surfaced in the response.
    await expect(page.locator('a[href*="/forgot-password/reset"]')).toHaveCount(0);

    // …but the server really did mint a token for the real account, storing
    // ONLY a SHA-256 digest, unused, expiring ~30 minutes out.
    const rows = await resetTokenRows("customer");
    expect(rows.length).toBeGreaterThan(0);
    const newest = rows[0];
    expect(newest.usedAt).toBeNull();
    expect(newest.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const msLeft = newest.expiresAt.getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(25 * 60 * 1000);
    expect(msLeft).toBeLessThanOrEqual(31 * 60 * 1000);
  });

  test("token link sets a new password exactly once; old password dies with it", async ({ page, context }) => {
    await setLocale(context, "en");

    // The customer asks for a link through the real UI (mints a server row)…
    await requestReset(page, "customer@example.com");
    // …and "receives" a raw token the way the SMS recipient would.
    const token = await mintResetToken("customer");
    const resetUrl = `/forgot-password/reset?token=${encodeURIComponent(token)}`;

    // A policy-failing password is refused and does NOT spend the token.
    await page.goto(resetUrl);
    await page.fill('input[name="password"]', "12345678");
    await page.fill('input[name="confirm_password"]', "12345678");
    await page.getByRole("button", { name: /reset password/i }).click();
    await expect(page.getByText(/only numbers/i)).toBeVisible();
    await expect(page).toHaveURL(/\/forgot-password\/reset/);

    // The SAME token with a good password succeeds → back to sign-in.
    await page.fill('input[name="password"]', NEW_PASSWORD);
    await page.fill('input[name="confirm_password"]', NEW_PASSWORD);
    await page.getByRole("button", { name: /reset password/i }).click();
    await page.waitForURL(/\/login\?reset=1/, { timeout: 20_000 });
    await expect(page.getByText(/password reset/i)).toBeVisible();

    // Spending it retired EVERY outstanding token for the account — including
    // the one the UI request minted above. No second live link survives.
    const rows = await resetTokenRows("customer");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.usedAt !== null)).toBe(true);

    // The token cannot be replayed: same link, valid password, hard refusal.
    await page.goto(resetUrl);
    await page.fill('input[name="password"]', NEW_PASSWORD);
    await page.fill('input[name="confirm_password"]', NEW_PASSWORD);
    await page.getByRole("button", { name: /reset password/i }).click();
    await expect(page.getByText(/already been used/i)).toBeVisible();
    await expect(page).toHaveURL(/\/forgot-password\/reset/);
    await expect(page.getByRole("link", { name: /request a new reset link/i })).toBeVisible();

    // The OLD password no longer signs in…
    await page.goto("/login");
    await page.fill('input[name="identifier"]', "customer");
    await page.fill('input[name="password"]', PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.locator(".auth-alert--error")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // …and the NEW one does.
    await page.fill('input[name="identifier"]', "customer");
    await page.fill('input[name="password"]', NEW_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });

    // Drop the session (an authenticated user is bounced away from /login and
    // the login helper below must start signed out).
    await context.clearCookies();
    await setLocale(context, "en");

    // Put the seeded password back THROUGH THE FLOW (a second token), so the
    // restore itself re-proves request→consume, then sign in as every other
    // spec will.
    const token2 = await mintResetToken("customer");
    await page.goto(`/forgot-password/reset?token=${encodeURIComponent(token2)}`);
    await page.fill('input[name="password"]', PASSWORD);
    await page.fill('input[name="confirm_password"]', PASSWORD);
    await page.getByRole("button", { name: /reset password/i }).click();
    await page.waitForURL(/\/login\?reset=1/, { timeout: 20_000 });
    await login(page, "customer");
  });

  test("reset page refuses a missing and a forged token", async ({ page, context }) => {
    await setLocale(context, "en");

    // No token: dead end with a way back to a fresh request, submit disabled.
    await page.goto("/forgot-password/reset");
    await expect(page.getByText(/link is incomplete/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /request a new reset link/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    await expect(page.getByRole("button", { name: /reset password/i })).toBeDisabled();

    // A well-formed but never-issued token: possession is really verified
    // against the stored hash, not inferred from the link's shape.
    await page.goto(`/forgot-password/reset?token=${"0".repeat(64)}`);
    await page.fill('input[name="password"]', NEW_PASSWORD);
    await page.fill('input[name="confirm_password"]', NEW_PASSWORD);
    await page.getByRole("button", { name: /reset password/i }).click();
    await expect(page.getByText(/link is not valid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/forgot-password\/reset/);
  });
});

test.describe("Delete My Account (customer punch-list #13)", () => {
  test("settings shows a delete-account control that opens a confirm dialog", async ({ browser }) => {
    const { page, context } = await newSession(browser, "customer");
    await page.goto("/customer/settings");
    const del = page.getByRole("button", { name: /delete my account/i }).first();
    await expect(del).toBeVisible();
    await del.click();
    // Confirm modal appears — cancel it (do NOT actually delete the demo user).
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/cannot be undone/i)).toBeVisible();
    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(page).toHaveURL(/\/customer\/settings/);
    await context.close();
  });
});

test.describe("Address icons differ per label (customer punch-list #4)", () => {
  test("Home and Office addresses render distinct icons", async ({ browser }) => {
    const { page, context } = await newSession(browser, "customer");
    await page.goto("/customer/addresses");

    // Create Home + Office (idempotent enough for a demo run).
    for (const preset of [/^home$/i, /^office$/i]) {
      await page.getByRole("button", { name: /new address/i }).first().click();
      await page.getByRole("button", { name: preset }).click();
      await page.locator("textarea").fill("123 Test Road, Dhaka");
      await page.getByRole("button", { name: /^save$/i }).click();
      await page.waitForTimeout(600);
    }

    // Collect the SVG path shapes used by the address-card icons.
    const paths = await page.locator("ul li .rounded-lg svg path").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("d")),
    );
    const distinct = new Set(paths.filter(Boolean));
    expect(distinct.size).toBeGreaterThan(1); // icons are no longer all identical
    await context.close();
  });
});

test.describe("Reservation split date & time (customer punch-list #9)", () => {
  test("reservation form has separate date and time inputs", async ({ browser }) => {
    const { page, context } = await newSession(browser, "customer");
    await page.goto("/customer/reservations");
    await expect(page.locator('input[type="date"]')).toBeVisible();
    await expect(page.locator('input[type="time"]')).toBeVisible();
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
    await context.close();
  });
});

test.describe("Category creation is super-admin only (roles spec)", () => {
  test("branch manager POST /api/categories → 403", async ({ browser }) => {
    const { page, context } = await newSession(browser, "branch_manager");
    const res = await page.request.post(API_BASE + "/api/categories", {
      data: { name: "Illegal Category" },
    });
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("super admin can create a category", async ({ browser }) => {
    const { page, context } = await newSession(browser, "super_admin");
    const branches = await page.request.get(API_BASE + "/api/branches/");
    const bJson = await branches.json();
    const branchId = (bJson.results ?? bJson)[0].id;
    const res = await page.request.post(API_BASE + "/api/categories", {
      data: { name: `QA Cat ${Date.now()}`, branch_id: branchId },
    });
    expect(res.ok()).toBeTruthy();
    await context.close();
  });
});

test.describe("Offline rider cannot be assigned (rider spec)", () => {
  test("assign fails while offline, succeeds while online", async ({ browser }) => {
    // Discover an order + the branch rider's user id via the BM session.
    const bm = await newSession(browser, "branch_manager");
    const ridersRes = await bm.page.request.get(API_BASE + "/api/riders/branch");
    const riders = await ridersRes.json();
    expect(Array.isArray(riders) && riders.length).toBeTruthy();
    const riderUserId = riders[0].user;

    const ordersRes = await bm.page.request.get(API_BASE + "/api/orders/?page_size=1");
    const orders = await ordersRes.json();
    const order = orders.results[0];
    const orderId = order.id;

    // Rider goes offline. Ending duty is REFUSED while a delivery is still
    // running, so any delivery an earlier spec left open is cleared first —
    // this establishes the test's precondition instead of assuming it, and the
    // result is verified rather than hoped for.
    const riderSess = await newSession(browser, "rider");
    const active = await (await riderSess.page.request.get(API_BASE + "/api/orders/?page_size=50")).json();
    for (const o of (active.results ?? []) as { id: number; status: string }[]) {
      if (["accepted", "preparing", "ready", "picked_up", "on_the_way"].includes(o.status)) {
        await bm.page.request.post(API_BASE + `/api/orders/${o.id}/update-status`, {
          data: { status: "cancelled", reason: "Cleared so the rider can go off duty for this test" },
        });
      }
    }
    await riderSess.page.request.post(API_BASE + "/api/rider/duty/end", { data: {} });
    const duty = await (await riderSess.page.request.get(API_BASE + "/api/rider/duty")).json();
    expect(duty.active_session, "the rider really is off duty").toBeFalsy();

    // Assigning an offline rider (no active session) is rejected.
    const bad = await bm.page.request.post(
      API_BASE + `/api/orders/${orderId}/assign-rider`,
      { data: { rider_id: riderUserId } },
    );
    expect(bad.status()).toBe(400);
    expect(await bad.text()).toContain("rider_id");

    // Rider starts duty on the order's branch → assignment succeeds.
    const start = await riderSess.page.request.post(API_BASE + "/api/rider/duty/start", { data: { branch_id: order.branch } });
    expect(start.ok(), "rider starts duty").toBeTruthy();
    const ok = await bm.page.request.post(
      API_BASE + `/api/orders/${orderId}/assign-rider`,
      { data: { rider_id: riderUserId } },
    );
    expect(ok.ok()).toBeTruthy();

    // Cleanup: cancel so the rider has no dangling active delivery.
    await bm.page.request.post(API_BASE + `/api/orders/${orderId}/update-status`, { data: { status: "cancelled", reason: "Cancelled by branch manager for test" } });

    await bm.context.close();
    await riderSess.context.close();
  });
});
