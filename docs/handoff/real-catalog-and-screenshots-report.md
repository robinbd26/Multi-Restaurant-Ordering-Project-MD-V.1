# Real catalog seed + presentation screenshots — progress report

Branch: `real-catalog-seed` (from `main` at `ee05581`). Started 2026-10-12.

If this session is resumed, read the **Status** section first and continue from the first unchecked item.

## Status

- [x] Setup: tree clean, on main, pulled (already up to date), branch `real-catalog-seed` created.
- [x] Last-entry field: `Branch.dineInLastEntry` + migration `20261012100000` + editor + homepage display (commit `07d1d4b`).
- [x] Parts 1–5 built as `npm run seed:real` (menu `8c7cc1a`, seed `a34ea13`, fixes `fde7eec` and `2500c74`, zone spelling `409559b`, README `c3bc4c7`).
- [x] Ran `npm run seed:real` on the real dev.db at 17:45 Dhaka. (The 11:30 timer was killed by Claude Code for low memory; resumed on "continue" when it was already past 11:30.) Before: 38/38 brand × channel combinations open by the planned hours. After: 38/38 open on dev.db by the app's own `channelStatus`. Today: 5 finished orders between 12:08 and 14:59, open orders between 16:08 and 17:30.
- [x] Part 6: 85 screenshots + manifest (commits `15961c9`, `8577b3f`, `54d3859`).
- [x] Finishing: pushed `real-catalog-seed`; tagged main (`ee05581`) as `pre-real-catalog-seed` and pushed the tag; merged with `--no-ff` as **`b038e4b`** (no conflicts); `npx tsc --noEmit` and `npm run build` pass on main; main pushed.

## Decisions log

