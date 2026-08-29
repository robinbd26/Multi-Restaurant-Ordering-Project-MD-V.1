import "server-only";
import { Prisma } from "@prisma/client";
import type { Branch, Order, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ApiError, conflict, forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { absoluteUrl } from "@/lib/seo/site";
import { WALLET_PAYMENT_METHODS, isWalletPaymentMethod, paymentLabelKey } from "@/lib/constants";
import { createNotification, notifyRole, notifySuperAdmins } from "@/lib/services/notifications";
import { getSetting, setSetting } from "@/lib/services/settings";
import { validatePhone } from "@/lib/validation/server";

/**
 * PHASE S / WS-1.4 — payment methods.
 *
 * The rails themselves live in ONE place, PAYMENT_METHOD_DEFS
 * (lib/constants/index.ts). This file implements what each RAIL does:
 *
 *  • cod (cash) — the order stays `unpaid` and is settled by the existing
 *    delivery workflow. Nothing here marks it paid.
 *  • wallet (bKash / Nagad / Rocket) — MANUAL record-and-verify. The customer
 *    pays the BRANCH's configured number for that wallet out of band and submits
 *    the transaction id. The order becomes `pending_verification` and is NEVER
 *    auto-marked paid; a branch manager (own branch) or accounts verifies or
 *    rejects it, and the actor + timestamp are recorded.
 *
 * WS-1.1 adds an automated path on top of the wallet rail: a real bKash
 * Tokenized Checkout gateway (see the gateway section at the bottom of this
 * file). It is per-provider — a rail without a driver simply keeps the manual
 * flow, which is what Nagad and Rocket do today. The offline flows are the
 * fallback whenever no gateway credentials are configured.
 *
 * WHERE A BRANCH'S WALLET NUMBERS LIVE. bKash predates this work and owns three
 * real columns (Branch.bkashNumber / bkashEnabled / bkashInstructions). The
 * schema is frozen, so Nagad and Rocket keep the SAME settings in the key-value
 * SystemSetting store under a namespaced per-branch key — exactly the precedent
 * `branchCommissionKey` set in lib/services/settings.ts. `branchWalletConfig`
 * below is the single reader, so no caller ever needs to know which of the two
 * a given wallet uses. Migrating the bKash columns to that generic shape (or,
 * better, a BranchPaymentAccount table) is recorded as a follow-up.
 *
 * On the ORDER, the three `bkash*` columns are used GENERICALLY as the manual
 * wallet-payment columns: transaction id, payer phone and the destination number
 * snapshotted at submission time. Order.paymentMethod is what says which wallet
 * they belong to. Renaming them to `wallet*` is a follow-up migration.
 */

export const PAYMENT_STATUSES = [
  "unpaid",
  "pending_verification",
  "verified",
  "rejected",
  "paid",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Normalize a wallet transaction id for storage + duplicate detection.
 *
 * bKash, Nagad and Rocket all issue the same shape of reference — a short
 * alphanumeric token — so one rule covers every wallet; anything else is
 * rejected outright. `methodRef` is an "@:" dictionary reference so the error
 * names the wallet the customer actually used, in their own language.
 */
function normalizeTransactionId(raw: unknown, methodRef: string): string {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!value) {
    throw validationError({
      transaction_id: sk("errors.payments.walletTransactionIdRequired", { method: methodRef }),
    });
  }
  if (!/^[A-Z0-9]{6,32}$/.test(value)) {
    throw validationError({ transaction_id: sk("errors.payments.transactionIdInvalid") });
  }
  return value;
}

/** A "@:payment.<method>" param, so an error/notification names the wallet. */
function methodRef(method: string): string {
  return `@:${paymentLabelKey(method)}`;
}

// ── Per-branch wallet settings ──────────────────────────────────────────────

/**
 * SystemSetting key for a wallet's per-branch destination number. Namespaced
 * exactly like `branchCommissionKey`: `<what>:<method>:branch:<id>`. Only used
 * for wallets with no dedicated Branch column (Nagad, Rocket) — bKash keeps its
 * own columns, and `branchWalletConfig` hides the difference.
 */
export function branchWalletNumberKey(method: string, branchId: number): string {
  return `branch_wallet_number:${method}:branch:${branchId}`;
}

/** SystemSetting key for a wallet's per-branch payment instructions. */
export function branchWalletInstructionsKey(method: string, branchId: number): string {
  return `branch_wallet_instructions:${method}:branch:${branchId}`;
}

/** One branch's acceptance settings for ONE wallet, whatever they are stored in. */
export interface BranchWalletConfig {
  method: string;
  /** The number customers are told to send money to ("" = not configured). */
  number: string;
  /** Optional branch-specific note shown above the submit form. */
  instructions: string;
  /**
   * Whether this branch advertises the wallet at all. For bKash this is the
   * explicit `bkashEnabled` flag AND a number; for the SystemSetting-backed
   * wallets the PRESENCE OF A NUMBER is the switch — there is no column to hold
   * a separate flag, and a wallet with no number could never be paid to anyway.
   */
  enabled: boolean;
}

/** Only the branch columns the wallet settings are read from. */
type WalletBranchFields = Pick<Branch, "id" | "bkashNumber" | "bkashEnabled" | "bkashInstructions">;

/** Read ONE wallet's settings for a branch. bKash → columns, others → settings. */
export async function branchWalletConfig(
  branch: WalletBranchFields,
  method: string,
): Promise<BranchWalletConfig> {
  if (method === "bkash") {
    const number = branch.bkashNumber.trim();
    return {
      method,
      number,
      instructions: branch.bkashInstructions,
      enabled: branch.bkashEnabled && number !== "",
    };
  }
  const [number, instructions] = await Promise.all([
    getSetting(branchWalletNumberKey(method, branch.id)),
    getSetting(branchWalletInstructionsKey(method, branch.id)),
  ]);
  const trimmed = (number ?? "").trim();
  return { method, number: trimmed, instructions: instructions ?? "", enabled: trimmed !== "" };
}

/** Every wallet's settings for a branch — what the payment panel renders from. */
export async function branchWalletConfigs(branch: WalletBranchFields): Promise<BranchWalletConfig[]> {
  return Promise.all(WALLET_PAYMENT_METHODS.map((method) => branchWalletConfig(branch, method)));
}

/** Load an order the CUSTOMER owns, or throw (IDOR-safe). */
async function ownOrder(user: User, orderId: number): Promise<Order> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound(sk("errors.orders.notFound"));
  if (order.customerId !== user.id) throw forbidden(sk("errors.orders.notYourOrder"));
  return order;
}

