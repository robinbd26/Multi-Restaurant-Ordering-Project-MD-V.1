# MAD DELIVERY HQ — Work Assignment & Execution Plan

> Companion to `docs/PROJECT_UNDERSTANDING.md`. Derived from nine specialist audits against
> `docs/REQUIREMENTS_ROLES.md`. **87 findings** across 9 audit areas, consolidated into
> **78 tasks** in **9 workstreams** (9 findings merged as duplicates — each merge is named in the
> task table). Coverage today: **72 of 154 requirement lines done**.

---

## 1. How to read this doc

Section 2 defines the nine workstreams: each has an owning agent from the agency roster, the
`superpowers` skills that agent must run **in the given order**, and hard exit criteria. Section 3
is the complete task table — every audited finding is a row, with a `WS-n.m` id, its severity, its
effort, its owner and the real file paths it touches. Section 4 sequences the work into three
waves and names the hard dependencies between workstreams. Section 5 gives copy-paste dispatch
prompts for the Wave 1 leads. Section 6 is the merge gate. Nothing may be marked complete without
passing Section 6, verified by the named agent — not by the implementer.

---

## 2. Workstreams

### WS-1 — Payments & Money Rails
**Goal:** make money actually move — a real bKash gateway with server-verified callbacks, a usable
manual fallback, an aggregator for the rest of the market, and exact-decimal arithmetic — so no
order can be marked paid without money having moved.

- **Lead:** Backend Architect
- **Supporting:** Application Security Engineer (callback signature + replay), Financial Analyst
  (rail selection, fee model), Frontend Developer (TrxID form, verification queue), API Tester
  (gateway contract + idempotency), Database Optimizer (Decimal / Postgres migration)
- **Skills, in order:** `superpowers:brainstorming` → `superpowers:writing-plans` →
  `superpowers:using-git-worktrees` → `superpowers:test-driven-development` →
  `superpowers:requesting-code-review` → `superpowers:verification-before-completion`
- **Exit criteria:** (a) `paymentStatus` can only reach `paid` from a server-side re-verification
  against the gateway, never from a request body; (b) every payment submission carries and
  validates an **amount** against `Order.totalAmount`; (c)
  `app/api/ramadan/reservations/[id]/pay/route.ts` no longer accepts a client-supplied `outcome`
  or `gateway_ref`; (d) `payment_method` is allowlist-validated server-side in
  `app/api/orders/route.ts`; (e) all order pricing is `Prisma.Decimal` arithmetic with one explicit
  rounding boundary; (f) a page-level Playwright spec (not `request.post`) drives customer
  submission → staff verification.

### WS-2 — Financial Reporting & Reconciliation
**Goal:** make every reported figure equal the money that actually exists — refunds and adjustments
in every total, delivery-charge revenue visible, invoices that add up, settlements that reconcile
against cash handed in.

- **Lead:** Bookkeeper & Controller
- **Supporting:** Backend Architect (service-layer aggregation), FP&A Analyst (report design,
  P&L shape), Data Engineer (groupBy/window queries), Analytics Reporter (export + drilldowns),
  Compliance Auditor (audit-log completeness)
- **Skills, in order:** `superpowers:brainstorming` → `superpowers:writing-plans` →
  `superpowers:test-driven-development` → `superpowers:requesting-code-review` →
  `superpowers:verification-before-completion`
- **Exit criteria:** `net_revenue = sales − commission − expenses − refunds + credits − debits`
  in both `app/api/accounts/reports/route.ts` and `lib/services/financials.ts#generateSettlement`;
  `deliveryCharge` aggregated and displayed on payments, settlements and branch sales; the printed
  invoice's line items sum to its stated total; every accounts list paginated (no bare `take: 100`);
  a reconciliation report diffing expected collections vs verified/paid vs settled; `payment_verified`
  / `payment_rejected` write `FinancialAuditLog` rows.

### WS-3 — Identity, Auth & Access Control
**Goal:** let a Bangladeshi customer log in the way the requirements say they can, close the
password-reset hole, and scope every location and report read to what the role legitimately needs.

- **Lead:** Security Architect
- **Supporting:** Senior SecOps Engineer (SMS gateway ops, key restriction), Application Security
  Engineer (OTP rate limiting, token hashing), Backend Architect (Auth.js provider wiring),
  Penetration Tester (post-implementation verification), Data Privacy Officer (coordinate retention)
- **Skills, in order:** `superpowers:brainstorming` → `superpowers:writing-plans` →
  `superpowers:test-driven-development` → `superpowers:requesting-code-review` →
  `superpowers:verification-before-completion`
- **Exit criteria:** `authorize()` resolves username **or** email **or** normalized BD phone; a
  second `otp` Credentials provider backed by a hashed, short-TTL, attempt-limited code table;
  `forgotPasswordAction` requires a one-time token and no longer resets on username+email alone;
  email optional at registration; rider coordinates returned only while a duty session is active and
  authorized by that session rather than `assignedBranchId`; Maps key restriction documented and
  iframe `referrerPolicy` changed to `strict-origin`; a per-report permission grant enforced in both
  the page and `app/api/management/export/route.ts`.

### WS-4 — Location, Mapping & Delivery Zones
**Goal:** replace typed decimal degrees with a real map, bind the delivery coordinate to a
server-known source, and resolve the zone-vs-area model conflict so the charged area matches where
the customer actually is.

- **Lead:** Web GIS Developer
- **Supporting:** Spatial Data Engineer (model consolidation, bbox prefilter, PostGIS path),
  GIS Analyst (zone/area design, BD administrative rollup), Cartography Designer (picker + live-map
  UX), Frontend Developer (form integration), Database Optimizer (N+1 collapse), GIS QA Engineer
  (coverage regression suite)
- **Skills, in order:** `superpowers:brainstorming` → `superpowers:writing-plans` →
  `superpowers:using-git-worktrees` → `superpowers:test-driven-development` →
  `superpowers:requesting-code-review` → `superpowers:verification-before-completion`
- **Exit criteria:** an interactive map picker with Places autocomplete and a draggable marker is
  mounted in the address book, checkout and the BM zone editor; a server-side geocoding helper
  exists in `lib/services/geo.ts`; `createOrder` accepts `customer_address_id` (or the stored fix)
  rather than free-floating lat/lng, and records which source was used; one model is authoritative
  for coverage and the fee-bearing area is containment-checked; the out-of-zone banner names the
  nearest pickup branch with distance and directions; the BM riders page renders live pins; the
  branch+zone N+1 is one query with a bounding-box prefilter.

### WS-5 — Order Lifecycle & Rider Operations
**Goal:** make the seven named order statuses actually settable by the roles that own them, add the
missing `delayed`/cancel paths, and unify the two disconnected rider duty systems.

- **Lead:** Senior Developer
- **Supporting:** Backend Architect (transition matrix + duty model), Frontend Developer (reason
  modals, status actions), Mobile App Builder (rider handset flows), API Tester (transition legality
  matrix), Reality Checker (verify each status is reachable from the UI, not just the API)
- **Skills, in order:** `superpowers:systematic-debugging` (start with the cancel bug — reproduce
  before changing anything) → `superpowers:test-driven-development` → `superpowers:writing-plans`
  → `superpowers:requesting-code-review` → `superpowers:verification-before-completion`
- **Exit criteria:** a branch manager can cancel an order from the dashboard with a reason;
  `picked_up` / `on_the_way` / `delivered` are settable by a branch manager on a rider's behalf;
  `delayed` exists as a status with bn+en labels, transitions and a rider action; a rider can cancel
  with a mandatory reason; an extra-time action notifies the customer with a revised ETA; one duty
  source of truth carries hours **and** deliveries **and** travel distance; every new path has a
  page-level e2e test.

### WS-6 — Notifications & Push Delivery
**Goal:** make a notification reach a rider whose screen is locked and a customer who is not on the
dashboard, and make the notification toggle mean something.

- **Lead:** Mobile App Builder
- **Supporting:** Backend Architect (`notifyUsers` fan-out, subscription model), DevOps Automator
  (VAPID keys, SMS gateway credentials, service-worker deploy), Frontend Developer (permission
  prompt, preference UI), Support Responder (message copy)
- **Skills, in order:** `superpowers:brainstorming` → `superpowers:writing-plans` →
  `superpowers:test-driven-development` → `superpowers:requesting-code-review` →
  `superpowers:verification-before-completion`
- **Exit criteria:** a `PushSubscription` model, `public/sw.js`, `POST /api/notifications/subscribe`
  and a web-push fan-out from `lib/services/notifications.ts` alongside the DB row; permission
  prompted from the rider dashboard when a duty session starts; per-category notification
  preferences with security/payment categories non-optional; notice targeting gains a branch /
  category / segment dimension; `notifyManagement` exists and fires on real business events.

### WS-7 — Rewards, Marketing & Growth Integrity
**Goal:** make a redeemed coin worth Taka, make a coupon impossible to over-redeem, and make a
campaign do something a customer can see and a marketer can measure.

