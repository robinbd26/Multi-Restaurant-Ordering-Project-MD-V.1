// Management, marketing, the Uttara branch manager and accounts. Desktop,
// Bangla. The rider's screens are taken during the order journey (journey.mjs),
// the only time a rider has a live job to show.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** Uttara's showcase order: delivered by the demo rider, with a chat and a review. */
async function uttaraDeliveredOrder() {
  const uttara = await db.branch.findFirstOrThrow({ where: { name: "Uttara" } });
  return db.order.findFirstOrThrow({
    where: { branchId: uttara.id, status: "delivered", fulfillmentType: "delivery", riderId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
}

const scenes = {
  async management(browser, { session, shot, go }) {
    const { context, page } = await session(browser, "management");
    const R = "management";
    await go(page, "/management/dashboard");
    await shot(page, R, "dashboard", "Management dashboard: today's orders, sales and branch status");
    await go(page, "/management/branches");
    await shot(page, R, "branches", "Branches: live status of all 16 branches");
    await go(page, "/management/orders");
    await shot(page, R, "orders", "All orders across branches, filterable by status and branch");
    await go(page, "/management/performance");
    await shot(page, R, "performance", "Branch performance comparison");
    await go(page, "/management/reports/sales");
    await shot(page, R, "sales-report", "Sales report for the last two weeks");
    await go(page, "/management/complaints");
    await shot(page, R, "complaints", "Complaints from all branches with their status");
    await context.close();
  },

  async marketing(browser, { session, shot, go }) {
    const { context, page } = await session(browser, "marketing");
    const R = "marketing";
    await go(page, "/marketing/dashboard");
    await shot(page, R, "dashboard", "Marketing dashboard: campaigns, coupon use and customer reach");
    await go(page, "/marketing/coupons");
    await shot(page, R, "coupons", "Coupons: MADCHEF30 (30% off everything, every branch) with its use count");
    await go(page, "/marketing/campaigns");
    await shot(page, R, "campaigns", "Campaigns: the MADCHEF30 campaign sent to customers, with its reach");
    await go(page, "/marketing/reviews");
    await shot(page, R, "review-moderation", "Review moderation: product reviews with ratings, one flagged by a branch manager");
    await context.close();
  },

  async branch_manager(browser, { session, shot, go, center }) {
    const { context, page } = await session(browser, "branch_manager");
    const R = "branch_manager";
    const showcase = await uttaraDeliveredOrder();
    await go(page, "/branch-manager/dashboard");
    await shot(page, R, "dashboard", "Uttara branch dashboard: today's orders, open orders and riders on duty");
    await go(page, "/branch-manager/orders");
    await shot(page, R, "orders", "Uttara orders: pending, preparing, delivered, collected and cancelled");
    await go(page, `/branch-manager/orders/${showcase.id}`);
    await shot(page, R, "order-detail", "Order detail: items, customer, rider and the status timeline from Pending to Delivered");
    const chat = page.locator('[data-testid="order-chat-panel"], [data-testid="order-chat"]').first();
    if (await chat.count()) {
      await center(page, chat);
      await shot(page, R, "order-chat", "Order chat on the same order: customer, branch and rider in one thread");
    }
    await go(page, "/branch-manager/delivery-areas");
    await page.locator(".leaflet-container").first().waitFor({ timeout: 20_000 }).catch(() => {});
    await shot(page, R, "delivery-area", "Uttara delivery area: a 5 km circle around the branch, ৳60, 45 minutes");
    await go(page, "/branch-manager/delivery-hours");
    await shot(page, R, "branch-hours", "Uttara ordering hours for Cheez and Madchef");
    await center(page, page.getByTestId("hours-dine-in-last-entry"));
    await shot(page, R, "branch-hours-dine-in", "Dine-in hours with last guest entry 10:30 PM");
    await go(page, "/branch-manager/delivery-zone");
    await shot(page, R, "branch-settings", "Branch settings: delivery radius, fee, prep time and pickup point");
    await go(page, "/branch-manager/complaints");
    await shot(page, R, "complaints", "Complaints routed to Uttara, with status");
    await go(page, "/branch-manager/reviews");
    await shot(page, R, "reviews", "Reviews of Uttara's dishes with ratings");
    await go(page, "/branch-manager/riders");
    await shot(page, R, "riders", "Riders on duty at Uttara, on the live map");
    await context.close();
  },

  async accounts(browser, { session, shot, go }) {
    const { context, page } = await session(browser, "accounts");
    const R = "accounts";
    const showcase = await uttaraDeliveredOrder();
    await go(page, "/accounts/dashboard");
    await shot(page, R, "dashboard", "Accounts dashboard: sales, platform fees, rider commissions");
    await go(page, "/accounts/reports");
    await shot(page, R, "reports", "Financial reports for the last two weeks");
    await go(page, "/accounts/invoices");
    await shot(page, R, "invoices", "Invoices list");
    await go(page, `/accounts/invoices/${showcase.id}`);
    await shot(page, R, "invoice", "One invoice: items, MADCHEF30 discount, delivery charge, platform fee and total");
    await go(page, "/accounts/rider-earnings");
    await shot(page, R, "rider-earnings", "Rider earnings: commission per delivered order");
    await context.close();
  },
};

export default scenes;