/**
 * WS-1.4 — customer submits a manual MOBILE WALLET payment for their own order.
 *
 * One flow for every wallet: which one is decided by the order's own
 * `paymentMethod`, never by the request body, so a customer cannot record a
 * Nagad payment against an order they placed as bKash. Rejects when the order
 * was not placed on a wallet rail at all, when the branch does not accept that
 * wallet (or has no number for it), when the transaction id is malformed, and
 * when that transaction id was already used on another order (duplicate-payment
 * protection, enforced across every wallet since they share the column).
 */
export async function submitWalletPayment(
  user: User,
  orderId: number,
  input: { transactionId: unknown; payerPhone: unknown },
) {
  const order = await ownOrder(user, orderId);
  const method = order.paymentMethod;
  if (!isWalletPaymentMethod(method)) {
    throw validationError({ payment_method: sk("errors.payments.notWalletOrder") });
  }
  if (order.paymentStatus === "verified" || order.paymentStatus === "paid") {
    throw conflict(sk("errors.payments.alreadySettled"));
  }

  const branch = await prisma.branch.findUnique({ where: { id: order.branchId } });
  if (!branch) throw notFound(sk("errors.catalog.branchNotFound"));
  const wallet = await branchWalletConfig(branch, method);
  if (!wallet.enabled) {
    throw validationError({
      payment_method: sk("errors.payments.walletUnavailable", { method: methodRef(method) }),
    });
  }

  const transactionId = normalizeTransactionId(input.transactionId, methodRef(method));
  const payerPhone = validatePhone(String(input.payerPhone ?? ""), "payer_phone");

  // Duplicate transaction ids are refused across ALL orders.
  const clash = await prisma.order.findFirst({
    where: { bkashTransactionId: transactionId, id: { not: order.id } },
    select: { id: true },
  });
  if (clash) throw conflict(sk("errors.payments.duplicateTransaction"));

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      // The `bkash*` columns are the generic manual-wallet columns (see the file
      // header); `paymentMethod` is what says which wallet this reference is for.
      bkashTransactionId: transactionId,
      bkashPayerPhone: payerPhone,
      // Snapshot the number actually advertised, so later branch edits never
      // rewrite what this customer was told to pay.
      bkashDestinationNumber: wallet.number,
      paymentStatus: "pending_verification",
      paymentSubmittedAt: new Date(),
      paymentRejectionReason: "",
    },
  });

  await notifyBranchPaymentQueue(order.branchId, order.id);
  return updated;
}

async function notifyBranchPaymentQueue(branchId: number, orderId: number) {
  const managers = await prisma.user.findMany({
    where: { role: "branch_manager", managedBranches: { some: { id: branchId } } },
    select: { id: true },
  });
  for (const m of managers) {
    await createNotification(m.id, {
      type: "payment",
      titleKey: "notifications.payment.pending.title",
      bodyKey: "notifications.payment.pending.body",
      params: { id: orderId },
      link: `/branch-manager/orders/${orderId}`,
    });
  }
}

/** Who may verify a payment: accounts (any branch) or the OWN-branch manager. */
async function assertCanVerify(user: User, order: Order) {
  if (user.role === "accounts" || user.role === "super_admin") return;
  if (user.role === "branch_manager") {
    const branch = await prisma.branch.findFirst({ where: { managerId: user.id } });
    if (!branch || branch.id !== order.branchId) {
      throw forbidden(sk("errors.payments.notYourBranch"));
    }
    return;
  }
  throw forbidden(sk("errors.payments.verifyForbidden"));
}

/**
 * Staff verifies or rejects a submitted manual WALLET payment (any wallet — the
 * decision, the audit fields and the customer notification are identical for
 * bKash, Nagad and Rocket; the verifier sees which one on the queue card).
 *
 * Records the verifier and timestamp, keeps a rejection reason exactly as typed,
 * notifies the customer, and refuses to re-decide an already-decided payment
 * (409) so the audit trail cannot be overwritten.
 */
