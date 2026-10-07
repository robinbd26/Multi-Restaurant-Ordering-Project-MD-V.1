# Brands, hours & statuses: handoff report

Branch: `brands-hours-statuses` (cut from `main` at `24886d1`, which was already up to date with `origin/main`).
All three parts are done and committed on the branch. **Nothing has been pushed and no PR exists** (see "PR" below).

## Status
- [x] Setup: the untracked snapshot `tests/e2e/17-rider-dashboard.spec.ts-snapshots/rider-offline-dashboard-chromium-win32.png`
      was stashed as `stash@{0}` "pre-brands-hours-statuses: untracked rider-offline-dashboard snapshot (2026-10-07)".
      A spec run has since re-created that file (untracked again); delete it before `git stash pop`, or drop the stash.
- [x] Backups of Ash's dev DB (NOT committed; never `git add backups/`):
      `backups/dev.db.2026-10-07T11-48-23Z.pre-brands-hours-statuses.bak` (before Part 1) and
      `backups/dev.db.2026-10-07T16-08-00Z.pre-hours-and-status-migrations.bak` (before Parts 2 and 3).
- [x] Part 1: brands as data. Commits `0b5e9ad`, `be9b2c8`.
- [x] Part 2: hours per brand and per channel. Commits `bca53a7`, `4549c7d` (label fix).
- [x] Part 3: order status flow. Commit `dec4c29`.
- [x] All three migrations applied to Ash's `prisma/dev.db` (after the backups above): 2 brands, 12/12 branch-brand
      pairs scheduled, 18 orders kept, 0 `delayed` orders left.
- [x] Verification: tsc, eslint, build, unit tests, related e2e specs (with a main baseline), role walkthrough.
- [ ] Push + PR: deliberately not done (CLAUDE.md). Commands below.

## What was built (short)
1. **Brands are data.** `Brand` table + super admin Brands section (`/admin/brands`): add, edit, reorder,
   activate/deactivate, archive (or delete when unused), all logged, super admin only. Branches serve one or several
   brands (`BranchBrand`). Every hardcoded brand name/slug/colour/logo in the storefront, forms, filters and seed now
   reads from the table. The crust guide belongs to the brand (`showCrustGuide`). Zero-loss migration.
2. **Hours per brand and per channel.** Unlimited slots per brand per branch, each with Delivery / Pickup ticks,
   midnight-crossing slots that belong to their start day, "same every day" + per-weekday overrides, optional dine-in
   hours (display only), Asia/Dhaka clock, 12-hour display. Editor for the branch manager (own branch) and super admin
   (any branch), enforced and logged on the server. The schedule replaced the 4 AM-11 AM rule and is the single source
   of truth for checkout, branch ranking, homepage and cart; the delivery pause still applies on top. Closed brands grey
   out with "Opens at ...", checkout explains what is closed. "Call to order" is computed from real data.
3. **Order status flow.** One writer per step (manager: up to Ready; assigned rider: Picked up / On the way /
   Delivered; pickup: manager to Collected), repeats are no-ops, pages live-refresh, rider can be assigned from
   Accepted and pick up before Ready, and an Override status (reason required, logged, visually secondary).

## On the Way bug: root cause
The delivery leg (picked_up / on_the_way / delivered) had TWO writers: the branch manager (the manager page offered
picked_up -> on_the_way -> delivered) and the rider. Neither the manager's order page nor the rider's refreshed live.
When the rider tapped "On the way", the manager's open page still showed "Mark On the way"; tapping it sent
on_the_way while the order was already on_the_way, and the transition table had no on_the_way -> on_the_way edge, so
the service answered 409 "Cannot move from On the Way to this status". Dev data shows managers routinely completing
the rider leg (orders 8, 10, 12, 16: on_the_way -> delivered by branch_manager). Fixed in `dec4c29` by making the
rider the only writer of the rider steps (server-enforced), turning a repeat of the current status into a no-op,
live-refreshing the manager/rider/super admin order pages, and adding Override status for real emergencies.
Covered by e2e `75-order-status-flow` (the exact stale request now returns 200; a manager moving the rider leg gets 403).

