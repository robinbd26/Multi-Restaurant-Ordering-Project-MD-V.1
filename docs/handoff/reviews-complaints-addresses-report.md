# Reviews, complaints & addresses: handoff report

Branch: `reviews-complaints-addresses` (cut from `main` at `2e6997d`, equal to `origin/main` after `git fetch`).
Nothing is pushed and no PR exists (CLAUDE.md + this round's instructions).

## Resume here
If this session was interrupted: read the Status list, continue at the first unchecked item. Don't redo checked items.

## Status
- [x] Setup: on `main` = `origin/main` (2e6997d). Previous round present: `/admin/brands`, `lib/hours/*` schedule,
      migrations 20261007120000/130000/140000 (brands, hours, status flow). Branch `reviews-complaints-addresses` created.
      The untracked snapshot `tests/e2e/17-rider-dashboard.spec.ts-snapshots/rider-offline-dashboard-chromium-win32.png`
      was stashed as `stash@{0}` "pre-reviews-complaints-addresses: untracked rider-offline snapshot png".
- [x] Part 1: delivery areas simplified. Commit `ea0fe50`. Migration applied to Ash's dev.db; default areas added with
      `npx tsx prisma/seed-delivery-areas.ts` (Main Branch, Cheez Gulshan, Madchef Dhanmondi: 5 km circles).
      E2E spec updates for the new model: TODO, done with the e2e runs in Finishing.
- [x] Part 2: My Addresses. Commit `632e1a9`. Checked in the browser (test DB, dev server :3100): map mode, coverage
      message, manual mode keeps its map, manual save stored "Flat 4B, Banani, Dhaka", mobile 400px layout.
- [x] Part 3: product reviews. Commit `4990a60`. Migration 20261008110000 applied to Ash's dev.db (after backup
      `backups/dev.db.2026-10-08T11-28-48Z.pre-product-reviews.bak`). Browser-checked on the test DB: customer review,
      card line and modal (logged out), marketing hide/restore, BM flag; API: marketing flag 403, BM hide 403.
      E2E spec for reviews: TODO in Finishing.
- [ ] Part 4: complaints form
- [ ] Part 5: shared upload component
- [ ] Part 6: dark mode unread notifications
- [ ] Part 7: branch hours follow-ups
- [ ] Part 8: cleanup leftovers
- [ ] Finishing: verification, browser walkthrough, final report

## Decisions

### Part 1: delivery areas
- **Kept the BranchDeliveryArea table** and made `branchId` unique, instead of moving the area onto Branch. Orders
  already point at it (snapshot provenance) and every coverage/quote/order path reads it, so this was the smallest
  safe change.
- **No name field.** The `name` column stays (NOT NULL, used by the order snapshot `deliveryAreaName`), but nobody types
  it: the service writes the branch name on every save, and new orders snapshot the branch's current name.
- **Shift (day/night/all day) is gone from the UI.** One area covers the whole day; opening hours decide when delivery
  runs. The column and API field remain (default "both"); the editor always sends "both".
- **Save = create or update.** `POST /api/delivery-areas` returns 201 when it creates the branch's area and 200 when it
  updates the existing one, so old callers (and specs) that "create an area" keep working instead of hitting a 409.
- **Hold** (pickup only for the whole area) is kept and moved onto the editor page, since it existed and is tested.
- **Temporary blocks** are a new table `DeliveryAreaExclusion` (shape, reason, optional end time). Kept simple: tap the
  map, size a circle, optional reason and end time (Dhaka time), save; remove with one button. A pin inside an active
  block is **pickup only** (reason `area_excluded`), the same treatment as a held area, because "we cannot drive there
  right now" is not "we are closed". Expiry is checked on every read (like the delivery pause); no background job.
  Blocks must sit within the branch's maximum radius. Every add/remove is logged to Activity Logs.
