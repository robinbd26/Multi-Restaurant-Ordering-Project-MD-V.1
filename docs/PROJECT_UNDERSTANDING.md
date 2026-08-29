# MAD DELIVERY HQ — Project Understanding

> A senior engineer's briefing on what this system actually is, written after a nine-auditor
> static read of the codebase against `docs/REQUIREMENTS_ROLES.md` (153 lines, 7 role sections).
> Every claim below traces to a file that was opened. Companion document:
> `docs/WORK_ASSIGNMENT.md` (the execution plan).

---

## 1. What the product is

**MAD DELIVERY HQ** is a multi-branch, multi-brand food-delivery and restaurant-operations
platform for Bangladesh. Two brands (`cheez`, `madchef` — `Product.brand`, `prisma/schema.prisma:906`)
operate out of shared branch records; each branch owns its own catalogue, its own delivery
circles, its own riders, its own dining tables, and its own Ramadan iftar programme. Bangla is
the default locale, Taka the only currency, cash-on-delivery and a manual bKash flow the only
payment rails. Seven roles are defined in the requirements and all seven exist as real
dashboards under `app/(dashboard)/` with server-side role gates (`lib/constants/index.ts`
`ROUTE_ROLES` / `ROLE_NAV`, `requireRole` on pages, `requireApiRole` on routes).

**Super Admin** is the platform owner. It approves or rejects every staff account
(`lib/services/users.ts` → `app/api/auth/users/[id]/approve/route.ts`), blocks fraudulent
customers with a mandatory reason (enforced at order creation, `lib/services/orders.ts:313`),
puts a whole branch on hold (`app/api/branches/[id]/deactivate/route.ts`, honoured by
`lib/services/product-eligibility.ts:31`), owns the product-category taxonomy, sets the rider
per-delivery commission with a money-audit row (`app/api/admin/settings/delivery-fees/route.ts`),
configures the reward-coin value and earning rules (`lib/services/reward-rules.ts` — integer
poisha maths, frozen ledger, archive-not-delete), and sees every complaint from every role
(`lib/services/complaints.ts:32` returns an empty where-clause for this role). Its weak points
are HR visibility and true "all sections" attendance.