## PR
CLAUDE.md says "Never git push and never open PRs". That overrides this round's request to push and open a PR, so the
branch has NOT been pushed. To publish it:
`git push -u origin brands-hours-statuses`, then open a PR from `brands-hours-statuses` into `main` (do not merge yet).

## Decisions (Part 1: brands as data)

**Data model**
- New `Brand` table: slug, name (+ Bangla name), logo, accent colour, short description (+ Bangla), tagline (+ Bangla),
  emoji, `showCrustGuide`, display order, active, archived. The extra fields beyond what was asked (Bangla text, tagline,
  emoji) exist because the homepage already rendered them per brand and the site is bilingual; dropping them would have
  regressed the storefront.
- `slug` is the stable key products, categories and order lines point at. It is set once and cannot be edited, so
  `Product.brand` / `Category.brand` became real foreign keys to `Brand.slug` without rewriting existing values.
- `BranchBrand` join table replaces `Branch.brandType` (cheez | madchef | combined). The column is dropped by the
  migration after its meaning is copied into `BranchBrand` rows ("combined" = both brands).
- `Product.brand = NULL` now means "sold under every brand its branch serves" (what the old `combined` value meant).
  The migration pins brand-less products on single-brand branches to that brand explicitly, so adding a second brand to
  a branch later never re-lists its old products under the new brand.
- Orders did not store a brand. Each `OrderItem` now snapshots the brand it was sold under (`OrderItem.brand`), filled
  by the migration from the product's brand or the branch's only brand. Legacy lines of a product sold under both brands
  on a combined branch get `""` (genuinely indeterminate; there was no record of which tab it came from).
- The migration repairs data before any constraint: inserts the two brands, turns any unknown brand value found in the
  data into its own brand (no dropped references), fills BranchBrand, fixes products, then rebuilds tables with FKs.
  Tested on a copy of Ash's dev.db and on a deliberately dirty copy (unknown brand values, empty strings). Result on
  Ash's data: 2 brands, 12 BranchBrand rows, all 12 products, 18 orders and 20 order lines kept, every line has a brand.

**Rules**
- Super admin only for every brand write, enforced in `lib/services/brands.ts` and the `/api/brands` routes.
  Branch managers and other staff can read brands (`GET /api/brands`, brand badges on their dashboard).
- Delete follows the existing rule: a brand with products, categories or order lines can only be archived; an unused one
  can be deleted. Archiving removes the brand from every branch (so it cannot linger as an empty tab) and keeps history;
  restoring brings it back inactive. All changes go to Activity Logs.
- A branch cannot drop a brand while it still has live products under that brand (clear error instead of silently
  hiding the menu).
- The customer-visibility rule now has two halves: the query checks the brand is live; an object-level check
  (`productSaleBrands`) confirms the branch actually serves it (Prisma cannot compare two columns). Order creation runs
  the object-level check too, so a product can never be sold under a brand its branch no longer serves.
- Legacy API callers that send `brand_type` (cheez | madchef | combined) still work; branch payloads now carry `brands`
  (slugs) plus a derived, deprecated `brand_type`.

**Brand-specific content**
- The Cheez "Crust & size guide" is now controlled by the brand's `Show the crust & size guide` switch, so it only shows
  for brands that turn it on. Its three cards (8" thick/thin, 14" thick, 12"/16" thin) are still fixed copy in the
  component: they describe pizza sizes, not a brand. If the client wants different sizes per brand, that copy should
  move into the brand record or the product variations. Noted rather than built.

**Replaced hardcoding** (homepage hero cards, stats and blurb; menu tabs, header band, colours, search placeholder,
category tab colours, product cards, item modal, nav search, branch bar, branch picker, footer, top strip, page title and
SEO description; branch form (now checkboxes), product form, category form, admin product filter and column, branch
list/detail, branch-manager dashboard, customer branch list; nearest-pickup brand filter; seed).
Coupons and reports never referenced brands, so nothing changed there.
- Hero stats "2 brands / 10 branches / 80 items" were hardcoded: now live counts.
- Left for Part 2 (hours-related, rewritten there): `OperatingHours`, `BranchesCoverage` status text, `CutoffCountdown`,
  `CallToOrder`. For the Part 1 commit only, the old hours module checks whether a branch serves the `cheez` slug for its
  late-night rule. Part 2 deletes that rule.