- **Lead:** Growth Hacker
- **Supporting:** Backend Architect (transactional redemption + coupon atomicity), Database
  Optimizer (segment query pushdown, redemption join model), Email Marketing Strategist (campaign
  metrics model), Financial Analyst (coin liability on the balance sheet), Frontend Developer
  (offers surface)
- **Skills, in order:** `superpowers:brainstorming` → `superpowers:writing-plans` →
  `superpowers:test-driven-development` → `superpowers:requesting-code-review` →
  `superpowers:verification-before-completion`
- **Exit criteria:** redemption mints a real instrument (wallet credit or single-use coupon) in the
  **same** transaction as the ledger debit, with the Tk value recomputed server-side from
  `coinValueTk`; coupon validation and `usedCount` increment share one transaction with a
  conditional `updateMany` guard; a per-customer redemption limit exists; cancellation/refund
  decrements `usedCount`; a redeemed coupon can only be deactivated, never deleted; campaign status
  derives from the clock and gates its linked coupon; a `CampaignEvent` model backs a per-campaign
  sent/opened/clicked/orders/revenue table.

### WS-8 — Management & Admin Reporting Depth
**Goal:** give the executive and super-admin layers period selectors, branch filters, real export
formats, and the five report subjects that have schema data but zero code.

- **Lead:** Analytics Reporter
- **Supporting:** Data Engineer (period/branch filter plumbing, groupBy joins), Backend Architect
  (`buildReport` filter argument), FP&A Analyst (profit and expense attribution), Frontend Developer
  (report controls, inventory + HR pages), Technical Writer (report column glossary, bn/en keys)
- **Skills, in order:** `superpowers:writing-plans` → `superpowers:subagent-driven-development`
  (the 14 report tasks are largely independent) → `superpowers:test-driven-development` →
  `superpowers:requesting-code-review` → `superpowers:verification-before-completion`
- **Exit criteria:** `buildReport(type, filters)` accepts `period` (day/week/month/year/custom) and
  `branchId`, surfaced as a control and forwarded to the export route; `xlsx` and `pdf` branches
  honour the already-accepted `format` param; management inventory, withdrawals, feedback and a real
  branch-attendance report exist; admin attendance covers `StaffAttendance` + `EmployeeAttendance`
  with a date picker; an admin HR/employees page exposes `BranchEmployee`; least-selling starts from
  `product.findMany` so zero-sale products appear.

### WS-9 — Bangladesh Readiness: Time, Locale & Mobile Performance
**Goal:** make the business day start at Dhaka midnight, make the app usable on a prepaid 3G handset,
consolidate the two Ramadan systems, and close the last i18n leaks.

- **Lead:** Cultural Intelligence Strategist
- **Supporting:** Language Translator (PAYMENT_LABELS, audit strings, sehri terminology, SEO copy),
  Performance Benchmarker (image weight, font payload, bundle), Frontend Developer (image pipeline,
  PWA shell), DevOps Automator (`TZ` pinning in PM2 + `.env.example`), Technical Writer (operator
  notes), Backend Architect (Ramadan model consolidation + migration)
- **Skills, in order:** `superpowers:systematic-debugging` (prove the TZ shift with a UTC-host
  repro before editing) → `superpowers:writing-plans` → `superpowers:test-driven-development` →
  `superpowers:requesting-code-review` → `superpowers:verification-before-completion`
- **Exit criteria:** `lib/utils/dates.ts` derives day boundaries in Asia/Dhaka via `Intl`, one
  stored day-key convention is chosen and the other migrated, `TZ=Asia/Dhaka` is set in
  `ecosystem.config.cjs` and documented in `.env.example`; uploads capped at ~1600px with a 400px
  thumbnail variant; a `manifest.json` and minimal service worker exist; one Ramadan seating model
  remains; zero user-facing English in the bn locale.

---

## 3. Task table

Sorted blockers first, then high, medium, low. Severity and effort are the auditors'. `[MERGED]`
marks a row that consolidates findings raised independently by more than one auditor.