- The tree had one untracked file, `docs/handoff/platform-readiness-report.md` (a read-only inspection report from the previous session, no secrets). I committed it on this branch as its own commit (`0104432`) instead of deleting it.
- Pizzas: the prototype gives each pizza 8" (thick/thin, dine-in only), 12" thin, 14" thick, 16" thin, and its own search lists thin pizzas as separate "(Thin)" items. Our crust policy is per product, so each pizza becomes two products: "<Name>" (THICK: 8", 14") and "<Name> (Thin)" (THIN: 8", 12", 16"). The 8" size is kept as a DISABLED size because the prototype says dine-in only and the app takes no dine-in orders; an admin can enable it.
- Last-entry time is a new column (`Branch.dineInLastEntry`) rather than a key inside the dine-in JSON, as asked ("a migration that backfills existing rows"). Backfill value is "" (not shown), the only value that is safe on anyone's data.
- Seed scripts call the app's own services. Those start with `import "server-only"`; `scripts/seed-real/server-only-shim.cjs` resolves it to the same empty module Next uses, nothing else.
- Non-pizza items use crust policy THICK (the app default, same as `npm run seed`). The product form offers "Not applicable" (`""`), but the storefront's eligibility rule (`lib/services/product-eligibility.ts`, VALID_VARIATION_TYPE) hides any product with `""`, so a product saved that way is invisible to customers. **Not fixed (unrelated to this task); listed for the developer.**
- The extra contact number for Gulshan (01793-708359) is stored as the branch's pickup phone: the branch has no second-phone field. The Cheez Mirpur manager name (Mohammad Rashel Hosen) is recorded only here and in `prisma/seed-real/branches.ts`: branches have no notes field, and no login was created for him.
- Banasree (both) gave no phone or bKash: phone = company hotline 09638-050505 (from the prototype), bKash switched off.
- Combos (Classic ৳449, Premium ৳549) use the existing features: crust policy BOTH (thick or thin, customer must pick) and one 8-inch size per pizza choice. Pictures: the Chicken Alfredo and Smoked Cheddar Tikka photos.
- Burger sauce and wing flavour choices are written in the item description ("mention yours in the order note"): the app has single-choice sizes but no second option group.
- A demo campaign "৩০% ছাড় — MADCHEF30" (14 days ago → 60 days ahead) is linked to the coupon so the campaigns page is not empty. The coupon itself has no end date. Delete the campaign if unwanted.
- Kept accounts: the 8 demo logins and the owner super admin (`ADMIN_USERNAME`, default `admin`) — that one is the env-configured owner, not test content. Deleted: the e2e fixtures (`qa_upload_1`, `qa_upload_2`, `courier2`; `npm run seed` recreates them for the test DB) and hand-made test accounts (`ash.md`, `ash123`, `john.wick`, `siam.sabith`, `afiya.jannat`).
- System settings kept as they are; the one per-branch override (`platform_fee:branch:2`) pointed at a deleted branch and was removed.
- Zone spelling fixed in the shared zone list too (`lib/constants/area-master-seed.ts`), so `npm run seed` stops creating "Mohammodpur"/"Basundhara".

## Branches and pins

Every branch was searched on Barikoi (server side, `lib/services/geocoding.ts`, key from .env) by business name and by address. Web search (Google Maps listings are not reachable from here) found no branch listings for the uncertain ones, so those are pinned from the client's address via Barikoi and marked medium/low.

| # | Branch | Brands | Type | Coordinates | Google Maps | Source | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Uttara | Cheez + Madchef | Dining | 23.877259, 90.391019 | [map](https://www.google.com/maps?q=23.877259,90.391019) | Barikoi name ("Madchef, House 34, Gareeb E Newaz Avenue") = Barikoi address; "Cheez Uttara" 20 m away | high |
| 2 | Bailey Road | Cheez + Madchef | Dining | 23.741915, 90.408518 | [map](https://www.google.com/maps?q=23.741915,90.408518) | Barikoi name ("Madchef & Cheez (Bailey Road), House 4, New Bailey Road") = Barikoi address | high |
| 3 | Gulshan | Cheez + Madchef | Cloud kitchen | 23.778878, 90.412757 | [map](https://www.google.com/maps?q=23.778878,90.412757) | Barikoi address ("House 7, Road 13, Gulshan 1"); name search finds no Cheez/Madchef listing here, web search found none either | medium |
| 4 | Cheez Dhanmondi | Cheez | Dining | 23.744689, 90.372219 | [map](https://www.google.com/maps?q=23.744689,90.372219) | Barikoi name ("Cheez, Rangs KB Square, Road 9/A"); Barikoi address (House 49, Road 9/A) 20 m away | high |
| 5 | Madchef Dhanmondi | Madchef | Dining | 23.744869, 90.372083 | [map](https://www.google.com/maps?q=23.744869,90.372083) | Barikoi address ("House 49, Road 9/A, Sat Masjid Road"); no Madchef listing by name; same building as Cheez Dhanmondi | high |
| 6 | Cheez Banani | Cheez | Dining | 23.789982, 90.408999 | [map](https://www.google.com/maps?q=23.789982,90.408999) | Barikoi name ("Cheez Banani, Navana Rowshan Sayed Plaza, House 47, Road 11, Block H") = Barikoi address | high |
| 7 | Madchef Banani | Madchef | Dining | 23.790049, 90.409008 | [map](https://www.google.com/maps?q=23.790049,90.409008) | Barikoi address (Navana Rowshan Sayed Plaza, House 47, Road 11, Block H); no Madchef listing by name; same building as Cheez Banani | high |
| 8 | Cheez Bashundhara | Cheez | Dining | 23.808730, 90.430350 | [map](https://www.google.com/maps?q=23.808730,90.430350) | Barikoi name ("Cheez Bashundhara, Apollo Hospital Road"); Barikoi address (Bashundhara Block A gate) 240 m away | medium |
| 9 | Madchef Bashundhara | Madchef | Dining | 23.808745, 90.430375 | [map](https://www.google.com/maps?q=23.808745,90.430375) | Same building as Cheez Bashundhara (no Madchef listing by name; Jabbar Molla Tower not in Barikoi) | medium |
| 10 | Cheez Khilgaon | Cheez | Dining | 23.752227, 90.421569 | [map](https://www.google.com/maps?q=23.752227,90.421569) | Barikoi name ("Cheez, House 380, Shahid Baki Road, Taltola") = Barikoi address; Apon Coffee House (No. 381) 10 m away | high |
| 11 | Madchef Khilgaon | Madchef | Dining | 23.752192, 90.421643 | [map](https://www.google.com/maps?q=23.752192,90.421643) | Barikoi address (House 380, Shahid Baki Road); no Madchef listing by name; same building as Cheez Khilgaon | high |
| 12 | Cheez Mirpur | Cheez | Cloud kitchen | 23.810366, 90.362866 | [map](https://www.google.com/maps?q=23.810366,90.362866) | Barikoi address ("House 30, Avenue 5, Block B, Section 6"). Barikoi's "Cheez Mirpur" listing sits at House 2/A Road 4 (the Madchef Mirpur building), 500 m away; the client's sheet places this cloud kitchen at House 30, so the address wins | medium |
| 13 | Madchef Mirpur | Madchef | Dining | 23.809399, 90.367780 | [map](https://www.google.com/maps?q=23.809399,90.367780) | Barikoi address (House 2/A, Road 4, Block A, Section 6; a "Cheez" listing at the same house). Barikoi's "Madchef Mirpur" name hit is on Mirpur Main Road, Section 10, 550 m away and does not match the sheet | medium |
| 14 | Cheez Mohammadpur | Cheez | Cloud kitchen | 23.768010, 90.361640 | [map](https://www.google.com/maps?q=23.768010,90.361640) | Barikoi address: the point where Tikka Para Road meets Haji Chinu Mia Road. Alternative: Barikoi has "Cheez And Beanz, House 15/6, Tajmahal Road" (23.763434, 90.362184), 520 m south; check which one is right | low |
| 15 | Cheez Banasree | Cheez | Cloud kitchen | 23.765997, 90.426135 | [map](https://www.google.com/maps?q=23.765997,90.426135) | Barikoi address ("House 9, Banasree Main Road, Block A"); no Cheez/Madchef listing by name | medium |
| 16 | Madchef Banasree | Madchef | Cloud kitchen | 23.765997, 90.426135 | [map](https://www.google.com/maps?q=23.765997,90.426135) | Same building as Cheez Banasree (Barikoi address) | medium |

**Please check by eye:** Cheez Mohammadpur (low) and the two Mirpur branches (Barikoi's name listings disagree with the client's addresses).

**Identical-address pairs** (kept as separate branches with the address text as given; floors to be corrected in admin): Cheez/Madchef Dhanmondi, Cheez/Madchef Banani, Cheez/Madchef Bashundhara, Cheez/Madchef Khilgaon, Cheez/Madchef Banasree.

## Verification so far

- `npx tsc --noEmit`: passes. `npx eslint` on every touched file: passes. `npm run test:unit`: 83/83 pass (incl. the new last-entry test). `npm run check:i18n`: passes. `npm run build`: passes.
- Related e2e specs (`74-brand-hours`, `full-page-audit/branch-manager-delivery`, `62-delivery-zones`, `55-nearest-branch-homepage`): 20 pass, 26 fail. **The same 26 fail on `main`** (I built main and ran the same specs as a baseline: identical list). They are pre-existing: spec 62 tests the retired locality list, spec 55 and the delivery audit expect older behaviour. Not caused by this branch; not fixed here.
- seed:real ran 3 times on a scratch copy of dev.db: identical results, no leftover upload files (3648 = 1216 photos × 3 sizes).

## Summary

### Wiped and kept
- **Wiped** (dev.db, and on any machine that runs `npm run seed:real`): every branch, zone, delivery area and exclusion, category, product and variation, saved address, order (items, status events, assignments, receive confirmations, commissions, refunds), product and rider review, complaint and message, coupon, redemption, campaign and event, segment, notification and notice, order and duty chat, rider duty session/log/route trail/withdrawal, financial audit/adjustment/expense/settlement, staff and attendance record, branch employee and team, table and reservation, Ramadan setup and booking, push subscription, password-reset token, branch-scoped reward rule, the orphaned `platform_fee:branch:2` setting, and the uploaded photos of the removed rows. Accounts deleted: `qa_upload_1`, `qa_upload_2`, `courier2` (e2e fixtures) and the hand-made test accounts `ash.md`, `ash123`, `john.wick`, `siam.sabith`, `afiya.jannat`.
- **Kept**: `super_admin`, `management`, `marketing`, `branch_manager`, `accounts`, `rider`, `customer`, `blocked_customer` exactly as they were (password untouched), the owner `admin` (ADMIN_USERNAME), the brands Cheez! Pizza and Madchef, system settings (platform fee ৳9, rider commission, reward value) and reward rules.

### Hours
- Madchef 11:00 AM–10:30 PM, Cheez 11:00 AM–4:00 AM, delivery and pickup, every day. Uttara, Bailey Road and Gulshan carry both.
- Dining branches (9): dine-in 11:00 AM–11:00 PM with **last guest entry 10:30 PM**. Cloud kitchens (Gulshan, Cheez Mirpur, Cheez Mohammadpur, Cheez/Madchef Banasree): no dine-in.
- Last entry: a new optional `Branch.dineInLastEntry` ("HH:MM" or ""), migration `20261012100000` adds it with '' and backfills existing rows to '' (nothing changes until someone sets it). Edited under the dine-in hours in the hours editor (admin and branch manager); shown to customers on the homepage hours card as "11:00 AM – 11:00 PM · last entry 10:30 PM". Display only.

### MADCHEF30
Existing coupon system: percent 30, every branch (branchId null, so both brands), no start or end date, maxUses 0 (unlimited), perCustomerLimit null, created by `marketing`; editable or endable at /admin/coupons and /marketing/coupons. Used on 7 sample orders. The discount is computed when the order is confirmed (the checkout overview says so), and shows on the receipt and invoice. A demo campaign links to it.

### Not imported from the prototype
- Its design and behaviour (by instruction).
- Burger sauce choice and wing flavour choice as selectable options (the app has one size/option list per product): named in the description instead.
- Burger add-ons as toggles inside the burger popup: imported as separate "Burger Extras" products; the dips as "Sauces" products. Neither has a photo (the prototype has none).
- The pizza "Spicy" badge and meat-type tags (Beef/Chicken/Sea Food): no product field; the ingredient line ("Inside: …") is kept in the description.
- The 8" pizza size is imported but disabled (dine-in only in the prototype).
- The Madchef can photos are inline images in the prototype; the identical Cheez can photos are used.
- Nothing else was skipped: 24 pizzas (each as thick and thin), 8 pastas, 4 boats, 2 garlic breads, 3 soups, 4 Cheez drinks, 2 cans per brand, 10 burgers, 8 extras, 5 wraps, 4 poutines, 9 rice meals, 4 teasers, 4 fries, 2 crispy chicken, 5 mocktails, 6 shakes, 8 sauces, 3 desserts, plus the 2 combos you specified.

### README
The "Demo / seed accounts" table now has a Notes column for all 59 accounts (the original 8 + 15 managers + 30 riders + 6 customers), a warning above it that every demo password must be changed or the account removed before launch, and a section on `npm run seed:real`.

### Screenshots
`docs/presentation/screenshots/` (85 PNGs, 21 MB) with `manifest.md`. Captured from `npm run build` + `npm start` on dev.db at 17:50 Dhaka with every brand open. Re-capture with `node scripts/presentation/capture.mjs` against a running production server (the journey scene places one real order).

### For Robin (same data on his machine)
1. Stop your dev server (Windows: `prisma generate` fails while it runs).
2. `git checkout main && git pull`
3. `npm install` (runs `prisma generate`)
4. `npx prisma migrate deploy` (adds `Branch.dineInLastEntry`)
5. `npm run seed:real` (about 2–3 minutes; **wipes all test data** in your dev.db except the 8 demo logins and your `ADMIN_USERNAME` account)
6. Start the server again. Log in with any account from the README table (password `Admin12345@##`).
No new env vars. It needs Node 20.12+ (`process.loadEnvFile`). Barikoi is only used at runtime, not by the seed (the pins are in `prisma/seed-real/branches.ts`).

### Loose ends for the developer
- Check the pins of Cheez Mohammadpur (low confidence) and both Mirpur branches.
- Correct the floors of the five identical-address pairs in admin.
- The product form's "Not applicable" crust option makes a product invisible to customers (`VALID_VARIATION_TYPE` in `lib/services/product-eligibility.ts`). Unrelated, not fixed.
- 26 pre-existing e2e failures in specs 55, 62 and the branch-manager delivery audit (same on main).
- A stray copy of an early dry run is on the E: drive at `E:UsersashraAppDataLocalTempclaude…scratchpadshots` (a mis-resolved output path; I was not allowed to delete `E:Users`). Safe to delete.
- Delete or edit the demo MADCHEF30 campaign if not wanted; change or remove every demo account before launch.

### Merge
- Merge commit: **`b038e4b`** (`Merge branch 'real-catalog-seed'`), on top of `ee05581`.
- Before merging: type check, lint, unit tests (83/83), i18n check and the build passed on the branch. The related e2e spec `74-brand-hours` passes; the 26 failing e2e tests are the same on main before the merge (see Verification), so they did not block it.
- Roll back the code: `git revert -m 1 b038e4b`, or compare with the tag `pre-real-catalog-seed`. The migration only adds a column, so rolling back the code needs no database change; to undo the data, restore a dev.db backup (`seed:real` wipes test data by design).

## Duplicate menu fix (branch `fix-homepage-duplicate-menu`, tag `pre-fix-homepage-menu` = main before it)
- **Cause.** Every branch owns its own Product and Category rows (73 per Cheez branch, 70 per Madchef branch, 143 on the three legacy branches; 226 category rows, 23 distinct names). There are no duplicates inside any single branch, so the data is fine and `seed:real` was not re-run. The guest and no-location homepage (`publicMenu()` in `lib/services/public-catalog.ts`) listed all branches' copies together: 730 Cheez and 630 Madchef cards.
- **Fix.** `lib/home/showcase-dedupe.ts` dedupes by brand + category name + product name and shows each category tab once. The stand-in card is the lowest-numbered branch's real product, so the cart stays locked to a real branch (the existing `BranchSwitchDialog` reconciles it after sign-in). A chosen branch still gets its own menu from `branchMenu()`. Guests can now also pick a branch with the customer's "Browsing" picker (`components/home/GuestBranchBar.tsx`, same `mad_scope` cookie, view lens only); "Deliver to" needs saved addresses, so a login link stands in for it. Unit test: `tests/showcase-dedupe.test.mts`.
- **Result.** Guest homepage on dev.db: 73 Cheez cards and 70 Madchef cards (one brand tab at a time), each category once. Before: 730 and 630 for the same brands, plus the legacy branches' copies.
- **Junk like `GlobalPizza-1791…` / `NBProd-…`** is e2e test data in `prisma/test.db`, not in dev.db. It appears when the e2e server (which reads test.db) is the one on port 3000.
- **Clock "04:58 AM" and sales ৳0** were not bugs. The clock formats in Asia/Dhaka (and the capture already sets that timezone); the shots were taken at 04:58 Dhaka, before the day's orders were delivered. After recapture at 19:13 the dashboard shows the right time and ৳10,658. The customer shots log in with a location and already showed one branch, so they were not recaptured.
- **Other pre-existing e2e failures, same on the pre-fix tag:** specs 18 (4 screenshot-size tests), 53 (1), 56 (1) and 66 (3). They are not on the 26-failure list above.
- **Admin Products** already has a branch filter; no change.

## Product variants fix (branch `fix-product-variants-menu-ui`, tag `pre-product-variants-fix` = main before it)
- **Cause.** Crust was a product-level policy (THICK/THIN/BOTH) and sizes were variations, so a pizza whose 12"/16" are thin and 14" is thick could not be one product. The real-catalog seed worked around it by storing every pizza twice (see "Pizzas" in the Decisions log): "<Name>" (8", 14") and "<Name> (Thin)" (8", 12", 16"). That is 24 duplicates on each of the 10 Cheez-serving branches (240 rows); non-pizza items were never split. Ingredient chips were built by splitting the description on "+", so the whole About sentence became the first chip.
- **Model.** `ProductVariation.variantType` ("THICK"/"THIN") is now the crust of that size, and the order pipeline takes the line's crust from the size (a contradicting crust is refused). New columns, migration `20261021100000_product_variant_flags` (defaults only, plus marking sizes already labelled "Dine-in only"): `ProductVariation.dineInOnly` (listed, greyed out, never sold online), `Product.ingredients` (comma-separated chips), `Product.isSpicy`, `Product.isVegetarian`. A multi-size product ordered without a size is refused instead of being charged at its default; reorder now carries the original size and crust.
- **Data.** Each pizza is one product with the prototype's four sizes: 8 inch – Thick & Thin (dine-in only), 12 inch – Thin Crust (6 Slices), 14 inch – Thick Crust (8 Slices, default), 16 inch – Thin Crust (8 Slices). Spicy and Veg come from the prototype's `taste`/`types`. `seed:real` now seeds it this way (117 menu items per brand set instead of 141).
- **Counts on dev.db.** Products 1,360 → 1,120. Per branch: Uttara, Bailey Road, Gulshan 143 → 119; each Cheez branch 73 → 49; Madchef branches 70 (unchanged). No base name appears twice on any branch. 14 order lines and 5 reviews pointed at "(Thin)" rows; they were moved to the merged product and the matching size (order lines keep their name, size, price and quantity snapshots). The sum of all order-line totals was 119 lines / ৳69,157 before and after.
- **Robin's database.** After pulling: stop the dev server, `npm install`, `npx prisma migrate deploy`, then `npx tsx scripts/fix-product-variants.ts` (`--dry-run` to preview). It is idempotent and rolls back if any order-line total would change. No re-seed needed. No new env vars.
- **UI.** Product modal: brand/category eyebrow, name, "from ৳X" (lowest orderable size) changing to the picked size's price, badges, About, ingredient chips, then Sizes & Prices radio cards; dine-in sizes greyed out with a "Dine-in only" note; reviews and the quantity/Add to Cart footer unchanged. Cards: badges top-left (Spicy, Veg, Dine-in only, Popular), never the category; the card bottom is unchanged; Place Order opens the modal only when there is more than one orderable size. Order pages (customer, branch manager, admin, rider) now show each line's size. Category chips wrap instead of scrolling. Every clickable control shows the pointer cursor (one base-layer rule in `app/globals.css`), disabled ones not-allowed.
- **Cart storage** moved to `mad-delivery-cart-v3`, so carts stored before the merge (which can name a deleted "(Thin)" product) are dropped once.
- **Verified.** `npx tsc --noEmit`, `npx eslint` on every touched file, `npm run build`: pass. E2E (specs 04, 18, 19, 20, 26, 29, 54, 66): 61 passed, 31 failed on the branch; the same specs on `pre-product-variants-fix` gave 30 failed with the same test.db. The only branch-only names were 04 (customer's saved location is covered by no test branch, so `/api/products` is empty; it fails the same way on the tag with that data) and 29:443 (passed on rerun). Spec 19 still targets the old hardcoded menu (Margherita, burgers) that test.db never had. Browser (Chrome DevTools, dev.db): guest homepage 49 Cheez cards, no duplicates, chips on 2 rows at 1366px and 5 at 390px with no horizontal scroll; Green Chili Pesto modal matches the prototype's right column. Real orders: #54 Uttara (homepage, Margherita 12 inch – Thin Crust ৳699, total ৳768) and #55 Cheez Banani (browsed branch, pickup, Green Chili Pesto 16 inch – Thin Crust ৳899, total ৳908); the cart drawer, dashboard cart, checkout summary, order record, order page and accounts invoice all show that size and price. Madchef Dhanmondi: 70 cards, no duplicates, Chicken Wings opens the size choice, single-size items add directly.
- **Loose ends.** The product form cannot yet edit `dineInOnly`, ingredients or the Spicy/Veg flags (they are kept on save; set them in the seed/repair or the DB). The in-drawer success receipt shows totals and item count only, no line list (unchanged). Orders #54 and #55 on dev.db are test orders (pending). The "(Thin)" products' uploaded photos are left in `storage/uploads/products` (harmless; the merged product keeps its own photo).