**Branch Manager** runs one outlet. Incoming orders arrive on a polled live board with a
WebAudio alert; the manager moves the order through the kitchen states, assigns a rider with
real eligibility checks (approved, online, holding an ACTIVE duty session for *this* branch —
`lib/services/orders.ts:612-689`), adds products under Super Admin categories, activates or
deactivates a product with a compulsory reason, draws the branch's delivery zones
(`components/branch/delivery-settings-panel.tsx`), fields table reservations with a real chat
thread and a `tel:` dial link, and runs the Ramadan booking programme. The cancel button on the
order screen is broken (see risk #3).

**Rider** is the most complete secondary role. Login, branch-scoped duty sessions, a blocking
polled assignment-offer popup with accept/reject-with-reason (`lib/services/rider-assignment.ts`),
GPS ingestion hardened against spoofing and stale fixes (`app/api/riders/location/route.ts`),
a route-point trail with Haversine distance, an idempotent per-order commission ledger
(`RiderCommission.orderId` unique + P2002 handling, `lib/services/wallet.ts:46`), a withdrawal
lifecycle with held/paid balance maths, attendance, login history and a complaint inbox all
exist and work. What does not exist: the `delayed` status, rider-side cancellation, any
"I need more time" signal to the customer, and real push when the phone screen is off.

**Customer** browses a branch-scoped menu, has the serving branch resolved server-side from the
cart plus coordinates, gets a distinct "out of zone" vs "covered but closed" verdict, checks out
with a server-priced immutable order snapshot, tracks the order (statically), watches an assigned
rider on an embedded map, keeps a Home/Office/Second-Home address book, reviews rider and food
after delivery, files complaints to four staff roles, and reorders in one click. It cannot log in
with a phone or email, cannot pick its location on a map, and cannot actually spend reward coins.

**Accounts** owns rider money end to end (commission, wallet, withdrawal approve/reject/pay,
`lib/services/wallet.ts`) and can record refunds, expenses, manual adjustments and end-of-day
branch settlements, each with a `FinancialAuditLog` row (`lib/services/financials.ts`). It is
blind on the reporting side: refunds and adjustments never reach any total, delivery-charge
revenue is never aggregated anywhere, tax/service charge do not exist in the schema, and the
role can verify a bKash payment in code but has no screen that lets it.

**Marketing** logs in with its own seeded credentials, creates and edits coupons that genuinely
validate and discount at checkout (`lib/services/marketing.ts:110` called from
`lib/services/orders.ts:452`), builds customer segments, and sends real targeted notifications
that honour each user's opt-out. Campaigns themselves are inert rows nothing reads; there is no
open/click/conversion tracking of any kind.

**Management** is the read-only executive layer: an aggregate KPI dashboard, eleven report types
built from one well-factored service (`lib/services/management.ts:33 buildReport`), a retention
and repeat-order analytics page, a branch directory, and a CSV export route. Everything is a
single hardcoded window (last 30 days or all-time) with no period selector, no branch filter and
no PDF/Excel.

---

## 2. Architecture at a glance

**Topology — Next.js only, no separate backend.** Next.js 16 App Router with Server Components
as the default rendering mode, 160 Route Handlers under `app/api/`, 156 dashboard pages under
`app/(dashboard)/`, and Server Actions in `lib/api/actions.ts` for form mutations. There is no
Express/Nest tier, no queue, no cron, and no worker process — the only runtime is one Node
process behind Nginx, defined in `ecosystem.config.cjs` (PM2, fork mode, bound to
`127.0.0.1:3200`). Real-time is **polling only**: `lib/hooks/use-live-data.ts` (pauses on tab
hide), plus a handful of raw `setInterval` callers. No SSE, no WebSocket, no service worker.

**Business logic lives in `lib/services/*.ts`** — 34 modules. This is the strongest structural
decision in the repo: route handlers parse and authorize, services own the rules, and both the
HTML page and the API read the same function, so page and export cannot diverge. Authorization
is expressed as reusable *where-clause builders* (`lib/selectors/index.ts` `ordersWhereForUser`,
`lib/services/complaints.ts` `complaintsWhereForUser`, `lib/services/employees.ts`
`employeeScope`) that are applied inside the Prisma query rather than post-filtering — so the
common IDOR class is structurally absent on the paths that use them.

**Data model:** `prisma/schema.prisma`, 1440 lines, **61 models**, SQLite in dev with a
PostgreSQL-shaped schema (no enums — every status is a plain string validated in
`lib/constants/enums.ts`). 55 `Decimal` money columns, only 2 `Float` (both on
`RewardEarningRule`). Immutable snapshotting is used deliberately: `OrderItem.unitPrice`,
`Order.deliveryCharge`, `Order.deliveryAreaName`, `RamadanReservationPayment` and the bKash
destination number are all frozen at write time so later edits cannot rewrite history.

**Auth:** Auth.js / NextAuth v5 beta, single Credentials provider, JWT session (`auth.ts`,
`auth.config.ts`). `authorize()` looks the user up by **username only**, checks
`isActive` + `status === "approved"`, bcrypt-compares, and writes a `LoginHistory` row. Role and
status ride in the JWT and drive `ROUTE_ROLES` in middleware plus `requireRole`/`requireApiRole`
in every page and handler.

**i18n:** a custom dictionary layer, `messages/bn.json` and `messages/en.json`, 3063 flattened
keys each with **zero one-sided keys**. Bangla is `DEFAULT_LOCALE`. Money and dates format
through `lib/i18n/format.ts`, which pins `APP_TIME_ZONE = "Asia/Dhaka"` for *display*.

**Tests:** 72 Playwright specs in `tests/e2e/`. Several drive features purely through
`request.post`, which is why UI-absent-but-API-present gaps (manual bKash, order cancel) shipped
green.

### Order lifecycle across roles

```
CUSTOMER                BRANCH MANAGER              RIDER                    ACCOUNTS
   |                          |                       |                         |
 browse menu                  |                       |                         |
 (branch-scoped)              |                       |                         |
   |                          |                       |                         |
 checkout ──► POST /api/orders                        |                         |
   |          lib/services/orders.ts#createOrder      |                         |
   |          • resolveDeliveryBranch (cart + coords, |                         |
   |            client branch_id IGNORED)             |                         |
   |          • coverageFor() zone check              |                         |
   |          • isBranchOpenNow() hours check         |                         |
   |          • server-side pricing + coupon          |                         |
   |          • idempotency key                       |                         |
   |                          |                       |                         |
 status: pending ────────► live board (poll + beep)   |                         |
   |                      accept ──► confirmed        |                         |
   |                      ──► preparing               |                         |
   |                      ──► ready                   |                         |
   |                          |                       |                         |
   |                      assign rider ──────────► assignment offer (5s poll,
   |                      orders.ts:612-689           blocking modal, accept/
   |                      • approved + online         reject-with-reason)
   |                      • ACTIVE duty session       |
   |                        for THIS branch           |
   |                      • haversine distance        |
   |                      • supersede prior offers    |
   |                          |                       |
   |                          |                   confirm receive ──► picked_up
   |                          |                   (opens delivery chat thread)
   |                          |                       |
 track (STATIC render) ◄──────┼──────────────────► on_the_way
 LiveMap (15s iframe reload)  |                       |
   |                          |                   delivered
   |                          |                       |
   |                          |                       └──► recordRiderCommission()
   |                          |                            wallet.ts:46 — idempotent
   |                          |                            on RiderCommission.orderId
   |                          |                                              |
 rate rider + food            |                       withdrawal request ──► approve/reject/pay
 (gated on delivered)         |                                              wallet.ts:90-237
   |                          |                                              FinancialAuditLog
   |                     end-of-day  ─────────────────────────────────────►  generateSettlement()
   |                                                                         financials.ts:142
   |                                                                         net = sales − commission
   |                                                                             − expenses
   |                                                                         (refunds & adjustments
   |                                                                          NOT subtracted — bug)
```

Every status change writes an append-only `OrderStatusEvent` row inside the same transaction as
the update, validated twice: lifecycle legality (`ALLOWED_TRANSITIONS` → 409) and role authority
(`*_SETTABLE` → 403), in `lib/services/orders.ts:498-556`.

---

## 3. The customer location flow, start to finish

This is the flow the client cares about most, so here is exactly what happens today.

**Step 1 — where the coordinate comes from.** Two sources, and only two. Either the browser
grants `navigator.geolocation` (pushed to `POST /api/customer/location`), or **the customer types
raw decimal latitude and longitude into two text boxes.** In
`components/orders/checkout-form.tsx:314-320` those inputs carry the placeholders `23.79` and
`90.41`; the same pattern repeats in `components/customer/address-manager.tsx:246-251` and in
the branch manager's `components/branch/delivery-settings-panel.tsx:238-242`. There is **no map
picker anywhere in the product.** No map SDK is installed — `package.json` has 8 runtime
dependencies (`@prisma/client`, `bcryptjs`, `next`, `next-auth`, `react`, `react-dom`, `sharp`,
`zod`) and none of them is `@googlemaps/js-api-loader`, `mapbox-gl`, `leaflet` or `maplibre`.
Every "map" in the repo is either a Google Maps **Embed** iframe (a static, unscriptable image —
`components/customer/branch-location-panel.tsx:88`, `components/rider/live-map.tsx:47`) or a
hand-drawn CSS/SVG placeholder with a faux street grid (`components/rider/route-panel.tsx`,
`components/rider/rider-delivery-map.tsx`). There is **no geocoding anywhere**, so a typed
address never becomes a coordinate: a customer who types "House 12, Road 3, Dhanmondi" gets no
coverage result at all.

**Step 2 — which point the server trusts.** `lib/services/customer-location.ts` maintains two
deliberate trust windows: a fix must be under 5 minutes old to be *accepted* as a write, and
under 24 hours old to be *trusted* for branch resolution, falling through to the default saved
address otherwise (lines 47-117). This part is thoughtfully built and documented in code.

**Step 3 — nearest-branch resolution.** `lib/services/orders.ts:69-111 resolveDeliveryBranch`
takes the cart's product ids, derives the single branch that owns them (the catalogue is
branch-scoped), filters to branches that are active, not archived, cover the point
(`coverageFor`), and are open right now (`isBranchOpenNow`), then picks the nearest by Haversine
with a stable id tiebreak. **The client's `branch_id` is explicitly ignored.** Genuine Haversine
maths with range guards lives in `lib/services/geo.ts:13-50`, including a `coordinateOrNaN`
helper that stops `Number(null) === 0` being accepted as the equator. "Covered but all closed" is
returned as a distinct error from "no branch covers you".