| ID | Task | Area | Sev | Eff | Owner | Files |
|---|---|---|---|---|---|---|
| WS-1.1 | Implement bKash Tokenized Checkout (grant/refresh token, create, execute) + server-side `payment/status` re-verification in a callback route; today there is no gateway and **no amount is ever submitted or checked** | BD Readiness | Blocker | XL | Backend Architect | `lib/services/payments.ts:9-19`, `:55-100`, `prisma/schema.prisma:1004-1012`, `.env.example` |
| WS-1.2 | Build the missing manual-bKash UI: customer TrxID + payer-phone form on the order page, and a branch-manager/accounts pending-verification queue with approve/reject-with-reason. Routes and e2e exist; **no page calls them** | BD Readiness | Blocker | L | Frontend Developer | `app/api/orders/[id]/payment/route.ts`, `app/api/orders/[id]/payment/verify/route.ts`, `app/(dashboard)/customer/orders/[id]/page.tsx`, `components/branch/live-operations-board.tsx:137`, `tests/e2e/34-payments-cod-bkash.spec.ts` |
| WS-1.3 | Ramadan advance payment is a client-driven fake — the route reads `{outcome, gateway_ref}` from the body and marks the booking paid, fabricating revenue into the audit log and the Ramadan summary. Gate behind the gateway or restrict to accounts as "record offline advance" | BD Readiness | Blocker | L | Backend Architect | `app/api/ramadan/reservations/[id]/pay/route.ts:12`, `lib/services/ramadan.ts:466-496`, `:575-576`, `prisma/schema.prisma:1409-1415` |
| WS-2.1 | `net_revenue` = sales − commission − expenses only; refunds never subtracted and `FinancialAdjustment` never summed. Add refunds/adjustments and a real reconciliation report (collected vs recorded vs verified vs settled) | Accounts | Blocker | L | Bookkeeper & Controller | `app/api/accounts/reports/route.ts:94-110`, `lib/services/financials.ts:106-131`, `app/(dashboard)/accounts/reports/page.tsx:58-64` |
| WS-2.2 | `Order.deliveryCharge` is snapshotted per order but referenced by **zero** finance code — delivery revenue is invisible on every accounts screen. Add `_sum` to payments groupBy, branch sales and the settlement snapshot | Accounts | Blocker | M | Bookkeeper & Controller | `app/api/accounts/payments/route.ts:15-49`, `prisma/schema.prisma:1030-1034`, `lib/services/dashboards.ts:306-328` |
| WS-3.1 | Login accepts username only — no phone, no email, no OTP — while registration enforces a unique phone "as a login identifier" and mandates email; password reset changes any password on username+email with no token **[MERGED: Customer §4 line 1 + BD Readiness line 81]** | Customer / BD | Blocker | L | Security Architect | `auth.ts:18-32`, `lib/auth/actions.ts:44-95`, `:100-145`, `app/api/auth/register/customer/route.ts:38-47`, `components/auth/login-form.tsx` |
| WS-4.1 | No map picker and no geocoding anywhere — the customer selects a location by typing decimal lat/lng into two boxes. Add a Maps JS picker (Places autocomplete + draggable marker) reused across checkout, address book and the BM zone editor, plus a server-side geocoder **[MERGED: Customer §4 + Location audit]** | Customer / Location | Blocker | L | Web GIS Developer | `components/orders/checkout-form.tsx:313-330`, `components/customer/address-manager.tsx:243-252`, `components/branch/delivery-settings-panel.tsx:238-242`, `lib/services/geo.ts`, `package.json` |
| WS-4.2 | Delivery coordinate is taken straight from the POST body and coverage is enforced against it; never reconciled with the stored trusted point or the typed address (removal documented in-code). Accept `customer_address_id` / stored fix and record the source on `Order` | Location | Blocker | M | Web GIS Developer | `app/api/orders/route.ts:47-48`, `lib/services/orders.ts:155-178`, `lib/services/customer-location.ts:94-117` |
| WS-5.1 | BM "Cancel Order" posts `{status}` with no reason while the service **requires** one for branch-manager cancellation — cancel is impossible from the dashboard. Also only 4 of 7 named statuses are BM-settable, so a manager cannot close an order the rider abandoned | Branch Manager | Blocker | S | Senior Developer | `components/orders/order-status-actions.tsx:73`, `lib/api/actions.ts:450`, `lib/services/orders.ts:533`, `lib/constants/orders.ts:18`, `lib/constants/index.ts:37` |
| WS-5.2 | `delayed` does not exist anywhere in the codebase (no status, no transition, no i18n key) and riders cannot cancel — 2 of 6 required rider statuses are absent | Rider | Blocker | M | Senior Developer | `lib/constants/orders.ts:9`, `:23`, `lib/constants/index.ts:20`, `:44`, `lib/services/orders.ts:511`, `messages/bn.json`, `messages/en.json` |
| WS-7.1 | Coin redemption writes a negative ledger row and returns a formatted Tk string — no wallet credit, no coupon, no checkout coin field. Coins are burned for nothing. Mint a redeemable instrument in the same transaction as the debit **[MERGED: Super Admin §1 "create coins / set value" + Customer §4 line 9]** | Super Admin / Customer | Blocker | M | Growth Hacker | `lib/services/rewards.ts:139-172`, `app/api/customer/rewards/route.ts:38-46`, `components/customer/redeem-form.tsx:50-70`, `lib/services/wallet.ts`, `lib/services/orders.ts:562`, `components/orders/checkout-form.tsx:26-31` |
| WS-7.2 | Coupon integrity: no per-customer cap; `usedCount` read and incremented in separate non-transactional steps so concurrent checkouts all pass; no decrement on cancellation; hard DELETE of a redeemed coupon nulls historical `Order.couponId` | Marketing | Blocker | M | Growth Hacker | `lib/services/marketing.ts:110-129`, `lib/services/orders.ts:449-465`, `app/api/marketing/coupons/[id]/route.ts:42-49`, `prisma/schema.prisma:355-372`, `:1014-1015` |
| WS-8.1 | Every management report is one hardcoded window (30 days / all-time) — no daily/weekly/monthly/yearly selector and no branch filter; `buildReport(type)` takes no filter argument at all | Management | Blocker | L | Analytics Reporter | `lib/services/management.ts:33`, `:36-53`, `components/management/report-view.tsx:12-14`, `app/api/management/export/route.ts:18-25`, `lib/utils/dates.ts` |
| WS-8.2 | Export is CSV-only; the `format` query param is read nowhere and silently ignored. PDF and Excel are explicitly required | Management | Blocker | L | Analytics Reporter | `app/api/management/export/route.ts:13-36`, `app/(dashboard)/management/exports/page.tsx:34-40`, `components/management/report-view.tsx:35-41`, `lib/services/management.ts:227-235` |
| WS-1.4 | Zero hits repo-wide for nagad / rocket / upay / sslcommerz / aamarpay / shurjopay / card rails — only `cash` and `bkash` exist. Integrate one aggregator covering all MFS wallets + cards | BD Readiness | High | XL | Backend Architect | `lib/constants/index.ts:31-34`, `prisma/schema.prisma:992`, `app/(dashboard)/accounts/transactions/page.tsx:66-67` |
| WS-1.5 | Order pricing is JS float arithmetic despite 55 Decimal columns (discounted unit, running total, delivery charge, coupon), with one trailing `toFixed(2)`; SQLite `DECIMAL` has NUMERIC affinity and there is no PostgreSQL migration set | BD Readiness | High | M | Database Optimizer | `lib/services/orders.ts:133-137`, `:423`, `:444`, `prisma/schema.prisma:12`, `prisma/migrations/20260711142903_init/migration.sql:116` |
| WS-2.3 | No tax / service-charge / discount / coupon / promotional-deduction reporting anywhere; tax and service charge are not modelled in the schema at all, and `Order.discountAmount` is aggregated only on the marketing dashboard | Accounts | High | L | Bookkeeper & Controller | `prisma/schema.prisma:1013-1015`, `app/(dashboard)/marketing/performance/page.tsx:27`, `lib/services/settings.ts:8-15` |
| WS-2.4 | `Order.paymentStatus` is read by no accounts page or route; the "pending" stat counts undelivered orders, not unpaid ones; `payments.ts` authorizes accounts to verify bKash but no accounts screen calls it; no per-customer/per-rider payment history | Accounts | High | M | Bookkeeper & Controller | `lib/services/payments.ts:118-129`, `app/api/accounts/payments/route.ts:24-38`, `app/api/orders/[id]/payment/verify/route.ts`, `lib/services/branch-live.ts:111` |
| WS-2.5 | The invoice does not add up — `order.totalAmount` (the grand total) is labelled "Subtotal" above item lines, and delivery charge / discount / coupon never appear; the invoice list is a bare `take: 100` | Accounts | High | M | Bookkeeper & Controller | `app/(dashboard)/accounts/invoices/[id]/page.tsx:109-124`, `lib/services/orders.ts:442-462`, `app/(dashboard)/accounts/invoices/page.tsx:22-26` |
| WS-2.6 | "Refunded" is unreachable in the transactions ledger (no status value, no refunded column, no filter) and both transactions and withdrawals hardcode `page_size=100` with no pagination control — "complete withdrawal history" is the newest 100 rows | Accounts | High | M | Bookkeeper & Controller | `app/(dashboard)/accounts/transactions/page.tsx:30`, `app/(dashboard)/accounts/withdrawals/page.tsx:30`, `lib/constants/enums.ts:50-59`, `app/api/accounts/transactions/route.ts:17-33` |
| WS-2.7 | End-of-day settlement excludes refunds and adjustments, buckets sales by `createdAt` rather than delivery time, and stores no delivery-charge or payment-method split — so it cannot reconcile against cash handed in | Accounts | High | M | Bookkeeper & Controller | `lib/services/financials.ts:133-179`, `prisma/schema.prisma:306-323`, `app/(dashboard)/accounts/settlements/page.tsx:72-84` |
| WS-2.8 | Accounts cannot manage commission records — no route or page lists individual `RiderCommission` rows and none can be corrected/voided; "rules set by the Super Admin" is one global flat taka value | Accounts | High | L | Financial Analyst | `lib/services/wallet.ts:46-78`, `lib/services/settings.ts:8-34`, `app/api/admin/settings/delivery-fees/route.ts:15-45` |
| WS-3.4 | Rider coordinates returned for **off-duty** riders whose `assignedBranchId` matches, and per-rider location is authorized on `assignedBranchId` rather than the active duty session — wrong BM can track, right BM cannot | Location / Rider | High | S | Application Security Engineer | `app/api/riders/branch/route.ts:33-40`, `app/api/riders/[userId]/location/route.ts:25-34`, `lib/services/rider-location.ts:8-13` |
| WS-4.3 | The branch manager can see no rider pin anywhere — the riders page is a name/phone/vehicle/branch table that discards the `latitude`/`longitude`/`is_online` the API already returns, and `LiveMap` is imported only by the customer page. Also fix the `assignedBranchId` 403 and the two disagreeing on-duty counts **[MERGED: Branch Manager §2 + Rider §3 + Location audit]** | BM / Rider / Location | High | M | Web GIS Developer | `app/(dashboard)/branch-manager/riders/page.tsx:38-52`, `app/api/riders/branch/route.ts:33-40`, `app/api/riders/[userId]/location/route.ts:30`, `components/rider/live-map.tsx`, `lib/services/dashboards.ts:344` |
| WS-4.4 | "Out of Delivery Zone" never names the nearest pickup point — `nearestPickupBranch` is implemented but shown only inside the checkout panel; `messages/en.json` has no pickup key; the homepage hardcodes five pickup names as strings | Location | High | S | GIS Analyst | `components/customer/branches-location-gate.tsx:121-150`, `components/home/BranchBar.tsx:142-164`, `messages/en.json:3373-3385`, `lib/services/delivery.ts:95-109`, `components/home/OperatingHours.tsx:112-118` |
| WS-4.5 | `BranchDeliveryZone` and `BranchDeliveryArea` overlap: coverage uses zones only, `BranchDeliveryArea.centerLat/centerLng` is dead data, and the fee-bearing area is never containment-checked — a customer can pick the cheapest active area of the branch | Location | High | M | Spatial Data Engineer | `lib/services/delivery.ts:23-51`, `lib/services/delivery-areas.ts:347-356`, `prisma/schema.prisma:564-615` |
| WS-4.12 | Average delivery time is computed from `Order.updatedAt` (bumped by payment verification and refunds) instead of the `OrderStatusEvent` delivered row; delivery-**zone** performance has no report at all despite `Order.deliveryAreaId` snapshots **[MERGED: Management §7 + Location audit]** | Management / Location | High | M | Analytics Reporter | `lib/services/management.ts:190-206`, `app/(dashboard)/management/reports/delivery/page.tsx`, `prisma/schema.prisma:1428`, `:1025-1035`, `:590` |
| WS-5.3 | No extra-delivery-time / delay signal of any kind — no ETA field, no delay reason, no notification template; the rider's only channel is free-text chat the customer may never open | Rider | High | M | Senior Developer | `lib/services/orders.ts:490`, `lib/services/rider-duty.ts:254`, `messages/en.json`, `prisma/schema.prisma` |
| WS-5.4 | A rider complaint addressed to `branch_manager` is stored with `branchId=null` (backfill only works for managers) and the BM scope requires `branchId = branch.id`, so it reaches no inbox and sits pending forever | Rider | High | M | Backend Architect | `lib/services/complaints.ts:53`, `:96`, `components/complaints/complaint-form.tsx:58`, `app/(dashboard)/complaints/new/page.tsx:24` |
| WS-5.5 | Two parallel unlinked duty systems: going online creates a `RiderBranchDutySession` and never touches `RiderDutyLog`; clocking in does the reverse. A rider who works all day via the online toggle shows zero hours, and the duty log carries no deliveries or travel distance | Rider | High | L | Backend Architect | `lib/services/rider-duty.ts:55`, `lib/services/riders.ts:26`, `lib/selectors/index.ts:338`, `app/(dashboard)/rider/duty-history/page.tsx:19`, `app/api/rider/duty/history/route.ts:7` |
| WS-6.1 | No push transport exists — no service worker, no VAPID, no FCM, no SMS; new-order alerts are a 5s poll + beep and announcements a 30s poll, both requiring a foregrounded tab. Notice targeting is role-only with no category/branch/segment dimension **[MERGED: Super Admin §1 + Rider §3]** | Super Admin / Rider | High | L | Mobile App Builder | `lib/services/notifications.ts:52`, `:149`, `components/rider/assignment-gate.tsx:56`, `components/notifications/notification-bell.tsx:30`, `components/notices/notice-composer.tsx`, `lib/constants/enums.ts:152` |
| WS-7.3 | Campaign rows are inert — nothing in the app reads a `Campaign`, no customer-facing offers surface exists, "scheduling" is display-only dates plus a manual `isActive` checkbox with no job to flip it, and a campaign's window does not gate its linked coupon | Marketing | High | M | Growth Hacker | `app/(dashboard)/marketing/campaigns/page.tsx`, `components/marketing/marketing-forms.tsx`, `app/api/marketing/campaigns/route.ts`, `lib/services/marketing.ts:55-102`, `prisma/schema.prisma:337-353` |
| WS-7.4 | Segmentation is broken for most customers: `User.address` is hardcoded `""` at registration and saved `CustomerAddress` rows are never consulted; "lapsed/win-back" cannot be expressed (`days_since_last_order` is inverted); `min_orders` counts cancelled orders; evaluation is O(segments × customers) in memory; no PATCH route | Marketing | High | M | Database Optimizer | `lib/services/marketing.ts:104-168`, `lib/auth/actions.ts:231`, `prisma/schema.prisma:108-125`, `app/api/marketing/segments/[id]/route.ts`, `app/(dashboard)/marketing/audience/page.tsx` |
| WS-7.5 | No opens, clicks or conversions exist — no engagement model, marketing notifications are created with `link:null`, `isRead` is never aggregated per notice, and `Campaign.couponId` is never joined to attribute orders or revenue | Marketing | High | L | Email Marketing Strategist | `app/(dashboard)/marketing/performance/page.tsx:23-45`, `lib/services/notifications.ts:145-175`, `app/api/marketing/segments/[id]/send/route.ts`, `prisma/schema.prisma:337-353`, `:402-425` |
| WS-8.3 | No management inventory or product-availability page, route or query at all; `ROUTE_ROLES` confines management to `/management/*` so existing availability screens are unreachable | Management | High | M | Frontend Developer | `app/(dashboard)/management/`, `lib/constants/index.ts:138-148`, `:238-246`, `prisma/schema.prisma:906`, `app/(dashboard)/branch-manager/catalog/page.tsx` |
| WS-8.4 | Branch profit and branch-wise expenses are unattributable — the branches report has no cost side and the finance report aggregates expenses/commission/refunds **globally** with no `branchId` grouping | Management | High | M | FP&A Analyst | `lib/services/management.ts:62-82`, `:145-168`, `prisma/schema.prisma:290`, `app/(dashboard)/accounts/expenses/page.tsx:38-52` |
| WS-8.5 | `RiderWithdrawal` is never queried by any management page or service — requested/approved/rejected/paid amounts are invisible to management | Management | High | M | Data Engineer | `lib/services/management.ts:83-107`, `:7-19`, `prisma/schema.prisma:256` |
| WS-8.6 | Management complaint scope excludes rider-filed complaints addressed elsewhere, contradicting the explicit "(customer, rider, branch manager)" wording; and there is no customer feedback/ratings surface for management at all | Management | High | M | Backend Architect | `lib/services/complaints.ts:31-59`, `app/(dashboard)/management/complaints/page.tsx`, `app/(dashboard)/marketing/feedback/page.tsx`, `prisma/schema.prisma:195`, `:210` |
| WS-8.7 | The management "attendance" report reads `RiderDutyLog` only — it is a rider-shift tally with no branch column and no attendance status; `EmployeeAttendance` and `StaffAttendance` are never queried | Management | High | M | Data Engineer | `lib/services/management.ts:207-222`, `prisma/schema.prisma:723`, `:758`, `app/(dashboard)/management/reports/attendance/page.tsx` |
| WS-8.8 | Super Admin "daily attendance (all sections)" shows only rider duty logs and manager login events, hardcoded to 7 days with no date picker, branch or section filter — the kitchen/waiter/cashier sections are never queried | Super Admin | High | M | Data Engineer | `app/(dashboard)/admin/reports/attendance/page.tsx`, `prisma/schema.prisma:723`, `:757`, `lib/services/employees.ts:288`, `:361`, `app/api/employee-attendance/route.ts` |
| WS-8.9 | `/admin/staff` lists platform `User` rows: "joining date" is account-creation date and "company post" is the login-role badge. The real HR record (`BranchEmployee` — photo, joiningDate, department, employeeCode) has no admin page or nav entry despite being API-reachable | Super Admin | High | M | Frontend Developer | `app/(dashboard)/admin/staff/page.tsx`, `prisma/schema.prisma:665`, `lib/services/employees.ts:69`, `app/api/employees/route.ts`, `lib/constants/index.ts:119` |
| WS-9.1 | Every reporting and attendance day boundary uses server-local midnight while timestamps render in Asia/Dhaka, and no `TZ` is pinned in PM2 or `.env.example` — on a UTC host the business day runs 06:00→06:00 Dhaka. A third convention (UTC midnight) coexists for Ramadan/settlement day keys **[MERGED: Super Admin "today's" reports + BD Readiness timezone]** | Super Admin / BD | High | M | DevOps Automator | `lib/utils/dates.ts:4-27`, `lib/services/dashboards.ts:107`, `lib/services/branch-ops.ts:119-121`, `lib/services/riders.ts:49-63`, `ecosystem.config.cjs`, `prisma/schema.prisma:1284` |
| WS-9.2 | `images: { unoptimized: true }` globally plus a 16383px-only downscale means raw 4000px phone photos are served into 360px menu tiles; no PWA, no service worker, no offline story; five Google font families including Bengali at five weights | BD Readiness | High | M | Performance Benchmarker | `next.config.ts:29`, `lib/http/upload.ts:19`, `:66-72`, `app/layout.tsx:14-44` |
| WS-9.3 | Two parallel Ramadan booking systems in one database (`RamadanTable`/`RamadanBooking` vs `RamadanReservation` against `BranchTable`) that lock different entities, so two records can claim the same physical table for the same iftar; no Ramadan trading-hours override; sehri absent entirely | BD Readiness | High | L | Backend Architect | `prisma/schema.prisma:815-846`, `:1287-1321`, `:522-523`, `app/api/ramadan/tables/route.ts`, `app/api/ramadan/bookings/route.ts`, `components/customer/ramadan-booking-panel.tsx:79-120` |
| WS-1.6 | `payment_method` is only checked for truthiness server-side and persisted verbatim — a POSTed `"card"` creates an order stuck unpaid forever that renders as a raw missing i18n key and pollutes the by-method revenue grouping | BD Readiness | Medium | S | Application Security Engineer | `app/api/orders/route.ts:56`, `lib/services/orders.ts:400`, `components/orders/checkout-form.tsx:27` |
| WS-1.7 | Payment methods are hardcoded in three places instead of one shared constant, so any new rail renders as a missing key in the by-method report | BD Readiness | Medium | S | Backend Architect | `app/(dashboard)/accounts/transactions/page.tsx:66-67`, `components/orders/orders-explorer.tsx:34`, `lib/constants/index.ts:31-34`, `app/(dashboard)/accounts/payments/page.tsx:49` |
| WS-2.9 | No rider filter exists on any accounts surface; the transactions page renders no branch select and no customer field, and its `q` is dropped unless `Number(q)` is valid — searching `ORD-YYYYMMDD-000001` silently returns everything | Accounts | Medium | M | Backend Architect | `app/api/accounts/transactions/route.ts:25-33`, `app/(dashboard)/accounts/transactions/page.tsx:46-84`, `components/orders/orders-explorer.tsx:81-90` |
| WS-2.10 | The expense report builds `const where = {}` and never populates it — no branch, category or date filter and no grouped breakdown, despite the API already supporting `?branch=`/`?category=` | Accounts | Medium | S | Bookkeeper & Controller | `app/(dashboard)/accounts/expenses/page.tsx:38-56`, `app/api/accounts/expenses/route.ts:41-44`, `lib/services/financials.ts:9-17` |
| WS-2.11 | Branch and payment cards on the accounts reports page are all-time regardless of the selected period tab, reading as a period breakdown when they are not; `/accounts/sales` has no date control | Accounts | Medium | S | Data Engineer | `lib/services/dashboards.ts:306-328`, `:67-87`, `app/(dashboard)/accounts/reports/page.tsx:47-50`, `app/(dashboard)/accounts/sales/page.tsx:20` |
| WS-2.12 | There is no Super Admin refund policy to process against (no window, cap, order-state restriction or second approval) and the form demands the raw internal numeric order id with no lookup | Accounts | Medium | M | Financial Analyst | `lib/services/financials.ts:29-71`, `lib/services/settings.ts:8-15`, `components/accounts/financial-forms.tsx:39-43` |
| WS-2.13 | "As-needed" financial summaries are impossible — the page only sends `?period=`, there is no custom range, and there is no accounts export at all despite `reportToCsv` existing for management | Accounts | Medium | M | Analytics Reporter | `app/api/accounts/reports/route.ts:32-36`, `app/(dashboard)/accounts/reports/page.tsx:45-50`, `app/api/management/export/route.ts:27-33`, `lib/services/management.ts:227` |
| WS-3.2 | No per-report permission concept exists — access is a flat hardcoded role check, so "as permitted by the Super Admin" cannot be expressed or revoked | Management | Medium | L | Security Architect | `app/(dashboard)/management/reports/page.tsx:33`, `app/(dashboard)/management/reports/sales/page.tsx:5`, `app/api/management/export/route.ts:17`, `lib/services/management.ts:7-19` |
| WS-3.3 | The public Maps key has no documented referrer restriction, and `referrerPolicy="no-referrer-when-downgrade"` sends the full page URL (including order ids) plus precise coordinates to Google | Location | Medium | S | Senior SecOps Engineer | `.env.example:44-46`, `components/customer/branch-location-panel.tsx:88-92`, `components/rider/live-map.tsx:47`, `components/rider/assignment-gate.tsx:153-155` |
| WS-4.6 | `LiveMap` uses a raw `setInterval(15s)` instead of `useLiveData`, so it never pauses on tab hide, and each ping swaps the Embed iframe `src`, reloading the whole Maps payload — up to ~120 full reloads per delivery on prepaid data | Location | Medium | M | Cartography Designer | `components/rider/live-map.tsx:24-53`, `lib/hooks/use-live-data.ts:45-60` |
| WS-4.7 | Rider navigation is a free-text Maps **search** on the delivery address even though `Order.deliveryLat/Lng` exist, the order detail page has no navigate link at all, and the "route" views are a CSS faux street grid and a hardcoded SVG polyline with a fake LIVE badge **[MERGED: Rider §3 + Location audit]** | Rider / Location | Medium | M | Cartography Designer | `components/rider/rider-current-order.tsx:42`, `app/(dashboard)/rider/orders/[id]/page.tsx:76`, `components/rider/route-panel.tsx`, `components/rider/rider-delivery-map.tsx`, `lib/services/geo.ts:35-37` |
| WS-4.8 | `nearestEligibleBranch` loads every active branch then queries zones **inside the loop** — an N+1 on every homepage render, branches page and order placement, with no bounding-box prefilter | Location | Medium | M | Database Optimizer | `lib/services/customer-location.ts:190-243`, `lib/services/orders.ts:96-103`, `lib/services/delivery.ts:96-108`, `app/page.tsx:95` |
| WS-4.11 | `CustomerAddress` has no BD administrative structure (no house/road/block/sector/thana/district/postcode) and `BranchDeliveryArea` is free-text, so zone rollups and rider addressing both degrade to one undifferentiated string | BD Readiness | Medium | M | GIS Analyst | `prisma/schema.prisma:108-125`, `:590-611`, `components/customer/address-manager.tsx:247-250` |
| WS-5.6 | No structured delivery-issue reporting — the chat thread only opens at `confirmReceive` (so the rider cannot reach the customer before that) and closes on delivery/end-of-duty; `/rider/support` is a static hotline and four non-clickable tiles | Rider | Medium | M | Senior Developer | `lib/services/rider-duty.ts:165`, `:105`, `lib/services/orders.ts:573`, `app/(dashboard)/rider/support/page.tsx:26`, `components/rider/rider-order-panel.tsx:52` |
| WS-5.7 | A stale second online toggle calls an endpoint that now rejects going online without a duty session and discards `res.error` entirely (button appears dead), while starting a third concurrent `watchPosition` | Rider | Medium | S | Frontend Developer | `components/rider/online-tracker.tsx:49`, `app/(dashboard)/rider/location-history/page.tsx:42`, `app/api/riders/online/route.ts:14`, `components/rider/rider-online-panel.tsx:47`, `app/(dashboard)/layout.tsx:63` |
| WS-5.8 | Customer order tracking is a static server render — no polling, no revalidate, no SSE — so a customer sees "preparing" until they manually reload, even though `useLiveData` is used everywhere else | Customer | Medium | S | Frontend Developer | `app/(dashboard)/customer/orders/[id]/page.tsx:23-99`, `components/orders/order-detail-card.tsx:21-45`, `lib/hooks/use-live-data.ts:40-60` |
| WS-5.9 | `DeliveryTimeSlot` rows are created and listed but read by nothing — checkout has no slot picker and `Order` has no slot field, so a manager configuring lunch/dinner windows changes nothing | Branch Manager | Medium | L | Senior Developer | `app/api/branch-manager/time-slots/route.ts`, `app/(dashboard)/branch-manager/delivery-hours/page.tsx:54`, `prisma/schema.prisma:744`, `components/orders/checkout-form.tsx` |
| WS-5.10 | A branch manager cannot mark their own daily attendance anywhere in the UI — `AttendanceMarker` is finished, `POST /api/attendance` works, and the action even revalidates the BM path, but the component is only mounted on the rider page | Branch Manager | Medium | S | Frontend Developer | `app/(dashboard)/branch-manager/attendance/page.tsx`, `components/branch/attendance-marker.tsx`, `app/api/attendance/route.ts`, `lib/api/actions.ts:863`, `app/(dashboard)/rider/attendance/page.tsx:36` |
| WS-5.11 | `LoginHistory` is written on every sign-in but no BM page reads it; the duty-history "activity log" renders login/logout badges for rows that are never created; `ipAddress`/`userAgent` are never populated | Branch Manager | Medium | M | Senior Developer | `auth.ts:34`, `prisma/schema.prisma:1143`, `app/(dashboard)/branch-manager/duty-history/page.tsx`, `lib/services/branches.ts:98`, `app/api/rider/login-history/route.ts` |
| WS-6.2 | The settings "Notifications" switch only suppresses `marketing`, so turning it off silences nothing the customer actually receives — the control is misleading | Customer | Medium | M | Backend Architect | `lib/services/notifications.ts:28-63`, `app/api/customer/settings/route.ts:12-21`, `components/customer/notifications-toggle.tsx:16-24`, `app/(dashboard)/customer/settings/page.tsx:33-39` |
| WS-6.3 | Nothing in the application ever generates a business alert for management — `notifyRole` is called exactly once (super admins) and the only management notification in existence is a seed row | Management | Medium | M | Backend Architect | `lib/services/notifications.ts:99-103`, `app/(dashboard)/management/notifications/page.tsx`, `prisma/seed.ts:747`, `lib/services/financials.ts:63` |
| WS-7.6 | The marketing "rider feedback" panel is actually customers rating riders; rider-filed complaints are excluded from the marketing scope; the page is a fixed `take: 50` with no search, filter or pagination | Marketing | Medium | M | Growth Hacker | `app/(dashboard)/marketing/feedback/page.tsx:22-30`, `prisma/schema.prisma:195-208`, `lib/services/complaints.ts:31-45`, `app/(dashboard)/marketing/products/page.tsx:41-46` |
| WS-8.10 | Cross-branch product hold is `updateMany({ where: { name } })` — exact, case- and whitespace-sensitive — while products are created per branch with free-text names and no shared SKU, so a held item stays on sale under a variant spelling and an unrelated item can be held by name collision | Super Admin | Medium | M | Backend Architect | `app/api/products/[id]/hold/route.ts:23`, `app/api/products/[id]/unhold/route.ts:20`, `lib/services/catalog.ts:418`, `prisma/schema.prisma:906`, `components/catalog/product-row-actions.tsx:185` |
| WS-8.11 | The management marketing report lists coupons only — `Campaign` is never read, and `Order.couponId`/`discountAmount` are never aggregated, so there is no revenue attribution, discount cost or active/expired state | Management | Medium | M | Analytics Reporter | `lib/services/management.ts:177-189`, `prisma/schema.prisma:337`, `:355`, `:1013-1015` |
| WS-8.12 | "Least selling" iterates `OrderItem` only, so products that never sold — the genuinely least-selling ones — are absent; categories are not reported at all | Management | Medium | M | Data Engineer | `lib/services/management.ts:124-144`, `lib/services/dashboards.ts:272-288`, `lib/constants/index.ts:238-246` |
| WS-8.13 | "Business growth trends" does not exist — the only series is the same 7-day chart, with no period-over-period comparison or growth percentage; retention counts customers whose orders were all cancelled | Management | Medium | M | FP&A Analyst | `app/(dashboard)/management/analytics/page.tsx:29-40`, `:59-66`, `lib/services/dashboards.ts:38-65` |
| WS-8.14 | A signed-in customer is hard-scoped to covered branches and sees an empty menu with no GPS fix — logged-out visitors can browse **more** than logged-in ones. Separate browsing from ordering | Customer | Medium | M | Frontend Developer | `app/page.tsx:76-118`, `app/(dashboard)/customer/branches/[id]/menu/page.tsx:32-35`, `app/(dashboard)/customer/branches/page.tsx:60-63`, `lib/services/customer-branch.ts:62-90` |
| WS-9.4 | Rider tracking registers `watchPosition` with `enableHighAccuracy` and fires a Server Action on **every** callback with no throttle or distance filter — the code comment claims 20s but `maximumAge` does not rate-limit; hundreds to thousands of round trips per shift | BD Readiness | Medium | S | Mobile App Builder | `components/rider/online-tracker.tsx:11-32`, `lib/services/rider-location.ts` |
| WS-2.14 | `decideBkashPayment` verifies or rejects a customer payment — a money-confirming act — and writes no `FinancialAuditLog` row; post-payment cancellations are likewise unlogged | Accounts | Low | S | Compliance Auditor | `lib/services/payments.ts:137-173`, `lib/services/financials.ts:22-26`, `lib/services/wallet.ts:21-37` |
| WS-4.9 | Route history is saved but not replayable — the page shows per-day point counts only, and it loads **every** route point the rider has ever recorded (≈5,700 rows per duty day) with no date filter or limit | Location | Low | M | Spatial Data Scientist | `app/(dashboard)/rider/route-history/page.tsx:24-40`, `lib/services/rider-location.ts:45-74`, `prisma/schema.prisma:1130-1142` |
| WS-4.10 | Saved addresses do not drive checkout — the form receives the `User.address` profile string, not a `CustomerAddress` row, so Home/Office cannot be selected and coordinates must be retyped | Location | Low | M | Frontend Developer | `app/(dashboard)/customer/checkout/page.tsx:22-26`, `components/orders/checkout-form.tsx:385-392`, `lib/services/customer-location.ts:87-115` |
| WS-5.12 | The BM sales report is fixed-window (today + hardcoded 7-day series + all-time popular items), accepts no `searchParams`, and has no date range, payment split or export | Branch Manager | Low | M | Data Engineer | `app/(dashboard)/branch-manager/reports/page.tsx`, `lib/services/dashboards.ts:330` |
| WS-6.4 | The daily-login coin only fires when the customer opens the rewards page — `awardDailyLogin` is never called from `loginAction` or `authorize()`, so a customer who logs in daily but never visits the hub earns nothing | Customer | Low | S | Backend Architect | `app/api/customer/rewards/route.ts:9-12`, `lib/services/rewards.ts:127-131`, `lib/auth/actions.ts:83-95`, `auth.ts:31-33` |
| WS-9.5 | English leaks in a Bangla-default product: `PAYMENT_LABELS` hardcoded outside the dictionary, audit-log detail strings hardcoded English on audit screens, SEO metadata English-only with `openGraph.locale = en_US`, plus a stray "Loading" literal and untranslated aria-labels | BD Readiness | Low | S | Language Translator | `lib/constants/index.ts:31-34`, `lib/services/financials.ts:54`, `lib/services/wallet.ts:137`, `app/layout.tsx:71-73`, `app/page.tsx:31`, `components/delivery/delivery-area-list-skeleton.tsx:13` |

