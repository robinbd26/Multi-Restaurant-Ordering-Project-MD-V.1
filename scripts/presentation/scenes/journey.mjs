// The order journey: ONE fresh order at Uttara, followed step by step from the
// screen of whoever acts. Places a real order (demo data only).
//
//   customer places it (MADCHEF30) → branch accepts → preparing → assigns the
//   rider and marks it ready → rider gets the job offer and accepts → picked up
//   → on the way (with order chat) → delivered → customer's tracking at the end.
//
// The rider's and customer's live screens are also filed under their own
// folders (rider/, customer/), since those states only exist during a journey.

const BN = {
  accept: "অর্ডার গ্রহণ করুন",
  preparing: "প্রস্তুতি শুরু",
  ready: "রাইডারের জন্য প্রস্তুত করুন",
  pickedUp: "পিকআপ করেছি",
  onTheWay: "রওনা দিয়েছি",
  delivered: "ডেলিভারি সম্পন্ন",
  assign: "অ্যাসাইন",
};

async function clickUntil(page, target, done, tries = 8) {
  for (let i = 0; i < tries; i++) {
    if (await done()) return;
    await target.click().catch(() => {});
    await page.waitForTimeout(900);
  }
}

/** Press a status button and wait for the page to show the next state. */
async function press(page, label, next) {
  const button = page.getByRole("button", { name: label, exact: true }).first();
  await button.waitFor({ timeout: 20_000 });
  await button.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  if (next) await page.getByRole("button", { name: next, exact: true }).first().waitFor({ timeout: 20_000 });
  else await page.waitForTimeout(1500);
}

async function openMenu(page, brand) {
  const tab = page.getByTestId(`menu-brand-tab-${brand}`).locator("button").first();
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await page.waitForTimeout(600);
}

async function addDish(page, name, crust) {
  const card = page.locator("article").filter({ has: page.locator("h4", { hasText: new RegExp(`^${name}$`) }) }).first();
  await card.scrollIntoViewIfNeeded();
  await clickUntil(page, card.locator("button").first(), () => page.getByTestId("modal-add-to-cart").isVisible());
  if (crust) await page.getByTestId(`home-crust-${crust}`).click();
  await page.getByTestId("modal-add-to-cart").click();
  await page.waitForTimeout(3500); // the "added to cart" toast fades
}