**Step 4 — zone enforcement and the delivery fee.** Coverage is **circle-only**: the branch's own
radius plus `BranchDeliveryZone` circles (`lib/services/delivery.ts:23-51`). Separately,
`BranchDeliveryArea` carries the money — `resolveOrderDeliveryArea`
(`lib/services/delivery-areas.ts:347-356`) snapshots that area's `deliveryCharge` onto the order.

### Where it is weak

1. **The coordinate is attacker-controlled.** `createOrder`/`quoteOrder` read `lat`/`lng` straight
   from the POST body (`app/api/orders/route.ts:47-48` → `lib/services/orders.ts:155-176`) and
   enforce coverage against *those* numbers. They are never reconciled against the customer's
   stored trusted point or against the free-text `delivery_address` printed on the order. The code
   comment at `lib/services/orders.ts:167-178` records that this reconciliation was implemented and
   then deliberately removed. A customer can POST a coordinate inside a branch circle while typing
   a delivery address 40 km away, and the order is accepted with the fee for the fake point.
2. **The area that sets the price is never geo-validated.** `BranchDeliveryArea.centerLat/centerLng`
   is declared, parsed, validated and serialized (`prisma/schema.prisma:600-601`) but **read by no
   coverage or distance code anywhere**. `resolveOrderDeliveryArea` checks only that the area
   belongs to the branch, is active and is not held — so a customer inside the branch circle can
   pick whichever active area has the lowest `deliveryCharge`. The two models genuinely overlap and
   neither is documented as authoritative.