export async function decideWalletPayment(
  user: User,
  orderId: number,
  approve: boolean,
  reason = "",
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound(sk("errors.orders.notFound"));
  await assertCanVerify(user, order);

  if (order.paymentStatus !== "pending_verification") {
    throw conflict(sk("errors.payments.notPendingVerification"));
  }
  if (!approve && !String(reason).trim()) {
    throw validationError({ reason: sk("errors.payments.rejectionReasonRequired") });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: approve ? "verified" : "rejected",
      paymentVerifiedById: user.id,
      paymentVerifiedAt: new Date(),
      // User-entered reason is stored EXACTLY as typed.
      paymentRejectionReason: approve ? "" : String(reason),
    },
  });

  await createNotification(order.customerId, {
    type: "payment",
    titleKey: approve ? "notifications.payment.verified.title" : "notifications.payment.rejected.title",
    bodyKey: approve ? "notifications.payment.verified.body" : "notifications.payment.rejected.body",
    params: { id: order.id },
    link: `/customer/orders/${order.id}`,
  });
  return updated;
}

/** One wallet's settings as a caller may submit them. Every value is unknown. */
export interface WalletSettingsInput {
  number?: unknown;
  instructions?: unknown;
  /** Only meaningful for bKash — the other wallets are enabled BY their number. */
  enabled?: unknown;
}

/** A checkbox that may arrive as a boolean (JSON) or a string (form post). */
function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Branch wallet-payment settings. Super admin may configure any branch; a branch
 * manager only their own (the id is resolved against the assignment, never
 * trusted).
 *
 * WS-1.4 — this used to know only about bKash. It now takes a `wallets` map
 * keyed by method, so a new rail needs no new parameter; the legacy `bkash*`
 * fields are kept because existing callers pass them, and they are folded into
 * the same map. bKash writes its three Branch columns; every other wallet
 * writes the namespaced SystemSetting keys (see the file header). A number is
 * validated as a real BD mobile number, and an empty value CLEARS it, which is
 * also how a branch stops accepting that wallet.
 */
export async function updateBranchPaymentSettings(
  user: User,
  submittedBranchId: number | undefined,
  input: {
    bkashEnabled?: unknown;
    bkashNumber?: unknown;
    bkashInstructions?: unknown;
    wallets?: Record<string, WalletSettingsInput>;
  },
) {
  const { resolveConfigurableBranch } = await import("@/lib/services/branches");
  const branch = await resolveConfigurableBranch(user, submittedBranchId);

  // Legacy bKash fields and the generic map are the same thing; the explicit
  // fields win when both are sent, so no caller changes behaviour.
  const wallets: Record<string, WalletSettingsInput> = { ...(input.wallets ?? {}) };
  const bkash: WalletSettingsInput = { ...(wallets.bkash ?? {}) };
  if (input.bkashNumber !== undefined) bkash.number = input.bkashNumber;
  if (input.bkashInstructions !== undefined) bkash.instructions = input.bkashInstructions;
  if (input.bkashEnabled !== undefined) bkash.enabled = input.bkashEnabled;
  if (Object.keys(bkash).length > 0) wallets.bkash = bkash;

  const data: Prisma.BranchUpdateInput = {};
  // Settings writes are collected and applied AFTER validation, so a rejected
  // number never leaves half of a branch's wallets updated.
  const settingWrites: { key: string; value: string }[] = [];
  let changed = false;

  for (const [method, settings] of Object.entries(wallets)) {
    if (!isWalletPaymentMethod(method)) {
      throw validationError({ payment_method: sk("errors.payments.unknownWalletMethod") });
    }
    // The field name an error is attached to, so the right input lights up.
    const numberField = `${method}_number`;
    let nextNumber: string | undefined;
    if (settings.number !== undefined) {
      const raw = String(settings.number ?? "").trim();
      nextNumber = raw ? validatePhone(raw, numberField) : "";
    }
    if (settings.enabled !== undefined) {
      const enabled = asBoolean(settings.enabled);
      const current = await branchWalletConfig(branch, method);
      const effectiveNumber = nextNumber ?? current.number;
      if (enabled && !effectiveNumber) {
        // Cannot advertise a wallet without a number to pay to.
        throw validationError({
          [numberField]: sk("errors.payments.walletNumberRequiredToEnable", {
            method: methodRef(method),
          }),
        });
      }
      // Only bKash has a flag column; for the others the number IS the switch,
      // so "disable" means clearing it (documented in BranchWalletConfig).
      if (method === "bkash") {
        data.bkashEnabled = enabled;
        changed = true;
      } else if (!enabled) {
        nextNumber = "";
      }
    }
    if (nextNumber !== undefined) {
      if (method === "bkash") data.bkashNumber = nextNumber;
      else settingWrites.push({ key: branchWalletNumberKey(method, branch.id), value: nextNumber });
      changed = true;
    }
    if (settings.instructions !== undefined) {
      const text = String(settings.instructions ?? "").slice(0, 500);
      if (method === "bkash") data.bkashInstructions = text;
      else settingWrites.push({ key: branchWalletInstructionsKey(method, branch.id), value: text });
      changed = true;
    }
  }

  if (!changed) {
    throw validationError({ detail: sk("errors.catalog.nothingToChange") });
  }
  for (const write of settingWrites) {
    // setSetting records the actor + timestamp on the SystemSetting row itself,
    // which is the audit trail for the wallets that have no Branch column.
    await setSetting(write.key, write.value, user.id);
  }
  return Object.keys(data).length > 0
    ? prisma.branch.update({ where: { id: branch.id }, data })
    : branch;
}

