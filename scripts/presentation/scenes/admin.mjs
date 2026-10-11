// Super admin: platform-wide screens. Desktop, Bangla.
const scenes = {
  async super_admin(browser, { session, shot, go, center }) {
    const { context, page } = await session(browser, "super_admin");
    const R = "super_admin";
    await go(page, "/admin/dashboard");
    await shot(page, R, "dashboard", "Super admin dashboard: users, branches, today's orders and total sales across all 16 branches");
    await go(page, "/admin/brands");
    await shot(page, R, "brands", "Brands: Cheez! Pizza and Madchef, with how many branches and products each has");
    await go(page, "/admin/branches");
    await page.mouse.move(850, 500);
    await page.mouse.wheel(0, 380);
    await shot(page, R, "branches", "Branch list: the 16 real branches with their brands, phone, manager and 5 km radius");
    await go(page, "/admin/branches/create");
    await shot(page, R, "add-branch", "Add new branch form: name, phone, brands served, zone, dining or cloud kitchen, address");
    await go(page, "/admin/branches/1/hours");
    await shot(page, R, "branch-hours", "Uttara hours editor: ordering hours per brand with Delivery and Pickup per time slot");
    await center(page, page.getByTestId("hours-dine-in-last-entry"));
    await shot(page, R, "branch-hours-dine-in", "Uttara dine-in hours 11:00 AM–11:00 PM with the new last guest entry time (10:30 PM)");
    await go(page, "/admin/delivery-areas");
    // The toggle is a client component: a click before hydration is lost, so retry.
    for (let i = 0; i < 6 && !(await page.getByTestId("coverage-legend").isVisible()); i++) {
      await page.getByTestId("coverage-map-toggle").click();
      await page.getByTestId("coverage-legend").waitFor({ timeout: 3000 }).catch(() => {});
    }
    await page.locator(".leaflet-container").first().waitFor({ timeout: 20_000 });
    await center(page, page.locator(".leaflet-container").first());
    await page.waitForTimeout(1500);
    await shot(page, R, "delivery-areas-map", "Delivery areas overview: all 16 branches and their 5 km delivery areas on one map");
    await go(page, "/admin/delivery-areas/1/edit");
    await page.locator(".leaflet-container").first().waitFor();
    await page.mouse.move(850, 500);
    await page.mouse.wheel(0, 330);
    await page.waitForTimeout(1200);
    await shot(page, R, "delivery-area-editor", "Delivery area editor (Uttara): the 5 km circle around the branch pin, with its radius slider");
    await go(page, "/admin/users");
    await shot(page, R, "users", "Users: demo staff, riders and customers with role and status");
    await go(page, "/admin/settings/platform-fee");
    await shot(page, R, "platform-fee", "Platform fee settings: one fee for every order, with per-branch overrides");
    await go(page, "/admin/coupons");
    await shot(page, R, "coupons", "Coupons: MADCHEF30, 30% off at every branch, no end date and no usage limits");
    await go(page, "/admin/activity-logs");
    await shot(page, R, "activity-log", "Activity log: manager assignments, review flags and other actions, with who did them");
    await go(page, "/admin/reports");
    await shot(page, R, "reports", "Reports: orders, sales and branch performance for the last two weeks");
    await context.close();
  },
};

export default scenes;
