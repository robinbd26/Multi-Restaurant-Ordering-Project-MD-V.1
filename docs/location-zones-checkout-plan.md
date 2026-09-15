# Location, Delivery Zones, Checkout & Fees — Build Plan

This is a plan, not a spec — it describes decisions and constraints, not implementation. You know this codebase better than we do: if anything below conflicts with existing architecture, flag it and propose an alternative rather than forcing it in. Work through this phase by phase, in order. Before starting each phase, restate your plan for that phase. Before moving to the next, report status and anything you're unsure about.

## Build order

1. UI cleanup & dashboard consistency
2. Delivery zone system
3. Checkout integration
4. Free delivery + platform fee
5. Coupons

---

## Phase 1 — UI cleanup & dashboard consistency

- Split the current combined location dropdown into two separate controls:
  - **"Deliver to"**: current location, saved addresses, add/manage addresses. Determines checkout/delivery eligibility.
  - **"Browsing: [branch name]"**: replaces the standalone "View branches" button entirely — don't keep both. Lets the customer view any branch's menu regardless of delivery eligibility.
- Customer dashboard "Restaurants" page currently locks non-nearest branches as unclickable ("ordering is locked to the nearest eligible one"). This contradicts the homepage, which already allows browsing any branch. Reuse the homepage's browse-scope logic here instead of a second implementation — every branch card clickable, non-covering branches get a "Browsing only — self-pickup available" badge.
- Before touching anything else: investigate why saved addresses show "No map pin saved." Confirm whether any existing or planned feature depends on address coordinates. Report back before starting Phase 3.

---

## Phase 2 — Delivery zone system

Delivery zones are a **named-area coverage list per branch**, not GPS radius or distance-based. This matches how the business actually operates (see real data below) and avoids needing geocoded coordinates on every address.

### Structure

- **Master zone/area list** — the broad zone names (Banani, Gulshan, Dhanmondi, Mohammodpur, Bailey Road, Mirpur, Khilgaon, Uttara, Basundhara, etc.) plus the specific localities within each. Managed by **super admin** only — no branch-level additions to this master list.
- **Per-branch coverage** — each branch manager selects which specific localities (from the master list) their branch delivers to. Two separate coverage lists per branch:
  - **Day window**: 11:00 AM – 10:45 PM (confirmed — this sheet has the time header)
  - **Night window**: ~10:45 PM – 4:00 AM (start time assumed to follow immediately after the day window closes — confirm this gap-free handoff with AshMd). Last order accepted at 3:45 AM (15 min before window close); delivery must complete by 4:00 AM.
- Coverage check = is (customer's selected locality) in (branch's coverage list for the currently active time window, based on server time)?

### Saved address structure

- **Primary zone** — picked from the master list only, no free text.
- **Specific locality/area** — free text allowed ("+ Add your own"), but anything custom-typed here defaults to **not covered** by any branch until a branch manager formally adds it to their coverage list. This prevents customers accidentally bypassing the coverage system.

### Real zone data (source of truth — from AshMd's operational sheets)

**Day coverage** (11 AM – 10:45 PM)

