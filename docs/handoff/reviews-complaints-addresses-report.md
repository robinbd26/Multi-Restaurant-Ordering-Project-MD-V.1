# Reviews, complaints & addresses: handoff report

Branch: `reviews-complaints-addresses` (cut from `main` at `2e6997d`, equal to `origin/main` after `git fetch`).
Pushed and merged into `main` on explicit instruction (see "Push and merge" at the end). No PR was opened.

## Resume here
If this session was interrupted: read the Status list, continue at the first unchecked item. Don't redo checked items.

## Summary
- **Delivery areas:** one area per branch, no name field, live "N km radius" slider, full-width editor, super admin and
  branch manager both edit (server-enforced, logged), temporary blocks with an optional end time. Old seeded areas
  removed by migration; each demo branch gets a 5 km default.
- **My Addresses:** live-location card gone; two modes (Pick on map with "Use my current location" first, or Enter
  manually + find on map); Home/Work/Other + one optional flat/floor/landmark line; coverage warning before saving.
- **Product reviews:** delivered/collected customers, one per product (editable), 1 to 5 stars, text, up to 3 photos;
  invite after delivery; "★ 4.8 (30)" on cards; reviews in the product modal; marketing/super admin hide and restore,
  branch manager views and flags; management pages with filters.
- **Complaints:** customer form always goes to the order's branch manager ("Goes to: …"), super admin when the branch
  has none; Other + Rider behavior categories; friendly order labels in Dhaka time; up to 5 photos.
- **Shared upload field** everywhere the app takes an image (order chat kept its camera button).
- **Dark mode** unread notifications fixed.
- **Hours:** no hours = closed, with warnings; live pairs without hours backfilled to all day; Night Pickup Points from
  real data.
- **Cleanup:** DeliveryTimeSlot dropped, "delayed" leftovers removed (fixed a NaN dashboard slice), missing i18n keys
  added, spec 22 rerunnable.

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
- [x] Part 4: complaints form. Commit `7e4757e`. Migration 20261008120000 applied to Ash's dev.db (backup
      `backups/dev.db.2026-10-08T11-47-14Z.pre-complaint-photos.bak`). Browser-checked: customer form, live "Goes to",
      friendly order labels, photo upload; complaint #6 notified only Main Branch's manager + super admins; photo shown
      on the detail page; BM/super admin can open it.
- [x] Part 5: shared upload component. Component added in `4990a60` (first used by reviews), rolled out in `0e32c26`.
      Browser-checked on the brand form: wrong-type error, preview, remove, real input carries the file.
- [x] Part 6: dark mode unread notifications. Commit `4355dea`. Browser-checked on /admin/notifications (dark).
      Cause: unread rows used `bg-brand-50/60` + `bg-brand-100` with no `dark:` variant. Fix: dark uses `brand-500/10`
      tint (same as other active rows in the dark theme) and unread rows get a brand left edge in both themes.
- [x] Part 7: branch hours follow-ups. Commits `f3edb12` (rule + warnings + backfill), `10432aa` (night pickup).
      Migration 20261008130000 applied to Ash's dev.db (backup `backups/dev.db.2026-10-08T12-06-17Z.pre-hours-backfill.bak`):
      0 of 12 branch-brand pairs needed hours (all had them). Browser-checked: branch page banner, availability API says
      `hours_not_set`, homepage night pickup from data.
- [x] Part 8: cleanup leftovers. Commits `2a052c9` (drop DeliveryTimeSlot + API; migration 20261008140000 applied to
      Ash's dev.db after backup `backups/dev.db.2026-10-08T15-52-53Z.pre-drop-time-slots.bak`), `0a21e1c` (delayed
      leftovers + NaN dashboard fix), `d2855a1` (missing i18n keys), `650021c` (spec 22 cleanup).
- [x] New/updated e2e: `bbd3d71` (spec 76 + delivery-areas-management rewrite). 76: 5/5 pass.
- [x] Finishing: related e2e runs against a main baseline (`308399e`, `ec73c4f`), role walkthrough on a production
      build (bug found and fixed in `61fed09`), final checks, this report.