- **Data step:** the migration removes ALL existing areas on every machine (they were seeded test data). References
  checked first: `Order.deliveryAreaId` (SetNull link; cleared first; orders keep their name/charge/ETA snapshot; on
  Ash's data 8 of 19 orders had a link and all 8 snapshots are intact), `CustomerAddress` (no link; coverage uses the
  pin), coupons/campaigns (no link; marketing matches the order's snapshot text). Nothing else references areas.
- **Seed:** `prisma/seed-delivery-areas.ts` creates a 5 km circle (৳60, 45 min) for each seeded demo branch that has a
  pin and no area. `npm run seed` calls it, and it also runs on its own, which is what Ash's machine got (the full seed
  also resets the demo branches' coordinates, which Ash has edited, e.g. Madchef Dhanmondi).
- **After the cleanup only the 3 demo branches deliver** on Ash's machine. Banani and Dhanmondi Lake (they have pins)
  need their area drawn by their manager or the super admin; Bailey Road and Mirpur 10 have no map pin, so a super
  admin must set the pin first.
- **Overlap between branches** is unchanged (nearest open branch that covers the pin is the default; the customer can
  switch). The editor now draws OTHER branches' areas faintly so overlaps are visible while drawing.
- The admin list is now one row per branch (drawn / not drawn, charge, time, hold, blocks) with Draw / Edit. The old
  paginated explorer, its skeleton and the already-unused `DeliveryAreasManager` were removed (no references left).
  `/branch-manager/delivery-areas/new` and `/[id]/edit` redirect to the single page.
- The old slider label read the missing key `branches.radiusN`; it now uses `deliveryArea.radiusKm`.

### Part 2: My Addresses
- **Root cause of the vanishing map:** manual mode hid the MapPicker, which also held the only lat/lng inputs, while the
  server requires a pin (coverage is decided from it). So a manual address could never be saved. Fixed by making the
  modes separate and giving manual mode its own pin step.
- **Manual mode still needs a pin.** Removing the pin requirement would let customers save addresses nobody can check
  for delivery. Instead "Find on map" geocodes the typed address (existing `/api/geo/search`, Barikoi on the server)
  and drops the pin; the customer can drag it. If geocoding finds nothing (or no Barikoi key), they tap the map.
- **One optional line** "Flat, floor or landmark" is stored in `flatNumber` and prefixed to the address text, which is
  what the order snapshot and the rider see. Map mode clears road/house/sub-area on save so a re-picked pin never keeps
  a stale road from an older address.
- **Labels Home / Work / Other.** Stored values unchanged ("Home", "Office", "Others" + optional name); only the English
  word "Office" became "Work" (also in the checkout drawer, same key). "Other" no longer requires a name.
- **Coverage before saving** uses a new `POST /api/delivery/point-coverage` (any branch, customer only, display only).
  Outside every branch = a clear amber message; saving is still allowed (pickup), matching the existing wording.
- The live-location card is removed from My Addresses only; it is still used on the restaurants page gate.
- MapPicker got opt-in props only (`prominentGps`, `alwaysOpen`, `coordinateEntry`); checkout is unchanged. The
  power-user "Enter coordinates manually" toggle is hidden in the address book (it read like a third mode).
- 5-address cap: unchanged on the server; the page now shows "n of 5 saved" and disables Add at the cap. The checkout
  one-time address flow was not touched.

### Part 3: product reviews
- **Evolved the existing `FoodReview` table** (kept its name) instead of adding a second review table. It already held
  food reviews (1 row on Ash's machine, 1 on the test DB). Uniqueness moved from (order, product) to (customer, product).
  The migration keeps the newest review when a customer had several for one product, clamps ratings to 1..5 and
  backfills branch/brand (tested on a deliberately dirty copy).
- **Eligibility** = a `delivered` order containing the product (Collected is stored as delivered). The review points at
  the newest such order. Customers only; enforced server-side.
- **Branch and brand** are snapshotted on the review (product's branch; brand from the order line, else the product's).
  A brand-less product sold under two brands at one branch gets the brand it was ordered under.
- **Privacy:** public payload = first name (first word of `firstName`, username prefix as a fallback), avatar, stars,
  text, photos, dates. Profile photos are private in this app, so the avatar is served through
  `/api/reviews/[id]/avatar`, only while that review is visible. Staff lists show first name + "Customer #id".
- **Photos:** private folder `review_photos` (refused by `/api/uploads`), served by `/api/reviews/[id]/photos/[n]`:
  public while visible, otherwise only marketing/super admin, the branch's manager and the author. Same pipeline and
  10 MB per-photo cap as order chat.
- **Moderation** keeps the review's `updatedAt`, so hiding/restoring never shows "edited" or reorders it. Hiding or
  restoring clears any flag. A BM flag notifies every marketing user (notification type "review").
- **"Rate your items"** appears on the order page for delivered/collected orders (each distinct product, pre-filled when
  already reviewed). The invite notification is sent from the shared status-change path, so it also fires for an
  override to Delivered. The old "Leave a review" header button now jumps to that section.
- The legacy `POST /api/reviews` (type food) now delegates to the new service (create-or-edit) so older callers work.
- The "See all reviews" option expands inside the modal (pages of 10) rather than opening a new page.
- Reviews management pages: `/marketing/reviews`, `/admin/reviews`, `/branch-manager/reviews` (+ nav entries).
- The marketing Feedback overview now ignores hidden reviews too (it averaged all of them).

## Backups (not committed)
- `backups/dev.db.2026-10-08T11-04-54Z.pre-reviews-complaints-addresses.bak` (before any migration this round).
- `backups/dev.db.2026-10-08T11-28-48Z.pre-product-reviews.bak` (before the reviews migration).

## Verification

## Steps for Robin
