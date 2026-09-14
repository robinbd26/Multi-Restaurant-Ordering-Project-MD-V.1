# Self Pickup + Address Form Fixes — Work Record

**Branch:** `customer-edit-by-ash`
**Commits:** `c6bdaeb`, `3ce3e9a`, `981a27d`
**Scope:** customer-facing checkout (`components/home/CartDrawer.tsx`) and the
Address Book (`components/customer/address-manager.tsx`). No other role's
files were touched.

---

## Context

The customer requested three things: a "Self Pickup" option alongside
delivery in the cart drawer, fixes to the "Add New Address" form (nickname
and Road/Lane should be free text, not dropdowns; the sub-area dropdown
should offer "add your own" like the main-area dropdown already does), and
an investigation into why the delivery-address map preview "isn't working."

---

## Part 1 — Self Pickup checkout flow (`c6bdaeb`)

**File:** `components/home/CartDrawer.tsx`

- Added a **"Self Pickup"** button under "Place an Order" in the cart view.
- **Important discovery, changed scope mid-plan:** the original ask assumed
  the customer could pick from a *list* of pickup locations. That's not
  possible in this codebase — every `Product` row belongs to exactly one
  `branchId` (`prisma/schema.prisma`), and a cart is already locked to the
  one branch that owns its items (see `components/home/BranchSwitchDialog.tsx`).
  So there is only ever one valid pickup branch per cart. The flow was built
  accordingly: **no location list** — "Self Pickup" goes straight to a
  confirmation step ("Are you sure you want to pick up from **{branch}**?"),
  showing that branch's `pickup_address`/`pickup_phone`.
- Added a **pickup-time selector** on the payment step: a `<select>` of
  preset offsets (30/45/60/90/120 minutes from now), each labeled with the
  actual clock time. Minimum is enforced by only ever offering ≥30-minute
  presets.
- Overview step shows the pickup branch/time recap instead of a delivery
  address, and the delivery-fee row reads "Free (Pickup)".
- Success receipt shows the pickup branch address/phone and chosen time.
- Reused the existing payment methods (`CUSTOMER_PAYMENT_METHODS`) unchanged
  — no new payment methods or config.
- New i18n keys added to both `messages/en.json` and `messages/bn.json`.