- [x] Follow-up: Bengali guide + 29 screenshots (`8b8ff25`). Three small bugs found while taking the screenshots,
      fixed in their own commits: `00e98e1`, `ad6b7d2`, `8d36237` (see "Found while writing the guide").
- [x] Follow-up: branch pushed, `main` tagged, merged (`b9e6a44`), built and pushed (see the last section).

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

### Part 4: complaints
- **Routing (server-enforced, customers only):** the selected order decides everything. Branch has an active approved
  manager → `branch_manager` + that branch (only that branch's managers are notified, plus super admins as before).
  **No manager assigned → `super_admin`, branch kept** on the complaint (so it lands in the super admin's inbox, which
  filters on recipient role). **No order selected → `super_admin`.** The old fallbacks for customers (their latest
  order's branch, or a branch-less complaint every manager could see) are no longer used for customers; riders and
  staff keep the old resolution.
- **Order is optional** for customers (a complaint about the app has no order); without one it goes to support.
  The newest order is pre-selected so the "Goes to" line is meaningful immediately.
- **"Goes to" wording:** "Goes to: Gulshan branch manager"; a branch whose name already ends in "Branch" reads
  "Goes to: Main Branch manager"; no manager: "Goes to: our support team (Gulshan has no branch manager assigned yet)".
- **Order label:** `#id · <date> · <total>`, id like the customer's order pages ("Order #122"). Dates on the Dhaka
  calendar: Today / Yesterday with time, "N days ago" for 2 to 6 days (no time, as specified), then "3 Oct, 2:15 PM".
- **Photos:** stored as a JSON array on `Complaint.photos` (additive migration, default `[]`). Served with
  `private, no-cache`: during the browser check a rider on the same browser got the super admin's cached photo with a
  `max-age` header, so complaint photos now revalidate every time. **Not fixed (pre-existing, unrelated):** order chat
  photos use `private, max-age=300`, so on a shared browser the next logged-in user can see a cached chat photo for up to
  5 minutes. Flagged for the developer.
- Staff/rider complaint form unchanged (recipient dropdown, JSON, no photos).

### Part 5: shared upload component
- `components/ui/image-upload.tsx`, used for: product image, brand logo, company logo (settings), branch logo, profile
  picture (own profile and admin user form), employee photo, Ramadan menu image, rider registration NID front/back and
  licence, review photos (3), complaint photos (5).
- **Order chat kept its camera button** (it already had a preview and never showed the bare browser control; a drop
  zone would crowd the composer). This is the "if it fits" case from the brief.
- Limits: unchanged per place. Type check = the shared `imageFileProblem` (same as the server); size = the server's
  50 MB default, or the caller's own cap (10 MB per photo for chat/review/complaint photos, matching chat).
- Integration: a real hidden `<input name=…>` carries the file, so FormData forms, their validation hooks and the e2e
  `setInputFiles('input[name=…]')` selectors keep working. Fields moved from `Field` to `FieldGroup` because `Field`
  wraps its children in a `<label>` (nested labels).

### Part 7: hours follow-ups
- **Which pairs had no hours:** on Ash's dev.db **none** (all 12 branch-brand pairs had schedules, including archived
  Mirpur Branch). On the test DB, the branches created by earlier e2e runs had none; the migration gave the active ones
  all-day hours. Robin's machine: the migration does the same for any live pair without hours, so nothing that is open
  today closes. (Branches created after this release start with no hours, i.e. closed, as requested.)
- **Why a backfill and not just a warning:** "make sure nothing open today closes" can only be guaranteed on Robin's
  data (which I cannot see) by giving unconfigured live pairs the behaviour they have today. All-day = exactly the old
  "no time limit". Managers can narrow it in the hours editor.
- Unreadable/malformed hours JSON also counts as "not set" (closed), so a corrupt row can never open a brand.
- Warnings: admin branch detail banner, BM dashboard banner (both name the brands), admin branch list badge, hours
  editor panel text. They all link to the hours editor.
- **Night Pickup Points:** "late at night" = last pickup order today at 11:00 PM or later, or past midnight. Branch must
  have pickup enabled. Shows branch name, pickup address (else branch address) and "Pickup until …". Hidden when none.
  The old fixed list (Mirpur DOHS, Mohakhali DOHS, Cantonment, Nikunja, Bashundhara pickup spots) had no data behind it
  and is gone; if the client wants those named pickup spots back, they need a data model (e.g. pickup points per branch).
- **e2e impact:** the e2e seed now writes an explicit all-day schedule for the demo branches (it used to clear them to
  mean "always open"). Specs that create a branch and then order from it must set hours: helper `openBranchAllDay()`.

### Part 8: cleanup
- **DeliveryTimeSlot:** confirmed unused before removal (only its own API routes, an `addTimeSlot` helper, the seed,
  the branch-removal setup counter + its label, and an audit spec checking the endpoint's auth referenced it; no UI,
  no reader). Dropped by migration 20261008140000. Ash's table held the 2 seeded demo rows only.
- **"delayed" leftovers removed** from in-flight/status lists (order-chat policy, rider-duty, rider-location, live
  board, page summaries, customer active count, rider current-order pickers). **Real bug found and fixed:** the admin,
  management and BM dashboards summed `picked_up + on_the_way + delayed` for "Delivering", but the breakdown has had no
  `delayed` key since `dec4c29`, so the slice was `NaN`. Kept on purpose: the rider's Delayed button (an announcement
  the update-status route accepts) and two display fallbacks that render a legacy "delayed" row as On the way.
  `tests/order-chat-policy.test.mts` listed "delayed" as in flight; updated.