**Row count: 78 tasks** consolidating **87 audited findings** (9 merges, each marked `[MERGED]`).

---

## 4. Sequencing

### Wave 1 — blockers, money, security, legal (ship nothing without these)
`WS-1.1 · 1.2 · 1.3` · `WS-2.1 · 2.2` · `WS-3.1` · `WS-4.1 · 4.2` · `WS-5.1 · 5.2` ·
`WS-7.1 · 7.2` · `WS-8.1 · 8.2` · `WS-9.1`

Rationale for the two non-obvious inclusions: **WS-9.1 (timezone)** is Wave 1 because every
Wave-1 financial fix is validated against a "today" boundary that is currently wrong by six hours
on a UTC host — fixing reporting maths on top of a broken day key just moves the error. **WS-3.1
(login)** is Wave 1 because registration already enforces a unique phone as "a login identifier"
that cannot be used to log in, which locks real customers out today.

**Parallel:** WS-1, WS-3, WS-4, WS-5, WS-9 can run concurrently in separate worktrees — they touch
disjoint files.
**Hard dependencies inside Wave 1:**
- `WS-2.1/2.2` (money totals) must land **after** `WS-9.1` (Dhaka day boundary) or the totals are
  recomputed twice.
- `WS-1.2` (manual bKash UI) blocks `WS-2.4` (pending-payment queue) — same verify route, same
  screens.
