// Customer screens (the demo `customer`, who lives in Uttara) and the blocked
// customer. Desktop unless marked mobile. Bangla, plus two English shots.
//
// Nothing here places an order: the cart and checkout are shown up to the last
// step. The order itself is placed in the journey scene.

/** Click until it takes: buttons rendered by the server react only after hydration. */
async function clickUntil(page, target, done, tries = 6) {
  for (let i = 0; i < tries; i++) {
    if (await done()) return;
    await target.click().catch(() => {});
    await page.waitForTimeout(700);
  }
}

async function openMenu(page, brand) {
  const tab = page.getByTestId(`menu-brand-tab-${brand}`).locator("button").first();
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await page.locator("#menu-section").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 56));
  await page.waitForTimeout(800);
}

/** Pick a category chip (its label is the category name, after an emoji). */
async function chooseCategory(page, label) {
  const chip = page.locator("#menu-section button").filter({ hasText: label }).first();
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await page.waitForTimeout(500);
  await chip.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150));
  await page.waitForTimeout(800);
}

/** The product card for a dish by its exact name. */
const card = (page, name) => page.locator("article").filter({ has: page.locator("h4", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) }).first();

async function openProduct(page, name) {
  const c = card(page, name);
  await c.scrollIntoViewIfNeeded();
  await clickUntil(page, c.locator("button").first(), () => page.getByTestId("modal-add-to-cart").isVisible());
  await page.getByTestId("modal-add-to-cart").waitFor();
}