- **Missing i18n keys:** all ten from the last report added in en + bn; a scan of every static `t()`/`sk()` key in
  app/components/lib now finds none missing.
- **Spec 22:** `beforeEach`/`afterEach` release courier2 (override its open orders to Cancelled, end duty). Ran twice
  on the same DB: only C3 fails, at the wrong-branch assignment (expects 400, gets 409); that assertion also failed on
  a fresh DB on main last round, so it is pre-existing and left as is.
- **Build gotcha (also for Robin):** `tsconfig.json` includes the generated types of `.next-e2e/` (an isolated e2e
  build folder). A stale `.next-e2e/types` from 26 Sep still listed the deleted time-slot routes and broke
  `npm run build`. I deleted only `.next-e2e/types` (generated, git-ignored). If Robin's build fails the same way:
  delete `.next-e2e/types` (or the whole `.next-e2e` folder).

## Found while writing the guide (fixed)
- `00e98e1` **hours editor label:** "Clear these hours (no time limit)" still described the old meaning. Since
  `f3edb12` no hours = closed, so a manager pressing it closed the brand while told it would be open around the
  clock. Label (en + bn) now says it stays closed until hours are set again.
- `ad6b7d2` **seed sample review:** the seed created its food review without the `branchId`/`brand` that
  `4990a60` added, so on a freshly seeded DB the branch manager's Product Reviews did not list it (marketing did).
  It now snapshots both and upserts on the one-per-customer-per-product key. Existing DBs were already backfilled by
  the migration; only fresh seeds were affected.
- `8d36237` **Night Pickup note:** `10432aa` said "Home delivery ends at {time}. After that, order for pickup" without
  checking pickup runs later. With the demo hours (Cheez delivery to 4 AM, pickup to 11 PM) the homepage told
  customers to pick up after 4 AM while the cards said pickup closes at 11 PM. The note now shows only when pickup
  really closes after delivery.
- Re-verified after these: `npx tsc --noEmit` clean, eslint on the touched files clean, `npm run build` passes,
  `npm run test:unit` 82/82, `npm run test:e2e:prepare` (seed on the test DB) OK, e2e 74 + 76: 8/8 pass.