- Not brand-related, left as is: the footer's location list and the helpline number.

## Test baseline (how pre-existing failures were identified)
A detached worktree of `main` (24886d1) was built in the scratchpad with its own `npm ci`, a fresh test DB, and run on
port 3200, so every failure can be checked against main instead of guessed.
- Subset after Part 1 (specs 18, 20, 28, 54, 55, 56, 57-admin-products-filtering, 66, 71, + new 73):
  main = 30 failed / 94 passed. This branch = the same 30 + 1 (spec 28 "brand type present", caused by the
  dashboard payload now carrying `brands` instead of `brand_type`; the assertion was updated to check `brands`).
  Spec 73 (new): 4/4 passed. The 30 pre-existing failures: 18 (4: brand-switch interaction + 3 screenshots),
  20 (1: variation rows), 28 (2: BM delivery areas), 54 (2: pagination/filters), 55 (17: fixtures draw no delivery
  areas, so customers are out of zone since coverage became drawn shapes), 56 (1, same cause), 66 (3, same cause).

## Decisions (Part 2: hours per brand and channel)
- **Where the schedule lives:** JSON on `BranchBrand.hours` (one per brand per branch), validated by
  `lib/hours/schedule.ts`. Shape: "same every day" slots + optional weekday overrides (an override replaces that day;
  an empty list = closed that day). Each slot has start, last-order time, and Delivery / Pickup ticks. JSON rather than a
  slot table because it is always read and written whole, and the activity log can describe a before/after in one line.
- **Midnight:** a slot whose end is not after its start crosses midnight and belongs to the day it started (Friday
  11:00 AM to 4:00 AM runs into Saturday, even if Saturday is overridden as closed). start == end = 24 hours.
- **Slot end = last order time.** Same-day overlapping slots are refused (ambiguous channels).
- **Not configured = no time limit.** A brand whose schedule was never set takes orders at any time, exactly like a
  branch without opening hours did before. The migration gave every existing branch-brand a real schedule; branches
  created later start unconfigured and the hours editor shows a loud "Hours not set" warning. If the client prefers
  "closed until configured", it is a one-line change in `channelStatus` (lib/hours/availability.ts). Chosen this way so
  a new branch is not silently dead, and so the e2e suite (which creates branches at any hour) stays deterministic.