const scenes = {
  async journey(browser, { session, shot, go, center, MOBILE }) {
    const J = "journey";

    // ── 1. Customer places the order ─────────────────────────────────────
    const customer = await session(browser, "customer");
    const cp = customer.page;
    await go(cp, "/");
    await openMenu(cp, "cheez");
    await addDish(cp, "Classic Combo", "THIN");
    await openMenu(cp, "madchef");
    await addDish(cp, "Mad Chicken Sandwich");
    await cp.getByTestId("home-cart-button").click();
    await cp.getByTestId("place-an-order").click();
    await cp.getByTestId("drawer-saved-address").first().click();
    await cp.getByTestId("drawer-next-payment").click();
    await cp.getByTestId("drawer-coupon").fill("MADCHEF30");
    await cp.getByTestId("drawer-order-note").fill("গেটে পৌঁছে কল দিবেন।");
    await cp.getByTestId("drawer-next-overview").click();
    await shot(cp, J, "customer-confirms-order", "1. Customer (Uttara) reviews the order: Classic Combo + Mad Chicken Sandwich, coupon MADCHEF30, cash on delivery");
    await cp.getByTestId("drawer-confirm-order").click();
    await cp.getByTestId("drawer-checkout-success").waitFor({ timeout: 30_000 });
    await shot(cp, J, "customer-order-placed", "2. Order placed: the receipt shows the MADCHEF30 discount (30% off), delivery charge and platform fee");
    await shot(cp, "customer", "order-placed-madchef30", "Order placed with MADCHEF30 applied: the 30% discount on the receipt");
    await cp.getByTestId("drawer-view-order").click();
    await cp.waitForURL(/\/customer\/orders\/\d+/);
    const orderId = Number(cp.url().match(/orders\/(\d+)/)[1]);
    await shot(cp, J, "customer-tracking-pending", "3. Customer's order page: waiting for the branch to accept");

    // ── 2. Branch manager accepts, prepares, assigns, marks ready ────────
    const manager = await session(browser, "branch_manager");
    const mp = manager.page;
    await go(mp, "/branch-manager/orders");
    await shot(mp, J, "branch-new-order", "4. Uttara branch manager: the new order arrives at the top of the list as Pending");
    await go(mp, `/branch-manager/orders/${orderId}`);
    await shot(mp, J, "branch-order-pending", "5. Order detail at the branch: items, customer note, and the Accept button");
    await press(mp, BN.accept, BN.preparing);
    await shot(mp, J, "branch-accepted", "6. Branch accepted the order");
    await press(mp, BN.preparing, BN.ready);
    const select = mp.locator("select").filter({ has: mp.locator("option") }).first();
    await select.selectOption({ index: 1 });
    await mp.getByRole("button", { name: BN.assign, exact: true }).click();
    await mp.waitForTimeout(2000);
    await shot(mp, J, "branch-preparing-rider-assigned", "7. Preparing, and the Uttara rider is assigned (the rider gets a job offer)");
    await press(mp, BN.ready);
    await shot(mp, J, "branch-ready-for-rider", "8. Marked Ready for rider");

    // ── 3. Rider (mobile) gets the job and delivers ──────────────────────
    const rider = await session(browser, "rider", { viewport: MOBILE, mobile: true });
    const rp = rider.page;
    await go(rp, "/rider/dashboard");
    await rp.getByTestId("rider-assignment-modal").waitFor({ timeout: 45_000 });
    await shot(rp, J, "rider-job-offer", "9. Rider's phone: the job offer pops up with the pickup, drop-off and distance");
    await shot(rp, "rider", "job-offer", "Job offer: accept or reject a new delivery (Uttara)");
    await rp.getByTestId("assignment-accept").click();
    await rp.getByTestId("rider-assignment-modal").waitFor({ state: "hidden", timeout: 20_000 });
    await go(rp, "/rider/dashboard");
    await shot(rp, "rider", "dashboard-active", "Rider home: on duty at Uttara, with the current delivery");
    await go(rp, `/rider/orders/${orderId}`);
    await rp.getByRole("button", { name: BN.pickedUp, exact: true }).first().waitFor({ timeout: 20_000 });
    await shot(rp, J, "rider-accepted", "10. Rider accepted: the active delivery with the Picked up button");
    await shot(rp, "rider", "active-delivery", "Active delivery: customer, address, items and the Picked up / On the way / Delivered buttons");
    await press(rp, BN.pickedUp, BN.onTheWay);
    await shot(rp, J, "rider-picked-up", "11. Rider picked the order up at the branch");
    await press(rp, BN.onTheWay, BN.delivered);
    await shot(rp, J, "rider-on-the-way", "12. On the way to the customer");
    const map = rp.locator(".leaflet-container").first();
    if (await map.count()) {
      await center(rp, map);
      await rp.waitForTimeout(1500);
      await shot(rp, "rider", "delivery-map", "Delivery map: the branch and the customer's pin");
    }
    const riderChat = rp.getByTestId("chat-input");
    if (await riderChat.count()) {
      await center(rp, riderChat);
      await riderChat.fill("আমি উত্তরা সেক্টর ৭-এ ঢুকেছি, ৫ মিনিটে পৌঁছাব।");
      await rp.getByTestId("chat-send").click();
      await rp.waitForTimeout(1500);
      await shot(rp, "rider", "order-chat", "Order chat from the rider's phone: rider, customer and branch in one thread");
    }

    // The customer follows along.
    await go(cp, `/customer/orders/${orderId}`);
    await shot(cp, J, "customer-tracking-on-the-way", "13. Customer's tracking: On the way, with the rider's name and the timeline");
    await shot(cp, "customer", "order-tracking", "Order tracking: status timeline, rider, and delivery estimate");
    const customerChat = cp.getByTestId("chat-input");
    if (await customerChat.count()) {
      await center(cp, customerChat);
      await customerChat.fill("ঠিক আছে, গেটে দারোয়ান আছে।");
      await cp.getByTestId("chat-send").click();
      await cp.waitForTimeout(1500);
      await shot(cp, "customer", "order-chat", "Order chat from the customer's side, with the rider's message");
      await shot(cp, J, "customer-chat", "14. Customer and rider chat on the order");
    }

    await go(rp, `/rider/orders/${orderId}`);
    await press(rp, BN.delivered);
    await shot(rp, J, "rider-delivered", "15. Rider marks it Delivered");
    await go(rp, "/rider/earnings");
    await shot(rp, "rider", "earnings", "Earnings: commission for each delivered order, including this one");
    await go(rp, "/rider/order-history");
    await shot(rp, "rider", "delivery-history", "Delivery history with each order's steps");

    await go(cp, `/customer/orders/${orderId}`);
    await shot(cp, J, "customer-tracking-delivered", "16. Customer's tracking at the end: Delivered, every step with its time");
    await go(mp, `/branch-manager/orders/${orderId}`);
    await shot(mp, J, "branch-order-delivered", "17. The branch sees the finished order, with the full status history");

    await customer.context.close();
    await manager.context.close();
    await rider.context.close();
  },
};

export default scenes;