const scenes = {
  async customer(browser, { session, shot, go, MOBILE }) {
    const R = "customer";
    {
      const { context, page } = await session(browser, "customer");
      await go(page, "/");
      await shot(page, R, "home-desktop", "Customer homepage (desktop): both brands, nearest branch Uttara, delivery fee and time");
      await openMenu(page, "cheez");
      await chooseCategory(page, "Classic Pizzas");
      await shot(page, R, "cheez-menu", "Cheez menu at Uttara: crust and size guide, then the pizzas with photos and prices");
      await chooseCategory(page, "Pizza Combos");
      await shot(page, R, "cheez-combos", "Cheez combos: Classic Combo ৳449 and Premium Combo ৳549, 8 inch, thick or thin");
      await openMenu(page, "madchef");
      await chooseCategory(page, "Gourmet Burgers");
      await shot(page, R, "madchef-menu", "Madchef menu at Uttara: burgers, wraps, rice meals and more");

      // A dish people have reviewed.
      await openMenu(page, "cheez");
      const reviewed = await page.locator("article:has([data-testid=card-rating]) h4").first().innerText();
      await openProduct(page, reviewed);
      await shot(page, R, "product-popup", `Product popup (${reviewed}): photo, description, sizes and price`);
      const reviews = page.locator('[data-testid="product-reviews"], [data-testid="product-reviews-section"]').first();
      if (await reviews.count()) {
        await reviews.scrollIntoViewIfNeeded();
        await shot(page, R, "product-popup-reviews", `The same popup scrolled to its customer reviews and star rating`);
      }
      await page.getByTestId("modal-add-to-cart").click();
      await page.waitForTimeout(600);

      // A Madchef dish too, so the cart shows both brands from one branch.
      await openMenu(page, "madchef");
      await openProduct(page, "Mad Chicken Sandwich");
      await page.getByTestId("modal-add-to-cart").click();
      await page.waitForTimeout(3500); // let the "added to cart" toast go

      await page.getByTestId("home-cart-button").click();
      await page.getByTestId("place-an-order").waitFor();
      await shot(page, R, "cart", "Cart: a Cheez pizza and a Madchef burger from Uttara, with delivery and pickup buttons");

      // Delivery checkout.
      await page.getByTestId("place-an-order").click();
      await page.getByTestId("drawer-checkout-address-step").waitFor();
      await shot(page, R, "checkout-delivery-address", "Checkout for delivery: choose the saved Uttara address (inside the delivery area)");
      await page.getByTestId("drawer-add-map-address").click();
      await page.locator(".leaflet-container").first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      await shot(page, R, "add-address-map", "Add a new address by picking the spot on the map (with address search)");
      await page.getByTestId("drawer-add-map-address").click().catch(() => {});
      await page.getByTestId("drawer-saved-address").first().click();
      await page.getByTestId("drawer-next-payment").click();
      await page.getByTestId("drawer-checkout-payment-step").waitFor();
      await page.getByTestId("drawer-coupon").fill("MADCHEF30");
      await shot(page, R, "checkout-payment-coupon", "Payment step: cash on delivery or bKash, with coupon MADCHEF30 entered");
      await page.getByTestId("drawer-next-overview").click();
      await page.getByTestId("drawer-checkout-overview-step").waitFor();
      await page.getByTestId("drawer-receipt-discount").waitFor({ timeout: 15_000 }).catch(() => {});
      await shot(page, R, "checkout-overview-madchef30", "Order overview before confirming: MADCHEF30 takes 30% off, plus delivery charge and platform fee");
      await context.close();
    }
    {
      // Pickup checkout, fresh cart.
      const { context, page } = await session(browser, "customer");
      await go(page, "/");
      await openMenu(page, "cheez");
      await openProduct(page, "Classic Combo");
      const thin = page.getByTestId("home-crust-THIN");
      if (await thin.count()) await thin.click();
      await page.getByTestId("modal-add-to-cart").click();
      await page.waitForTimeout(600);
      await page.getByTestId("home-cart-button").click();
      await page.getByTestId("self-pickup").click();
      await page.getByTestId("drawer-pickup-confirm-step").waitFor();
      await shot(page, R, "checkout-pickup", "Checkout for pickup: collect from Uttara, with the address, hours and a pickup time");
      await context.close();
    }
    {
      const { context, page } = await session(browser, "customer", { viewport: MOBILE, mobile: true });
      await go(page, "/");
      await shot(page, R, "home-mobile", "Customer homepage on a phone (mobile)");
      await openMenu(page, "cheez");
      await chooseCategory(page, "Classic Pizzas");
      await shot(page, R, "cheez-menu-mobile", "Cheez menu on a phone (mobile)");
      await context.close();
    }
    {
      const { context, page } = await session(browser, "customer", { locale: "en" });
      await go(page, "/");
      await shot(page, R, "home-desktop-english", "Customer homepage in English");
      await openMenu(page, "cheez");
      const reviewed = await page.locator("article:has([data-testid=card-rating]) h4").first().innerText();
      await openProduct(page, reviewed);
      await shot(page, R, "product-popup-english", `Product popup in English (${reviewed})`);
      await context.close();
    }
    {
      const { context, page } = await session(browser, "customer");
      await go(page, "/complaints/new");
      await shot(page, R, "complaint-form", "Complaint form: pick the order and category; it goes to that order's branch");
      await go(page, "/customer/reviews");
      await shot(page, R, "reviews", "My reviews: dishes from delivered orders, with star ratings");
      await context.close();
    }
  },

  async blocked_customer(browser, { session, shot, go }) {
    const R = "blocked_customer";
    const { context, page } = await session(browser, "blocked_customer");
    await go(page, "/");
    await openMenu(page, "cheez");
    await chooseCategory(page, "Pizza Combos");
    await openProduct(page, "Classic Combo");
    await page.getByTestId("home-crust-THICK").click();
    await page.getByTestId("modal-add-to-cart").click();
    await page.waitForTimeout(3500); // let the "added" toast go
    await page.getByTestId("home-cart-button").click();
    await page.getByTestId("self-pickup").click();
    await page.getByTestId("drawer-confirm-pickup-branch").click();
    await page.getByTestId("drawer-checkout-payment-step").waitFor();
    await page.getByTestId("drawer-next-overview").click();
    await page.getByTestId("drawer-confirm-order").click();
    await page.getByText(/ব্লক করা হয়েছে|blocked/i).first().waitFor({ timeout: 15_000 });
    await shot(page, R, "order-refused", "A blocked account can browse but not order: confirming shows 'your account is blocked, contact the helpline'");
    await context.close();
  },
};

export default scenes;