- `WS-4.2` (bind the coordinate to a server-known source) depends on `WS-4.1` (the picker that
  produces `customer_address_id`); do not ship 4.2 first or checkout breaks for users without a
  saved address.
- `WS-7.1` (coin redemption) shares the order-pricing transaction with `WS-1.5` (Decimal
  arithmetic) — sequence 1.5 first or resolve the merge conflict once.
- `WS-5.1` is a same-day fix and should be merged before anything else touches
  `lib/services/orders.ts`, to keep the diff trivially reviewable.

### Wave 2 — high-severity feature gaps
`WS-1.4 · 1.5` · `WS-2.3 · 2.4 · 2.5 · 2.6 · 2.7 · 2.8` · `WS-3.4` · `WS-4.3 · 4.4 · 4.5 · 4.12` ·
`WS-5.3 · 5.4 · 5.5` · `WS-6.1` · `WS-7.3 · 7.4 · 7.5` ·
`WS-8.3 · 8.4 · 8.5 · 8.6 · 8.7 · 8.8 · 8.9` · `WS-9.2 · 9.3`

**Parallel:** WS-6, WS-7, WS-8 are independent of each other and of WS-4.
**Hard dependencies:** `WS-8.4/8.5/8.7` all consume the filter argument added by `WS-8.1` — do not
start them until 8.1 is merged. `WS-4.12` (delivery-zone report) depends on `WS-4.5` (deciding
which zone model is authoritative). `WS-5.3` (extra-time notification) depends on `WS-5.2`
(`delayed` status exists) and feeds `WS-6.2`. `WS-1.4` (aggregator) should reuse the callback
verification pattern established by `WS-1.1` — do not start it first.