3. **Saved addresses do not drive checkout.** `app/(dashboard)/customer/checkout/page.tsx:23`
   passes `defaultAddress={user.address}` — the User profile string, not any `CustomerAddress`
   row — into a plain textarea. A customer with Home and Office saved cannot pick Office; they
   retype the address and re-enter coordinates.
4. **"Out of zone" never shows the pickup point** the requirement demands.
   `nearestPickupBranch` is implemented (`lib/services/delivery.ts:95-109`) but surfaced only
   inside the checkout coverage panel — after the customer has already built a cart. The
   customer-facing banners (`components/customer/branches-location-gate.tsx:121-150`,
   `components/home/BranchBar.tsx:142-164`) offer only "retry / update address", and
   `messages/en.json:3373-3385` has no pickup key at all. `components/home/OperatingHours.tsx:112-118`
   hardcodes five pickup point names as strings instead of reading `Branch.pickupAddress`.
5. **The branch manager cannot see a rider pin at all.** The API returns it
   (`app/api/riders/branch/route.ts:37-38`) and authorizes it, but
   `app/(dashboard)/branch-manager/riders/page.tsx` renders a four-column table with no map, and
   `LiveMap` is imported in exactly one place in the whole repo — the *customer* order page.
6. **Resolution is an N+1 on every page view.** `nearestEligibleBranch`
   (`lib/services/customer-location.ts:215-243`) loads every active branch, then issues a separate
   `branchDeliveryZone.findMany` **inside the loop**; the same shape recurs in
   `lib/services/orders.ts:99`. It runs on every homepage render (`app/page.tsx:95`) and every
   order placement. Tolerable at tens of branches; it will not survive expansion.
7. **Live tracking is expensive.** `components/rider/live-map.tsx:37` uses a raw
   `setInterval(load, 15_000)` — not the project's own `useLiveData` hook — so it never pauses on
   tab hide, and every position change swaps the Embed iframe `src`, reloading the entire Google
   Maps payload. Up to ~120 full map reloads over a 30-minute delivery on a prepaid data plan.

---

## 4. Requirements coverage scoreboard

Counts are the auditors' verbatim scores against `docs/REQUIREMENTS_ROLES.md`.

