# MAD DELIVERY HQ

A **Next.js-only full-stack** multi-branch food-delivery and restaurant-operations platform
built for Bangladesh. Two restaurant brands (**Cheez!** and **Madchef**) across multiple
branches, seven user roles, Bangla-first, Taka-only.

The public storefront, authentication, every role dashboard and the entire API are served by
a single Next.js application. There is no separate backend service, no queue, no cron
daemon and no worker tier.

```bat
setup.bat      :: one-time setup — installs, migrates, seeds
start.bat      :: run it  (start.bat prod  builds and serves)
```

Then open <http://localhost:3000> and sign in as `super_admin` / `Admin12345@##`.

---

## Documentation

| File | What it covers |
| --- | --- |
| [`docs/HANDOVER.md`](./docs/HANDOVER.md) | **Start here.** Architecture, repository map, environment variables, Bangladesh-specific behaviour, deployment, operational runbook, known limitations, and a first-week reading order. |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | Security posture: auth model, authorization, rider-location scoping, payment integrity, redemption race protection, secrets handling, known gaps, and how to report a vulnerability. |
| [`docs/REQUIREMENTS_ROLES.md`](./docs/REQUIREMENTS_ROLES.md) | The client's original seven-role requirements, verbatim. The scope contract. |
| [`docs/PROJECT_UNDERSTANDING.md`](./docs/PROJECT_UNDERSTANDING.md) | Pre-sprint engineering audit: what the system is, architecture, requirement-coverage scoreboard, top risks. Predates the hardening work — its architectural description is current, several of its findings are now fixed. |
| [`docs/WORK_ASSIGNMENT.md`](./docs/WORK_ASSIGNMENT.md) | The 78-task remediation plan those audits produced, with severity, effort, owner and file paths. The remaining backlog lives here. |

<details>
<summary>Historical audits — <code>docs/audits/</code></summary>

Snapshots from earlier development rounds. Useful for archaeology; not maintained.

| File | Subject |
| --- | --- |
| [`FULL_PAGE_AUDIT.md`](./docs/audits/FULL_PAGE_AUDIT.md) | Page-by-page audit of every route |
| [`NEW_FEATURES_IMPLEMENTATION_AUDIT.md`](./docs/audits/NEW_FEATURES_IMPLEMENTATION_AUDIT.md) | Feature-implementation audit |
| [`DASHBOARD_UI_REDESIGN_AUDIT.md`](./docs/audits/DASHBOARD_UI_REDESIGN_AUDIT.md) | Dashboard redesign audit |
| [`DASHBOARD_UI_REDESIGN_FINAL_REPORT.md`](./docs/audits/DASHBOARD_UI_REDESIGN_FINAL_REPORT.md) | Dashboard redesign outcome |
| [`INTERNAL_PAGE_ENHANCEMENT_AUDIT.md`](./docs/audits/INTERNAL_PAGE_ENHANCEMENT_AUDIT.md) | Internal page enhancements |
| [`INTERNAL_LIST_PAGINATION_AUDIT.md`](./docs/audits/INTERNAL_LIST_PAGINATION_AUDIT.md) | List pagination coverage |
| [`PRODUCT_SYSTEM_SYNC_AUDIT.md`](./docs/audits/PRODUCT_SYSTEM_SYNC_AUDIT.md) | Product/catalogue consistency |
| [`NEAREST_BRANCH_HOMEPAGE_AUDIT.md`](./docs/audits/NEAREST_BRANCH_HOMEPAGE_AUDIT.md) | Nearest-branch homepage behaviour |
| [`SUPER_ADMIN_ORDERING_AUDIT.md`](./docs/audits/SUPER_ADMIN_ORDERING_AUDIT.md) | Super-admin ordering surfaces |
| [`DROPDOWN_ARROW_AUDIT.md`](./docs/audits/DROPDOWN_ARROW_AUDIT.md) | Select-control consistency |

</details>

<details>
<summary>Design plans and specs — <code>docs/superpowers/</code></summary>

