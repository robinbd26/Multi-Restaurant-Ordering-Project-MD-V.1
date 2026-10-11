# Real catalog seed + presentation screenshots — progress report

Branch: `real-catalog-seed` (from `main` at `ee05581`). Started 2026-10-12.

If this session is resumed, read the **Status** section first and continue from the first unchecked item.

## Status

- [x] Setup: tree clean, on main, pulled (already up to date), branch `real-catalog-seed` created.
- [x] Last-entry field: `Branch.dineInLastEntry` + migration `20261012100000` + editor + homepage display (commit `07d1d4b`).
- [x] Parts 1–5 built as `npm run seed:real` (commits `8c7cc1a` menu content, `a34ea13` seed, `409559b` zone spelling, `c3bc4c7` README). Verified twice on a scratch copy of dev.db (`prisma/scratch-seed.db`, gitignored).
- [ ] Run `npm run seed:real` on the real dev.db at **11:30 Dhaka (05:30 UTC)**, per the developer's instruction (replaces the earlier 14:00 plan; that timer was cancelled). Before starting: `scripts/_opencheck.tmp.ts --planned` must show all 38 brand×channel combinations open (else wait until they open); after seeding, the same check against dev.db with the app's own `channelStatus`. Seed timestamps follow the real hours (commit `2500c74`): open orders after 11:00, today's finished orders in Cheez's overnight window (until 04:00), so today's sales are not ৳0.
- [x] Part 6 tooling: `scripts/presentation/capture.mjs` (commit `15961c9`), dry-run end to end on the scratch DB (63 shots incl. the full journey).
- [ ] Part 6: the real capture on dev.db right after the 11:30 re-seed + manifest, commit.
- [ ] Finishing: checks, push, tag, merge, push main

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