| Area | Requirements Done | Assessment |
|---|---|---|
| Super Admin (§1) | **8/16** | The most complete role. Approvals, blocking, branch holds, categories, complaints, notices and the reward-rules engine are real and audited. Hollow at: all-sections attendance, HR/staff data UI, real push, cross-branch product hold by name-string. |
| Branch Manager (§2) | **10/16** | Order intake, rider assignment, catalogue control, zones, reservations and Ramadan are genuinely built. One blocker: the Cancel button cannot succeed. Rider live pin and delivery time slots are inert. |
| Rider (§3) | **20/29** | Highest coverage of any role — assignment workflow, GPS, commission, withdrawals, attendance all real. Missing `delayed` status entirely, no rider cancel, no extra-time signal, two disconnected duty systems. |
| Customer (§4) | **10/17** | Whole order lifecycle is real and server-enforced. Broken at three points: no email/phone/OTP login, redeemed coins vanish with nothing returned, location is typed decimals not a map. |
| Accounts (§5) | **7/21** | Rider money is excellent; reporting and reconciliation are hollow. Refunds and adjustments reach no total, delivery-charge revenue is never aggregated, tax/service charge do not exist, invoices do not add up. |
| Marketing (§6) | **2/6** | Coupons work end to end and consent-aware sends are real. Campaigns are inert rows, segmentation is broken for non-ordering customers, and opens/clicks/conversions do not exist. |
| Management (§7) | **7/20** | Real skeleton, no depth. Every report is one hardcoded window with no period or branch filter, export is CSV-only, and five named report subjects have schema data but zero code. |
| Bangladesh Market Readiness | **4/17** | Localization is outstanding; everything financial is hollow. No payment gateway of any kind, self-serve fake Ramadan payments, username-only login, business day computed in server-local time. |
| Location, Mapping & Delivery Zones | **4/12** | Server-side geo core is good and genuinely non-client-trusting on branch choice — but there is no map picker, no geocoding, and the coordinate itself is attacker-supplied. |
| **Total** | **72 / 154** | |

---

## 5. What is genuinely strong

- **Service-layer authorization as where-clauses.** `ordersWhereForUser`, `complaintsWhereForUser`,
  `productsForUser`, `employeeScope` are applied *inside* the Prisma query
  (`lib/selectors/index.ts:308-328`, `lib/services/complaints.ts:31-60`). Rider order access is
  IDOR-safe on both list and detail paths.
- **Idempotency where money moves.** `RiderCommission.orderId` is uniquely constrained and P2002 is
  treated as already-recorded (`lib/services/wallet.ts:46-78`), so a replayed `delivered`
  transition can never double-pay. Order creation carries an idempotency key.
- **Conservative wallet maths.** `availableBalance = earnings − (pending + approved) − paid`
  (`lib/services/wallet.ts:90`), so approving a withdrawal immediately holds the money and it can
  never be spent twice. Every decision writes a `FinancialAuditLog` row with actor and detail.
- **Defensive rider assignment.** Approved-rider check, offline rejection, an ACTIVE duty session
  for *this* branch, server-computed distance, supersede of prior pending offers, and closure of
  the previous rider's chat — all in one transaction (`lib/services/orders.ts:612-689`).
- **Hardened GPS ingestion.** Rider id from the session never the body, active duty session
  required, lat/lng/accuracy range-checked, stale or future-dated fix refused via `assertFreshFix`
  (`app/api/riders/location/route.ts:14-40`). Read authorization is correctly role-scoped: a
  customer may track only a rider on one of their own non-terminal orders.
- **A carefully engineered reward-rules engine.** Coins computed in integer poisha/milli-rate space
  with no float drift, ambiguous same-priority active rules refused with a 409, paid-out rules
  archived rather than deleted (`lib/services/reward-rules.ts`).
- **Immutable financial snapshots.** Item unit prices, delivery charge, delivery-area name and the
  advertised bKash destination number are all frozen at write time, so later edits cannot rewrite
  what the customer was charged or told (`lib/services/payments.ts:91`).