| File | Subject |
| --- | --- |
| [`plans/2026-07-29-performance-optimization.md`](./docs/superpowers/plans/2026-07-29-performance-optimization.md) | Performance work plan |
| [`plans/2026-07-30-authenticated-dashboard-redesign.md`](./docs/superpowers/plans/2026-07-30-authenticated-dashboard-redesign.md) | Dashboard redesign plan |
| [`plans/2026-07-30-delivery-areas-management.md`](./docs/superpowers/plans/2026-07-30-delivery-areas-management.md) | Delivery-areas plan |
| [`specs/2026-07-30-authenticated-dashboard-redesign-design.md`](./docs/superpowers/specs/2026-07-30-authenticated-dashboard-redesign-design.md) | Dashboard redesign spec |
| [`specs/2026-07-30-delivery-areas-management-design.md`](./docs/superpowers/specs/2026-07-30-delivery-areas-management-design.md) | Delivery-areas spec |

</details>

Also at the repository root: [`AGENTS.md`](./AGENTS.md) — **read it before writing code.**
Next.js 16 has breaking changes relative to older documentation and training data; check
`node_modules/next/dist/docs/` before assuming an API still exists.

---

## Features by role

Seven roles, seven dashboards, all gated server-side. Full requirements in
[`docs/REQUIREMENTS_ROLES.md`](./docs/REQUIREMENTS_ROLES.md).

**Super Admin** — approve or reject every staff account · block fraudulent customers with a
reason · put a branch or a product on hold platform-wide · own the category taxonomy · set
rider commission (global and per branch) · configure reward-coin value and earning rules ·
configure tax and service-charge rates · broadcast notices · see every complaint from every
role · today's sales / orders / cancellations · attendance and staff reports.

**Branch Manager** — live order board with an audible alert · drive an order through all
seven statuses · assign riders with real eligibility checks (approved, online, holding an
active duty session for *this* branch) · live rider fleet map · branch catalogue with
activate/deactivate-with-reason · delivery zones, areas and hours · table reservations with
a chat thread and a `tel:` dial link · Ramadan bookings · attendance · complaints · duty and
login history.

**Rider** — branch-scoped duty sessions · blocking assignment-offer modal with
accept/reject-with-reason · `picked_up` → `on_the_way` → `delivered`, plus `delayed` with
extra minutes and cancel-with-reason · GPS streaming hardened against spoofed and stale
fixes · route trail with Haversine distance · idempotent per-order commission ledger ·
withdrawal requests with held/paid balance maths · earnings, performance, attendance,
login history · complaint inbox · Web Push for new delivery requests.

**Customer** — browse branch-scoped menus · map picker with a server-geocoded address search
and a draggable, reverse-geocoded pin · server-resolved nearest branch with a distinct
"out of zone" vs "covered
but closed" verdict, naming the nearest pickup point · server-priced immutable order
snapshot · order and rider tracking · Home/Office/Second-Home address book · reward coins
that mint a real, spendable voucher · rate the rider and review the food · complaints to
four staff roles · one-click reorder · sign in by username, email or phone, with password or
SMS OTP.

**Accounts** — payments and verification queue · refunds · expenses · manual adjustments ·
rider commission ledger and per-branch rule book · withdrawal approve/reject/pay · invoices
that add up · end-of-day branch settlements with a reconciliation view · the deductions and
charges (VAT / service charge / discounts / coupons) report · financial audit log.

**Marketing** — coupons that validate and discount at checkout · campaigns with
sent/opened/clicked/conversion tracking · audience segments · targeted notification sends
that honour each user's opt-out · feedback monitoring.

**Management** — read-only executive layer: sales, orders, branches, riders, customers,
finance, expenses, withdrawals, marketing, delivery, attendance, inventory and complaint
reports, each with period and branch filters, exportable as CSV, XLSX or PDF · retention and
repeat-order analytics · branch performance comparison.

---

## Tech stack