**Verified:** live dev server, logged in as the seeded `customer` account,
placed a real Self Pickup order end-to-end (order #5), confirmed
`fulfillmentType: "pickup"` and the correct `branchId`/`deliveryAddress` in
the SQLite row directly.

---

## Part 2 — Backend: scheduled pickup time (`3ce3e9a`)

- **Schema:** added `Order.requestedPickupAt DateTime?` — a single additive,
  nullable column. **Migration SQL was shown to the user for review before
  it was applied** (`prisma/migrations/20260914122717_add_order_requested_pickup_at/`):
  ```sql
  ALTER TABLE "Order" ADD COLUMN "requestedPickupAt" DATETIME;
  ```
- **`lib/services/orders.ts` (`createOrder`)**: accepts an optional
  `pickupTime` (ISO string). When present and the order is a pickup order,
  it must parse and sit at least `PICKUP_MIN_LEAD_MINUTES` (30, defined in
  `lib/constants/orders.ts`) ahead of the **server's** clock — never the
  client's. Persisted to `requestedPickupAt`.
- Threaded `pickup_time` through `app/api/orders/route.ts`,
  `lib/serializers/index.ts` (outbound `pickup_time` field),
  `lib/api/actions.ts` (`CheckoutPayload`), and `types/index.ts`.
- New error keys: `errors.orders.pickupTimeRequired`,
  `errors.orders.pickupTimeTooSoon` (both locales).

**Bug found and fixed during testing:** the first version of this
validation made `pickup_time` **mandatory** for every pickup order. That
broke a pre-existing e2e test
(`tests/e2e/26-nearest-branch-checkout.spec.ts` — "PICKUP uses the explicit
branch (no coordinates required)") which creates a pickup order without a
scheduled time — a legitimate use case outside the new customer drawer
flow. Fixed: **`pickup_time` is optional**; it's validated only when
provided. This fix is folded into the Part 3 commit (`981a27d`) since it
was discovered while re-verifying that work.

**Verified:** placed a second live Self Pickup order (order #6) choosing a
non-default 60-minute slot; confirmed `requestedPickupAt` persisted with
the correct timestamp directly in the database.

---

## Part 3 — Address form fixes (`981a27d`)

Applied to **both** `components/home/CartDrawer.tsx` (the drawer's inline
add-address form) and `components/customer/address-manager.tsx` (the
Address Book page) — these are two independently-coded forms that had
drifted apart before this work.

1. **Nickname → "Location Name" free-text input.** Removed the
   Home/Home-2/Home-3/Office/Others preset dropdown (drawer) and the
   "What Kind of Address is This?" modal + button-grid (Address Book,
   `ADDRESS_TYPES`/`PRESET_TYPES`/`TYPE_EMOJI`/`showTypeModal` all deleted).
   Replaced with one text input, label "Location Name", placeholder
   *"e.g. Home, Office, Mom's House"*. New addresses store the typed text
   directly as `label`. Old saved addresses with preset labels still
   display correctly (no data migration needed).
2. **Road/Lane → free text (drawer only).** The Address Book already used
   free text here; only the drawer still had a 100-option `<select>`
   (`ROAD_LANE_OPTIONS`, "Road 1".."Road 100"). Converted to a plain input;
   deleted the now-unused `ROAD_LANE_OPTIONS` export from
   `lib/constants/area-data.ts`.
3. **Sub-area ("Select Area") gets its own "+ Add your Own"**, in both
   forms, for every main area — mirroring the main-area dropdown, which
   already had this. Wired to the existing `custom_area` column (previously
   only a legacy display fallback, now a first-class input path).
4. Applied the "Location Name" fix to the drawer's map-mode add-address
   form too (the label field under the `MapPicker`).

**Test file updated:** `tests/e2e/61-address-book.spec.ts` — rewrote the
"address-type modal" test to match the new direct-save/Location-Name flow,
and updated the sub-area dropdown assertions (Basundhara and Banani) to
expect the new "+ Add your Own" trailing option.

**Verified:**
- Full production build (`npm run build`) + isolated test database
  (`prisma/test.db`, never the dev/prod `dev.db`) — all 3 tests in
  `61-address-book.spec.ts` pass.
- Manually exercised in the browser: Location Name renders as a plain input
  with the correct placeholder; selecting Banani → "+ Add your Own" on the
  sub-area correctly reveals "Enter Area Name" and updates the live preview.
  (A later attempt to also click through Road/Lane hit stale coordinates
  after a layout reflow and got garbled input — no data was saved, the page
  was reloaded to discard it. Not pursued further since the same flow is
  already covered deterministically by the passing Playwright test.)

---

## Part 4 — Investigated, no code needed

- **Map preview "not working"**: not a bug. `components/maps/map-picker.tsx`
  already implements a fully working draggable/clickable pin with live
  reverse-geocoded preview. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is blank in
  `.env`, `.env.local`, and `.env.example`, so the component correctly falls
  back to its documented no-key placeholder. Confirmed live in-browser: the
  Address Book page shows *"The interactive map is not available on this
  installation..."* exactly as designed.
  **Action needed from the user:** obtain a Google Maps JavaScript API key
  (Maps JavaScript API + Geocoding API enabled) and set it in `.env.local`.
  No code changes will be required once that's done. This component is
  shared with the branch-manager delivery-zone editor, so the fix benefits
  both.
- **Order-ready notifications**: already implemented, no work needed.
  `updateOrderStatus()` in `lib/services/orders.ts` already calls
  `createNotification()` on every status transition (except "delayed",
  which gets more specific copy), including a pickup order moving to
  "ready" — mirrored to push automatically. This is fulfillment-type
  agnostic already.

---

## Skipped / known gaps / needs attention

- **Pre-existing pricing quirk (not touched, out of scope):** the quote
  request built in `CartDrawer.tsx`'s `fetchQuote()` sends only
  `{ product_id, quantity }` per line — no `variation_id`. This means the
  server prices using the product's base price rather than the specific
  size/variant shown in the cart (observed live: cart showed "Cheese Pizza
  · Small · ৳499 each" but the quoted/charged subtotal came back as ৳699).
  This exists identically in the **original, untouched** delivery quote
  code — Self Pickup just reuses the same line-building logic. Worth a
  dedicated fix, but it's unrelated to this task and wasn't introduced by
  it.
- **This e2e suite is heavily order-dependent across files** (documented in
  `playwright.config.ts`: "workflow specs mutate shared seed data; run
  serially"). Running an arbitrary subset or a re-ordered subset of spec
  files against the same test database produces *different* spurious
  failures each time (confirmed directly — the same specs failed one way
  when run as a partial batch, a different way when run again without
  resetting the DB, and yet differently in a full from-scratch run that hit
  unrelated pre-existing issues in `18-homepage-design`/`19-product-modal`
  screenshot-diff tests). A full, clean, correctly-ordered run was
  attempted but did not finish in the session (killed after ~330 of ~600+
  tests, well past the point where every spec touching pickup, delivery
  coverage, or addresses had already passed). **Recommendation:** run
  `npm run test:e2e:prepare && npm run build && npm run test:e2e` as one
  uninterrupted sequence in CI or a dedicated terminal before merging, to
  get a trustworthy full-suite signal — don't cherry-pick files.
- **Manual delivery-flow regression check was not completed in-browser.**
  The seeded customer's location is far outside every delivery zone in this
  dev environment ("You are outside every delivery zone right now"), which
  makes the homepage menu show 0 items and blocks adding a fresh cart item
  through the UI. Delivery-path correctness was instead verified by: (a)
  code review confirming the delivery branches of `fetchQuote()`/
  `confirmOrder()` are byte-identical to the pre-existing code, just moved
  into the "else" side of a new `fulfillmentType` branch, and (b) the full
  passing e2e coverage in `21-phase-b-core.spec.ts` and
  `26-nearest-branch-checkout.spec.ts`, which exercise delivery checkout at
  the API level. A live UI click-through of a delivery order was not done.
- **`components/home/CartDrawer.tsx.bak`** — a stale, unused backup file
  sitting next to the real component (not imported anywhere, confirmed via
  grep). Left alone since deleting it wasn't asked for, but it's dead
  weight worth removing in a follow-up.
- **New e2e coverage for the Self Pickup flow itself** was not written —
  the plan called this out as a nice-to-have, not a blocking requirement
  for this task. Recommend adding a drawer-level Playwright test (Self
  Pickup button → confirm → payment with time selector → overview → place
  → success) mirroring the existing delivery-drawer coverage pattern.
- **Bengali translations** for all new strings were written by the
  assistant (not reviewed by a native speaker) — worth a native-speaker
  pass before shipping to Bangla-locale users.