### Wave 3 — medium and low polish
`WS-1.6 · 1.7` · `WS-2.9 … 2.14` · `WS-3.2 · 3.3` · `WS-4.6 · 4.7 · 4.8 · 4.9 · 4.10 · 4.11` ·
`WS-5.6 … 5.12` · `WS-6.2 · 6.3 · 6.4` · `WS-7.6` · `WS-8.10 … 8.14` · `WS-9.4 · 9.5`

All of Wave 3 is parallelisable. Two exceptions: `WS-4.10` (saved-address selector at checkout) is
subsumed by `WS-4.1`/`4.2` if those were done properly — verify before scheduling it. `WS-1.7`
(shared `PAYMENT_METHODS` constant) should land before `WS-1.4` adds rails, not after.

---

## 5. Ready-to-paste dispatch prompts (Wave 1)

### → Backend Architect (WS-1: Payments & Money Rails)
```
Repo: C:/Users/MORSHED/Desktop/MAD/repo  (Next.js 16 App Router, Prisma, SQLite dev)
Start by invoking the skill: superpowers:brainstorming, then superpowers:writing-plans.
Work in a git worktree (superpowers:using-git-worktrees). Do not run npm install or builds
until the plan is approved.

Context: there is NO payment gateway in this product. lib/services/payments.ts:9-19 says so in
its own header. The "bKash integration" is a customer typing a TrxID that a human approves, and
submitBkashPayment(user, orderId, {transactionId, payerPhone}) never records or checks an AMOUNT
(lib/services/payments.ts:55-100), so a 50 Tk payment on an 850 Tk order passes undetected.
Separately, app/api/ramadan/reservations/[id]/pay/route.ts:12 reads {idempotency_key, outcome,
gateway_ref} from the REQUEST BODY and lib/services/ramadan.ts:466-496 marks the reservation paid
from it — any customer can fabricate revenue into the financial audit log and the Ramadan revenue
summary (lib/services/ramadan.ts:575-576).

Deliver, in this order:
1. lib/services/bkash-gateway.ts — grant/refresh token, payment/create (amount from the order's
   Decimal totalAmount, orderNumber as merchantInvoiceNumber), payment/execute.
2. app/api/payments/bkash/callback/route.ts — re-verify via payment/status SERVER-SIDE; never
   trust the redirect. Only then may paymentStatus become 'paid'.
3. Keep the manual flow as an explicit fallback for branches without a merchant account, but add
   a required amount field validated against Order.totalAmount.
4. app/api/ramadan/reservations/[id]/pay/route.ts — delete the client-supplied `outcome` and
   `gateway_ref`; route through the gateway, or restrict to accounts/super_admin as an explicit
   "record offline advance received" action.
5. app/api/orders/route.ts:56 — allowlist-validate payment_method (today it is only checked for
   truthiness and persisted verbatim at lib/services/orders.ts:400).

Acceptance: paymentStatus reaches 'paid' only after a server-side gateway re-verification; every
submission carries a validated amount; no route accepts a client-asserted payment outcome; a
page-level Playwright spec (NOT request.post — see tests/e2e/34-payments-cod-bkash.spec.ts for
the anti-pattern) drives customer submission through staff verification.
Finish with superpowers:requesting-code-review then superpowers:verification-before-completion.
```