| Banani | Dhanmondi | Mohammodpur | Gulshan | Bailey Road | Mirpur | Khilgaon | Uttara | Basundhara |
|---|---|---|---|---|---|---|---|---|
| All Over Banani | All over Dhanmondi | Adabor full | Badda All | Dilu Road | Mirpur-1 | Bangla Motor | Sector-1 | All Bashundhara |
| Army stadium | BGB Gate no-4 | Asad Avenue | Begun bari | Chamelibagh | Mirpur-2 | Bonosre (Block F-H) ALL | Sector-2 | Nikonjo 1+2 |
| Baridhara dip areas | Central road | Asha University | Bonosre (A-E) | Eskaton Garden | Mirpur-6 | Khilgaon | Sector-3 | |
| Baridhara DOHS | City College | Aongzeb road | Gulshan-1 | Eskaton Road | Mirpur-7 | Modhubag | Sector-4 | |
| Baridhara J Block | Elephant Road | Aziz Moholla Road | Hatirjheel Mohanagar Project | kakrail | Mirpur-10 | Malibagh | Sector-5 | |
| Dhaka Cantonment | Green Road | Azam Road | Impulse Hospital | Mintu Road | Mirpur-11 | Mirbag | Sector-6 | |
| Falcon Tower | Jafrabad-Shankar Road | Babor Road | Link Road | New Bailey Road | Mirpur-11 (1/2) | Moghbazar Wireless | Sector-7 | |
| Gulshan-2 | Kalabagan | Bash Bari | Nabisco | rajabar | Mirpur-12 | Mohanagar Project | Sector-8 | |
| Jahangir Gate | Lalmatia | Biji Mohalla | Niketon | Ramna | Mirpur-13 | Mouchak | Sector-9 | |
| Mohakhali DOHS | Modhu Bazar | Chanmia Housing | Novonil | Shegunbagicha | Mirpur-14 | Shantibaag | Sector-10 | |
| Mohakhali Jhol Khabar | North Road | Gajnabi Road | polic plaza | Siddeshwari | Mirpur-15 | Taltola | Sector-11 | |
| Mohakhali Rail Gate | North Circural road | Humayun Road | Shahjadpur | SSL Wireless | Mirpur DOHS | T.V. Link Road | Sector-12 | |
| Mohakhali TV Gate (Main Road) | Panthapath | Iqbal Road | Shanta Tower | | Bijoy Rken City | Rampura | Sector-13 | |
| Mohakhali wireless gate | Rayer bazar | Japan Garden City | Suvastu Tower | | Ebrahimpur | Aftab Nagar | Sector-14 | |
| Namara restaurant | Shukrabad | Johari Mohalla | Tejgaon | | Kazipara | Basabo- | | |
| Navy HQ | Sikder Medical College | Katasur | Tejkunipara | | Shewrapara | | | |
| Rawya Club | Sobhanbag Officer's Quarter | Kazi Nazrul Islam Road | Uttar Badda | | Kafrul | | | |
| shadhinata tower | Zigatala High School | Krishi Market | West Nakhalpara | | Arambaag | | | |
| SKS Tower | Zigatala Post Office | Mohammodpur Bus Stand | | | CRP Hospital | | | |
| Zia Colony (Main Road) | | mohammadiya housing limited | | | Commerce College | | | |
| | | Mohammadia Housing Society | | | Kachukhet | | | |
| | | Monsurabad Housing | | | Zoo Road | | | |
| | | Nobodoy Housing Society | | | Milk Vita Road | | | |
| | | Nurjahan Road | | | Rupnagar R/A | | | |
| | | Ring Road | | | Ex. Pallabi | | | |
| | | Sahjahan Road | | | | | | |
| | | Probal Housing | | | | | | |
| | | Razia Sultana Road | | | | | | |
| | | Shamoly Square | | | | | | |
| | | Shekhertek (pc Culture) | | | | | | |