## Bengali guide
- `docs/guide/mad-delivery-guide-bn.md` + `docs/guide/images/` (29 PNGs, 1440x900, ~6 MB).
- Screenshots come from a scratch `prisma/guide.db` (git-ignored): `migrate deploy` + the normal `npm run seed`, served by
  the production build through Playwright. `dev.db` was not touched (checksum compared before/after; an extra backup
  `backups/dev.db.2026-10-08T17-39-24Z.pre-guide-screenshots.bak` was taken anyway). Only seeded demo data is visible;
  no keys or .env values. The demo password is not written in the guide (it points to `docs/HANDOVER.md`).
- The screenshot script was temporary and is not committed.
- `docs/location-zones-checkout-fees-coupons-bn.md` got a top note pointing to the new guide for the rules that changed.

## Backups (not committed)
- `backups/dev.db.2026-10-08T11-04-54Z.pre-reviews-complaints-addresses.bak` (before any migration this round).
- `backups/dev.db.2026-10-08T11-28-48Z.pre-product-reviews.bak` (before the reviews migration).
- `backups/dev.db.2026-10-08T11-47-14Z.pre-complaint-photos.bak` (before the complaint photos migration).
- `backups/dev.db.2026-10-08T12-06-17Z.pre-hours-backfill.bak` (before the hours backfill migration).
- `backups/dev.db.2026-10-08T15-52-53Z.pre-drop-time-slots.bak` (before dropping DeliveryTimeSlot).

## Verification