// ─────────────────────────────────────────────────────────────────────────────
// WS-1.1 — REAL PAYMENT GATEWAY (bKash Tokenized Checkout)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gateway seam, shaped exactly like the SMS seam in lib/auth/sms.ts: a driver is
 * resolved from env AT CALL TIME, and with no credentials the resolver returns
 * `null` instead of throwing. That is what keeps the repo's demo-fallback
 * promise — with an empty .env the gateway is simply unavailable and the manual
 * bKash + cash flows above keep working, byte for byte, as before.
 *
 * Only bKash is implemented today. Nagad / Rocket / SSLCommerz slot into
 * DRIVER_FACTORIES without any caller changing — WS-1.4 adds Nagad and Rocket
 * as first-class MANUAL wallets (record + verify, above), which is a complete
 * payment path on its own; an ONLINE driver for them is separate and optional.
 * See the Nagad note on DRIVER_FACTORIES for exactly what is and is not built.
 *
 * The security rule the whole file is built around: NOTHING a customer or a
 * gateway redirect tells us is ever believed. A payment is settled only after
 * `payment/status` is read back from bKash server-to-server and the amount it
 * reports matches the order total TO THE PAISA.
 */

export type GatewayName = "bkash" | "nagad" | "rocket" | "sslcommerz";

/** Where the gateway sends the customer's browser back to. */
export const GATEWAY_CALLBACK_ORDER_PATH = "/api/payments/gateway/callback/order";
export const GATEWAY_CALLBACK_RAMADAN_PATH = "/api/payments/gateway/callback/ramadan";

export interface GatewayCreateInput {
  /** Amount to charge. Rounded to 2dp by the seam, never by the driver. */
  amount: Prisma.Decimal;
  /** Merchant-side invoice number, echoed back by the gateway. */
  invoiceNumber: string;
  /** Customer reference printed on the gateway's own receipt (BD mobile). */
  payerReference: string;
  /** ABSOLUTE callback URL — the gateway rejects a relative one. */
  callbackUrl: string;
}

export interface GatewayCreateResult {
  paymentId: string;
  /** Where to send the customer's browser. */
  redirectUrl: string;
  /** Raw gateway status at creation time, stored verbatim. */
  status: string;
  raw: string;
}

export interface GatewayPaymentState {
  paymentId: string;
  trxId: string;
  /** null when the gateway reported no amount — NEVER coerce that to 0. */
  amount: Prisma.Decimal | null;
  currency: string;
  invoiceNumber: string;
  /** Raw gateway status string, stored verbatim for disputes. */
  status: string;
  /** True only when the money actually moved. */
  settled: boolean;
  failed: boolean;
  raw: string;
}

export interface PaymentGatewayDriver {
  readonly name: GatewayName;
  createPayment(input: GatewayCreateInput): Promise<GatewayCreateResult>;
  /** Finalise an authorised payment. May legitimately fail when replayed. */
  executePayment(paymentId: string): Promise<GatewayPaymentState>;
  /** Authoritative server-side status read — the ONLY source we act on. */
  queryPayment(paymentId: string): Promise<GatewayPaymentState>;
}

/** A gateway-side outage. 503 so the client knows a retry is the right move. */
function gatewayDown(detail = sk("errors.payments.gatewayUnavailable")): ApiError {
  return new ApiError(503, { detail });
}

