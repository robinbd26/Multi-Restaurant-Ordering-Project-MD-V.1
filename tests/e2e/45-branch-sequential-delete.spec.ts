import { test, expect, type APIRequestContext } from "@playwright/test";

import { newSession, API_BASE, activeZoneId } from "./helpers";

/**
 * REGRESSION — sequential branch delete/archive on the Super Admin list.
 *
 * The reported bug: after the FIRST successful delete/archive, every later
 * Delete on the same page stopped working until the browser was refreshed.
 *
 * Cause: `deleteBranchAction` ended with `redirect()`. Next settles a
 * redirecting Server Action's client promise by REJECTING it (it has no action
 * result to resolve with), so `ConfirmModal`'s `setOpen(false)` — which sits
 * after `await action(...)` — never ran. The dialog's `fixed inset-0 z-50`
 * overlay therefore stayed mounted over the whole page and swallowed every
 * subsequent click, and because its own dismiss handler is gated on `!pending`
 * (a transition that never settled) it could not even be clicked away.
 *
 * These specs drive the exact sequence through the browser with NO reload.
 */

const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** An unused branch — no products/orders/areas, so it is safe to hard delete. */
async function createBareBranch(req: APIRequestContext, prefix = "SeqBranch") {
  const res = await req.post(`${API_BASE}/api/branches/`, {
    multipart: {
      name: uniq(prefix),
      address: "Nowhere Rd, Dhaka",
      phone: `014${Math.floor(10000000 + Math.random() * 89999999)}`,
      brand_type: "cheez",
      zone_id: String(await activeZoneId(req)),
    },
  });
  expect(res.status(), "branch created").toBe(201);
  return res.json() as Promise<{ id: number; name: string }>;
}

/** A branch with setup data (a delivery area), archived explicitly below. */
async function createBranchWithHistory(req: APIRequestContext, prefix = "SeqArchiveBranch") {
  const branch = await createBareBranch(req, prefix);
  // A delivery area is setup data; the branch is archived via its own button.
  const area = await req.post(`${API_BASE}/api/delivery-areas/`, {
    data: {
      branch_id: branch.id,
      name: uniq("Area"),
      estimated_delivery_minutes: 30,
      delivery_charge: 20,
    },
  });
  expect(area.status(), "dependency created").toBe(201);
  return branch;
}

test.describe("branch delete/archive works repeatedly without a refresh", () => {
  test("archive one branch, then delete two more — all from the same page load", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { page } = admin;

    // One branch that MUST archive (it has a dependency) and two that must be
    // hard-deleted — this is the mix the report described.
    // One tag for this test's branches: the admin list is sorted by name and
    // paginated, so in a busy test.db they would sit past page 1. The list is
    // opened filtered to exactly them.
    const tag = uniq("SeqRun");
    const willArchive = await createBranchWithHistory(admin.req, `${tag}-A`);
    const willDelete1 = await createBareBranch(admin.req, `${tag}-B`);
    const willDelete2 = await createBareBranch(admin.req, `${tag}-C`);

    await page.goto(`/admin/branches?search=${encodeURIComponent(tag)}`);
    await expect(page.getByTestId(`branch-row-delete-${willArchive.id}`)).toBeVisible();

    /**
     * "archived" uses the row's Archive button; "deleted" uses Delete
     * permanently, which waits for the server's check and then needs the
     * branch's exact name typed before its button enables.
     */
    async function deleteRow(id: number, expected: "archived" | "deleted", name = "") {
      await page.getByTestId(expected === "archived" ? `branch-row-archive-${id}` : `branch-row-delete-${id}`).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog, "dialog opens for this row").toBeVisible();
      if (expected === "archived") {
        await dialog.getByRole("button", { name: /archive branch/i }).click();
      } else {
        const confirm = dialog.getByRole("button", { name: /delete forever/i });
        await expect(confirm, "disabled until the name is typed").toBeDisabled();
        await dialog.getByTestId("branch-delete-confirm-name").fill(name);
        await confirm.click();
      }
      // The dialog must disappear on its own — this is exactly what used to
      // fail, leaving an invisible overlay across the page.
      await expect(dialog, "dialog closes after the action").toBeHidden({ timeout: 20_000 });
      await expect(page, "URL states the REAL outcome").toHaveURL(
        new RegExp(`result=${expected}`),
      );
    }

    // 1st — archives. This is the operation after which everything used to break.
    await deleteRow(willArchive.id, "archived");
    // An archived branch leaves the default list (kept, not managed day to day).
    await expect(page.getByText(willArchive.name)).toHaveCount(0);

    // 2nd — with NO page reload in between.
    await deleteRow(willDelete1.id, "deleted", willDelete1.name);
    // 3rd — still no reload.
    await deleteRow(willDelete2.id, "deleted", willDelete2.name);

    // The Archived filter is where it went.
    await page.goto(`/admin/branches?state=archived&search=${encodeURIComponent(tag)}`);
    await expect(page.getByText(willArchive.name)).toBeVisible();

    // The two unused branches are gone; the archived one is preserved.
    expect((await admin.req.get(`${API_BASE}/api/branches/${willDelete1.id}/`)).status()).toBe(404);
    expect((await admin.req.get(`${API_BASE}/api/branches/${willDelete2.id}/`)).status()).toBe(404);
    const archived = await (await admin.req.get(`${API_BASE}/api/branches/${willArchive.id}/`)).json();
    expect(archived.is_archived, "history-carrying branch was archived, not deleted").toBe(true);
    expect(archived.is_active, "an archived branch takes no new orders").toBe(false);

    await admin.context.close();
  });

  test("cancelling one dialog leaves every other row's Delete working", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const { page } = admin;
    const tag = uniq("SeqCancel");
    const first = await createBareBranch(admin.req, `${tag}-A`);
    const second = await createBareBranch(admin.req, `${tag}-B`);

    await page.goto(`/admin/branches?search=${encodeURIComponent(tag)}`);

    // Open the first row's dialog and cancel it.
    await page.getByTestId(`branch-row-delete-${first.id}`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog, "cancel removes the overlay").toBeHidden();

    // A different row must now be usable immediately.
    await page.getByTestId(`branch-row-delete-${second.id}`).click();
    const secondDialog = page.getByRole("dialog");
    await expect(secondDialog, "the second row's dialog opens").toBeVisible();
    await expect(secondDialog, "and names the SECOND branch").toContainText(second.name);
    await expect(secondDialog, "not the first").not.toContainText(first.name);

    // Escape closes it too, without leaving the page pointer-locked.
    await page.keyboard.press("Escape");
    await expect(secondDialog).toBeHidden();

    // Prove the page still receives clicks: delete the first branch for real.
    await page.getByTestId(`branch-row-delete-${first.id}`).click();
    const third = page.getByRole("dialog");
    await expect(third).toBeVisible();
    await third.getByTestId("branch-delete-confirm-name").fill(first.name);
    await third.getByRole("button", { name: /delete forever/i }).click();
    await expect(third).toBeHidden({ timeout: 20_000 });
    expect((await admin.req.get(`${API_BASE}/api/branches/${first.id}/`)).status()).toBe(404);

    await admin.context.close();
  });
});