### → Bookkeeper & Controller (WS-2: Financial Reporting & Reconciliation)
```
Repo: C:/Users/MORSHED/Desktop/MAD/repo
Start with superpowers:brainstorming, then superpowers:writing-plans, then
superpowers:test-driven-development.
DEPENDENCY: do not start until WS-9.1 (Asia/Dhaka day boundaries in lib/utils/dates.ts) is merged.

Two blockers, both money-wrong-on-screen:
1. app/api/accounts/reports/route.ts:94-110 computes net_revenue = sales − commission − expenses.
   Refunds issued via /accounts/refunds are never subtracted and FinancialAdjustment rows are
   created, counted and listed but NEVER summed (lib/services/financials.ts:106-131). The headline
   figure is overstated by every taka refunded. Same defect in generateSettlement
   (lib/services/financials.ts:133-179), which also buckets sales by order.createdAt rather than
   delivery time, so a 23:55 order delivered next morning lands on the wrong settlement day.
2. Order.deliveryCharge (prisma/schema.prisma:1030-1034) is referenced by ZERO finance code.
   Delivery revenue is invisible on every accounts screen, for a delivery business.

Deliver: net_revenue = sales − commission − expenses − refunds + credits − debits in BOTH the
reports route and generateSettlement, with refunds and adjustments as their own summary cards;
_sum deliveryCharge in app/api/accounts/payments/route.ts and lib/services/dashboards.ts:306-328
and on the settlement snapshot; cashSales/bkashSales columns on BranchSettlement; and a
reconciliation report grouping delivered orders by paymentMethod + paymentStatus and diffing
expected collections against verified/paid rows plus recorded settlements.

Acceptance: for a seeded branch-day containing a refund and a debit adjustment, the reports page,
the settlement row and the reconciliation report agree to the poisha, and the settlement's net
equals cash-in-hand minus recorded expenses.
Finish with superpowers:requesting-code-review then superpowers:verification-before-completion.
```

### → Security Architect (WS-3: Identity, Auth & Access Control)
```
Repo: C:/Users/MORSHED/Desktop/MAD/repo  (Auth.js / NextAuth v5 beta, Credentials + JWT)
Start with superpowers:brainstorming, then superpowers:writing-plans, then
superpowers:test-driven-development.

auth.ts:18-32 resolves the login identifier by USERNAME ONLY. Meanwhile
app/api/auth/register/customer/route.ts:46 enforces a unique phone with the comment "mobile number
is a login identifier" — but it is not one — and line 40 makes email REQUIRED, which a large share
of Bangladeshi delivery customers do not have. Requirement line 81 demands phone, email or another
authorized method with OTP. There is no OTP anywhere in the repo. The substitute,
forgotPasswordAction (lib/auth/actions.ts:100-145), resets ANY account's password on knowledge of
username + email alone, with no token.

Deliver:
1. authorize() resolves username OR email (lowercased) OR normalized BD phone — reuse
   normalizeBdPhoneForSearch in lib/validation/server.ts:270.
2. Make email optional at registration.
3. A PhoneOtp model (phone, codeHash, expiresAt, attempts, consumedAt) + POST
   /api/auth/otp/request and /api/auth/otp/verify behind an SMS-gateway adapter (SSL Wireless /
   BulkSMSBD / Alpha Net — SMS_* vars already stubbed and unread in .env.example), plus a second
   Auth.js Credentials provider ('otp') that authorizes on a verified unconsumed code.
4. Gate forgotPasswordAction behind the same one-time token.
Rate-limit and hash the codes; never log a code.

Acceptance: a customer who registered with 01712345678 and no email can log in by phone and by
OTP; password reset without a token is rejected; a Penetration Tester pass finds no enumeration or
brute-force path on /api/auth/otp/*.
Finish with superpowers:requesting-code-review then superpowers:verification-before-completion.
```

### → Web GIS Developer (WS-4: Location, Mapping & Delivery Zones)
```
Repo: C:/Users/MORSHED/Desktop/MAD/repo
Start with superpowers:brainstorming, then superpowers:writing-plans, then
superpowers:using-git-worktrees, then superpowers:test-driven-development.

Two blockers:
1. There is NO map picker in this product. The customer selects a delivery location either by
   granting browser GPS or by typing raw decimal lat/lng into two text boxes — see
   components/orders/checkout-form.tsx:313-330 (placeholders "23.79"/"90.41") and
   components/customer/address-manager.tsx:243-252 and
   components/branch/delivery-settings-panel.tsx:238-242. No map SDK is installed (package.json
   has 8 runtime deps, none of them a map library); every "map" is a Google Maps EMBED iframe or a
   CSS/SVG placeholder. There is no geocoding, so a typed Bangladeshi address never becomes a
   coordinate.
2. app/api/orders/route.ts:47-48 passes lat/lng straight from the POST body into
   lib/services/orders.ts:155-176, and coverage + delivery fee are enforced against THOSE numbers.
   They are never reconciled with the stored trusted point or the typed address — the removal is
   documented in the code comment at lib/services/orders.ts:167-178. A customer can POST a
   coordinate inside a branch circle while typing an address 40 km away.

Deliver: a MapPicker client component (Google Maps JS API — the key is already plumbed as
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) with Places autocomplete and a draggable marker, mounted in
AddressManager, CheckoutForm and the BM zone editor; a server-side geocoding helper in
lib/services/geo.ts; and a createOrder that accepts customer_address_id (server reads that row's
lat/lng) or the stored fix, recording which source was used on the Order row. Keep all existing
server-side coverage/hours enforcement — resolveDeliveryBranch (lib/services/orders.ts:69-111) is
correct and must not be weakened.

Acceptance: a customer can complete an order without ever typing a number; a request carrying a
raw coordinate more than a few km from both the trusted point and the selected saved address is
rejected; GIS QA Engineer confirms tests/e2e/26-nearest-branch-checkout.spec.ts and
tests/e2e/41-login-zone-ordering.spec.ts still pass.
Finish with superpowers:requesting-code-review then superpowers:verification-before-completion.
```

### → Senior Developer (WS-5: Order Lifecycle & Rider Operations)
```
Repo: C:/Users/MORSHED/Desktop/MAD/repo
Start with superpowers:systematic-debugging — REPRODUCE the cancel bug before changing anything.
Then superpowers:test-driven-development.

Blocker 1 — cancel is broken end to end. components/orders/order-status-actions.tsx:73 calls
updateOrderStatusAction(orderId, "cancelled"); lib/api/actions.ts:450 posts only { status }; and
lib/services/orders.ts:533 throws validationError({ reason }) whenever a branch_manager cancels
without a non-empty reason. There is no reason input anywhere in the BM order UI. The e2e suite
misses it because tests/e2e/35-order-workflow.spec.ts:136 posts to the API directly WITH a reason.
Fix: pass withReason to the cancel ConfirmModal (it already supports it — see
components/catalog/product-row-actions.tsx:167) and widen updateOrderStatusAction to forward the
reason. Then add "picked_up", "on_the_way", "delivered" to BRANCH_MANAGER_SETTABLE
(lib/constants/orders.ts:18) and extend BM_NEXT_STATUS (lib/constants/index.ts:37) so a manager can
close out an order a rider abandoned. Keep the branch-ownership check and the OrderStatusEvent row.

Blocker 2 — "delayed" does not exist anywhere in the codebase (no status, no transition, no i18n
key, no UI) and riders cannot cancel (RIDER_SETTABLE = [picked_up, on_the_way, delivered]). Add
'delayed' to the OrderStatus union in lib/constants/enums.ts, ORDER_STATUS_LABELS, and orderStatus.*
in BOTH messages/bn.json and messages/en.json (the two files have exact 3063-key parity — do not
break it); add ready|picked_up|on_the_way -> delayed and delayed -> on_the_way|delivered to
ALLOWED_TRANSITIONS; add 'delayed' plus 'cancelled' (mandatory reason, mirroring
lib/services/orders.ts:534) to RIDER_SETTABLE. Reuse OrderStatusEvent.reason.

Acceptance: a page-level Playwright test cancels an order as a branch manager THROUGH THE UI and
asserts the reason lands on OrderStatusEvent; every one of the seven §2 statuses and six §3
statuses is reachable from a real screen. Reality Checker verifies by clicking, not by curl.
Finish with superpowers:requesting-code-review then superpowers:verification-before-completion.
```