| Concern | Technology |
| --- | --- |
| Framework | Next.js 16.2.10 (App Router, Server Components, Route Handlers, Server Actions) — webpack, not Turbopack |
| Runtime | React 19.2.4 / Node.js |
| Language | TypeScript 5 |
| Auth | Auth.js / NextAuth v5 beta — two Credentials providers (password, SMS OTP), JWT session |
| Password hashing | bcryptjs |
| ORM / DB | Prisma 6 — SQLite in dev, PostgreSQL-ready (66 models, **no Prisma enums**, 58 `Decimal` money columns) |
| Styling | Tailwind CSS v4 |
| i18n | Custom dictionary — Bangla (`bn`) **default**, English (`en`) secondary; 3,439 keys each at exact parity |
| Validation | Hand-rolled client + server rules in `lib/validation/` (`<form noValidate>`) — not schema-driven |
| Images | sharp — every upload re-encoded to WebP, metadata stripped |
| Push | web-push (VAPID) + `public/sw.js` — optional, off by default |
| Tests | Playwright — 72 e2e specs |
| Process | PM2 (`ecosystem.config.cjs`) behind Nginx |

---

## Quick start

### Windows (one click)

```bat
setup.bat
start.bat
```

`setup.bat` checks Node, creates `.env` and `.env.local` from `.env.example` (never
overwriting existing ones), installs dependencies, applies migrations, generates the Prisma
client and seeds demo data. `start.bat` pins `TZ=Asia/Dhaka` and starts the dev server;
`start.bat prod` builds and serves.

### macOS / Linux / CI

```bash
cp .env.example .env          # Prisma CLI reads .env
cp .env.example .env.local    # Next.js runtime reads .env.local  — you need BOTH
npm install                   # postinstall runs `prisma generate`
npx prisma migrate deploy     # creates prisma/dev.db and applies 26 migrations
npm run seed                  # demo accounts, branch, catalogue, orders (idempotent)
TZ=Asia/Dhaka npm run dev     # http://localhost:3000
```

---

## Verification

Run all five before opening a pull request.

```bash
npm run lint            # eslint
npm run check:i18n      # bn/en key + placeholder parity (TypeScript cannot catch this)
npx tsc --noEmit        # type check
npm run build           # next build --webpack
npm run test:e2e        # after: npm run test:e2e:prepare
```

