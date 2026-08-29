# MAD DELIVERY HQ — Handover

> Everything a new developer or a client's engineering team needs to run, understand,
> operate and extend this system. Written against the `production-hardening` branch.
> Companion documents: [`SECURITY.md`](./SECURITY.md),
> [`REQUIREMENTS_ROLES.md`](./REQUIREMENTS_ROLES.md),
> [`PROJECT_UNDERSTANDING.md`](./PROJECT_UNDERSTANDING.md),
> [`WORK_ASSIGNMENT.md`](./WORK_ASSIGNMENT.md).

---

## 1. What this system is

MAD DELIVERY HQ is a multi-branch, multi-brand food-delivery and restaurant-operations
platform built for Bangladesh (Dhaka). Two restaurant brands — **Cheez!** and **Madchef** —
operate out of shared branch records. Each branch owns its own menu, its own delivery
geometry, its own riders, its own dining tables and its own Ramadan iftar programme.

It is a **single Next.js application**. The public storefront, the login flows, all seven
role dashboards and the entire API are served by one Node process. There is no separate
backend service, no message queue, no cron daemon and no worker tier.

Money is Taka. The default interface language is Bangla. The business day starts at
midnight in Dhaka. These three facts shape more of the codebase than anything else — see
[§8 Bangladesh-specific behaviour](#8-bangladesh-specific-behaviour-read-this-before-you-write-code).

### The seven roles

The role strings used everywhere in code are snake_case and are defined in
`lib/constants/index.ts`.

| Role | Identifier | What this person does |
| --- | --- | --- |
| Super Admin | `super_admin` | Platform owner. Approves or rejects every staff account, blocks fraudulent customers, puts a branch or a product on hold, owns the product-category taxonomy, sets rider commission and the reward-coin value, configures tax and service-charge rates, sends notices, and sees every complaint from every role. Bypasses the per-section route gates. |
| Branch Manager | `branch_manager` | Runs one outlet. Works the live order board (poll + audible alert), drives an order through all seven kitchen/delivery statuses, assigns riders, manages the branch catalogue, draws delivery zones and areas, sets delivery hours, handles table reservations and the Ramadan programme, marks attendance, and files/receives complaints. |
| Rider | `rider` | Goes on duty at a branch, accepts or rejects assignment offers, drives the delivery leg (`picked_up` → `on_the_way` → `delivered`), can flag `delayed` with extra minutes or cancel with a reason, streams GPS while on duty, accrues per-delivery commission, requests withdrawals, marks attendance, and has a complaint inbox. |
| Customer | `customer` | Browses branch-scoped menus, picks a delivery point on a map, checks out with server-side pricing, tracks the order and the assigned rider, keeps an address book, earns and redeems reward coins, reviews rider and food, and files complaints. Signs in by username, email or Bangladeshi phone (password or SMS OTP). |
| Accounts | `accounts` | Owns money end to end: payments and their verification, refunds, expenses, manual adjustments, rider commission rules and ledger, withdrawal approval and payment, invoices, end-of-day branch settlements, the deductions/VAT report, and the financial audit log. |
| Marketing | `marketing` | Coupons, campaigns, audience segments, targeted notification sends, and per-campaign sent/opened/clicked/conversion reporting. |
| Management | `management` | Read-only executive layer. Sales, orders, branches, riders, customers, finance, expenses, withdrawals, marketing, delivery, attendance, inventory and complaint reports with period and branch filters, plus CSV/XLSX/PDF export. |

The client's original, verbatim role requirements are in
[`docs/REQUIREMENTS_ROLES.md`](./REQUIREMENTS_ROLES.md). That file is the scope contract; if
this document and that one disagree about intent, that one wins.

---

## 2. Quick start (Windows, one click)

```bat
setup.bat      :: run once
start.bat      :: run every time  (start.bat prod  builds and serves)
```

Then open <http://localhost:3000>.

`setup.bat` checks for Node.js, creates `.env` and `.env.local` from `.env.example` (it
never overwrites existing ones), installs dependencies, applies migrations, generates the
Prisma client and seeds demo data. `start.bat` refuses to run with a clear message if
`setup.bat` has not been run, pins `TZ=Asia/Dhaka` for the process, and starts the dev
server — or builds and serves with `start.bat prod`.

### Demo accounts

Every seeded account uses the same password: **`Admin12345@##`**

| Username | Email | Phone | Role |
| --- | --- | --- | --- |
| `super_admin` | superadmin@example.com | 01700000001 | Super Admin |
| `branch_manager` | branchmanager@example.com | 01700000004 | Branch Manager |
| `rider` | rider@example.com | 01700000006 | Rider |
| `customer` | customer@example.com | 01711111111 | Customer |
| `accounts` | accounts@example.com | 01700000005 | Accounts |
| `marketing` | marketing@example.com | 01700000003 | Marketing |
| `management` | management@example.com | 01700000002 | Management |

Plus `blocked_customer` (a blocked customer, so you can see block enforcement) and an
extra Super Admin created from the `ADMIN_*` variables (default `admin` / `Admin12345@##`).

**The sign-in field accepts any of three identifiers** — username, email address, or a
Bangladeshi mobile number in any written form (`01711111111`, `8801711111111`,
`+880 1711-111111`, or bare `1711111111`). Resolution is by input shape, in
`lib/auth/identity.ts`.

### What to expect on first run

- The homepage renders the public storefront. Sign in from `/login`.
- After login each role lands on its own dashboard; a **customer lands on `/` (the public
  homepage)**, because that is where the ordering flow starts. `/customer/dashboard` still
  exists and is reachable from navigation. See `ROLE_HOME` vs `ROLE_DASHBOARD` in
  `lib/constants/index.ts` — they are deliberately different maps.
- The UI is in **Bangla** by default. Switch to English from the language control.
- Every dashboard shows real seeded data: a Main Branch with a manager and rider, menu
  categories and products, orders in several states, rider commissions and withdrawals,
  reward rules and ledger entries, reviews, complaints, a notice, delivery time slots, a
  table reservation, Ramadan tables and a booking, a rider route trail and login history.
- **No external key is required.** With an empty optional-integration block you get a map
  fallback instead of Google Maps, dev OTP codes instead of real SMS, in-app notifications
  instead of push, and the manual record-and-verify payment flow instead of a live gateway.
  Nothing crashes and no feature disappears from the navigation. See [§7](#7-environment-variables).
- **The seed is idempotent.** Re-running `npm run seed` is safe.

---

## 3. Manual setup (macOS, Linux, CI)

`setup.bat` is a wrapper around these commands. Run them directly on any platform.

```bash
# 1. Environment. The Prisma CLI reads .env; the Next.js runtime reads .env.local.
#    You need BOTH.
cp .env.example .env
cp .env.example .env.local

# 2. Dependencies. `postinstall` runs `prisma generate` for you.
npm install

# 3. Database — creates prisma/dev.db (SQLite) and applies all 26 migrations.
npx prisma migrate deploy      # use `npx prisma migrate dev` when authoring a migration
npx prisma generate

# 4. Demo data (idempotent).
npm run seed

# 5. Run. Pin the timezone so the process clock agrees with the business day.
TZ=Asia/Dhaka npm run dev      # http://localhost:3000
```

Production build and serve:

```bash
TZ=Asia/Dhaka npm run build
TZ=Asia/Dhaka npm run start
```

End-to-end tests use a separate database and upload directory so they never touch your dev
data:

```bash
npm run test:e2e:prepare       # migrate + seed the test DB
npm run test:e2e               # playwright test
```

Both `dev` and `build` pass `--webpack` explicitly — this project does not use Turbopack.

---

## 4. Architecture

### 4.1 Topology

```
Browser ──► Nginx (TLS, Host/X-Forwarded-*) ──► Node: `next start` on 127.0.0.1:3200
                                                 │
                                                 ├─ proxy.ts        (Next 16 middleware: redirects only)
                                                 ├─ app/(dashboard) (162 Server Component pages)
                                                 ├─ app/api         (179 Route Handlers)
                                                 ├─ lib/api/actions (Server Actions for form mutations)
                                                 └─ Prisma ──► SQLite (dev) / PostgreSQL (prod)
```

One process. `ecosystem.config.cjs` is the PM2 definition: fork mode, one instance, bound
to `127.0.0.1:3200`, `TZ=Asia/Dhaka`, `max_memory_restart: 1G`, and `LD_LIBRARY_PATH`
pointing at the project-local libvips that `sharp` needs.

Real-time is **polling**, not sockets. `lib/hooks/use-live-data.ts` is the shared poller and
it pauses while the tab is hidden. Web Push (VAPID, `public/sw.js`, `lib/services/push.ts`)
is layered on top for lock-screen alerts when configured; the poll remains the fallback and
backs off from 5s to 30s only when a live push subscription is detected.

### 4.2 The request path

**A page request** (`GET /branch-manager/orders`):

1. `proxy.ts` runs. It redirects logged-out users to `/login`, redirects logged-in users
   away from auth pages, and keeps each role inside its own `ROUTE_ROLES` prefix.
   **This is UX only.** It deletes any `Set-Cookie` the Auth.js wrapper tries to add (see
   the long comment in `proxy.ts` — cookie rolling in middleware was resurrecting
   just-signed-out sessions).
2. The Server Component page calls `requireRole(...)` from `lib/auth/`, which is the real
   page-level gate.
3. The page calls a function in `lib/services/*` for its data. Authorization is expressed
   as a **where-clause builder** (`ordersWhereForUser`, `complaintsWhereForUser`,
   `productsForUser`, `employeeScope`) applied *inside* the Prisma query, not as a filter
   after the fact — so a role can never receive rows it then has to be trusted to drop.
4. HTML streams back. Money and dates are formatted through `lib/i18n/format.ts`.

**An API request** (`POST /api/orders`):

1. `proxy.ts` does **not** run — its matcher excludes `/api`.
2. The route handler calls `requireApiRole(...)`, parses and validates the body, and
   delegates to `lib/services/*`. **Validation is hand-rolled, not schema-driven** — the
   validators live in `lib/validation/server.ts` (`validatePhone`, `validateMoney`,
   `validateEnum`, `validateImage`, …) with shared bounds in `lib/validation/limits.ts` and
   mirrored client rules in `lib/validation/rules.ts`. `zod` is a dependency but is imported
   in exactly one file, `lib/http/errors.ts`, purely to catch `ZodError` in the error
   handler. Do not assume there are zod schemas to extend.
3. The service owns the rule, writes through Prisma (in a transaction where money or state
   machines are involved), and returns a serialized shape from `lib/serializers/`.

### 4.3 Where the business logic lives

`lib/services/` — **36 modules**. This is the most important structural decision in the
repo: route handlers parse and authorize, services own the rules, and the HTML page and the
JSON API call the *same* function, so a screen and its export cannot drift apart.

The ones you will read most:

| Module | Owns |
| --- | --- |
| `orders.ts` | Order pricing pipeline (the one money-rounding rule), branch resolution, status transitions. |
| `payments.ts` | Payment rails: cash, manual wallet (bKash/Nagad/Rocket), and the gateway driver seam. |
| `wallet.ts` | Rider earnings and the withdrawal lifecycle. |
| `financials.ts` | Expenses, period financials, end-of-day settlement, the deductions/VAT report (`splitCharges`). |
| `delivery.ts` | Coverage geometry and the single effective-delivery-fee resolver. |
| `customer-location.ts` | GPS fix trust windows, coordinate provenance, nearest eligible branch. |
| `rider-duty.ts` | `RiderBranchDutySession` — the single source of truth for rider duty. |
| `rider-location.ts` | Live position **and the rules for who may read it**. |
| `notifications.ts` | In-app notification creation and fan-out; the only caller of `push.ts`. |
| `settings.ts` | The `SystemSetting` key-value store: commission rates, tax/service-charge rates, company logo. |
| `management.ts` | Every management report, windowed and branch-filtered, plus export. |
| `ramadan.ts` | Ramadan config, menus, slots, reservations and advance payments. |

Supporting layers: `lib/selectors/` (role-scoped Prisma queries), `lib/serializers/`
(Prisma record → API JSON), `lib/validation/` (client + server rules), `lib/constants/`
(roles, routes, nav, order transitions, payment methods), `lib/auth/` (identity, OTP,
password reset, rate limiting, session guards), `lib/i18n/` (dictionary + formatters).

### 4.4 Data model at a glance

`prisma/schema.prisma` — **1,670 lines, 66 models, 26 migrations, and zero Prisma enums.**
Every status is a plain `String` validated in `lib/constants/enums.ts`. This is deliberate:
it keeps SQLite and PostgreSQL behaving identically and makes adding a status a code change
rather than a migration.

**58 `Decimal` columns** carry money (and, on a few models, coordinates). There are no
`Float` money columns.

The clusters:

| Cluster | Models |
| --- | --- |
| Identity | `User`, `PasswordResetToken`, `LoginHistory`, `PushSubscription` |
| Catalogue | `Category`, `Product`, `ProductVariation` |
| Branches | `Branch`, `BranchDeliveryZone`, `BranchDeliveryArea`, `BranchTable`, `DeliveryTimeSlot`, `BranchManagerAssignment`, `ManagerActivityLog` |
| Orders | `Order`, `OrderItem`, `OrderStatusEvent`, `OrderNumberCounter`, `RiderOrderAssignment`, `OrderReceiveConfirmation`, `OrderDeliveryChatThread`, `OrderDeliveryChatMessage` |
| Rider | `RiderProfile`, `RiderCommission`, `RiderWithdrawal`, `RiderRoutePoint`, `RiderDutyLog`, `RiderBranchDutySession`, `RiderDutyChatThread`, `RiderDutyChatMessage` |
| Money | `Refund`, `BranchExpense`, `BranchSettlement`, `FinancialAdjustment`, `FinancialAuditLog`, `SystemSetting` |
| Growth | `Campaign`, `CampaignEvent`, `Coupon`, `CouponRedemption`, `AudienceSegment`, `RewardRule`, `RewardEarningRule`, `RewardLedger`, `RewardRedemption` |
| Feedback | `RiderReview`, `FoodReview`, `Complaint`, `ComplaintMessage`, `Notification`, `Notice` |
| HR | `BranchEmployee`, `EmployeeTeam`, `EmployeeAttendance`, `StaffAttendance` |
| Front of house | `TableReservation`, `ReservationMessage` |
| Ramadan | `RamadanConfig`, `RamadanTimeSlot`, `RamadanMenu`, `RamadanMenuItem`, `RamadanReservation`, `RamadanReservationPayment`, plus the legacy `RamadanTable` / `RamadanBooking` (see [§10](#10-known-limitations-and-outstanding-work)) |
| Customer | `CustomerAddress` |

**Immutable snapshotting is used deliberately.** `OrderItem.unitPrice`, the product name on
the order line, `Order.deliveryCharge`, `Order.deliveryAreaName`,
`Order.deliveryRadiusKmSnapshot` and the advertised wallet destination number are all frozen
at write time, so editing a product or a delivery area later cannot rewrite what a customer
was charged or told.

### 4.5 Auth model

Auth.js / NextAuth v5 beta, JWT session strategy, **two Credentials providers**:

- the default provider — identifier (username **or** email **or** BD phone) + password,
  bcrypt-compared;
- a second provider with `id: "otp"` — BD phone + a 6-digit SMS code.

Both resolve to the same session shape, both require `isActive === true` and
`status === "approved"`, and both write a `LoginHistory` row.

Role and status ride in the JWT (`auth.config.ts`), which is what lets `proxy.ts` and every
route handler authorize without a database round trip. "Remember me" is enforced, not
decorative: the cookie is issued for 30 days, but if the box was not ticked the `jwt`
callback returns `null` after 24 hours, destroying the session.

Authorization is enforced **server-side in every route handler and every page**
(`requireApiRole` / `requireRole`). `proxy.ts` is a redirect layer only. Full detail is in
[`docs/SECURITY.md`](./SECURITY.md).

### 4.6 Internationalisation

A custom dictionary layer — no i18n library. `messages/bn.json` and `messages/en.json`
each flatten to **3,439 keys with exact parity and zero one-sided keys**. Bangla (`bn`) is
`DEFAULT_LOCALE`; English is secondary.

- Money and dates format through `lib/i18n/format.ts`, which pins
  `APP_TIME_ZONE = "Asia/Dhaka"` and implements Bengali numerals and `bn-BD` lakh/crore
  grouping.
- System notifications are **key-based**: rows store `titleKey` / `bodyKey` / `params`, not
  rendered text, and are translated to the *viewer's* locale at render time. A param value
  tagged `@:<key>` (e.g. `@:orderStatus.preparing`) is itself re-translated.
- `npm run check:i18n` (`scripts/check-i18n-params.mjs`) verifies that every key's declared
  `{placeholders}` match what call sites pass. TypeScript cannot catch that class of bug;
  this script exists because it shipped to users twice.

**Adding any user-facing string means adding it to both dictionaries.** The Bangla must be
real Bangla, not machine output.

### 4.7 Order lifecycle across roles

The transition graph is `ALLOWED_TRANSITIONS` in `lib/constants/orders.ts`; who may set
what is `BRANCH_MANAGER_SETTABLE` / `RIDER_SETTABLE` / `CUSTOMER_SETTABLE` in the same file.
Every transition is validated twice — lifecycle legality (→ 409) and role authority
(→ 403) — and writes an append-only `OrderStatusEvent` row inside the same transaction as
the update.

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant BM as Branch Manager
    participant R as Rider
    participant A as Accounts

    C->>BM: POST /api/orders — createOrder()
    Note right of C: resolveDeliveryBranch(cart + coords)<br/>client branch_id is IGNORED<br/>coverage + opening-hours checked<br/>server-side pricing, coupon, coins<br/>idempotency key
    Note over BM: status: pending<br/>live board polls + audible alert

    BM->>BM: accept → accepted
    BM->>BM: → preparing (cooking)
    BM->>BM: → ready

    BM->>R: assign rider (transaction)
    Note right of BM: approved + online<br/>ACTIVE duty session for THIS branch<br/>server-computed distance<br/>supersedes prior offers
    R-->>BM: accept / reject with reason

    R->>C: → picked_up (opens delivery chat)
    R->>C: → on_the_way
    opt running late
        R->>C: → delayed (+ extra minutes, 5–240)
        R->>C: → on_the_way
    end
    R->>C: → delivered

    Note over R,A: recordRiderCommission()<br/>idempotent on RiderCommission.orderId
    C->>C: rate rider + review food (gated on delivered)
    R->>A: withdrawal request
    A-->>R: approve / reject / pay (FinancialAuditLog)
    BM->>A: end of day
    A->>A: generateSettlement()<br/>net = sales − commission − expenses − refunds ± adjustments
```

`cancelled` is reachable from every open state, always requires a reason, and is terminal.
`delayed` is the one non-terminal detour and never dead-ends.

---

## 5. Repository map

```
mad-delivery-hq/
├── app/
│   ├── (auth)/                 register (7 role forms), forgot-password, forgot-password/reset,
│   │                           login/otp, registration-pending
│   ├── (auth-full)/login/      the login page (full-bleed layout)
│   ├── (dashboard)/            162 pages — admin/ branch-manager/ management/ accounts/
│   │                           rider/ customer/ marketing/ + shared complaints/ profile/
│   │                           change-password/
│   ├── api/                    179 Route Handlers — this IS the backend
│   ├── page.tsx                public storefront homepage
│   ├── layout.tsx  globals.css  robots.ts  sitemap.ts  not-found.tsx  global-error.tsx
├── components/                 28 folders: per-role UI plus ui/ common/ forms/ layout/ maps/
├── lib/
│   ├── services/               36 modules — ALL business logic lives here
│   ├── selectors/              role-scoped Prisma where-clause builders
│   ├── serializers/            Prisma record → API JSON
│   ├── auth/                   identity, otp, password-reset, tokens, phone, rate-limit,
│   │                           sms, session, current-user, actions, login-destination
│   ├── api/actions.ts          Server Actions for form mutations
│   ├── constants/              index.ts (roles/routes/nav/payment rails), enums.ts, orders.ts
│   ├── validation/             limits.ts (BD_PHONE_RE, money), rules.ts (client), server.ts
│   ├── i18n/                   dictionary loader + format.ts (APP_TIME_ZONE, bn-BD numerals)
│   ├── utils/dates.ts          THE Asia/Dhaka business-day boundary
│   ├── http/                   errors, upload, list-params, respond
│   └── db/  hooks/  cache/  seo/  theme/  upload/  home/  dashboard/  delivery-areas/
├── prisma/
│   ├── schema.prisma           66 models, 58 Decimal columns, no enums
│   ├── migrations/             26 migrations, init → 20260829123921_high_severity_gaps
│   ├── seed.ts                 idempotent demo data
│   └── dev.db                  SQLite dev database (gitignored)
├── messages/                   bn.json + en.json — 3,439 keys each, exact parity
├── public/                     brand art (WebP/SVG) + sw.js (push service worker)
├── storage/uploads/            runtime uploads (gitignored; served via /api/uploads)
├── scripts/                    check-i18n-params, convert-images-to-webp,
│                               ensure-test-db, with-test-db
├── tests/e2e/                  72 Playwright specs (65 top level + 7 in full-page-audit/)
├── types/                      shared TS types + next-auth module augmentation
├── docs/                       this file, SECURITY.md, requirements, audits/, superpowers/
├── auth.ts  auth.config.ts     Auth.js (Node + edge-safe split)
├── proxy.ts                    Next 16 middleware — redirects only, never security
├── ecosystem.config.cjs        PM2 production process definition
├── next.config.ts              image optimizer allow-list, Server Action body limits
├── setup.bat  start.bat        one-click Windows setup / run
└── AGENTS.md                   ⚠ read this — Next.js 16 has breaking changes vs. older docs
```

---

## 6. Verification commands

Run all five before you propose a change. They are the merge gate.

```bash
npm run lint            # eslint
npm run check:i18n      # i18n key/placeholder parity — TypeScript cannot catch this class
npx tsc --noEmit        # type check
npm run build           # next build --webpack
npm run test:e2e        # after: npm run test:e2e:prepare
```

All five were green at the last sprint commit **except** the four e2e specs listed in
[§10.2](#102-four-playwright-specs-assert-superseded-contracts).

---

## 7. Environment variables

`.env.example` is the source of truth and is heavily commented. Copy it to **both** `.env`
(read by the Prisma CLI) and `.env.local` (read by the Next.js runtime).

**The design rule for this repo: every external integration degrades gracefully.** With an
empty optional block the app is fully functional — nothing crashes, nothing 500s, no
feature vanishes from the navigation. Each integration resolves its driver *at call time*
from the environment and returns a null/demo driver when unconfigured. A **half-filled**
credential block is refused with a loud server-log warning rather than half working, so a
misconfigured production deploy is visible instead of silently swallowing payments or codes.

### Required

| Variable | Purpose | Behaviour when unset |
| --- | --- | --- |
| `DATABASE_URL` | Prisma connection string. Dev default `file:./dev.db` (SQLite). | Prisma cannot connect. The CLI and every database call fail. `setup.bat` supplies the SQLite default by copying `.env.example`. |
| `AUTH_SECRET` | Signs and verifies the session JWT (Auth.js). Generate with `npx auth secret` or `openssl rand -base64 32`. | Auth.js raises `MissingSecret` and **no one can sign in**. Changing it invalidates every existing session — that is the intended way to force a global logout. |
| `AUTH_TRUST_HOST` | `true`. Tells Auth.js to derive the app origin from the request's `Host` / `X-Forwarded-*` headers instead of a hardcoded URL. | Auth.js raises `UntrustedHost` and refuses the request. Leave `AUTH_URL` / `NEXTAUTH_URL` **unset** so login works on every deployment URL. |
| `ADMIN_USERNAME`<br/>`ADMIN_EMAIL`<br/>`ADMIN_PASSWORD` | The default Super Admin that `npm run seed` creates. | The seed cannot create the bootstrap Super Admin. **`.env.example` ships a real, working password (`Admin12345@##`) for this account and that file is in version control** — any deployment that seeds without changing it has a publicly known super-admin credential. Set your own values before the first production seed. See [`SECURITY.md`](./SECURITY.md). |

### File uploads

| Variable | Purpose | Behaviour when unset |
| --- | --- | --- |
| `UPLOAD_DIR` | Runtime directory that uploaded images are written to (relative to the app cwd, or absolute). Files are stored here — **not** in `public/` — and served by the `/api/uploads/[...path]` route. | Defaults to `storage/uploads`. In production this **must** point at a persistent, writable disk, or every upload is lost on redeploy. `next start` serves `public/` from a build-time snapshot, so files written there after the build 404 — that is why this directory exists. |
| `NEXT_PUBLIC_UPLOAD_BASE_URL` | Optional S3/R2/CDN base. When set, upload URLs become `${BASE}/<key>` and `next.config.ts` derives an image-optimizer `remotePatterns` allow-list from the same value. | Uploads are served same-origin through the internal `/api/uploads` route. A malformed value degrades to "no remote images" rather than failing the boot. |

### Optional integrations

| Variable(s) | Purpose | Behaviour when unset |
| --- | --- | --- |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Renders the actual map surface in `components/maps/map-picker.tsx` (draggable pin), the branch zone editor and the live rider fleet map. | The map canvas is replaced by a fallback panel. **The picker's address search still works**, because it runs against the app's own `/api/geo/search` endpoint rather than a browser Maps library — see the note below. Coverage checks, distance maths and branch resolution are all server-side and unaffected. |
| `GOOGLE_MAPS_SERVER_API_KEY` | Server-side geocoding and reverse geocoding (`lib/services/geo.ts`), used by `/api/geo/search` and `/api/geo/reverse`. Not listed in `.env.example`; set it when you want a server key separate from (and more tightly restricted than) the browser key. | Falls back to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. If that is also unset, geocoding is unavailable and the customer falls back to the pin or a stored address. |
| `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_API_URL`, `TWILIO_ACCOUNT_SID` | OTP login and password-reset link delivery. Providers implemented in `lib/auth/sms.ts`: `bulksmsbd`, `ssl_wireless`, `twilio`. `SMS_API_URL` overrides an adapter's endpoint (BD gateways move theirs between plans). | The **demo driver**: the message is logged server-side and nothing is transmitted. Outside production the OTP request response carries the code and the reset request returns a `demoLink`, so both flows are fully testable with no gateway. In production those are always withheld. A driver **never throws** — a gateway outage degrades the flow, it does not crash the request. |
| `PAYMENT_GATEWAY_PROVIDER` | Which rail the online gateway uses. Defaults to `bkash`. Only `bkash` has a working driver; `nagad`, `rocket` and `sslcommerz` are declared stubs. | Defaults to `bkash`. |
| `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` | bKash Tokenized Checkout merchant credentials. **All four are required together.** | No "Pay online" button. Cash-on-delivery and the manual record-and-verify wallet flow keep working unchanged. A partially filled block logs a warning and stays disabled rather than half working. Never commit real values. |
| `BKASH_BASE_URL` | bKash API base, no trailing slash. Sandbox `https://tokenized.sandbox.bka.sh/v1.2.0-beta`; live `https://tokenized.pay.bka.sh/v1.2.0-beta`. | **Defaults to sandbox.** Production must set the live URL explicitly — the code never guesses "live" for a merchant. |
| `NAGAD_MERCHANT_ID`, `NAGAD_MERCHANT_PRIVATE_KEY`, `NAGAD_PUBLIC_KEY` | Reserved for the online Nagad driver. Not in `.env.example`. | The online Nagad driver **is not implemented** (`lib/services/payments.ts` documents why). Setting these logs a warning once so the situation is visible; Nagad customers use the manual rail, which is a complete path. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push for riders (new delivery requests, announcements) and customers (order status). **All three are required together.** Generate once with `npx web-push generate-vapid-keys`; `VAPID_SUBJECT` must be a `mailto:` address or an `https:` URL. | Push is silently off: no service-worker subscription, no permission prompt. In-app notifications and the bell work exactly as before. Rotating the keys invalidates stored subscriptions; browsers re-subscribe on the next visit and `lib/services/push.ts` prunes dead endpoints on 404/410. Push needs a **secure origin** — https in production, or localhost in dev. |
| `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | Placeholders for cloud object storage. **Not read by any code today** — wire a provider in `lib/http/upload.ts` first. | Uploads go to the local `UPLOAD_DIR`. |

### Build / test only

`NEXT_DIST_DIR` (isolated build output — the e2e gate uses `.next-e2e`), `E2E_DATABASE_URL`,
`E2E_UPLOAD_DIR`, `E2E_PORT`, `E2E_OUTPUT_DIR`, `E2E_REPORT_DIR`, `PLAYWRIGHT_BASE_URL`,
`CI`, `PORT`, `HOSTNAME`, `NODE_ENV`, `TZ`, `LD_LIBRARY_PATH`.

---

## 8. Bangladesh-specific behaviour (read this before you write code)

These five behaviours are not preferences. They are correctness requirements, and each one
was a real production bug at some point in this project's history.

### 8.1 Asia/Dhaka is the single business-day boundary

`lib/utils/dates.ts` is the only definition of "a day" in this system.

**Why it matters.** On a UTC cloud host, local midnight is 06:00 in Dhaka. Before this was
fixed, every "today's sales", "today's orders" and "today's cancelled orders" figure was a
6am-to-6am window, orders placed between 00:00 and 06:00 Dhaka were filed under the previous
day, and a once-per-day key — the daily-login reward coin, a rider's attendance row — could
be claimed twice inside one Dhaka day.

**How it works.** Day boundaries are derived from the Dhaka wall clock through
`Intl.DateTimeFormat` with `timeZone: "Asia/Dhaka"` and `hourCycle: "h23"` — never
`setHours()`, never `toISOString()`. The zone constant is imported from
`lib/i18n/format.ts` (the display side already pins it) so the app never carries two copies
of the answer. There is a fixed +06:00 fallback for runtimes with a stripped-down ICU build.

**What to use.** `dhakaDayKey`, `dhakaMidnight`, `dhakaDayEnd`, `dhakaAddDays`,
`dhakaWeekBounds`, `dhakaMonthBounds`, `dhakaYearBounds`, `dhakaDayStartFromKey`,
`dhakaDayEndFromKey`. The legacy names `startOfToday`, `endOfToday`, `midnight`, `daysAgo`,
`weekBounds` and `isoDate` still exist with identical signatures and are simply re-pointed
at the Dhaka-correct implementations, so no caller needed editing.

**The rule.** Any new report window, attendance key, reward key or settlement bucket goes
through this module. If you find yourself writing `new Date().setHours(0,0,0,0)`, stop.

`dhakaDayStartFromKey` round-trips its result, so a hand-crafted query string like
`2026-02-31` is rejected instead of silently rolling forward to 3 March and reporting on a
day nobody asked for.

Twenty-one code files import this module: ten services, eight accounts/attendance API
routes and seven dashboard pages.

### 8.2 BDT money is Prisma `Decimal` end to end — never a JS float

58 `Decimal` columns; no `Float` money columns. Order pricing in `lib/services/orders.ts`
is exact `Prisma.Decimal` arithmetic.

**One rounding boundary, stated once.** The **unit price** is rounded to two decimal places
(one paisa), `ROUND_HALF_UP`, exactly once — at the only step that produces sub-paisa
precision, a percentage discount. Everything after it is a sum or difference of 2dp values,
which Decimal keeps exact, so nothing else rounds. Rounding the *unit* rather than the line
total is what makes an invoice add up: the customer reads `unit × qty` and it equals the
line the ledger stores.

The helpers (`toPaisa`, `zero`, `notBelowZero`, `discountedUnit`) are module-private in
`lib/services/orders.ts`, which declares itself the owner of the rule. There is no
`lib/utils/money.ts` — do not create a second one.

**Why it matters commercially:** float paisa drift does not reconcile against a bKash
settlement report, and an invoice whose lines do not sum to its total is a dispute the
business cannot win.

Two documented float leaks remain, both display-side or hand-off-side and both flagged in
code: `claimCouponForOrder` takes a `number` subtotal (the returned value is re-`toPaisa`'d),
and `lib/serializers/index.ts` converts through `toNumber().toFixed(2)` at the API output
boundary and re-implements percentage discount in floats for `discountedPrice`. Neither
touches a stored figure. Both are worth closing.

### 8.3 VAT and service charge are EXTRACTED, never added on top

**The convention.** In Bangladesh the shelf price is what the customer pays — VAT and the
house service charge are already inside it. So `Order.totalAmount` is
`items + delivery − coupon discount − coin discount` and **nothing is added on top**.

The configured rates are therefore *extraction* rates: they say what proportion of money
already recorded is tax and service charge. Adding them to a total would report revenue the
till never saw.

**Naming.** There is no identifier called `vat` anywhere. The concept is spelled `tax` in
code; "VAT" appears only in comments and translated strings.

**Where the rates live.** `SystemSetting` rows, not schema columns —
`tax_rate_percent` and `service_charge_percent`, both defaulting to `0.00`, read through
`chargeRates()` in `lib/services/settings.ts` and edited only via
`PUT /api/admin/settings/charges` (super admin, which also refuses `tax + service >= 100`).

**Where the split happens.** `splitCharges()` in `lib/services/financials.ts` — the single
implementation:

```
net = base × 100 / (100 + taxPercent + servicePercent)
tax          = net × taxPercent / 100      (rounded to the paisa)
serviceCharge = net × servicePercent / 100 (rounded to the paisa)
net          = base − tax − serviceCharge  (the RESIDUAL)
```

Taking net as the residual is what makes `net + tax + service === base` exactly at every
level of aggregation — no rounding crumb is ever left unattributed. It is applied **per
order**, never to a pre-summed total, so the branch-wise table, the period table and a
single invoice all report the identical figure.

The base is the **food slice only**: `totalAmount − deliveryCharge`. A delivery charge funds
the rider and the route; VAT on a discount the customer never paid would be tax on money
that does not exist.

No tax or service-charge columns exist in the schema — the values are derived on read. The
invoice renders the split as a memo under the total, never added to it.

### 8.4 BD phone normalization

`User.phone` stores exactly one shape: `01XXXXXXXXX`, validated by
`BD_PHONE_RE = /^01[3-9]\d{8}$/` in `lib/validation/limits.ts` — 11 digits, operator
prefixes 013–019. The same regex is enforced client-side and server-side.

`normalizeBdPhone()` in `lib/auth/phone.ts` reduces any written form to that shape: it
strips all non-digits (`+`, spaces, dashes, parentheses), removes a `00880` or `880` country
code, re-adds the trunk zero if the number was typed without it, and returns `""` when the
result is not a valid BD mobile number.

**Contract:** `""` means "not a phone number" and must never be used as a lookup value —
`User.phone` defaults to `""` for the many accounts that have none, so a blank lookup would
match half the table.

There is a second, deliberately different normalizer:
`normalizeBdPhoneForSearch()` in `lib/validation/server.ts` reduces a number to its national
significant digits for a `contains` search (so a partial `0171` matches). It is lossy and
must never be used as an exact key.

Login resolves by input **shape**, in order, in `lib/auth/identity.ts`: phone → email →
username. Soft-deleted accounts are excluded at every step. If someone registered the
username `01711111111`, a phone-shaped login still resolves to the account that *owns* that
number, and only falls through to the username match when no account holds it.

### 8.5 The address picker geocodes on the server, not in the browser

Worth knowing because it is easy to "fix" by mistake. `components/maps/map-picker.tsx`
does **not** use Google Places Autocomplete. Its search box is debounced and posts to the
app's own `/api/geo/search`; reverse geocoding of a dragged pin goes to `/api/geo/reverse`.
Only the map *canvas* uses the browser Maps SDK.

Three consequences:

- The Google key used for geocoding **stays on the server** and can be IP-restricted
  separately from the public browser key.
- Both endpoints are rate limited per user (60/min reverse, 40/min search — see
  [`SECURITY.md` §2.5](./SECURITY.md#25-rate-limiting)), so a typing loop cannot run up a
  Maps bill.
- **The search still works with no browser key at all**, which is what keeps the graceful
  degradation honest: the customer loses the map picture, not the ability to find their
  address.

### 8.6 Payment rails and the default language

- **Rails.** `PAYMENT_METHOD_DEFS` in `lib/constants/index.ts` is the single catalogue:
  `cash` (COD) plus the three mobile-financial-service wallets `bkash`, `nagad`, `rocket`.
  All three wallets have a complete **manual record-and-verify** path (customer sends money
  to the branch's number out of band, submits the TrxID, staff verify). bKash additionally
  has a working **online gateway** (Tokenized Checkout). Nagad, Rocket and SSLCommerz are
  declared driver stubs — `lib/services/payments.ts` explains at length why an unverified
  Nagad integration is worse than none.
- **Schema quirk to know about:** the schema is frozen, so bKash owns three real `Branch`
  columns (`bkashNumber` / `bkashEnabled` / `bkashInstructions`) while Nagad and Rocket keep
  the same settings in namespaced `SystemSetting` keys, hidden behind one reader,
  `branchWalletConfig()`. On `Order`, the three `bkash*` columns are used **generically** for
  any wallet — `Order.paymentMethod` is what says which one. Both are recorded as follow-up
  migrations.
- **Language.** Bangla is the default. English is the secondary locale, not the source of
  truth. Noto Sans Bengali is the first font in `--font-sans`. Bengali numerals and `bn-BD`
  lakh/crore grouping are implemented in `lib/i18n/format.ts`.

---

## 9. Deployment

### 9.1 SQLite → PostgreSQL

SQLite is a development convenience. The schema is written to be PostgreSQL-shaped: no
Prisma enums, `Decimal` for money, `DateTime` for instants, and no SQLite-specific types.

1. In `prisma/schema.prisma`, change the datasource:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. Set `DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/mad_delivery?schema=public"` in
   both `.env` and `.env.local`.
3. **Regenerate the migration history against PostgreSQL.** The 26 existing migrations were
   authored against SQLite and their SQL is not portable. On an empty Postgres database,
   either squash to a fresh baseline (`prisma migrate dev --name init` against the new
   provider) or use `prisma db push` once and then `prisma migrate diff` to capture a
   baseline. Do not assume `prisma migrate deploy` will replay the SQLite migrations.
4. Consider adding explicit precision to money columns while you are there —
   `@db.Decimal(12, 2)`. The current schema carries no `@db.Decimal` annotations because
   SQLite ignores them; PostgreSQL does not, and an unannotated `Decimal` gets Prisma's
   default `Decimal(65,30)`.
5. Migrate the data itself separately. `prisma/dev.db` is demo data; a real cutover needs
   its own export/import plan.
6. Run `npx prisma migrate deploy` on every release thereafter.

### 9.2 Process environment

```bash
TZ=Asia/Dhaka
NODE_ENV=production
```

`lib/utils/dates.ts` resolves Asia/Dhaka explicitly and does **not** depend on `TZ`. Pin it
anyway: log timestamps, third-party libraries and any future code that reads the server-local
clock will then agree with what the UI shows instead of drifting six hours.
`ecosystem.config.cjs` already sets it; `start.bat` sets it; set it in your own runner too.

### 9.3 Reverse proxy

The app derives its own origin from request headers — `AUTH_TRUST_HOST=true` with
`AUTH_URL` and `NEXTAUTH_URL` deliberately **unset**, so sign-in works on every deployment
URL without reconfiguration. Your proxy must forward:

- `Host`
- `X-Forwarded-Host`
- `X-Forwarded-Proto`

If `X-Forwarded-Proto` is missing or wrong, Auth.js builds `http://` callback URLs behind
your TLS terminator and login breaks in ways that look like a cookie bug.

Nginx sketch:

```nginx
location / {
    proxy_pass         http://127.0.0.1:3200;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-Host  $host;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   Upgrade           $http_upgrade;
    proxy_set_header   Connection        "upgrade";
    client_max_body_size 50m;   # matches next.config.ts Server Action limits
}
```

### 9.4 Storage

`UPLOAD_DIR` must be a **persistent, writable** disk — a mounted volume, not a container's
ephemeral filesystem, and not `public/`. Uploads are validated (`image/jpeg`, `image/png`,
`image/webp`, `image/avif`, max 5 MB), converted to WebP by sharp with EXIF baked in and
metadata stripped, stored as `<subdir>/<uuid>.webp`, and served by
`/api/uploads/[...path]`. Legacy `/uploads/...` values still resolve from `public/` for
backward compatibility.

For serverless or multi-instance hosting, set `NEXT_PUBLIC_UPLOAD_BASE_URL` to an object
store and push files there from `lib/http/upload.ts` — the only place in the codebase that
writes the filesystem.

`sharp` needs libvips at runtime. On the reference host that is handled by
`LD_LIBRARY_PATH` in `ecosystem.config.cjs`, pointing at the project-local
`@img/sharp-libvips-linux-x64`.

### 9.5 Secrets

Generate `AUTH_SECRET` **per environment**:

```bash
npx auth secret
# or
openssl rand -base64 32
```

Never reuse it between staging and production; never commit it. `.env` and `.env.*` are
gitignored (`.env.example` is the one exception). Rotating it logs everyone out — which is
the correct response to a suspected leak.

### 9.6 Multi-instance caveats

The current deployment is one Node process, and two components assume that:

- **Rate limiting** (`lib/auth/rate-limit.ts`) is an in-process fixed-window `Map`. With N
  instances the effective allowance becomes `limit × N`, and counters reset on restart.
- **OTP challenges** (`lib/auth/otp.ts`) live in an in-process `Map`, so a code is only
  verifiable on the instance that issued it.

Before scaling horizontally, move both to Redis (or add an `OtpChallenge` model). Both files
say so in their headers.

---

## 10. Operational runbook

### Migrations

```bash
npx prisma migrate deploy        # apply pending migrations (production / CI)
npx prisma migrate dev           # author a new migration (development)
npm run db:reset                 # DESTRUCTIVE — drop, re-migrate, re-seed
npx prisma studio                # browse the database
```

Every schema change needs a migration file. `prisma db push` drift is not acceptable —
it is an explicit gate in `docs/WORK_ASSIGNMENT.md` §6.

### Seeding

```bash
npm run seed                     # idempotent; safe to re-run
```

The seed upserts by username, so re-running it will not duplicate accounts. It creates the
demo staff and customers, a Main Branch with a manager and rider, categories and products,
orders across the lifecycle, commissions and withdrawals, reward rules and ledger rows,
reviews, complaints, a notice and notifications, delivery time slots, a table reservation,
Ramadan tables and a booking, a rider route trail and login history.

### Creating the first Super Admin

On a fresh environment, set `ADMIN_USERNAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`
and run `npm run seed`. That upserts a single `super_admin` with `status: "approved"` and
`isActive: true`.

Thereafter, every staff account is created by a Super Admin at `/admin/users/create` and
starts as **pending** until approved. Public registration creates **customer** accounts only,
and those are auto-approved. Pending, rejected and blocked users cannot reach any protected
page or API.

Change `ADMIN_PASSWORD` away from the example value before the first production seed.

### Where uploads live

Runtime uploads: `UPLOAD_DIR` (default `storage/uploads`), gitignored, served through
`/api/uploads/[...path]`. Public subdirectories (`products`, `branch_logos`, `branding`,
`ramadan_menus`) are additionally listed in `next.config.ts` `images.localPatterns` so the
image optimizer can fetch them. **Private folders — `profile_photos`, `employee_photos`,
rider NID/licence — are deliberately absent from that list**: the optimizer fetches local
images through an internal cookie-less request, so anything behind an auth check would come
back as a JSON 401 and render as a broken image. Those are rendered with a plain `<img>` and
pre-sized at upload time. Anything not on the list responds 400 — it fails closed and loudly
rather than silently leaking private media. **Keep `next.config.ts` `localPatterns` and
`PUBLIC_SUBDIRS` in `app/api/uploads/[...path]/route.ts` in step.**

Bundled brand art lives in `public/images/` and is WebP/SVG only. After adding raster art:

```bash
npm run images:convert              # public/*.{png,jpg,jpeg,bmp,tiff,avif} → .webp
npm run images:convert -- --delete  # also remove the originals
```

### Reading the audit logs

| Log | Model | Where to read it |
| --- | --- | --- |
| Financial audit trail — refunds, adjustments, settlements, withdrawal decisions, payment verification, commission-rule changes, gateway amount mismatches | `FinancialAuditLog` | `/accounts/audit-log` (page) · `GET /api/accounts/audit-log` |
| Manager activity | `ManagerActivityLog` | `/admin/activity-logs` (page) · `GET /api/activity-logs` |
| Sign-ins (all roles, both providers) | `LoginHistory` | `/rider/login-history`; also written on every successful `authorize()` in `auth.ts` |
| Order state history (append-only, with actor and reason) | `OrderStatusEvent` | Written in the same transaction as every status change, `lib/services/orders.ts` |
| Rider duty | `RiderBranchDutySession` (source of truth) + `RiderDutyLog` (derived per-Dhaka-day rollup) | `/rider/duty-history`, `/branch-manager/duty-history` |

Every money-moving decision writes a `FinancialAuditLog` row with the actor and a detail
string. When investigating a discrepancy, start there.

---

## 11. Known limitations and outstanding work

This is the most valuable section in the document. Read it before you promise anything to
a stakeholder.

### 11.1 Roughly 34 medium- and low-severity items remain open

`docs/WORK_ASSIGNMENT.md` enumerates **78 tasks** across 9 workstreams, derived from 87
audited findings, graded Blocker / High / Medium / Low. The production-hardening sprint
(git commits `5ae0030`, `022eb94`, `6e725b3`) closed:

- **all 14 Blocker items** — payment gateway with server-side re-verification, the
  client-asserted Ramadan payment path, manual bKash UI, account-takeover password reset,
  phone/email/OTP login, coin redemption, coupon over-redemption race, refunds and
  adjustments in net revenue, delivery-charge revenue, map picker and coordinate
  provenance, order-cancel and the `delayed` status, and the Asia/Dhaka day boundary;
- **the High-severity items**, with the Ramadan consolidation (WS-9.3) only partly done
  (see §11.5).

That leaves the **28 Medium and 6 Low rows — 34 in total** as the outstanding backlog. They
are listed row by row with severity, effort, owner and exact file paths in
`docs/WORK_ASSIGNMENT.md` §3, and sequenced in §4 "Wave 3". Representative examples:

- No rider filter on any accounts surface; the transactions search drops a non-numeric `q`,
  so searching an order number silently returns everything (WS-2.9).
- The expense report builds `const where = {}` and never populates it (WS-2.10).
- No per-report permission concept — access is a flat role check, so "as permitted by the
  Super Admin" cannot be expressed or revoked (WS-3.2).
- `CustomerAddress` has no Bangladeshi administrative structure (house/road/block/sector/
  thana/district/postcode), so zone rollups and rider addressing degrade to one string (WS-4.11).
- `DeliveryTimeSlot` rows are created and listed but read by nothing — checkout has no slot
  picker (WS-5.9).
- A branch manager cannot mark their own attendance from the UI: `AttendanceMarker` is
  finished and `POST /api/attendance` works, but the component is only mounted on the rider
  page (WS-5.10). *Verified still open.*
- Cross-branch product hold matches on an exact product **name** string, so a held item stays
  on sale under a variant spelling (WS-8.10).
- Rider GPS still fires a Server Action on every `watchPosition` callback with no distance
  filter or throttle — expensive on a prepaid data plan (WS-9.4). *Verified still open.*

A few Medium rows were fixed opportunistically while adjacent code was being changed — for
example the live rider map now uses the shared `useLiveData` poller rather than a raw
`setInterval` (WS-4.6). **The backlog was not re-audited after the sprint**, so treat the
"34" as an upper bound and re-verify a row against the code before scheduling it.

### 11.2 Four Playwright specs assert superseded contracts

These fail today and **will keep failing until they are rewritten**. They are not
regressions; they encode behaviour that was deliberately removed.

| Spec | Why it fails | What to do |
| --- | --- | --- |
| `tests/e2e/12-md-pdf-fixes.spec.ts` | Asserts the **old single-page forgot-password form** (enter username + email, password is reset in one step). | Rewrite against the two-step flow: `/forgot-password` requests a token, `/forgot-password/reset?token=…` consumes it. |
| `tests/e2e/13-login-design.spec.ts` | Same — asserts the old single-page reset form. | Same. |
| `tests/e2e/full-page-audit/public-auth.spec.ts` | Same — asserts the old single-page reset form. | Same. |
| `tests/e2e/23-ramadan.spec.ts` (≈ lines 163–191) | Exercises the **deleted client-asserted payment path**: it POSTs `{ outcome: "fail" }` to `/api/ramadan/reservations/[id]/pay` and expects the customer to be able to self-declare a payment result. That path let anyone book a free iftar table and fabricate revenue into the financial audit log — **it was the security vulnerability, and removing it was the fix.** | **Rewrite, do not restore.** Assert instead that a client-supplied `outcome` is rejected, and drive the two supported paths: the gateway callback, and the accounts-only "record offline advance" action. |

The remaining 68 specs exercise contracts that still hold.

### 11.3 Payment gateways are record-and-verify until real credentials exist

- **bKash** has a complete Tokenized Checkout driver — token grant/refresh with skew and
  concurrent-miss collapsing, create, execute, and an authoritative `payment/status` read.
  It is inert until `BKASH_APP_KEY` / `APP_SECRET` / `USERNAME` / `PASSWORD` are supplied,
  and it defaults to the **sandbox** base URL until `BKASH_BASE_URL` is set to live.
- **Nagad, Rocket, SSLCommerz** are declared driver stubs. Nagad's is documented at length:
  its Merchant Checkout needs RSA-PSS signing and a per-order key exchange, and writing that
  against documentation with no sandbox to verify against would produce code that looks like
  a payment integration and either silently fails to take money or marks orders paid that
  were not. All three have a complete manual rail.
- Until credentials are supplied, every wallet payment is **record-and-verify**: the
  customer pays the branch's number out of band, submits a TrxID, and staff verify. Orders
  are never auto-marked paid on that path.

### 11.4 Push notification copy renders in Bangla for everyone

Web Push works, but the message text is always rendered in the default locale (Bangla),
regardless of the recipient's chosen language. In-app notifications are unaffected — those
are key-based and translated at render time to the viewer's locale.

The cause is structural: there is nowhere to record a **per-device** language preference.
`PushSubscription` has no locale column, and a user's locale is a client-side choice that is
not persisted per endpoint. Fixing it means adding a `locale` column to `PushSubscription`,
capturing the browser locale at subscribe time, and passing it into the push payload build
in `lib/services/push.ts`.

### 11.5 Two Ramadan booking systems still coexist

The database contains two seating models:

- **Canonical:** `RamadanReservation` against the physical `BranchTable`, with
  `RamadanConfig`, `RamadanTimeSlot`, `RamadanMenu`, `RamadanMenuItem` and
  `RamadanReservationPayment`.
- **Legacy:** `RamadanTable` + `RamadanBooking`, a parallel table list with its own
  `@@unique([tableId, bookingDate])`.

The sprint **closed the legacy write path** — new bookings only ever go through the
canonical `RamadanReservation` flow — and made **capacity checks read both**, so an existing
legacy booking still blocks its slot and two records cannot claim the same physical table
for the same iftar. That change was deliberately non-destructive: **no data migration was
run and the legacy tables were not retired.**

The remaining work is a one-way data migration (map each `RamadanBooking` onto a
`RamadanReservation` against the equivalent `BranchTable`, verify counts, then drop
`RamadanTable` and `RamadanBooking`). It is described in `docs/WORK_ASSIGNMENT.md` as
WS-9.3. Until it is run, anything that counts Ramadan bookings must consult both models —
and any new code that touches Ramadan seating must be read carefully for that assumption.

Also still missing from the Ramadan feature: a trading-hours override for the Ramadan period,
and sehri (pre-dawn) service, which is absent entirely.

### 11.6 SQLite has no geospatial index

Nearest-branch resolution is an **in-memory scan**. `nearestEligibleBranch` and
`nearestEligibleBranchForPoint` in `lib/services/customer-location.ts` load every active,
non-archived branch, batch-load their delivery zones, then evaluate coverage and Haversine
distance in JavaScript, sorting the results in process. The same shape appears in
`resolveDeliveryBranch` in `lib/services/orders.ts`.

The N+1 that used to issue a zone query *inside* the loop has been collapsed into one
batched read, so this is no longer pathological — but it is still O(branches) work on every
homepage render, every branches page and every order placement, with no bounding-box
prefilter and no spatial index.

It is fine at tens of branches. It will not survive expansion. When it starts to hurt:
move to PostgreSQL + PostGIS with a GiST index on branch geometry, or at minimum add a
latitude/longitude bounding-box prefilter in SQL before the Haversine pass. Note also that
`BranchDeliveryArea` has a centre but **no radius column** (the schema was frozen), which is
why an area can describe pricing but never coverage — see the long comment at the top of
`lib/services/delivery.ts` before you touch either model.

### 11.7 Open security items

Four are worth naming here because they affect launch planning; all are described with
their file paths in [`docs/SECURITY.md` §9](./SECURITY.md#9-known-gaps-and-accepted-risks):

- **`.env.example` ships a working seed super-admin password** and is in version control.
- **The password login path is not rate limited.** OTP, password reset and geocoding are;
  `bcrypt.compare` is not.
- **No security response headers are set** — `next.config.ts` has no `headers()` function,
  so there is no CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options` or
  `Referrer-Policy`.
- **`LoginHistory.ipAddress` and `.userAgent` are always empty** — the columns exist, the
  writer only supplies `userId`, so login history has no forensic value today.

### 11.8 Smaller things worth knowing

- `lib/services/order-number.ts` builds `ORD-YYYYMMDD-000001` from the **UTC** calendar day,
  while settlements now bucket on the Dhaka day. An order placed between 00:00 and 06:00
  Dhaka therefore carries a date segment one day behind the settlement it lands in. Cosmetic,
  but confusing during a reconciliation.
- `lib/serializers/index.ts` re-implements percentage discount in floats for
  `discountedPrice` — a second, divergent copy of a money rule `orders.ts` claims to own.
  Display-only today.
- The repo contains **both** `package-lock.json` and `yarn.lock`. `setup.bat` uses npm.
  Pick one and delete the other before publishing.
- e2e spec filename prefixes are not unique — `10`, `16`, `45` and `57` each appear twice,
  and `delivery-areas-management.spec.ts` has no prefix.

---

## 12. A new developer's first week

**Day 1 — understand the domain before the code.**
1. `docs/REQUIREMENTS_ROLES.md` — the client's own words, all seven roles. This is scope.
2. This document, §1 and §8. Especially §8: the Dhaka day, Decimal money and VAT extraction
   explain design choices that look strange until you know why.
3. Run `setup.bat` / `start.bat` (or the manual equivalent). Sign in as each of the seven
   demo accounts and click through their dashboards. Place an order as `customer`, accept
   and cook it as `branch_manager`, assign `rider`, deliver it, then look at what appeared
   in `accounts`.

**Day 2 — the shape of the system.**
4. `docs/PROJECT_UNDERSTANDING.md` — the pre-sprint audit. Some of its findings are now
   fixed (it predates the hardening commits), but its architectural description and its
   "what is genuinely strong" section are still accurate and are the best single narrative
   of how the pieces fit.
5. §4 of this document, then read the code it names, in this order:
   `lib/constants/index.ts` → `auth.ts` + `auth.config.ts` → `proxy.ts` →
   `lib/constants/orders.ts`.

**Day 3 — the money and the state machine.**
6. `lib/services/orders.ts` top to bottom. It is long, and its header comments state the
   rules the rest of the codebase depends on.
7. `lib/services/payments.ts` — the rails, the driver seam, and the re-verification rule.
8. `lib/services/financials.ts` `splitCharges` and `generateSettlement`.
9. `lib/utils/dates.ts` — short, and everything reporting-related routes through it.

**Day 4 — data and boundaries.**
10. `prisma/schema.prisma`. Skim all 66 models; read `User`, `Order`, `OrderItem`,
    `OrderStatusEvent`, `Branch`, `BranchDeliveryZone`, `BranchDeliveryArea` and
    `RiderBranchDutySession` properly. The inline comments carry the reasoning.
11. `docs/SECURITY.md` in full, then `lib/selectors/index.ts` and
    `lib/services/rider-location.ts` — the two clearest examples of how authorization is
    expressed in this codebase.

**Day 5 — the backlog and your first change.**
12. `docs/WORK_ASSIGNMENT.md` §3 (the task table) and §6 (definition of done). Pick a Wave-3
    row, verify it is still open against the code, and fix it.
13. Before you open a PR, run all five verification commands from [§6](#6-verification-commands).
    Add a **page-level** Playwright spec, not an API-only one — several gaps in this
    project's history shipped green precisely because the specs drove the feature entirely
    through `request.post` and never clicked a button.
14. Read `AGENTS.md`. Next.js 16 has breaking changes relative to older documentation and
    training data; check `node_modules/next/dist/docs/` before assuming an API still exists.