function str(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

/** Only a plain positive decimal is accepted as money off the wire. */
function isMoneyString(value: string): boolean {
  return /^\d{1,12}(\.\d{1,2})?$/.test(value);
}

/** Gateway payloads are kept verbatim for dispute forensics, but capped. */
function rawPayload(json: unknown): string {
  try {
    return JSON.stringify(json).slice(0, 4000);
  } catch {
    return "";
  }
}

/**
 * Exact to-the-paisa equality. A gateway amount is never "close enough": an
 * underpayment and an overpayment are both mismatches and both refuse to settle.
 */
export function gatewayAmountMatches(reported: Prisma.Decimal | null, expected: Prisma.Decimal): boolean {
  if (reported == null) return false;
  return new Prisma.Decimal(reported.toFixed(2)).equals(new Prisma.Decimal(expected.toFixed(2)));
}

// ── bKash driver ────────────────────────────────────────────────────────────

// Sandbox default. Live is https://tokenized.pay.bka.sh/v1.2.0-beta — set it
// explicitly in BKASH_BASE_URL; we never guess "live" for a merchant.
const BKASH_SANDBOX_BASE = "https://tokenized.sandbox.bka.sh/v1.2.0-beta";
const BKASH_TIMEOUT_MS = 20_000;
// Renew a minute before the token actually dies so an in-flight call never
// lands on an expired one.
const TOKEN_SKEW_MS = 60_000;
// bKash transactionStatus values that mean the payment is over and lost.
const BKASH_DEAD_STATUSES = new Set(["cancelled", "canceled", "failed", "expired", "refunded"]);

interface BkashConfig {
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  baseUrl: string;
}

/** Read the bKash credentials, or null when the merchant is not configured. */
function bkashConfig(): BkashConfig | null {
  const appKey = str(process.env.BKASH_APP_KEY);
  const appSecret = str(process.env.BKASH_APP_SECRET);
  const username = str(process.env.BKASH_USERNAME);
  const password = str(process.env.BKASH_PASSWORD);
  if (!appKey || !appSecret || !username || !password) {
    // A HALF-configured deploy is a mistake, not a runtime error — say so loudly
    // in the log and stay disabled rather than failing customer requests.
    if (appKey || appSecret || username || password) {
      console.warn(
        "[payments:bkash] partially configured — BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME and BKASH_PASSWORD are ALL required. The gateway stays disabled and the manual bKash + cash flows remain in use.",
      );
    }
    return null;
  }
  const baseUrl = str(process.env.BKASH_BASE_URL).replace(/\/+$/, "");
  if (!baseUrl) {
    console.warn(`[payments:bkash] BKASH_BASE_URL is empty — defaulting to the SANDBOX endpoint ${BKASH_SANDBOX_BASE}.`);
  }
  return { appKey, appSecret, username, password, baseUrl: baseUrl || BKASH_SANDBOX_BASE };
}

interface BkashToken {
  idToken: string;
  refreshToken: string;
  /** Epoch ms after which the token must be renewed (skew already applied). */
  expiresAt: number;
}

// The token lives in memory only, and on globalThis so a dev hot-reload does not
// burn a fresh grant on every save (bKash rate-limits the grant endpoint).
const globalForGateway = globalThis as unknown as {
  bkashTokenCache?: Map<string, BkashToken>;
  bkashTokenInFlight?: Map<string, Promise<BkashToken>>;
};
const tokenCache = (globalForGateway.bkashTokenCache ??= new Map<string, BkashToken>());
const tokenInFlight = (globalForGateway.bkashTokenInFlight ??= new Map<string, Promise<BkashToken>>());

/** Credentials-scoped cache key, so rotating a key invalidates the token. */
function tokenCacheKey(cfg: BkashConfig): string {
  return `${cfg.baseUrl}|${cfg.appKey}|${cfg.username}`;
}

/** One JSON POST to bKash. Network/parse failures become a 503, never a crash. */
async function bkashPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify(body),
      cache: "no-store",
      // Customers are on prepaid 3G; a hung gateway must not hold the request open.
      signal: AbortSignal.timeout(BKASH_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[payments:bkash] network failure calling ${url}:`, err);
    throw gatewayDown();
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { nonJsonBody: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

/** Grant a brand-new token, or refresh an existing one when a refresh token exists. */
async function bkashGrant(cfg: BkashConfig, refreshToken?: string): Promise<BkashToken> {
  const path = refreshToken ? "/tokenized/checkout/token/refresh" : "/tokenized/checkout/token/grant";
  const { json } = await bkashPost(
    `${cfg.baseUrl}${path}`,
    { username: cfg.username, password: cfg.password },
    refreshToken
      ? { app_key: cfg.appKey, app_secret: cfg.appSecret, refresh_token: refreshToken }
      : { app_key: cfg.appKey, app_secret: cfg.appSecret },
  );
  const idToken = str(json.id_token);
  if (!idToken) {
    console.error(
      `[payments:bkash] token ${refreshToken ? "refresh" : "grant"} rejected: ${str(json.statusCode)} ${str(json.statusMessage)}`,
    );
    throw gatewayDown();
  }
  const ttlSeconds = Math.max(60, Number(json.expires_in) || 3600);
  return {
    idToken,
    // A refresh response does not always re-issue the refresh token; keep ours.
    refreshToken: str(json.refresh_token) || (refreshToken ?? ""),
    expiresAt: Date.now() + ttlSeconds * 1000 - TOKEN_SKEW_MS,
  };
}

/**
 * The cached id_token, renewed before expiry. Concurrent misses collapse onto a
 * single in-flight grant, because bKash rate-limits the token endpoints hard.
 */
async function bkashToken(cfg: BkashConfig, force = false): Promise<BkashToken> {
  const key = tokenCacheKey(cfg);
  const cached = tokenCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached;

  const running = tokenInFlight.get(key);
  if (running && !force) return running;

  const attempt = (async () => {
    // Prefer a refresh while we still hold a refresh token; a rejected refresh
    // falls back to a full grant rather than failing the customer's payment.
    if (cached?.refreshToken) {
      try {
        return await bkashGrant(cfg, cached.refreshToken);
      } catch {
        console.warn("[payments:bkash] token refresh failed — falling back to a fresh grant.");
      }
    }
    return bkashGrant(cfg);
  })()
    .then((token) => {
      tokenCache.set(key, token);
      return token;
    })
    .finally(() => {
      tokenInFlight.delete(key);
    });

  tokenInFlight.set(key, attempt);
  return attempt;
}

/** An authenticated bKash checkout call, with one forced re-grant on a 401. */
async function bkashCall(cfg: BkashConfig, path: string, body: unknown): Promise<Record<string, unknown>> {
  const send = (idToken: string) =>
    bkashPost(`${cfg.baseUrl}${path}`, { authorization: idToken, "x-app-key": cfg.appKey }, body);

  let token = await bkashToken(cfg);
  let res = await send(token.idToken);
  // 401 means the cached token died early (revoked, merchant re-keyed). Retry once.
  if (res.status === 401) {
    token = await bkashToken(cfg, true);
    res = await send(token.idToken);
  }
  if (res.status === 429 || res.status >= 500) {
    console.error(`[payments:bkash] ${path} returned HTTP ${res.status}: ${rawPayload(res.json)}`);
    throw gatewayDown();
  }
  return res.json;
}

/** Map a create/execute/status response onto the provider-neutral state. */
function bkashState(json: Record<string, unknown>): GatewayPaymentState {
  const transactionStatus = str(json.transactionStatus);
  const statusCode = str(json.statusCode);
  const amount = str(json.amount);
  const settled = transactionStatus.toLowerCase() === "completed";
  return {
    paymentId: str(json.paymentID),
    trxId: str(json.trxID),
    amount: amount && isMoneyString(amount) ? new Prisma.Decimal(amount) : null,
    currency: str(json.currency) || "BDT",
    invoiceNumber: str(json.merchantInvoiceNumber),
    status: transactionStatus || (statusCode ? `${statusCode} ${str(json.statusMessage)}`.trim() : "unknown"),
    // For an intent=sale payment "Completed" is the ONLY status that means the
    // money moved. Everything else — Initiated, Authorized, Cancelled — leaves
    // the order unpaid.
    settled,
    failed:
      !settled &&
      (BKASH_DEAD_STATUSES.has(transactionStatus.toLowerCase()) || (statusCode !== "" && statusCode !== "0000")),
    raw: rawPayload(json),
  };
}

function bkashDriver(cfg: BkashConfig): PaymentGatewayDriver {
  return {
    name: "bkash",
    async createPayment(input) {
      const json = await bkashCall(cfg, "/tokenized/checkout/create", {
        // "0011" is the tokenized-checkout mode: the customer authorises inside
        // bKash's own UI, so no PIN ever touches this application.
        mode: "0011",
        payerReference: input.payerReference || "N/A",
        callbackURL: input.callbackUrl,
        amount: input.amount.toFixed(2),
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: input.invoiceNumber,
      });
      const paymentId = str(json.paymentID);
      const redirectUrl = str(json.bkashURL);
      if (!paymentId || !redirectUrl) {
        console.error(`[payments:bkash] create rejected: ${str(json.statusCode)} ${str(json.statusMessage)}`);
        throw gatewayDown(sk("errors.payments.gatewayCreateFailed"));
      }
      return { paymentId, redirectUrl, status: str(json.transactionStatus) || "Initiated", raw: rawPayload(json) };
    },
    async executePayment(paymentId) {
      return bkashState(await bkashCall(cfg, "/tokenized/checkout/execute", { paymentID: paymentId }));
    },
    async queryPayment(paymentId) {
      return bkashState(await bkashCall(cfg, "/tokenized/checkout/payment/status", { paymentID: paymentId }));
    },
  };
}

// ── Driver resolution ───────────────────────────────────────────────────────

type DriverFactory = () => PaymentGatewayDriver | null;

/**
 * NAGAD — DELIBERATELY A STUB, and it says so out loud.
 *
 * Nagad's Merchant Checkout is not "bKash with different URLs": initialisation
 * is signed and encrypted with an RSA key pair the merchant is issued
 * (SHA-256/PSS signature over a sensitive-data blob, PGP-style key exchange,
 * per-order challenge), and the settlement semantics differ from tokenized
 * checkout. Writing that against the published documentation alone — with no
 * sandbox credentials to verify a single response against — would produce code
 * that LOOKS like a payment integration and silently fails to take money, or
 * worse, marks orders paid that were not. That is precisely the class of bug
 * WS-1.1 existed to remove, so it is not guessed at here.
 *
 * What Nagad customers get today is the MANUAL rail at the top of this file,
 * which is a real, complete payment path: per-branch destination number, TrxID +
 * payer phone captured from the customer, staff verification, audit trail.
 *
 * To finish the online driver later: implement `PaymentGatewayDriver` (the same
 * three methods bKash implements), read credentials from NAGAD_* env vars with
 * the same all-or-nothing `bkashConfig()` shape, return null when unconfigured,
 * and register it below. `settleOrderGatewayPayment` — including the to-the-
 * paisa amount check and the mismatch alarm — then works unchanged.
 */
function nagadDriver(): PaymentGatewayDriver | null {
  const configured = [
    process.env.NAGAD_MERCHANT_ID,
    process.env.NAGAD_MERCHANT_PRIVATE_KEY,
    process.env.NAGAD_PUBLIC_KEY,
  ].some((value) => str(value) !== "");
  if (configured) {
    // Credentials present but no driver: say so once, loudly, instead of
    // pretending online Nagad works. The manual Nagad flow is unaffected.
    console.warn(
      "[payments:nagad] NAGAD_* credentials are set but the online Nagad driver is not implemented — online Nagad stays disabled and the MANUAL Nagad flow (TrxID + staff verification) remains in use.",
    );
  }
  return null;
}

// The door left open for the other BD rails: implement a driver, register it
// here, set PAYMENT_GATEWAY_PROVIDER. No caller changes.
const DRIVER_FACTORIES: Record<GatewayName, DriverFactory> = {
  bkash: () => {
    const cfg = bkashConfig();
    return cfg ? bkashDriver(cfg) : null;
  },
  nagad: nagadDriver,
  rocket: () => null,
  sslcommerz: () => null,
};

/** The configured driver, or null when no gateway is set up. Never throws. */
export function resolvePaymentGateway(): PaymentGatewayDriver | null {
  const name = (str(process.env.PAYMENT_GATEWAY_PROVIDER).toLowerCase() || "bkash") as GatewayName;
  const factory = DRIVER_FACTORIES[name];
  if (!factory) {
    console.warn(`[payments] unknown PAYMENT_GATEWAY_PROVIDER="${name}" — online payment stays disabled.`);
    return null;
  }
  return factory();
}

/** True when a real gateway is live — drives the "show the Pay online button?" check. */
export function isGatewayConfigured(): boolean {
  return resolvePaymentGateway() !== null;
}

/** Public availability payload for the UI. Safe to call with no credentials. */
export function gatewayStatusPayload() {
  const driver = resolvePaymentGateway();
  return { configured: driver !== null, provider: driver?.name ?? "", currency: "BDT" };
}

/** The driver, or a clean field error telling the customer to use cash/manual bKash. */
function requireGateway(): PaymentGatewayDriver {
  const driver = resolvePaymentGateway();
  if (!driver) throw validationError({ payment_method: sk("errors.payments.gatewayNotConfigured") });
  return driver;
}

// ── Provider-neutral helpers (shared with the Ramadan advance flow) ─────────

/**
 * Start a gateway payment for ANY feature that needs one. Returns the URL the
 * customer's browser must be sent to. Nothing is marked paid here.
 */
export async function createGatewayPayment(input: {
  amount: Prisma.Decimal;
  invoiceNumber: string;
  payerReference: string;
  callbackPath: string;
}): Promise<GatewayCreateResult & { provider: GatewayName }> {
  const driver = requireGateway();
  const created = await driver.createPayment({
    amount: new Prisma.Decimal(input.amount.toFixed(2)),
    invoiceNumber: input.invoiceNumber,
    payerReference: input.payerReference,
    // Absolute, resolved from the request's own host so every deployment URL
    // (and the reverse proxy in front of it) gets a callback that comes back.
    callbackUrl: await absoluteUrl(input.callbackPath),
  });
  return { ...created, provider: driver.name };
}

/**
 * Execute-then-verify. The callback body is NEVER the source of truth: this
 * finalises the payment (harmless, and expected to fail, on a replay) and then
 * re-reads the authoritative state from the gateway itself. Returns null when
 * no gateway is configured.
 */
export async function verifyGatewayPayment(
  paymentId: string,
  opts: { execute?: boolean } = {},
): Promise<(GatewayPaymentState & { provider: GatewayName }) | null> {
  const id = paymentId.trim();
  if (!id) return null;
  const driver = resolvePaymentGateway();
  if (!driver) return null;
  if (opts.execute !== false) {
    await driver.executePayment(id).catch((err: unknown) => {
      // A replayed callback legitimately fails here ("already executed"); the
      // status query below is what we actually act on.
      console.warn(
        `[payments:gateway] execute failed for paymentID=${id}:`,
        err instanceof ApiError ? err.payload : err,
      );
      return null;
    });
  }
  const state = await driver.queryPayment(id);
  return { ...state, provider: driver.name };
}

/** Financial audit trail for every gateway decision — settled, refused or failed. */
async function auditGateway(actorId: number | null, action: string, orderId: number, detail: string) {
  await prisma.financialAuditLog.create({
    data: { actorId, action, entity: "Order", entityId: String(orderId), detail },
  });
}

// ── Order gateway flow ──────────────────────────────────────────────────────

export type GatewaySettlementOutcome = "paid" | "already_paid" | "failed" | "mismatch" | "unknown";

/**
 * Start a real gateway payment for an order the CUSTOMER owns.
 *
 * The order only remembers WHICH gateway payment it is waiting on — its
 * paymentStatus is untouched. Settlement happens exclusively in
 * `settleOrderGatewayPayment`, off a server-side status read.
 */
export async function startOrderGatewayPayment(user: User, orderId: number) {
  const order = await ownOrder(user, orderId);
  // The gateway is a MERCHANT-level rail, not the branch's own wallet number, so
  // branch acceptance (which governs the manual flow) is deliberately not
  // consulted here — but the order must have been placed on the SAME wallet the
  // configured driver settles. Charging a Nagad order through the bKash gateway
  // would leave a payment nobody can reconcile against the order.
  const gateway = requireGateway();
  if (order.paymentMethod !== gateway.name) {
    throw validationError({
      payment_method: sk("errors.payments.gatewayMethodMismatch", { method: methodRef(gateway.name) }),
    });
  }
  if (order.paymentStatus === "verified" || order.paymentStatus === "paid") {
    throw conflict(sk("errors.payments.alreadySettled"));
  }
  const amount = new Prisma.Decimal(order.totalAmount.toFixed(2));
  if (amount.lte(0)) throw validationError({ amount: sk("errors.payments.nothingToPay") });

  // An earlier attempt that ALREADY settled at the gateway must never be
  // replaced by a second charge — reconcile it instead.
  if (order.gatewayPaymentId) {
    const existing = await verifyGatewayPayment(order.gatewayPaymentId, { execute: false }).catch(() => null);
    if (existing?.settled) {
      const reconciled = await settleOrderGatewayPayment(order.gatewayPaymentId, { execute: false }).catch(() => null);
      // Either way there is no second charge: a clean settlement is already
      // credited, and a mismatch needs accounts, not another payment attempt.
      throw conflict(
        reconciled?.outcome === "mismatch"
          ? sk("errors.payments.gatewayAmountMismatch")
          : sk("errors.payments.alreadySettled"),
      );
    }
  }

  const created = await createGatewayPayment({
    amount,
    // The customer-facing order number is what appears on the bKash statement.
    invoiceNumber: order.orderNumber ?? `ORD-${order.id}`,
    payerReference: user.phone || order.bkashPayerPhone || "",
    callbackPath: GATEWAY_CALLBACK_ORDER_PATH,
  });

  await prisma.order.update({
    where: { id: order.id },
    data: {
      gatewayName: created.provider,
      gatewayPaymentId: created.paymentId,
      gatewayStatus: created.status,
      gatewayTrxId: "",
      gatewayRawPayload: created.raw,
      paymentSubmittedAt: new Date(),
      paymentRejectionReason: "",
    },
  });

  return { paymentId: created.paymentId, redirectUrl: created.redirectUrl, provider: created.provider };
}

/**
 * Settle — or loudly refuse — a gateway payment. Called ONLY from the callback
 * route, which hands over nothing but the gateway's own payment id.
 *
 * Guarantees:
 *  • the callback body is never trusted — the state is re-read from the gateway;
 *  • the amount the gateway reports is compared to Order.totalAmount TO THE
 *    PAISA, and a mismatch leaves the order UNPAID, writes an audit row and
 *    alerts accounts + super admins. It is never rounded away;
 *  • idempotent — an already-settled order short-circuits without re-executing,
 *    and the paid transition is a conditional updateMany so two concurrent
 *    callbacks can never both credit it.
 */
export async function settleOrderGatewayPayment(
  paymentId: string,
  opts: { execute?: boolean } = {},
): Promise<{ orderId: number | null; outcome: GatewaySettlementOutcome }> {
  const id = paymentId.trim();
  if (!id) return { orderId: null, outcome: "unknown" };

  const order = await prisma.order.findFirst({ where: { gatewayPaymentId: id } });
  if (!order) {
    console.error(`[payments:gateway] callback for an unknown paymentID=${id} — ignored.`);
    return { orderId: null, outcome: "unknown" };
  }
  // Already settled → never execute again, never credit again.
  if (order.paymentStatus === "paid" || order.paymentStatus === "verified") {
    return { orderId: order.id, outcome: "already_paid" };
  }

  const state = await verifyGatewayPayment(id, { execute: opts.execute });
  if (!state) return { orderId: order.id, outcome: "unknown" };

  const gatewayColumns = {
    gatewayName: state.provider,
    gatewayStatus: state.status,
    gatewayTrxId: state.trxId,
    gatewayRawPayload: state.raw,
  };
  const expected = new Prisma.Decimal(order.totalAmount.toFixed(2));

  if (!state.settled) {
    // Cancelled / failed / still pending — record what the gateway said and
    // leave paymentStatus exactly where it was.
    await prisma.order.update({ where: { id: order.id }, data: gatewayColumns });
    await auditGateway(
      null,
      "order_gateway_payment_failed",
      order.id,
      `Order ${order.orderNumber ?? order.id}: ${state.provider} paymentID=${id} status="${state.status}" — left unpaid.`,
    );
    return { orderId: order.id, outcome: "failed" };
  }

  // Our own invoice number coming back changed is not fatal (the paymentID is
  // what binds this to the order), but it is worth seeing in the logs.
  const ourInvoice = order.orderNumber ?? `ORD-${order.id}`;
  if (state.invoiceNumber && state.invoiceNumber !== ourInvoice) {
    console.warn(
      `[payments:gateway] order ${order.id}: gateway echoed invoice "${state.invoiceNumber}", we sent "${ourInvoice}".`,
    );
  }

  // Currency is part of the amount: 100 of anything else is not 100 Taka.
  if (!gatewayAmountMatches(state.amount, expected) || state.currency.toUpperCase() !== "BDT") {
    // FAIL LOUDLY. Money moved at the gateway, but not the amount we asked for,
    // so this order must NOT read as paid — accounts reconcile it by hand.
    const reported = state.amount ? `${state.amount.toFixed(2)} ${state.currency}` : "none";
    console.error(
      `[payments:gateway] AMOUNT MISMATCH on order ${order.id}: expected ${expected.toFixed(2)} BDT, gateway reported ${reported} (paymentID=${id}, trxID=${state.trxId || "-"}).`,
    );
    await prisma.order.update({
      where: { id: order.id },
      data: { ...gatewayColumns, gatewayStatus: `amount_mismatch:${state.status}`, paidAmount: null },
    });
    await auditGateway(
      null,
      "order_gateway_amount_mismatch",
      order.id,
      `Order ${ourInvoice}: expected ${expected.toFixed(2)} BDT, ${state.provider} reported ${reported} (trxID ${state.trxId || "-"}, paymentID ${id}). NOT marked paid.`,
    );
    const alert = {
      type: "payment" as const,
      titleKey: "notifications.payment.mismatch.title",
      bodyKey: "notifications.payment.mismatch.body",
      params: { id: order.id },
      link: "/accounts/payments",
    };
    await notifyRole("accounts", alert);
    await notifySuperAdmins(alert);
    return { orderId: order.id, outcome: "mismatch" };
  }

  // Conditional write — two concurrent callbacks cannot both credit the order.
  // Note `paymentVerifiedById` stays null: no human verified this, the gateway
  // did, and `gatewayName` is what tells the two apart.
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, paymentStatus: { notIn: ["paid", "verified"] } },
    data: {
      ...gatewayColumns,
      paidAmount: expected,
      paymentStatus: "paid",
      paymentVerifiedAt: new Date(),
      paymentRejectionReason: "",
    },
  });
  if (claimed.count === 0) return { orderId: order.id, outcome: "already_paid" };

  await auditGateway(
    order.customerId,
    "order_gateway_payment_settled",
    order.id,
    `Order ${order.orderNumber ?? order.id}: ${state.provider} settled ${expected.toFixed(2)} BDT (paymentID ${id}, trxID ${state.trxId || "-"}).`,
  );
  await createNotification(order.customerId, {
    type: "payment",
    titleKey: "notifications.payment.verified.title",
    bodyKey: "notifications.payment.verified.body",
    params: { id: order.id },
    link: `/customer/orders/${order.id}`,
  });
  return { orderId: order.id, outcome: "paid" };
}
