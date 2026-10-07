# Brands, hours & statuses: progress report

Branch: `brands-hours-statuses` (cut from `main` at `24886d1`, which was already up to date with `origin/main`).

## Resume instructions
If the session was interrupted, read "Status" and "Next" below and continue from there.
Every finished milestone is committed on the branch, so `git log main..HEAD` shows what is already done.
Scratch DB copies and edit scripts live outside the repo; nothing there is needed to resume.

## Status
- [x] Setup: stashed the untracked snapshot `tests/e2e/17-rider-dashboard.spec.ts-snapshots/rider-offline-dashboard-chromium-win32.png`
      as stash `pre-brands-hours-statuses: untracked rider-offline-dashboard snapshot (2026-10-07)`. Restore it with `git stash list` / `git stash pop`.
- [x] Backup of Ash's dev DB before any migration: `backups/dev.db.2026-10-07T11-48-23Z.pre-brands-hours-statuses.bak`
      (NOT committed; `backups/` is not gitignored, so never `git add` it).
- [x] Part 1: brands as data (code done, migration applied to Ash's dev.db; e2e verification running)
- [ ] Part 2: branch hours per brand and channel
- [ ] Part 3: order status flow
- [ ] Finishing: build, tests, role walkthrough, report

## Next
Commit Part 1 once spec 73 + the brand-related existing specs pass, then Part 2.

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