test.describe("permanent delete follows the history rule", () => {
  test("a branch with orders can only be archived: the check and the delete both refuse", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    // Searched by name: the list is newest first, so a busy test.db can push
    // Main Branch past any fixed page.
    const branches = (await (await admin.req.get(`${API_BASE}/api/branches/?search=Main%20Branch&page_size=100`)).json()).results as {
      id: number;
      name: string;
    }[];
    const main = branches.find((b) => b.name === "Main Branch")!;
    const check = await (await admin.req.get(`${API_BASE}/api/branches/${main.id}/removal-check`)).json();
    expect(check.deletable, "a branch with orders is not deletable").toBe(false);
    expect(check.history.orders).toBeGreaterThan(0);
    const refused = await admin.req.post(`${API_BASE}/api/branches/${main.id}/permanent-delete`, {
      data: { confirm_name: main.name },
    });
    expect(refused.status(), "history → 409, even with the right name").toBe(409);
    expect((await admin.req.get(`${API_BASE}/api/branches/${main.id}/`)).status()).toBe(200);

    // The dialog explains instead of offering a delete.
    await admin.page.goto(`/admin/branches/${main.id}`);
    await admin.page.getByTestId("branch-delete").click();
    await expect(admin.page.getByTestId("branch-delete-blocked")).toBeVisible();
    await expect(admin.page.getByRole("button", { name: /delete forever/i })).toBeDisabled();
    await admin.context.close();
  });

  test("a zero-order branch goes with its setup data, only with the exact name, and is logged", async ({ browser }) => {
    const admin = await newSession(browser, "super_admin");
    const branch = await createBranchWithHistory(admin.req);
    const check = await (await admin.req.get(`${API_BASE}/api/branches/${branch.id}/removal-check`)).json();
    expect(check.deletable).toBe(true);
    expect(check.setup.deliveryAreas).toBe(1);

    const wrongName = await admin.req.post(`${API_BASE}/api/branches/${branch.id}/permanent-delete`, {
      data: { confirm_name: "not the name" },
    });
    expect(wrongName.status(), "wrong name → 400").toBe(400);
    const bm = await newSession(browser, "branch_manager");
    const denied = await bm.req.post(`${API_BASE}/api/branches/${branch.id}/permanent-delete`, {
      data: { confirm_name: branch.name },
    });
    expect(denied.status(), "super admin only").toBe(403);

    const ok = await admin.req.post(`${API_BASE}/api/branches/${branch.id}/permanent-delete`, {
      data: { confirm_name: branch.name },
    });
    expect(ok.status()).toBe(200);
    expect((await admin.req.get(`${API_BASE}/api/branches/${branch.id}/`)).status()).toBe(404);

    const logs = await (await admin.req.get(`${API_BASE}/api/activity-logs/?activity_type=delete&page_size=20`)).json();
    const rows = (logs.results ?? logs) as { description: string }[];
    expect(rows.some((r) => r.description.includes(branch.name) && r.description.includes("1 delivery areas"))).toBe(true);
    await admin.context.close();
    await bm.context.close();
  });
});