> **Known:** four Playwright specs currently fail because they assert contracts that were
> deliberately superseded — three assert the old single-page forgot-password form, and
> `23-ramadan.spec.ts` exercises a deleted client-asserted payment path that *was* the
> vulnerability. They must be rewritten, not restored. See
> [`docs/HANDOVER.md` §11.2](./docs/HANDOVER.md#112-four-playwright-specs-assert-superseded-contracts).

---

## Demo / seed accounts

Run `npm run seed`. **Password for every account: `Admin12345@##`**

| Username | Email | Phone | Role |
| --- | --- | --- | --- |
| `super_admin` | superadmin@example.com | 01700000001 | super_admin |
| `management` | management@example.com | 01700000002 | management |
| `marketing` | marketing@example.com | 01700000003 | marketing |
| `branch_manager` | branchmanager@example.com | 01700000004 | branch_manager |
| `accounts` | accounts@example.com | 01700000005 | accounts |
| `rider` | rider@example.com | 01700000006 | rider |
| `customer` | customer@example.com | 01711111111 | customer |
| `blocked_customer` | — | — | customer (blocked demo — shows block enforcement) |

Plus a default Super Admin from `ADMIN_*` (`admin` / `Admin12345@##`).

**The sign-in field accepts any of three identifiers** — username, email, or a Bangladeshi
mobile number in any written form (`01711111111`, `8801711111111`, `+880 1711-111111`, or
bare `1711111111`).

The seed also creates a **Main Branch** (manager + rider assigned), categories and products,
orders across the lifecycle, rider commissions and withdrawals, reward rules and ledger
rows, reviews, complaints, a notice and notifications, delivery time slots, a table
reservation, Ramadan tables and a booking, a rider route trail and login history — so every
dashboard shows real data. **The seed is idempotent.**

---

## Environment variables

Copy `.env.example` to **both** `.env` (Prisma CLI) and `.env.local` (Next.js runtime).
Every variable, and what happens when each one is absent, is tabulated in
[`docs/HANDOVER.md` §7](./docs/HANDOVER.md#7-environment-variables).

**Required:** `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST`, `ADMIN_USERNAME` /
`ADMIN_EMAIL` / `ADMIN_PASSWORD`.

**The design rule: every external integration degrades gracefully.** With an empty optional
block the app is fully functional — nothing crashes, nothing 500s, no feature disappears
from the navigation. A *half-filled* credential block is refused with a loud server-log
warning rather than half working.

| Variable(s) | Feature | Behaviour when unset |
| --- | --- | --- |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | The map canvas in the picker, zone editor and rider fleet map | Fallback panel instead of the map. The picker's **address search still works** — it runs against the app's own `/api/geo/search`, not a browser Maps library. All coverage and distance maths is server-side and unaffected |
| `GOOGLE_MAPS_SERVER_API_KEY` | Server-side geocoding / reverse geocoding | Falls back to the public key; if that is also unset, geocoding is unavailable |
| `SMS_PROVIDER` / `SMS_API_KEY` / `SMS_SENDER_ID` | OTP login, password-reset link delivery | Demo driver: the message is logged server-side, nothing is sent. Outside production the code and reset link are returned to the caller so the flow is testable |
| `BKASH_*` (four, all required together) | bKash Tokenized Checkout | No "Pay online" button. Cash-on-delivery and the manual record-and-verify wallet flow keep working |
| `BKASH_BASE_URL` | bKash API base | **Defaults to sandbox** — production must set the live URL explicitly |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push | Push silently off; in-app notifications and the bell are unaffected |
| `UPLOAD_DIR` | Runtime upload directory | Defaults to `storage/uploads`; **must be a persistent writable disk in production** |
| `NEXT_PUBLIC_UPLOAD_BASE_URL` | S3/R2/CDN base for upload URLs | Served same-origin through `/api/uploads` |

> ⚠️ `.env.example` ships a real, working seed super-admin password. **Set your own
> `ADMIN_*` values before the first production seed.** See
> [`docs/SECURITY.md` §9](./docs/SECURITY.md#9-known-gaps-and-accepted-risks).

---

## Folder structure

```
mad-delivery-hq/
├── app/
│   ├── (auth)/               registration (7 role forms), forgot-password (+ /reset),
│   │                         login/otp, registration-pending
│   ├── (auth-full)/login/    login (full-bleed layout)
│   ├── (dashboard)/          162 pages — admin/ branch-manager/ management/ accounts/
│   │                         rider/ customer/ marketing/ + shared complaints/ profile/
│   ├── api/                  179 Route Handlers — this IS the backend
│   ├── layout.tsx  page.tsx  globals.css  robots.ts  sitemap.ts
├── components/               28 folders — per-role UI plus ui/ common/ forms/ layout/ maps/
├── lib/
│   ├── services/             36 modules — ALL business logic lives here
│   ├── selectors/            role-scoped Prisma where-clause builders
│   ├── serializers/          Prisma record → API JSON
│   ├── auth/                 identity, otp, password-reset, tokens, phone, rate-limit, sms
│   ├── api/actions.ts        Server Actions for form mutations
│   ├── utils/dates.ts        THE Asia/Dhaka business-day boundary
│   ├── validation/  constants/  i18n/  http/  hooks/  db/  cache/  seo/  theme/  upload/
├── prisma/
│   ├── schema.prisma         66 models, 58 Decimal columns, zero enums
│   ├── migrations/           26 migrations
│   └── seed.ts               idempotent seed
├── messages/                 bn.json / en.json — 3,439 keys each, exact parity
├── public/                   brand art (WebP/SVG) + sw.js (push service worker)
├── storage/uploads/          runtime uploads (gitignored; served via /api/uploads)
├── scripts/                  check-i18n-params, convert-images-to-webp, test-db helpers
├── tests/e2e/                72 Playwright specs
├── types/                    shared TS types + next-auth augmentation
├── proxy.ts                  Next 16 middleware — route redirects, UX only
├── auth.ts  auth.config.ts   Auth.js setup (Node + edge-safe split)
├── ecosystem.config.cjs      PM2 production process definition
└── setup.bat  start.bat      one-click Windows setup / run
```

---

## User roles & redirects

| Role | After-login destination (`ROLE_HOME`) | Section prefix |
| --- | --- | --- |
| `super_admin` | `/admin/dashboard` | `/admin` |
| `management` | `/management/dashboard` | `/management` |
| `marketing` | `/marketing/dashboard` | `/marketing` |
| `branch_manager` | `/branch-manager/dashboard` | `/branch-manager` |
| `accounts` | `/accounts/dashboard` | `/accounts` |
| `rider` | `/rider/dashboard` | `/rider` |
| `customer` | **`/`** — the public homepage | `/customer` |

A customer lands on `/` because that is where the ordering flow starts (location prompt →
nearest eligible branch → menu → cart → checkout). `/customer/dashboard` still exists and is
reachable from navigation. `lib/constants/index.ts` keeps **`ROLE_HOME`** (post-login
redirect) and **`ROLE_DASHBOARD`** (links labelled "Dashboard") as deliberately separate
maps — do not conflate them. The actual decision, including `callbackUrl` sanitisation, is
in `lib/auth/login-destination.ts`.

- **Public registration creates `customer` accounts only** (auto-approved).
- **Staff accounts are created by a Super Admin** at `/admin/users/create` and stay pending
  until approved.
- Pending, rejected and blocked users cannot reach protected pages or APIs.
- Role permissions are enforced in **every Route Handler and every page, server-side**.
  `proxy.ts` (Next 16 middleware) is UX only, and its matcher excludes `/api` entirely.

---

## Database & Prisma

SQLite for local development, zero setup. The schema is deliberately PostgreSQL-shaped:
`Decimal` for money, `DateTime` for instants, and **no Prisma enums** — every status is a
plain `String` validated in `lib/constants/enums.ts`.

```bash
npx prisma migrate deploy   # apply pending migrations
npx prisma migrate dev      # author a new migration
npm run db:reset            # DESTRUCTIVE — drop, re-migrate, re-seed
npx prisma studio           # browse the data
```

To move to **PostgreSQL**, set `provider = "postgresql"` in `prisma/schema.prisma` and a
Postgres `DATABASE_URL` — but note that the 26 existing migrations were authored against
SQLite and their SQL is not portable, so the history needs a fresh baseline. Full procedure,
including `@db.Decimal(12,2)` precision, in
[`docs/HANDOVER.md` §9.1](./docs/HANDOVER.md#91-sqlite--postgresql).

Every schema change needs a migration file. `prisma db push` drift is not acceptable.

---

## Bangladesh-specific behaviour

Four rules that shape more of this codebase than anything else. Each is explained with its
reasoning in [`docs/HANDOVER.md` §8](./docs/HANDOVER.md#8-bangladesh-specific-behaviour-read-this-before-you-write-code).

1. **Asia/Dhaka is the single business-day boundary.** `lib/utils/dates.ts` derives every
   day boundary from the Dhaka wall clock through `Intl.DateTimeFormat` — never
   `setHours()`, never UTC. Reports, attendance keys, reward keys and settlement buckets all
   route through it. On a UTC host, local midnight is 06:00 Dhaka, and getting this wrong
   makes "today's sales" a 6am-to-6am window.
2. **BDT money is `Prisma.Decimal` end to end and never touches a JS float.** One rounding
   boundary, stated once, in `lib/services/orders.ts`: the **unit price** is rounded to the
   paisa, `ROUND_HALF_UP`, exactly once — at the only step that produces sub-paisa
   precision. Rounding the unit rather than the line total is what makes an invoice add up.
3. **VAT and the service charge are EXTRACTED from VAT-inclusive menu prices, never added
   on top.** BD shelf prices already include them, so `splitCharges()` in
   `lib/services/financials.ts` computes `net = base × 100 / (100 + tax + service)` and
   takes net as the residual, per order. Adding them to a total would report revenue the
   till never saw.
4. **Bangla is the default locale**, English is secondary, and phone numbers normalize to
   `01XXXXXXXXX` (`/^01[3-9]\d{8}$/`) from `01X`, `880`, `+880` or bare forms.

Payment rails: cash on delivery plus **bKash, Nagad and Rocket**. All three wallets have a
complete manual record-and-verify path; bKash additionally has a working online gateway
(Tokenized Checkout with server-side re-verification). Nagad, Rocket and SSLCommerz online
drivers are declared stubs — see [`docs/HANDOVER.md` §11.3](./docs/HANDOVER.md#113-payment-gateways-are-record-and-verify-until-real-credentials-exist).

---

## Internationalisation

Bangla (`bn`, default) and English (`en`), switchable across the whole app.
`messages/bn.json` and `messages/en.json` each flatten to **3,439 keys with exact parity and
zero one-sided keys**. The Bangla is native copy, not machine output.

System notifications are **key-based**: rows store `titleKey` / `bodyKey` / `params`, never
rendered text, and are translated to the *viewer's* locale at render time. A param value
tagged `@:<key>` (for example an enum label `@:orderStatus.preparing`) is itself
re-translated on render.

`npm run check:i18n` verifies that every key's declared `{placeholders}` match what call
sites pass — TypeScript cannot catch that class of bug, and it shipped to users twice.

Money and dates format through `lib/i18n/format.ts`, which pins `APP_TIME_ZONE =
"Asia/Dhaka"` and implements Bengali numerals and `bn-BD` lakh/crore grouping.

---

## Notifications

One in-app notification system serves **every** role, with optional Web Push layered on top.

**Model** (`Notification`): `userId`, `type`, `title`, `body`, `titleKey`, `bodyKey`,
`params` (JSON), `link`, `isRead`, `noticeId`, `createdAt`. Notifications are **per-user
rows** — role, branch and broadcast sends fan out to one row per recipient, so read state is
always per user and no query can leak another user's inbox.

**Central service** — `lib/services/notifications.ts`. Every module goes through this
surface rather than writing rows by hand:

| Helper | Recipients |
| --- | --- |
| `createNotification(userId, input)` | one user (the primitive) |
| `notifyUser(userId, input)` | one user |
| `notifyUsers(userIds, input)` | a list of users |
| `notifyRole(role, input, branchId?)` | every approved + active user of a role, optionally branch-scoped |
| `notifySuperAdmins(input)` | all super admins |
| `notifyBranchManagers(branchId, input)` | a branch's managers |
| `notifyBranch(branchId, input)` | a branch's managers + assigned riders |
| `notifyCampaignAudience(...)` | a marketing segment, honouring each user's opt-out |
| `publishNotice(...)` | a broadcast notice fanned out to its audience |

**Categories** (`type`, from `lib/constants/enums.ts`): `system`, `order`, `delivery`,
`payment`, `withdrawal`, `commission`, `complaint`, `reward`, `review`, `marketing`,
`reservation`, `ramadan`, `notice`, `security`, `account`, `branch`, `catalog`.

**API** (all require auth and are scoped to the caller — 401 anonymous, 403 wrong role;
never leak another user's rows):

| Route | Purpose |
| --- | --- |
| `GET /api/notifications` | own inbox (paginated; `?unread=1`) |
| `GET /api/notifications/unread-count` | `{ count }` for the topbar badge |
| `POST /api/notifications/[id]/read` | mark one read (own only) |
| `POST /api/notifications/read-all` | mark all read |
| `DELETE /api/notifications/[id]` | delete one (own only) |
| `POST /api/notices` · `PATCH·DELETE /api/notices/[id]` | super admin / marketing broadcast → fan-out |
| `GET /api/push` | the VAPID public key (empty when push is unconfigured) |
| `POST /api/push/subscribe` · `POST /api/push/unsubscribe` | register / drop a device endpoint |

**UI:** a topbar bell polls `unread-count` every 30 seconds and shows a role-scoped badge;
each role has a `/…/notifications` page with per-category icons, all/unread/read filters,
mark-one-on-open, mark-all, and translated empty states.

**Preferences:** `User.notificationsEnabled` (set at `/customer/settings`) suppresses
**optional** categories only. Transactional and security categories — order, payment,
withdrawal, complaint, account — are always delivered.

**Web Push** is optional and off by default. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`VAPID_SUBJECT` (all three together) to enable it. When enabled: `public/sw.js` handles
`push` and `notificationclick` with a same-origin path guard so a stored link cannot become
an off-site jump; fan-out is scheduled with Next 16's `after()` so an order write never
waits on a round trip to a push service; it is mirrored from the *existing*
`createNotification` path and placed **after** the opt-out filtering, so push inherits the
toggle rule instead of re-implementing it; it is best-effort and never blocks the in-app
row; dead subscriptions are pruned on 404/410. The rider poll backs off from 5s to 30s only
when a live subscription is detected, and reverts if permission is revoked — the poll
remains the fallback.

> **Known limitation:** push copy renders in Bangla for everyone. `PushSubscription` has no
> per-device locale column. In-app notifications are unaffected.

---

## Deployment

Full procedure — PostgreSQL migration, `TZ`, reverse-proxy headers, storage, secrets and
multi-instance caveats — in [`docs/HANDOVER.md` §9](./docs/HANDOVER.md#9-deployment).
The short version:

- Set a per-environment `AUTH_SECRET` (`npx auth secret`) and a PostgreSQL `DATABASE_URL`.
  Keep `AUTH_TRUST_HOST=true` and leave `AUTH_URL` / `NEXTAUTH_URL` **unset** — the app
  derives its origin from `Host` / `X-Forwarded-*`, so the reverse proxy must forward
  `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto`.
- Set `TZ=Asia/Dhaka` in the process environment. `ecosystem.config.cjs` already does.
- Run `npx prisma migrate deploy` on every release.
- Point `UPLOAD_DIR` at a **persistent, writable** disk. Uploads are validated
  (JPEG/PNG/WebP/AVIF, max 5 MB), converted to WebP by sharp with metadata stripped, stored
  as `<subdir>/<uuid>.webp` outside `public/`, and served by `/api/uploads/[...path]` —
  because `next start` serves `public/` from a build-time snapshot, so files written there
  after the build 404.
- **Images are WebP-only.** After adding raster art to `public/`:
  ```bash
  npm run images:convert             # → .webp
  npm run images:convert -- --delete # also remove the originals
  ```
- All external integrations are optional and key-gated. The app is fully functional
  without any of them.

---

## Security

See [`docs/SECURITY.md`](./docs/SECURITY.md) for the full posture — including the known gaps.
Headlines:

- Hashed-token password reset, 30-minute expiry, single-use, **no account enumeration**.
- SMS OTP behind a provider seam: 6 digits, 5-minute TTL, 5 attempts, SHA-256 at rest,
  constant-time comparison, consumed on use.
- Role authorization enforced server-side in every route, expressed as Prisma where-clauses
  applied **inside** the query rather than as post-filters.
- Rider live location is **duty-scoped**: only the rider, their currently on-duty branch
  manager, the customer of an in-flight delivery, and super admin — and an off-duty rider is
  not locatable by anyone but themselves.
- Payments are re-verified server-to-server against the gateway, with exact `Decimal` amount
  comparison at paisa precision plus a BDT currency check, before any order is marked paid.
  A forged callback cannot settle an order.
- Coupon and coin redemption use atomic conditional updates, so a `maxUses = 1` coupon
  survives N simultaneous checkouts.

**Found a vulnerability?** Report it privately — do not open a public issue. See
[`docs/SECURITY.md` §11](./docs/SECURITY.md#11-if-you-find-a-vulnerability).

---

## Project status

The `production-hardening` branch closed all 14 production blockers and the high-severity
findings from the audit in [`docs/WORK_ASSIGNMENT.md`](./docs/WORK_ASSIGNMENT.md).
Roughly **34 medium- and low-severity items remain open**, four Playwright specs need
rewriting against the new contracts, and payment gateways stay in record-and-verify mode
until real merchant credentials are supplied.

All of it — with file paths — is in
[`docs/HANDOVER.md` §11](./docs/HANDOVER.md#11-known-limitations-and-outstanding-work).
Read that section before promising anything to a stakeholder.
# Personal-AI-Wanda-v.1