- **Dine-in hours** are branch-level (the venue, not the brand), display only, `Branch.dineInHours`.
- **Single source of truth:** `lib/hours/availability.ts` `channelStatus` (branch archived/inactive, then manager
  hold, then brand served and live, then the schedule on the Asia/Dhaka clock, then the delivery pause on top, delivery
  only). Used by order quote + creation (`assertBrandsOpen`, per brand per channel, e.g. "Madchef is not taking pickup
  orders right now. It opens at 11:00 AM."), nearest-branch ranking, the branch bar, the homepage, the cart drawer and
  `GET /api/branches/[id]/availability`. The hardcoded 04:00-11:00 platform closure, the 03:45 night cutoff, the
  Cheez late-night rule, `isBranchOpenNow` and `lib/services/branch-hours.ts` are gone.
- **Pickup** is checked at the moment the order is placed. The requested pickup time is not checked against the slot
  (slot end is the last ORDER time, so a 10:20 PM order collected at 10:50 PM is legitimate).
- **Migration of old hours** (20261007130000) reproduces what the code enforced: no hours = 11:00-04:00 both channels;
  daytime hours = max(open, 11:00) to close, and for Cheez on to 04:00 (the old late-night rule); overnight /
  early-morning hours = as set, clipped to 04:00; a window fully inside the old 04:00-11:00 closure = no slots. Both
  channels ticked because the old code accepted pickup whenever it accepted delivery. Old opening/closing become
  dine-in hours for dine-in branches. Then `openingTime`/`closingTime` are dropped. Old API fields
  `opening_time`/`closing_time` now get a 400 pointing to the Hours page instead of being silently ignored.
- **Customer side:** a brand closed on both channels is greyed in the menu (tab + cards) with "Opens at 11:00 AM" /
  "Opens tomorrow at ..." / "Opens Friday at ..."; open on one channel shows "Pickup only right now - delivery: opens
  at ...". The cart drawer disables only the closed channel's button and names the brand. The server re-checks.
- **"Call to order" banner:** computed from real data (today's widest window across live branches, the real branch
  count, each brand's latest delivery last-order today), NOT an admin text setting, so it can never contradict what is
  enforced. Same for Operating Hours, branch status chips (now server-computed in Dhaka time instead of the visitor's
  device clock) and the last-order countdown (server deadlines; the browser only counts down).
- **Left as is:** the "Night Pickup Points" block (pickup locations + "10:15 PM" text) is static marketing copy with no
  data model behind it; flag for the client. The old label-only `DeliveryTimeSlot` "time slots" (never enforced) lost
  their UI; the table and `/api/branch-manager/time-slots` API are kept (no data loss) for a later cleanup.
- **Permissions:** `PUT /api/branches/[id]/hours`: branch manager of that branch or super admin, enforced in
  `lib/services/branch-schedule.ts`; every change logged with a before/after description. Pages:
  `/branch-manager/delivery-hours` (own branch), `/admin/branches/[id]/hours` (any branch, linked from the branch page).
- **Seed:** default schedules for a fresh machine (Madchef 11:00 AM-10:30 PM both channels; Cheez 11:00 AM-11:00 PM
  both + 11:00 PM-4:00 AM delivery only; dine-in 11:00 AM-11:00 PM), only where unset. New env `E2E_SEED=1` (set by
  `scripts/with-test-db.mjs --seed`, documented in .env.example) clears the demo branches' schedules on the test DB.
- **Specs:** 57-branch-hours-enforcement and 67-platform-closure tested the removed rules; replaced by 74-brand-hours
  (permissions, logging, midnight slots, per-brand/channel refusal naming the brand and opening time, delivery pause
  on top). The closure/blackout helpers in tests/e2e/helpers/fixtures.ts now always return false.

## Decisions (Part 3: order status flow)
- **Stored values:** pending, accepted, preparing, ready, picked_up, on_the_way, delivered, cancelled.
  Pickup's "Collected" is stored as `delivered` and "Ready for collection" as `ready`; a delivery's `ready` is labelled
  "Ready for rider" (`orderStatusLabelKey`). A separate `collected` value would have had to be taught to ~90 report
  and aggregate call sites; one missed filter would silently drop pickup revenue.
- **`delayed` is no longer a status.** The rider's "Delayed" button still exists: it records an announcement on the
  status trail (status unchanged) and notifies the customer; the order page shows "about N minutes longer". Migration
  20261007140000 moves delayed orders to on_the_way (and any pickup order a legacy flow left in picked_up/on_the_way
  back to ready). History rows are untouched.
- **Who sets what (server-enforced, lib/services/orders.ts):** delivery: manager / super admin set accepted,
  preparing, ready (and cancel); ONLY the assigned rider sets picked_up, on_the_way, delivered (and the hand-back
  cancel, as before). Pickup: the manager runs it to Collected; riders have no role. Customer: cancel while pending.
  The super admin's normal moves are the manager's; rider statuses only via Override.
- **Rider not blocked:** Picked up is allowed from accepted/preparing/ready (an implicit "ready" event is recorded),
  and Picked up straight to Delivered is allowed. Tapping Picked up also writes the receive confirmation, so the
  separate "confirm receive" tap is no longer required (that endpoint still works, from Accepted on).
- **Rider assignment** only in accepted / preparing / ready (409 otherwise), so a rider can head over while the food
  is prepared.
- **Repeating the current status is a no-op (200)**, never an error: double taps and stale screens.
- **Override status:** `POST /api/orders/[id]/override-status {status, reason}`; branch manager (own branch) or super
  admin; reason of at least 5 characters; any other step of the order's own flow except Pending, or Cancelled;
  delivered/cancelled are final. Logged to Activity Logs ("Override on order ORD-...: picked_up -> delivered. Reason:
  ...", with the actor) and on the order's status trail ("Override: ..."). Commission still goes to the assigned rider
  when overridden to Delivered. UI: a small, quiet "Override status" link on the manager's and super admin's order
  page that opens a panel (deliberately not a normal button).
- **Cancellation** unchanged (manager from any open state with a reason, rider hand-back during their leg, customer
  while pending). It did not conflict with the new flow.
- **Live updates:** the manager's, rider's and super admin's order pages now poll like the customer's tracking page,
  so rider taps show up without a reload.
- **Notifications / chat / commission / reports:** status notifications use the channel label (Collected etc.); the
  2-hour chat read-only clock starts on delivered (= collected) or cancelled as before; commission on delivered as
  before; dashboards / live board / filters use ORDER_FLOW_STATUSES (no "delayed" tile or filter any more).
- **Specs changed because rules changed:** 04 and 35 (a repeated Delivered is now a 200 no-op, commission still once;
  Picked up no longer needs a prior confirm-receive), 22 (same), 68 (pickup wording "Ready for collection" /
  "Collected" / "Mark Collected"). New: unit tests tests/order-status-rules.test.mts and e2e 75-order-status-flow.

## Verification (what was run, and what was not)
- `npx tsc --noEmit`: clean. `npx eslint` on every touched/new file: clean. `npm run build`: passes (final build after
  the last code change).
- Unit tests `npm run test:unit`: 54/54 pass (hours schedule + order status rules).
- E2E: run per part on the related specs. Each failure was checked against a `main` worktree (`24886d1`) built and run
  separately, so "pre-existing" below means "fails on main the same way", not a guess.
  - Part 1 subset (18, 20, 28, 54, 55, 56, 57-admin-products-filtering, 66, 71, 73): branch = main's 30 failures, plus
    spec 28 (assertion updated, see Part 1). New spec 73: 4/4.
  - Part 2/3 subsets on fresh test DBs: branch-only failures found and fixed (11:49, 11:156, 12:268, 68:105, 68:124,
    75:76: specs that assigned riders to Pending orders or expected the old rules). New spec 74 passes.
  - Final run on the last build: 04, 22, 35, 68, 73, 74, 75 -> 27 passed, 7 failed; then 11, 12, 22, 35, 75 -> 39 passed,
    8 failed. Every remaining failure is pre-existing:
    - `22-part-c-rider` C1-C4 (6 tests): the spec's own C3 test assigns Ready orders to `courier2` and never finishes
      them, so on ANY second run against the same test DB that rider cannot go off duty. Reproduced on main: two runs
      of spec 22 on the main worktree fail the same 6 tests. On a fresh test DB only 22:110 fails (on main too).
    - `35-order-workflow:165` (a manager driving another branch's order): fails on main too.
    - `12-md-pdf-fixes:199` (address icons): fails on main too.
    - `26:264` and `29:438` (seen in the Part 2 subset): fail on main too.
  - NOT run: the full e2e suite end to end (only the related specs above). Visual snapshots were not re-baselined.
- Role walkthrough in the running app (production build on the test DB, port 3100):
  - Logged-out visitor: hero brand cards, brand tabs, "Call to order" from real data, hours section, late-night list.
  - Customer: a closed brand (Madchef) greyed with "Opens tomorrow at 12:32 AM", countdown, cart drawer blocks the
    closed channels with a message naming the brand.
  - Branch manager: order page offers only "Mark Ready for rider" / Cancel plus the quiet Override link; the page moved
    to On the Way by itself when the rider tapped; override to Delivered with a reason worked and was logged; hours
    editor saved a Friday-closed override and logged it.
  - Rider: Picked up straight from Accepted, then On the way, then Delivered; the pickup card turned to "Order
    received" after Picked up (a stale-card bug found here was fixed in `dec4c29`).
  - Super admin: `/admin/brands` and `/admin/branches/1/hours` load; Override link on an open order, hidden on a
    delivered one; override logged as "Override on order ORD-...: picked_up -> delivered. Reason: ...".

## Loose ends for the developer
- **Push and open the PR** yourselves (commands under "PR").
- **Restart your dev server** if it was running: the Prisma client was regenerated for the new schema.
- **Robin** must run the migrations on their own dev.db (steps below).
- Static copy with no data model: the homepage "Night Pickup Points" block (locations + "10:15 PM"). Ask the client
  whether it should come from data.
- `DeliveryTimeSlot` table and `/api/branch-manager/time-slots` are no longer used by any UI (kept to avoid data loss);
  remove in a later cleanup.
- "Hours not configured = no time limit" (Part 2 decision); one-line switch in `channelStatus` if the client prefers
  "closed until configured".
- The Cheez crust guide cards are fixed copy (sizes), shown only for brands with the switch on.
- Dead `"delayed"` entries remain in a few status lists (`lib/order-chat/policy.ts`, `lib/services/branch-live.ts`,
  `lib/services/page-summaries.ts`, `lib/services/rider-duty.ts`). Harmless (no order can hold it any more); left so
  this change stayed focused.
- Pre-existing, not touched: missing i18n keys `bmExtras.pickupAddress/pickupEnabled/pickupPhone/prepHint/prepLabel`,
  `branches.radiusN`, `deliveryZone.activate`, `payments.bank*`; spec 22's self-pollution described above.
- The `main` baseline worktree lived in a temp folder only for testing; `git worktree prune` clears the reference once
  that folder is gone (no branch was created or deleted for it).

## Steps for Robin (own machine, own dev.db)
Three migrations change data, so back up first. They only read what is in YOUR database (no assumptions about Ash's
data) and repair it before adding constraints; each was tested on Ash's data and on a deliberately dirty copy.

1. Stop your dev server (Windows: `prisma generate` fails while it holds the query engine).
2. Back up your database:
   `copy prisma\dev.db backups\dev.db.<date>.before-brands-hours-statuses.bak`
   (do not commit it; `backups/` is not gitignored).
3. Get the branch (after Ash pushes it / merges the PR):
   `git fetch origin` then `git checkout brands-hours-statuses` (or pull `main` once merged).
4. `npm install` (no new packages, but it runs `prisma generate` for the new schema).
5. Apply the migrations to your dev.db: `npx prisma migrate deploy`
   - 20261007120000_brands_as_data: Brand + BranchBrand tables, brand FKs, order-line brand snapshot, drops
     Branch.brandType. Any brand value it does not recognise becomes its own brand (nothing is dropped).
   - 20261007130000_brand_hours_schedule: converts your branches' opening/closing times into per-brand schedules that
     behave exactly like before (including the old 4-11 AM closure and Cheez late night), then drops the old columns.
   - 20261007140000_order_status_flow: moves "delayed" orders to "on_the_way", and any pickup order left in
     picked_up / on_the_way back to "ready" (pickup orders have no rider leg any more).
6. Optional: `npm run seed` only fills things that are missing (brands, demo schedules where unset); it does not
   overwrite your brands or hours.
7. Env: nothing new for the app. `E2E_SEED` is set automatically by `npm run test:e2e:prepare`; it is documented in
   `.env.example` but you do not need to set it.
8. Restart the dev server.
9. Check: /admin/brands (super admin) shows Cheez! Pizza and Madchef; /branch-manager/delivery-hours shows each brand's
   schedule; the homepage shows brand cards from data.
10. For e2e: `npm run build`, `npm run test:e2e:prepare`, then the specs. The test DB is migrated by prepare.

If a migration fails: stop, restore the backup (`copy backups\...bak prisma\dev.db`) and send Ash the error text.