- **Bangla/English parity is exact.** Both dictionaries flatten to 3063 keys with zero one-sided
  keys and only three Latin values (brand names). The Bangla is idiomatic native copy, not machine
  output. Noto Sans Bengali is loaded first in `--font-sans` (`app/globals.css:117`), Bengali
  numerals and `bn-BD` lakh/crore grouping are implemented (`lib/i18n/format.ts`), and the BD phone
  regex `^01[3-9]\d{8}$` is enforced identically client and server
  (`lib/validation/limits.ts:24`).
- **Branch open/closed is the one place timezone is done right** —
  `lib/services/branch-hours.ts:86 nowMinutesInDhaka` reads the wall clock through
  `Intl.DateTimeFormat` with `timeZone: "Asia/Dhaka"`, so it is correct regardless of server TZ.
- **Lean runtime for a 3G market.** 8 runtime dependencies, no chart/date/map libraries, heavy use
  of Server Components, and `lib/hooks/use-live-data.ts:50-58` pauses polling on `visibilitychange`.

---

## 6. Top 10 risks, ordered

1. **No payment gateway exists at all** — bKash is a record-only TrxID field with human approval and
   **no amount is ever submitted or checked**, so a customer can pay 50 Tk on an 850 Tk order and
   nothing detects it (`lib/services/payments.ts:9-19`, `:55-100`).
2. **Ramadan advance payment is a client-driven fake** — `POST /api/ramadan/reservations/[id]/pay`
   reads `{outcome, gateway_ref}` from the request body and marks the booking paid, fabricating
   revenue straight into the financial audit log and the Ramadan revenue summary
   (`app/api/ramadan/reservations/[id]/pay/route.ts:12`, `lib/services/ramadan.ts:466-496`).
3. **The branch manager's Cancel button can never succeed** — the UI posts `{status:"cancelled"}`
   with no reason while the service throws a validation error whenever a branch manager cancels
   without one (`components/orders/order-status-actions.tsx:73` vs `lib/services/orders.ts:533`).
4. **Redeeming reward coins destroys them and returns nothing** — a negative ledger row is written,
   a Tk figure is displayed, but no wallet is credited, no coupon is minted, and checkout has no
   coin field (`lib/services/rewards.ts:142`, `lib/services/orders.ts:562`).
5. **Net revenue and every branch settlement overstate real money** — refunds and
   `FinancialAdjustment` rows are recorded but never subtracted from any total
   (`app/api/accounts/reports/route.ts:94-110`, `lib/services/financials.ts:133-179`).
6. **The delivery coordinate is attacker-supplied and never reconciled**, so zone enforcement and
   the delivery fee both guard an input the client controls
   (`app/api/orders/route.ts:47-48`, `lib/services/orders.ts:155-178`).
7. **Login is username-only** — no phone, no email, no OTP — while registration enforces a unique
   phone with the comment "mobile number is a login identifier" and makes email mandatory; password
   reset changes any account's password on knowledge of username + email with no token
   (`auth.ts:18-32`, `app/api/auth/register/customer/route.ts:38-47`, `lib/auth/actions.ts:100-145`).
8. **The business day is computed in the server's local timezone** while every timestamp renders in
   Asia/Dhaka, and no `TZ` is pinned in `ecosystem.config.cjs` or `.env.example` — on a UTC host
   every "today's sales" figure and every attendance day key is shifted six hours
   (`lib/utils/dates.ts:4-27`, `lib/services/dashboards.ts:107`, `lib/services/riders.ts:49-63`).
9. **Coupon redemption is not atomic and never rolls back** — `validateCoupon` reads `usedCount`
   and the increment happens later in a separate non-transactional block, nothing decrements on
   cancellation, and a redeemed coupon can be hard-DELETEd with `Order.couponId` set to null,
   erasing discount attribution from history (`lib/services/marketing.ts:110-129`,
   `lib/services/orders.ts:449-465`, `app/api/marketing/coupons/[id]/route.ts:42`).
10. **The manual bKash lifecycle has routes and green e2e tests but no user interface** — no
    customer TrxID form, no verification queue, only a count badge — and the e2e suite passes
    because it drives the feature entirely through `request.post`
    (`app/api/orders/[id]/payment/route.ts`, `components/branch/live-operations-board.tsx:137`,
    `tests/e2e/34-payments-cod-bkash.spec.ts`).