### E2E findings while finishing (and what was changed because of them)
- A `main` baseline worktree (2e6997d, own `npm ci`, own build, own test DB, port 3200) ran the same 32 related spec
  files: **main = 65 failed / 200 passed**. First branch run: 87 failed / 178 passed. Compared by test title (line
  numbers move when a spec is edited), 25 failures were branch-only. Causes, all from this round's intended changes:
  1. **Held Main Branch area cascade.** Specs 25, 28 and 39 "created" an area on Main Branch and held it. With one area
     per branch that held Main's only area, and a test that failed before resuming left Main pickup-only for every
     later spec (35, 39, 68, 26 UI, ...). Fix: those tests now use a fresh branch far from Dhaka
     (`freshDeliveryBranch()` fixture) or resume in `finally`; the e2e seed resets Main's area (not held, active, no
     blocks) on every `test:e2e:prepare`.
  2. **New overlapping seeded areas.** The seed now gives Cheez Gulshan and Madchef Dhanmondi areas (requested for dev
     machines). They share a pin, so for many test points they became the customer's nearest branch, changing the
     catalogue scope dozens of specs assume. Decision: **the e2e seed keeps only Main Branch's area** (removes the
     other two demo areas on the test DB only); dev machines still get one area per demo branch.
  3. **No hours = closed.** Specs that create a branch and order from it now call `openBranchAllDay()` (26, 29, 35,
     55, 63, 66, 70).
  4. **One area per branch / no area names.** Area tests in 25, 28, 39 and 29 ("find a branch by its area's name")
     rewritten for the single-area model; spec 61 rewritten for the two-mode address form (and starts from an empty
     address book, since other specs fill the shared customer's 5-address cap).

### E2E results (final)
- **Branch: 62 failed / 221 passed** on the same 32 related spec files plus 22, 76 and delivery-areas-management.
  **Main baseline: 65 failed / 200 passed** (same files that exist on main).
- After the fixes above, **no failure is branch-only.** Every remaining branch failure also fails on main (same test
  title), or is one of the four the brief said to leave alone: `35:165`, `12:199`, `26:264`, `29:438`.
  Other groups failing on both: the screenshot specs (18), and parts of 55, 62, 63, 66, 70 (mostly stale fixtures and
  timing on a long-lived test DB).
- Spec 22 C3: fails on both (main also fails C2 and C5, which now pass on the branch thanks to the cleanup hooks).
- 26 / 29 "branch list" UI tests failed at first only because ~226 leftover fixture branches from earlier runs pushed the
  target past the list's 100-branch page. I archived old fixture branches **in the test DB only**, and the specs now
  archive what they create. They pass.
- New spec 76 (review eligibility + one-per-product, moderation permissions, complaint routing incl. no-manager
  fallback, no-hours rule, one area per branch + temporary block): **5/5 pass**.

### Commands run at the end (on `61fed09`)
- `npx tsc --noEmit`: clean.
- `npx eslint` on every file touched this round (per commit) and on the final fix: clean.
- `npm run test:unit`: **82/82 pass** (new: review policy, complaint routing, no-hours rule, coverage exclusions).
- `npm run build`: passes, no warnings.
- `node scripts/check-i18n-params.mjs`: clean (run after the i18n commits).

### Browser walkthrough (production build, test DB, port 3100; desktop 1380 wide and mobile 400 wide)
- **Super admin** (desktop, clicking through the sidebar): Delivery Areas overview and Edit area for Main Branch
  (slider, blocks, hold), Reviews (filters, hide/restore), Complaints #6 with its photo, branch detail no-hours banner,
  notifications in dark mode. **Bug found:** the overview map drew archived branches' areas and its "not drawn yet"
  count disagreed with the list. Fixed in `61fed09`.
- **Marketing** (mobile): Reviews with the Flagged filter, hide and restore, no layout overflow.
- **Branch manager** (mobile): Delivery Area editor (one area, radius slider, add/remove block), dashboard (no NaN, no
  false no-hours banner), Reviews (view + flag only, no hide button).
- **Rider** (desktop + mobile): dashboard and order flow unaffected; complaint form for staff unchanged.
- **Customer** (mobile): complaint form ("Goes to: Main Branch manager", order labels like "#229 · Today, 11:25 PM ·
  ৳704", photos), order page "Rate your items", My Addresses two modes and the 5-address counter.
- **Logged out** (mobile): product card "★ 5.0 (1)", product modal reviews section (average, breakdown, text), Night
  Pickup block, no horizontal scroll; the product sheet sits flush at the bottom.

### Not verified (and why)
- "Use my current location" with a real GPS fix: the browser here has no location permission; the button and its
  error path were checked, the success path only through the map pin.
- Barikoi reverse geocoding with a real key on this machine's test run: the code path is the existing `/api/geo`
  routes; with no key the form falls back to manual text, which was checked.
- Push notifications (Firebase is on hold); the in-app notifications were checked.
- Robin's data: migrations were tested on copies of Ash's dev.db and on deliberately dirty copies, not on Robin's DB.

### Loose ends for the developer
- I stopped only my own server on port 3100. Ash's dev server was not touched; restart it if it was running before
  (the Prisma client was regenerated during the run).
- `stash@{0}` holds the untracked rider-offline snapshot png from main (`git stash pop` on main if you want it back).
- Scratch worktree for the main baseline: `git worktree list` shows it under the session scratchpad (`.../scratchpad/mb`).
  Remove with `git worktree remove --force <path>` when convenient; I left it because it is outside the project folder.
- Order chat photos are cached `private, max-age=300` (pre-existing): on a shared browser the next user can see a cached
  chat photo for up to 5 minutes. Complaint photos were changed to `no-cache`; chat was left as is.
- The test DB keeps growing (fixture branches, orders). `npm run test:e2e:prepare` resets demo data but not old fixtures;
  deleting `prisma/test.db` before prepare gives a clean slate.

## Steps for Robin (own machine, own dev.db)
Five migrations this round. Two of them change data on purpose (delivery areas are wiped; unset hours become
all-day), so back up first. Each was tested on a copy of Ash's dev.db and, where it repairs data, on a deliberately
dirty copy. They only read what is in YOUR database.

1. Stop your dev server (Windows: `prisma generate` fails while it holds the query engine file).
2. Back up: `copy prisma\dev.db backups\dev.db.<date>.before-reviews-complaints-addresses.bak` (never commit `backups/`).
3. Get the code: `git fetch origin` then `git checkout reviews-complaints-addresses` (or pull `main` once the PR is merged).
4. `npm install` (no new packages; it runs `prisma generate` for the new schema).
5. `npx prisma migrate deploy`. It applies, in order:
   - `20261008100000_one_delivery_area_per_branch`: **deletes every delivery area** (they were test data), after
     clearing `Order.deliveryAreaId` (orders keep their own name/charge/ETA snapshot), then makes one area per branch
     and adds the temporary-blocks table. After this, **no branch delivers until it has an area** (step 6).
   - `20261008110000_product_reviews`: one review per customer per product (keeps the newest if you had duplicates),
     photos, moderation fields; backfills branch/brand on existing reviews.
   - `20261008120000_complaint_photos`: adds `Complaint.photos` (empty for existing complaints).
   - `20261008130000_backfill_unset_brand_hours`: "no hours" now means CLOSED. Any live brand at a live branch with no
     (or unreadable) hours gets an all-day schedule, so nothing that is open for you today closes. To see which ones
     it touches, run this BEFORE migrating (optional):
     `npx prisma db execute --stdin --schema prisma/schema.prisma` and paste
     `SELECT branchId, brandId FROM BranchBrand WHERE hours = '' OR hours IS NULL;` (or just look at the hours editors
     afterwards: backfilled brands show 12:00 AM to 12:00 AM).
   - `20261008140000_drop_delivery_time_slots`: drops the unused time-slot table.
6. Give the demo branches their default delivery area: `npx tsx prisma/seed-delivery-areas.ts` (only creates a 5 km
   circle for Main Branch / Cheez Gulshan / Madchef Dhanmondi when they have a map pin and no area; touches nothing
   else). Any other branch: its manager or the super admin draws the area at Delivery Areas.
   (`npm run seed` also does this, but it re-applies other demo data, e.g. demo branch coordinates.)
7. Env: nothing new. `.env.example` only had the `E2E_SEED` note reworded.
8. If `npm run build` fails with "Cannot find module ... app/api/branch-manager/time-slots", delete the generated
   folder `.next-e2e\types` (or the whole `.next-e2e`), which `tsconfig.json` includes; it is stale build output.
9. Restart the dev server.
10. Check: Delivery Areas shows one row per branch; My Addresses has the two tabs; a product you received can be rated
    from its order page; /marketing/reviews lists reviews; the homepage Night Pickup block shows only branches with
    late pickup (or nothing).
11. For e2e: `npm run build`, `npm run test:e2e:prepare` (migrates + seeds the test DB, demo hours all day), then specs.

If a migration fails: stop, restore the backup (`copy backups\...bak prisma\dev.db`) and send Ash the error text.

## Push and merge (follow-up, on explicit instruction)
- **Guide:** `docs/guide/mad-delivery-guide-bn.md`, screenshots in `docs/guide/images/` (commit `8b8ff25`).
- **Branch push:** done, `git push -u origin reviews-complaints-addresses` (new branch on origin, tracking set).
- **Merge conditions checked first:** production build passes on the branch, `npx tsc --noEmit` clean, no
  branch-caused e2e failures (the remaining ones also fail on main; listed under "E2E results (final)").
- **Tag:** `pre-reviews-complaints-addresses` on the old `main` (`2e6997d`), pushed to origin.
- **Merge:** `main` was up to date with origin (`2e6997d`, nobody had pushed since the branch was cut).
  `git merge --no-ff reviews-complaints-addresses`: no conflicts. **Merge commit: `b9e6a44`.**
- **After the merge, on `main`:** `npx tsc --noEmit` clean, `npm run build` passes; the merged tree is identical to the
  branch tree. Pushed: `2e6997d..b9e6a44 main -> main`. No push needed a retry. Nothing was force-pushed and no branch
  was deleted.
- **This report update** was committed on `main` after the merge and pushed; the branch was then fast-forwarded to
  `main` and pushed, so both point at the same commit.
- **Rollback** (undoes the whole merge in one new commit, history kept):
  `git revert -m 1 b9e6a44` then `git push origin main`.
  The database migrations are NOT undone by a revert; restore a DB backup if the data must go back too.
  The tag `pre-reviews-complaints-addresses` marks the exact pre-merge `main`.
