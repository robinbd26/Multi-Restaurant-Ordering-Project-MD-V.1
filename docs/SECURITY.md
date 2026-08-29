# MAD DELIVERY HQ — Security Posture

> What this system defends, how it defends it, and what it does not defend yet.
> Written against the `production-hardening` branch. Every claim below traces to a file
> named in the text. Companion document: [`HANDOVER.md`](./HANDOVER.md).

---

## 1. Trust model in one paragraph

`proxy.ts` (Next 16's renamed middleware) is a **redirect layer, not a security boundary** —
it says so in its own header, and its matcher excludes `/api` entirely, so no API request
ever passes through it. The real boundary is `requireRole()` on every page and
`requireApiRole()` / `requireApproved()` in every route handler, backed by role-scoped
Prisma where-clause builders that constrain the query itself rather than filtering results
afterwards. Nothing a client asserts about identity, branch, price or payment outcome is
believed.

---

## 2. Authentication

### 2.1 Providers and session

Auth.js / NextAuth v5 beta, JWT session strategy, two Credentials providers and no OAuth
(`auth.ts`, `auth.config.ts`):

| Provider | Credentials | Verification |
| --- | --- | --- |
| default | identifier + password | `bcryptjs` compare against `User.password` |
| `otp` | BD phone + 6-digit code | `verifyOtp()` — SHA-256 digest compared with `timingSafeEqual`, then consumed |

Both providers require `user.isActive === true` **and** `user.status === "approved"` before
returning a session, and both write a `LoginHistory` row. The OTP provider deliberately
**re-reads the account after verification** rather than trusting the challenge — the user
may have been deactivated in the five minutes since the code was sent.

The JWT carries `id`, `role`, `status`, `username`, `name`, `picture`, `remember` and
`loginAt`. That is what lets `proxy.ts` and route handlers authorize without a database
round trip. `getSessionUser()` in `lib/auth/current-user.ts` additionally re-reads the user
row and re-checks `isActive` on every API call, so a deactivation takes effect immediately
on the API surface rather than waiting for the token to expire.

**"Remember me" is enforced, not decorative.** The cookie is issued for 30 days, but when
the box was not ticked the `jwt` callback returns `null` after 24 hours, which destroys the
session (`auth.config.ts`).

### 2.2 Identifier resolution

`findUserByIdentifier()` in `lib/auth/identity.ts` is the single implementation, shared by
the provider, the login server action and the password-reset request so the three can never
disagree about which account an input names. It resolves by **input shape, in order**:

1. BD-phone-shaped → `User.phone`, canonicalized through `normalizeBdPhone()`
2. contains `@` → `User.email` (matched both as typed and lowercased, because registration
   does not lowercase what it stores)
3. otherwise → `User.username`

Soft-deleted accounts (`status: "deleted"`) are excluded at every step. Ordering matters: if
someone registers the username `01711111111`, a phone-shaped login still resolves to the
account that *owns* that number.

### 2.3 Password reset — hashed token, 30-minute expiry, no enumeration

`lib/auth/password-reset.ts`, backed by the `PasswordResetToken` model. The previous
implementation reset any account's password on knowledge of username + email with no token
at all; that was an account-takeover hole and it is gone.

**Two steps.** `/forgot-password` requests a link; `/forgot-password/reset?token=…` consumes
it.

- **Hashed at rest.** The raw token is `randomBytes(32).toString("hex")` — 256 bits from a
  CSPRNG — and only its SHA-256 digest is stored (`tokenHash`, `@unique`). The schema
  comment states it plainly: *the raw value is never persisted*. SHA-256 rather than bcrypt
  is deliberate and documented: the secret is full-entropy, so there is no dictionary to
  slow down.
- **Expiry.** `RESET_TOKEN_TTL_MINUTES = 30`.
- **Single use, twice over.** Requesting a new link retires every outstanding token for the
  account; confirming rejects an already-`usedAt` token and then spends *all* live tokens
  for that account in one statement, inside a `$transaction` with the password update.
- **No account enumeration.** Rate limiting runs **before** the account lookup, so the
  limiter itself cannot be used as an existence oracle. An unknown, inactive or deleted
  account returns byte-identical output to a real one:
  ```ts
  if (!user || !user.isActive || user.status === "deleted") {
    return { accepted: true, retryAfter: 0 };
  }
  ```
  SMS delivery failure is logged server-side, never returned, for the same reason. The
  code carries an explicit warning not to add a branch that changes the response shape,
  message or timing profile.
- Confirmation re-applies the password policy (minimum 8 characters, all-digit passwords
  rejected) and re-checks `isActive`.
- **Outside production only**, the response carries a `demoLink` so the flow is testable
  with no SMS gateway. `isProduction()` unconditionally withholds it.

### 2.4 SMS OTP behind a provider seam

`lib/auth/otp.ts` (challenge lifecycle) and `lib/auth/sms.ts` (transport).

| Parameter | Value |
| --- | --- |
| Code length | 6 digits |
| TTL | 5 minutes |
| Max attempts per challenge | 5 |
| Resend cooldown | 60 seconds |

The code is generated by a CSPRNG that rejects bytes ≥ 250 to avoid modulo bias, is stored
**only as a SHA-256 digest**, is compared with `timingSafeEqual`, and is consumed on
success — a replay of the same credentials fails in the provider rather than minting a
second session. An unknown or unapproved number still returns `status: "sent"` with nothing
minted and nothing transmitted.

**The transport is a seam.** `resolveSmsDriver()` picks a driver from the environment *at
call time*: `bulksmsbd`, `ssl_wireless`, `twilio`, or the built-in `demo` driver. A driver
**never throws** — a gateway outage degrades the flow (the user is told to retry) rather
than crashing the request.

With `SMS_*` unset, the demo driver logs the message server-side and sends nothing, and —
**outside production only** — the request response echoes the code back so the flow is
testable. A half-configured provider (`SMS_PROVIDER` set, `SMS_API_KEY` empty; or
`twilio` without `TWILIO_ACCOUNT_SID`) falls back to demo with a loud `console.warn`, so a
broken production deploy is visible in the logs instead of silently swallowing every code.

⚠️ **Scale-out constraint.** OTP challenges live in an in-process `Map`, not the database
(the schema was frozen when the feature landed). A restart invalidates in-flight codes, and
on a multi-instance deploy a code is only verifiable on the instance that issued it. Add an
`OtpChallenge` model or move to Redis before scaling horizontally. The file says so in its
header.

### 2.5 Rate limiting

`lib/auth/rate-limit.ts` — fixed window, in-process `Map`, `MAX_KEYS = 5000` with eviction.
Deliberately dependency-free, in keeping with the repo's "runs with an empty `.env`" rule.

Every attempt is counted, **including attempts for accounts that do not exist** — a limiter
that only counts real accounts is itself an existence oracle.

| Flow | Key | Limit | Window |
| --- | --- | --- | --- |
| Password reset request (identifier + IP) | `pwreset:req:<id>\|<ip>` | 5 | 15 min |
| Password reset request (IP) | `pwreset:req-ip:<ip>` | 20 | 60 min |
| Password reset confirm (IP) | `pwreset:confirm:<ip>` | 20 | 15 min |
| OTP request (phone + IP) | `otp:req:<phone>\|<ip>` | 5 | 15 min |
| OTP request (IP) | `otp:req-ip:<ip>` | 20 | 60 min |
| OTP verify (IP) | `otp:verify-ip:<ip>` | 30 | 15 min |
| Reverse geocode | `geo:reverse:<userId>` | 60 | 60 s |
| Geocode search | `geo:search:<userId>` | 40 | 60 s |

The client IP comes from `x-forwarded-for` (left-most) or `x-real-ip` in
`lib/auth/request-info.ts`. **That assumes a trusted reverse proxy.** If the Node process is
ever exposed directly, those headers are client-controlled and every IP-keyed limit above is
trivially bypassed.

Two gaps are named in [§9](#9-known-gaps-and-accepted-risks): the password login path and
public customer registration are not rate limited.

---

## 3. Authorization

### 3.1 Enforced server-side, in every route

| Helper | Location | Failure mode |
| --- | --- | --- |
| `requireUser()` / `requireRole(...roles)` | `lib/auth/session.ts` | `redirect()` — to `/login`, or to the caller's own `ROLE_HOME` |
| `requireApiUser()` | `lib/auth/current-user.ts` | throws `unauthorized()` → **401** (no session, or `!isActive`) |
| `requireApproved()` | `lib/auth/current-user.ts` | throws `forbidden()` → **403** (`status !== "approved"`) |
| `requireApiRole(...roles)` | `lib/auth/current-user.ts` | throws `forbidden()` → **403** (role mismatch) |

`handle()` in `lib/http/errors.ts` converts a thrown `ApiError` into a localized JSON
response, so a guard never leaks a stack trace.

Of the **179 route handlers**, 173 call an auth helper. The six that do not are public by
design and documented in-file:

- `app/api/auth/otp/request/route.ts`, `app/api/auth/otp/verify/route.ts` — public, rate limited
- `app/api/auth/register/customer/route.ts` — public registration
- `app/api/auth/[...nextauth]/route.ts` — the Auth.js handler
- `app/api/payments/gateway/callback/order/route.ts`,
  `app/api/payments/gateway/callback/ramadan/route.ts` — gateway callbacks, deliberately
  unauthenticated; see [§5](#5-payment-integrity)

No route is unguarded by accident. Whether each `requireApiRole(...)` names the *right*
roles is a per-route review that has not been performed end to end.

### 3.2 Scope expressed as where-clauses, not post-filters

`lib/selectors/index.ts` and the service modules express "what may this person see" as a
Prisma `where` fragment applied **inside** the query. The common IDOR class is therefore
structurally absent on the paths that use them, because the rows never reach the process.

```ts
// ordersWhereForUser — lib/selectors/index.ts
case "super_admin": case "management": case "accounts": return {};
case "branch_manager": {
  const branch = await branchForManager(user.id);
  return branch ? { branchId: branch.id } : null;   // null => empty result
}
case "rider":    return { riderId: user.id };
case "customer": return { customerId: user.id };
default:         return null;
```

The same pattern is used by `complaintsWhereForUser`, `productsForUser`, `categoriesForUser`
and `employeeScope`. Catalogue reads resolve a customer's branch **server-side** via
`resolvedBranchIdFor(user.id, branchId)` and return `[]` when the requested branch does not
cover them — a client-supplied `branch_id` cannot widen the result. `adminUserListWhere`
allow-lists filter values and clamps free-text search to 80 characters.

Note that `super_admin`, `management` and `accounts` receive `{}` — unrestricted order
visibility. That is by design and matches the requirements; it is not an oversight.

### 3.3 Rider live location is duty-scoped

A rider's live position is personal data about a named individual, not operational
telemetry. `riderLocationVisibility()` in `lib/services/rider-location.ts` is the single
decision point, and `app/api/riders/[userId]/location/route.ts` delegates the whole question
to it.

| Viewer | Sees the row | Sees coordinates |
| --- | --- | --- |
| The rider themselves | yes | **yes**, on or off duty — it is their own data |
| Super admin | yes | only while the rider is **on duty** |
| Branch manager of the branch the rider is **currently on duty at** | yes | **yes** |
| Branch manager holding only a roster relationship (`assignedBranchId`) | yes | **no** — 200 with null coordinates, not 403 |
| The customer of an **in-flight delivery** assigned to that rider | yes | only while the rider is on duty |
| management / marketing / accounts / any other rider | **403** | no |

`IN_FLIGHT_DELIVERY_STATES = ["accepted", "preparing", "ready", "picked_up", "on_the_way",
"delayed"]`. **An off-duty rider is not locatable by anyone but themselves** — clocking out
really does stop the tracking, and a home-branch roster entry is a scheduling fact, not a
live shift.

The route **withholds the coordinates server-side** rather than hiding them in the UI:

```ts
latitude: access.coordinates ? profile.currentLat?.toString() ?? null : null,
```

and reports `is_online` from the duty session rather than the stale `RiderProfile.isOnline`
flag. `app/api/riders/branch/route.ts` mirrors the same rule inline for the fleet list.

**Write path** (`app/api/riders/location/route.ts`) is hardened independently: the rider id
comes from the session and never from the body, an active duty session is required (else
409), latitude/longitude/accuracy are range-checked, and `assertFreshFix()` refuses a stale
or future-dated fix.

---

## 4. Order and pricing integrity

- **The client's `branch_id` is ignored.** `resolveDeliveryBranch()` in
  `lib/services/orders.ts` derives the serving branch from the cart's products, filters to
  branches that are active, cover the point and are open right now, and picks the nearest.
- **Pricing is server-side.** Unit prices, discounts, delivery charge, coupon and coin
  discounts are all computed on the server from database state and snapshotted onto the
  order. A posted price is never used.
- **Transitions are validated twice.** Lifecycle legality against `ALLOWED_TRANSITIONS`
  (→ 409) and role authority against `*_SETTABLE` (→ 403), in `lib/constants/orders.ts`.
  Cancellation always requires a reason. Every change writes an append-only
  `OrderStatusEvent` row inside the same transaction as the update.
- **Order creation carries an idempotency key**, so a retried submit cannot create a second
  order.
- **Rider commission is idempotent.** `RiderCommission.orderId` is uniquely constrained and
  a P2002 is treated as "already recorded" (`lib/services/wallet.ts`), so a replayed
  `delivered` transition can never double-pay.
- **Wallet maths is conservative.** `availableBalance = earnings − (pending + approved) −
  paid`, so approving a withdrawal immediately holds the money and it cannot be spent twice.

---

## 5. Payment integrity

The rule the whole of `lib/services/payments.ts` is built around, stated in its own header:
**nothing a customer or a gateway redirect tells us is ever believed.**

### 5.1 Server-side re-verification

The gateway callback routes are intentionally unauthenticated — which is safe *precisely
because* no caller-supplied identity, amount or outcome is trusted anywhere in the
settlement path. The callback hands over nothing but the gateway's own `paymentID`; the
order is looked up by `where: { gatewayPaymentId: id }`.

`settleOrderGatewayPayment()` then calls `verifyGatewayPayment()`, which is
**execute-then-verify**: it calls the gateway's `execute` (whose failure on a replayed
callback is expected and swallowed with a warning), and then acts **only** on
`driver.queryPayment(id)` — bKash's server-to-server `/tokenized/checkout/payment/status`.
A forged callback cannot settle an order because the callback body contributes nothing to
the decision.

Only `transactionStatus === "completed"` counts as settled. Initiated, Authorized and
Cancelled all leave the order unpaid.

### 5.2 Exact amount comparison

```ts
/**
 * Exact to-the-paisa equality. A gateway amount is never "close enough": an
 * underpayment and an overpayment are both mismatches and both refuse to settle.
 */
export function gatewayAmountMatches(reported: Prisma.Decimal | null, expected: Prisma.Decimal): boolean {
  if (reported == null) return false;
  return new Prisma.Decimal(reported.toFixed(2)).equals(new Prisma.Decimal(expected.toFixed(2)));
}
```

This is **exact `Decimal` equality at two decimal places (paisa precision), with no epsilon
and no float**, applied against `expected = new Prisma.Decimal(order.totalAmount.toFixed(2))`.
Money is stored as `Decimal`, not as integer minor units, so "paisa-exact" here means exact
decimal equality at paisa scale.

Supporting rules:

- The reported amount is only parsed when it matches `/^\d{1,12}(\.\d{1,2})?$/`. Otherwise
  it is `null` — and `null` is a **mismatch**, never coerced to 0.
- **Currency is part of the amount.** The call site requires
  `state.currency.toUpperCase() === "BDT"`; 100 of anything else is not 100 Taka.

**On mismatch** the order is left **unpaid**, `paidAmount` is nulled, `gatewayStatus` is
prefixed `amount_mismatch:`, a `FinancialAuditLog` row is written
(`order_gateway_amount_mismatch`), expected-vs-reported is logged with the payment and
transaction ids, and both the `accounts` role and every super admin are notified.

### 5.3 No double credit, no double charge

The paid transition is a **conditional `updateMany`**, so two concurrent callbacks cannot
both credit the order:

```ts
const claimed = await prisma.order.updateMany({
  where: { id: order.id, paymentStatus: { notIn: ["paid", "verified"] } },
  data: { ...gatewayColumns, paidAmount: expected, paymentStatus: "paid", paymentVerifiedAt: new Date() },
});
if (claimed.count === 0) return { orderId: order.id, outcome: "already_paid" };
```

`paymentVerifiedById` stays `null` on this path — no human verified it — and `gatewayName`
is what distinguishes gateway settlement from staff verification in the audit trail.

`startOrderGatewayPayment()` guards the other direction: it checks ownership
(`order.customerId !== user.id` → 403), refuses when `order.paymentMethod` does not match
the resolved gateway (a Nagad order cannot be charged through the bKash driver), and if the
order already has a `gatewayPaymentId` it re-queries and **reconciles** an already-settled
attempt instead of charging again.

### 5.4 The manual wallet rail

Until gateway credentials exist, wallet payments are **record and verify**: the customer
pays the branch's number out of band and submits a transaction id.

- Ownership is checked (`ownOrder()`), so one customer cannot submit against another's order.
- The wallet is taken from `order.paymentMethod`, **never from the request body**.
- The transaction id is normalized to `/^[A-Z0-9]{6,32}$/` and **duplicates are refused
  across all orders**, so one receipt cannot pay two bills.
- The order is **never auto-marked paid**; it moves to `pending_verification`.
- The verifier's id and timestamp are recorded, and re-deciding an already-decided payment
  is refused with 409.
- Branch managers may decide only their own branch's payments; accounts and super admin may
  decide any.

### 5.5 The removed Ramadan payment path

`POST /api/ramadan/reservations/[id]/pay` previously read `{ outcome, gateway_ref }` from
the **request body** and marked the booking paid from it — anyone could POST
`{ outcome: "success" }`, book a free iftar table and fabricate revenue into the financial
audit log and the Ramadan revenue summary. That path has been deleted and replaced by the
gateway flow plus an auditable accounts-only "record offline advance received" action.

`tests/e2e/23-ramadan.spec.ts` (≈ lines 163–191) still exercises the deleted path and
therefore fails. **Rewrite that spec to assert the path is rejected. Do not restore it.**

---

## 6. Coupon and coin redemption race protection

Both use atomic conditional updates rather than read-then-write.

**Coupons** — `claimCouponForOrder()` in `lib/services/marketing.ts`. Validation and the
`usedCount` increment share one transaction, and the increment is guarded:

```ts
const ceiling: Prisma.CouponWhereInput =
  coupon.maxUses > 0 ? { usedCount: { lt: coupon.maxUses } } : {};
const claimed = await tx.coupon.updateMany({
  where: { id: coupon.id, isActive: true, isArchived: false, ...ceiling },
  data: { usedCount: { increment: 1 } },
});
if (claimed.count !== 1) {
  throw validationError({ coupon_code: sk("errors.ops.couponInvalidOrExpired") });
}
```

N simultaneous checkouts against a `maxUses = 1` coupon therefore produce exactly one
redemption. A `CouponRedemption` row is created in the same transaction, and
`@@unique([couponId, orderId])` means a replayed checkout for the same order cannot
double-count. `releaseCouponForOrder()` returns the use on cancellation, guarded by
`usedCount: { gt: 0 }` so the counter cannot go negative. A coupon with `usedCount > 0` is
archived rather than deleted, so historical discount attribution survives.

**Reward coins** — `lib/services/rewards.ts`, two stages, both protected:

- `redeemCoins()` re-reads the balance **inside** the transaction — two redemptions
  submitted at once must not both pass a check made against a stale balance — then burns a
  negative `RewardLedger` row and mints a `RewardRedemption` voucher atomically. The Taka
  value is recomputed server-side from `coinValueTk` in exact `Decimal` arithmetic and
  frozen at mint; a client-supplied value is never trusted.
- `consumeRedemptionForOrder()` is a conditional update:
  ```ts
  const claimed = await tx.rewardRedemption.updateMany({
    where: { id: voucher.id, userId: input.userId, status: "active" },
    data: { status: "consumed", consumedOrderId: input.orderId, consumedAt: new Date(), tkValue: applied },
  });
  if (claimed.count !== 1) throw validationError({ reward_code: sk("errors.rewards.voucherAlreadyUsed") });
  ```
  A voucher belonging to another customer is reported **identically** to a nonexistent code,
  so the endpoint is not a cross-customer oracle. Overflow value is re-minted as a change
  voucher rather than forfeited, and `restoreRedemptionForOrder()` is a single idempotent
  `updateMany` guarded on `status: "consumed"`.

Coin **awards** are idempotent through a `(userId, reason, dedupeKey)` unique constraint,
so the daily-login coin cannot be claimed twice in one Dhaka day.

---

## 7. Uploads

- **Validation** (`lib/http/upload.ts`): extension, MIME type and size are checked; allowed
  input is `image/jpeg`, `image/png`, `image/webp`, `image/avif`. Every image is re-encoded
  to WebP by sharp with EXIF rotation baked in and metadata stripped, so a non-decodable
  file (a payload wearing a `.jpg` extension) fails at re-encode. The stored filename is a
  `randomUUID()` inside a fixed subdirectory — there is no attacker-controlled path
  component. `deleteUpload()` refuses rooted or absolute paths and re-checks that the
  resolved path is inside `uploadDir()`.
- **Serving** (`app/api/uploads/[...path]/route.ts`): the traversal guard runs **before**
  the auth check. `PUBLIC_SUBDIRS` — `products`, `branch_logos`, `branding`,
  `ramadan_menus` — are anonymous; **everything else fails closed** behind
  `requireApproved()`, which is what protects `profile_photos`, `employee_photos` and rider
  NID/licence scans. Non-public keys are served `Cache-Control: private` so a shared cache
  cannot cross-serve a KYC document.
- `next.config.ts` `images.localPatterns` deliberately mirrors only the public subdirectories.
  **Keep the two lists in step.** Anything unlisted responds 400 — it fails loudly rather
  than silently leaking private media.

---

## 8. Secrets handling

- **`.env` and `.env.*` are gitignored**, with `!.env.example` as the single exception
  (`.gitignore`). `git ls-files` confirms no real env file is tracked.
- **`AUTH_SECRET` must be regenerated per environment.** `npx auth secret` or
  `openssl rand -base64 32`. Never share it between staging and production. Rotating it
  invalidates every session — which is the correct response to a suspected leak.
  `.env.example` ships the literal `"dev-only-change-me-please-generate-a-real-secret"`; if
  that value ever reaches a deployment, **every JWT in that environment is forgeable**.
  Treat rotation as a launch gate.
- **Never commit real bKash credentials.** `BKASH_APP_KEY`, `BKASH_APP_SECRET`,
  `BKASH_USERNAME` and `BKASH_PASSWORD` are merchant secrets; `.env.example` ships them
  commented out and empty and must stay that way. The same applies to `SMS_API_KEY`,
  `VAPID_PRIVATE_KEY`, `NAGAD_*` and any storage keys.
- **No secret belongs in a `NEXT_PUBLIC_` variable.** Anything so prefixed is inlined into
  the browser bundle. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is public by nature — restrict it by
  HTTP referrer in the Google Cloud console, and use the separate server-side
  `GOOGLE_MAPS_SERVER_API_KEY` (IP-restricted) for geocoding.
- The bKash driver uses Tokenized Checkout with `intent: "sale"` and mode `"0011"` — the
  customer authorises inside bKash's own interface, so **no PIN or wallet credential ever
  touches this application**.
- `BKASH_BASE_URL` defaults to the **sandbox**. The code never guesses "live" for a
  merchant; production must set the live URL explicitly.

---

## 9. Known gaps and accepted risks

Honest list. None of these is a reason not to ship, but each should be a decision rather
than a surprise.

| # | Gap | Where | Suggested action |
| --- | --- | --- | --- |
| 1 | **`.env.example` contains a working seed super-admin password** (`ADMIN_PASSWORD=Admin12345@##`) and is in version control. Any deployment that seeds without changing it has a publicly known super-admin credential. | `.env.example`, `prisma/seed.ts` | Set your own `ADMIN_*` before the first production seed, and change the password again after first login. Consider replacing the example value with a placeholder. **Highest-severity item on this list.** |
| 2 | **The password login path is not rate limited.** OTP, password reset and geocoding are; `bcrypt.compare` is not, so online password guessing is unthrottled at the application layer. | `auth.ts` `authorize()`, `lib/auth/actions.ts` `loginAction` | Apply `rateLimit()` keyed on identifier + IP, and consider a short lockout after N failures. |
| 3 | **Public customer registration is not rate limited.** | `app/api/auth/register/customer/route.ts` | Add an IP-keyed limit. |
| 4 | **No security response headers.** `next.config.ts` has no `headers()` function — no CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options` or `Referrer-Policy`. | `next.config.ts` | Add a `headers()` block, or set them at the Nginx tier. A CSP will need care because of the Google Maps embed. |
| 5 | **No application-level CSRF token on `app/api/**` routes.** Protection rests on Auth.js's own CSRF for auth routes and Next.js Server Actions' origin checking; state-changing REST routes are cookie-session-authenticated with nothing further. | `app/api/**` | Verify the Auth.js session cookie's `SameSite` behaviour is adequate for your threat model, or add an origin check to mutating handlers. Also note `allowedDevOrigins: ['**.*']` in `next.config.ts` — dev-only, but permissive. |
| 6 | **`LoginHistory.ipAddress` and `.userAgent` are always empty.** The columns exist; `recordLogin()` writes only `userId`. Login history therefore has no forensic value. | `auth.ts` `recordLogin()`, `prisma/schema.prisma` | Pass the values from `lib/auth/request-info.ts`. Small change, real benefit. |
| 7 | **Rate limiter and OTP challenges are in-process.** With N instances the effective allowance is `limit × N`, counters reset on restart, and an OTP is only verifiable on the issuing instance. | `lib/auth/rate-limit.ts`, `lib/auth/otp.ts` | Move both to Redis (or add an `OtpChallenge` model) before scaling out. Both files document this. |
| 8 | **IP extraction trusts `x-forwarded-for`.** Correct behind the intended Nginx tier; if the Node process is ever exposed directly, every IP-keyed limit is bypassable. | `lib/auth/request-info.ts` | Never expose the process directly. Ensure the proxy overwrites rather than appends the header. |
| 9 | **No `@@unique([couponId, customerId])`.** The per-customer coupon cap is re-counted after insert rather than enforced by a constraint, because the schema was frozen. Under a weaker transaction isolation level two orders from the same customer could theoretically both pass. | `lib/services/marketing.ts`, `prisma/schema.prisma` | Add the constraint (or a `perUserLimit` column with a guarded update) in the next migration. Acknowledged in code as a follow-up. |
| 10 | **The online Nagad driver is a documented stub.** Setting `NAGAD_*` does not enable online Nagad; it only logs a warning. | `lib/services/payments.ts` | Do not represent online Nagad as working. Nagad customers use the manual rail, which is complete. |
| 11 | **`auth.config.ts` does not override Auth.js cookie flags**, so `secure` / `sameSite` / `httpOnly` are library defaults and could not be verified from repo source. | `auth.config.ts` | Confirm the resulting `Set-Cookie` against a real HTTPS deployment. |
| 12 | **Per-route role choices have not been reviewed end to end.** 173 of 179 handlers have a guard and the six unguarded ones are intentional, but whether each `requireApiRole(...)` names the *right* roles is a review that has not been done. | `app/api/**` | Schedule a per-route authorization review before a public launch. |
| 13 | **Git history has not been audited for previously committed secrets.** | — | Run a history scan (`gitleaks`, `trufflehog`) before making the repository public. |

---

## 10. Audit trail

Every money-moving decision writes a row. When investigating a discrepancy, start here.

| Model | Covers | Read at |
| --- | --- | --- |
| `FinancialAuditLog` | Refunds, adjustments, settlements, withdrawal decisions, payment verification and rejection, commission-rule changes, gateway settlement / failure / amount mismatch. Carries `actorId`, `action`, `entity`, `entityId`, `detail`. | `/accounts/audit-log` · `GET /api/accounts/audit-log` |
| `ManagerActivityLog` | Branch-manager actions | `/admin/activity-logs` · `GET /api/activity-logs` |
| `OrderStatusEvent` | Append-only order state history with actor and reason, written in the same transaction as the status change | Attached to every order detail read |
| `CampaignEvent` | Append-only marketing sent/opened/clicked/conversion | `/marketing/performance` |
| `LoginHistory` | Every successful sign-in on both providers (⚠️ IP and user-agent columns are empty — see §9) | `/rider/login-history` |

---

## 11. If you find a vulnerability

**Please report it privately. Do not open a public GitHub issue, and do not post details in
a pull request, a commit message or a chat channel.**

Send the report to the maintainer or client contact listed in the repository's owner
metadata. Include:

1. What the issue is, in one or two sentences.
2. The exact file paths and, where you have them, line numbers.
3. Reproduction steps — the request, the role you were signed in as, and what you observed.
4. Your assessment of impact: what data or money is exposed, and to whom.
5. Any suggested fix, if you have one.

Please give the maintainers a reasonable window to respond and ship a fix before disclosing
anything publicly.

If the issue involves live payment credentials, a leaked `AUTH_SECRET`, or access to
production customer data, say so in the first line so it can be triaged immediately. The
first containment steps for a suspected secret leak are: rotate `AUTH_SECRET` (which logs
everyone out), rotate the affected gateway or SMS credentials in the provider's own portal,
and check `FinancialAuditLog` for unexplained entries.