**Night coverage** (confirmed: this is the sheet without the time header, and has fewer areas than the day sheet because fewer branches operate overnight. Each night-shift branch's coverage is the combined zone shown below — e.g. the branch covering Banani by day also covers Gulshan by night. Last order 3:45 AM, delivery completes by 4:00 AM — see window definition above.)

> Still open: exact night-window start time is assumed to be 10:45 PM (immediately after day closes, no gap). Confirm with AshMd if there's a gap between shifts.

| Banani + Gulshan | Dhanmondi + Mohammodpur | Khilgaon + Bailey Road | Mirpur + Uttara |
|---|---|---|---|
| All Over Banani | All over Dhanmondi | Bangla Motor | Mirpur-1 |
| Army stadium | BGB Gate no-4 | Bonosre (Block F-H) | Mirpur-2 |
| Baridhara dip areas | Central road | Khilgaon | Mirpur-6 |
| Baridhara DOHS | City College | Modhubag | Mirpur-7 |
| Baridhara J Block | Elephant Road | Malibagh | Mirpur-10 |
| Dhaka Cantonment | Green Road | Mogbazar | Mirpur-11 |
| Falcon Tower | Jafrabad-Shankar Road | Moghbazar Wireless | Mirpur-11 (1/2) |
| Gulshan-2 | Kalabagan | Mohanagar Project | Mirpur-12 |
| Jahangir Gate | Lalmatia | Mouchak | Mirpur-13 |
| Mohakhali DOHS | Modhu Bazar | Shantibaag | Mirpur-14 |
| Mohakhali Jhol Khabar | North Road | Taltola | Mirpur-15 |
| Mohakhali Rail Gate | North Circural road | T.V. Link Road | Mirpur DOHS |
| Mohakhali TV Gate (Main Road) | Panthapath | No Order in South Banasree | Bijoy Rken City |
| Mohakhali wireless gate | Rayer bazar | Bangla Motor (dup.) | Ebrahimpur |
| Gudara ghat (main road) | Shukrabad | Mohammodpur | Kazipara |
| Gulshan-1 | Sikder Medical College | Mohanagar Project (dup.) | Shewrapara |
| Middle Badda | Sobhanbag Officer's Quarter | Kazi Nazrul Islam Road | Kafrul |
| Niketon | Zigatala High School | Krishi Market | Arambaag |
| Police plaza | Zigatala Post Office | Mohammodpur Bus Stand | CRP Hospital |
| Elephant Road | Japan Garden City | mohammadiya housing limited | Commerce College |
| Green Road | Johari Mohalla | Mohammadia Housing Society | Kachukhet |
| Suvastu tower (main road) | Katasur | Monsurabad Housing | Zoo Road |
| Tejgaon brac bank | Kazi Nazrul Islam Road (dup.) | Nobodoy Housing Society | Milk Vita Road |
| Tejgaon mohila college | Krishi Market (dup.) | Nurjahan Road | Rupnagar R/A |
| Tejgaon shanta tower | | Rajarbagh Police Lines | Ex. Pallabi |
| Uttar badda main road | | South Banasree | Sector-1 |
| Shazadpur | | Rampura | Sector-2 |
| | | Aftab Nagar | Sector-3 |
| | | Basabo- | ... Sector-4 through Sector-14 |

*(Note: some entries above appear duplicated between column groups in the source sheet — flagged with "(dup.)" — confirm with AshMd whether these are intentional overlaps or transcription artifacts in the original sheet.)*

---

## Phase 3 — Checkout integration

- **Select Delivery Address screen**: keep all saved addresses selectable at all times. Do not disable or grey out uncovered ones.
- When an address is selected, live-check coverage against the cart's locked branch + current time window (day/night). This must be computed live on render, not cached on the address — the same address can be covered by Branch A but not Branch B, or covered by day but not night.
- If not covered: show the same "outside delivery area — pickup only" pattern already used elsewhere in the app (don't build a second pattern for the same concept). Block delivery checkout, offer pickup as the fallback.
- **Address form changes**:
  - Nickname field (currently free text "e.g. Home, Office, Mom's House") → dropdown: Home / Office / Custom (custom reveals a text input). Localize Home/Office to Bangla to match the existing অফিস/বাসা pattern already in use.
  - Primary zone dropdown (currently pre-selects "Banani") → default to a placeholder "Select Your Area," nothing pre-selected. Remove "+ Add your own" from this dropdown — master-list only, no free text (this is the zone that controls coverage matching).
  - Secondary "Select Area" dropdown → keep "+ Add your own" as-is. Anything custom-typed here defaults to not-covered per the Phase 2 rule above.
- **Cross-branch delivery rule**: if the browsed/cart-locked branch doesn't cover the selected delivery address, delivery is not offered as a fulfillment option — pickup only, same banner as elsewhere. No mixed-branch delivery. No in-app negotiation/confirmation flow for borderline addresses — that stays a manual phone call outside the app for now.

---

## Phase 4 — Free delivery + platform fee

- Delivery fee: default to ৳0 per branch. Do not remove the underlying fee logic — branch manager can re-enable a real fee later.
- Platform fee: global default ৳5, set by super admin. Optional per-branch override (no separate "zone" concept for this — branches already exist as the natural unit). Applies to both delivery and pickup orders.

---

## Phase 5 — Coupons

- One coupon system, not separate platform/branch systems. Coupon has an optional `branch_id`:
  - `null` = platform-wide, super admin only.
  - set = branch-scoped, creatable by that branch's manager or by super admin.
- Usage limit: default **1 redemption per customer** (editable per coupon), plus an optional total-redemption cap across all customers (e.g. "first 100 uses").
- Expiry: both a scheduled end date/time AND a manual "end now" toggle — give both options, not one or the other.
- Discount type: percentage or fixed amount, plus optional minimum order value.

---

## General notes for Claude Code

- Check in with a status report before starting each phase and after finishing each phase — don't chain all five silently in one run.
- If a decision above conflicts with something already built (naming, existing fields, existing patterns), say so and propose the fix rather than guessing.
- Manually click through any new/changed UI in a real browser session (desktop and mobile width) before calling a phase done — don't rely on automated tests alone for UI changes.
- Once all five phases are complete, write a full documentation file in Bangla covering: what was built, what functionality changed, what visual/UI changes were made, and how everything works now (delivery zones, checkout flow, fees, coupons — all of it). Save it in the project (e.g. `docs/`) as a permanent record — this is for both future reference and for explaining the work to the project owner, so it should be complete enough to stand on its own without the original chat history.