### → Growth Hacker (WS-7: Rewards, Marketing & Growth Integrity)
```
Repo: C:/Users/MORSHED/Desktop/MAD/repo
Start with superpowers:brainstorming, then superpowers:writing-plans, then
superpowers:test-driven-development.
Pair with Backend Architect for the transaction work.

Blocker 1 — redeeming coins gives the customer NOTHING. lib/services/rewards.ts:139-172 validates
the minimum and balance, writes a negative RewardLedger row, computes tkValue = amount *
coinValueTk and returns it in a toast. No wallet is credited (lib/services/wallet.ts is
rider-commission/withdrawal only), no coupon is minted, and checkout has no coin field
(components/orders/checkout-form.tsx:26-31; createOrder's total is items + delivery − coupon,
lib/services/orders.ts:442-462). A customer who redeems 500 coins loses them and receives nothing.
Fix: mint a real instrument — a single-use Coupon row owned by the customer, or a wallet credit —
inside the SAME prisma.$transaction as the negative ledger entry, with the Tk amount recomputed
server-side from coinValueTk (never trust a client value).

Blocker 2 — coupon redemption integrity. validateCoupon reads usedCount
(lib/services/marketing.ts:122) and lib/services/orders.ts:449-456 increments it afterwards in a
separate non-transactional .then(), so concurrent checkouts all pass the same maxUses check.
Nothing decrements usedCount on cancellation or refund. app/api/marketing/coupons/[id]/route.ts:42
hard-DELETEs a redeemed coupon and Order.couponId is onDelete: SetNull
(prisma/schema.prisma:1015), erasing discount attribution from history.
Fix: per-customer limit (CouponRedemption join model @@unique([couponId,userId,orderId]) or a
perUserLimit column), validate + increment inside the order transaction as a conditional
updateMany (where usedCount < maxUses; count===0 means exhausted), decrement on cancel/refund, and
replace DELETE with deactivate once usedCount > 0.

Acceptance: a concurrency test firing N simultaneous checkouts against a maxUses=1 coupon results
in exactly one redemption; a redeemed-then-cancelled order returns the slot; redeeming coins
produces a spendable instrument whose value equals coins x coinValueTk to the poisha.
Finish with superpowers:requesting-code-review then superpowers:verification-before-completion.
```

### → Analytics Reporter (WS-8: Management & Admin Reporting Depth)
```
Repo: C:/Users/MORSHED/Desktop/MAD/repo
Start with superpowers:writing-plans, then superpowers:subagent-driven-development (the report
tasks are largely independent), then superpowers:test-driven-development.

Two blockers on the two reports management would use daily:
1. lib/services/management.ts:33 buildReport(type) takes NO filter argument. The sales case
   hardcodes createdAt >= daysAgo(30) grouped by calendar day — no weekly/monthly/yearly rollup,
   no date range, no branch filter. components/management/report-view.tsx:12-14 and
   app/api/management/export/route.ts:18-25 both call buildReport(type) with nothing to pass.
   lib/utils/dates.ts exposes only startOfToday/endOfToday/daysAgo/weekBounds.
2. Export is CSV-only. The route always returns text/csv and the `format` query param is read
   nowhere; the exports page hardcodes format=csv per report. PDF or Excel is explicitly required.

Deliver: a ReportFilters argument (period: day|week|month|year|custom, from/to, branchId) applied
to every case in the buildReport switch, backed by new monthBounds()/yearBounds() helpers in
lib/utils/dates.ts — these MUST use the Asia/Dhaka boundaries produced by WS-9.1, not setHours.
Surface as a segmented control + branch select on ManagementReportView reading searchParams, and
forward both to the export route. Add an xlsx branch (exceljs) and a pdf branch to
app/api/management/export/route.ts honouring `format`, with buttons on the exports page and in the
report header. Add bn+en keys for any new column (messages/*.json have exact 3063-key parity).

Acceptance: the same period+branch selection produces byte-identical numbers in the HTML view, the
CSV, the XLSX and the PDF; a yearly report over a seeded multi-branch dataset reconciles against
the accounts reports page.
Finish with superpowers:requesting-code-review then superpowers:verification-before-completion.
```

### → Cultural Intelligence Strategist (WS-9.1: Asia/Dhaka business day) — Wave 1 slice
```
Repo: C:/Users/MORSHED/Desktop/MAD/repo
Start with superpowers:systematic-debugging — reproduce the shift first: set TZ=UTC, seed an order
at 02:00 Dhaka, and show it landing in the PREVIOUS day's "today's sales". Then
superpowers:test-driven-development.
Pair with DevOps Automator for the deploy-side change.

lib/utils/dates.ts:4-27 computes startOfToday/endOfToday/midnight/daysAgo/weekBounds with plain
d.setHours(0,0,0,0) — the SERVER's local timezone — while lib/i18n/format.ts:18 renders every
timestamp in Asia/Dhaka. Nothing pins TZ: ecosystem.config.cjs's env block has only
NODE_ENV/PORT/HOSTNAME/LD_LIBRARY_PATH, and TZ is absent from .env.example. On a UTC host the
business day runs 06:00 Dhaka to 06:00 Dhaka. Consumers: lib/services/dashboards.ts:107 (today's
sales/orders/cancellations), :265, :344, :408-415, lib/services/branch-ops.ts:119-121 and
lib/services/riders.ts:49-63 (the UNIQUE attendance/duty DAY KEY — a rider clocking in at 01:00
Dhaka writes a row keyed to yesterday, then a second row at 07:00), lib/selectors/index.ts:340,
app/api/attendance/route.ts:22, and all four admin report pages. A THIRD convention coexists:
Ramadan and settlement dates are stored at UTC midnight (prisma/schema.prisma:1284, 1293).

Deliver: rewrite lib/utils/dates.ts to derive day boundaries in Asia/Dhaka (compute the Dhaka
Y/M/D via Intl.DateTimeFormat, then build the UTC instant for that local midnight) — do NOT use
setHours. Add monthBounds()/yearBounds() while you are there (WS-8.1 depends on them). Pick ONE
convention for stored day keys, migrate the other, and document the choice in the schema comment.
Add TZ: "Asia/Dhaka" to the env block of ecosystem.config.cjs and document it in .env.example.
Do not change lib/services/branch-hours.ts:86 — nowMinutesInDhaka is already correct.

Acceptance: with the process TZ forced to UTC, an order created at 02:00 Dhaka appears in that
Dhaka day's sales report, and a rider clocking in at 01:00 and 07:00 Dhaka produces exactly one
attendance row. Add a unit test that pins process.env.TZ to prove it.
Finish with superpowers:requesting-code-review then superpowers:verification-before-completion.
```

---

## 6. Definition of done

No workstream merges without all five gates green. The **verifier is never the implementer.**

| Gate | Command / check | Verified by |
|---|---|---|
| Lint | `npm run lint` — zero new errors or warnings | Code Reviewer |
| Types + build | `npm run build` (Next 16, webpack) completes with no type errors | Code Reviewer |
| Schema | `npx prisma migrate dev` applies cleanly from an empty DB; every new column has a migration file; no `prisma db push` drift | Database Optimizer |
| E2E | `npm run test:e2e:prepare && npm run test:e2e` — the full 72-spec suite green, **plus at least one new PAGE-LEVEL spec per workstream** (`page.goto` + clicks, never `request.post` only — the manual-bKash and order-cancel gaps both shipped green precisely because the specs were API-only) | API Tester + Reality Checker |
| i18n parity | `messages/bn.json` and `messages/en.json` still flatten to identical key sets with zero one-sided keys; every new user-facing string exists in both, and the Bangla is native copy not machine output | Language Translator |

Additional per-workstream gates:

- **WS-1, WS-2, WS-7** — a **Financial Analyst** reconciliation pass: for one seeded branch-day
  containing an order, a refund, a coupon, a redeemed-coin discount, a commission and an expense,
  the order total, the invoice, the accounts report, the settlement and the management finance
  report must all agree to the poisha. No float arithmetic in any money path.
- **WS-1, WS-3** — an **Application Security Engineer** review plus a **Penetration Tester** pass on
  every new route: no client-asserted payment outcome, no enumeration or brute-force path on OTP,
  no secret in a `NEXT_PUBLIC_` variable.
- **WS-4** — a **GIS QA Engineer** coverage regression: `tests/e2e/26-nearest-branch-checkout.spec.ts`,
  `41-login-zone-ordering.spec.ts` and `42-gps-and-maps.spec.ts` green, plus new cases for
  in-zone / out-of-zone / covered-but-closed / no-fix, and a rejection case for a forged coordinate.
- **WS-9** — a **Performance Benchmarker** budget: a 20-product branch menu must transfer under
  1.5 MB on a simulated 3G profile, and a unit test pinning `process.env.TZ=UTC` must prove the
  Dhaka day boundary.
- **Every workstream** — finish with `superpowers:finishing-a-development-branch` and update the
  corresponding rows in this table plus the scoreboard in `docs/PROJECT_UNDERSTANDING.md`.
