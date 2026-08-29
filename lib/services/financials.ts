import "server-only";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { notFound, sk, validationError } from "@/lib/http/errors";
import { createNotification, notifySuperAdmins } from "@/lib/services/notifications";
import { chargeRates, type ChargeRates } from "@/lib/services/settings";
import { dhakaAddDays, dhakaDayStartFromKey } from "@/lib/utils/dates";

export const EXPENSE_CATEGORIES = [
  "rent",
  "utilities",
  "salary",
  "maintenance",
  "inventory",
  "delivery",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const ZERO = new Prisma.Decimal(0);

function audit(actorId: number, action: string, entity: string, entityId: number | string, detail: string) {
  return prisma.financialAuditLog.create({
    data: { actorId, action, entity, entityId: String(entityId), detail },
  });
}

/** Process a customer refund (per super-admin policy) and notify the customer. */
export async function processRefund(actor: User, orderId: number, amountRaw: string, reason: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound(sk("errors.money.orderNotFound"));
  const amount = Number(amountRaw);
  if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
    throw validationError({ amount: sk("errors.money.enterValidAmount") });
  }
  const already = await prisma.refund.aggregate({ where: { orderId }, _sum: { amount: true } });
  const refunded = already._sum.amount ?? ZERO;
  if (new Prisma.Decimal(amountRaw).plus(refunded).greaterThan(order.totalAmount)) {
    throw validationError({
      amount: sk("errors.money.refundExceedsOrderTotal", { amount: order.totalAmount.minus(refunded).toFixed(2) }),
    });
  }
  if (!reason.trim()) throw validationError({ reason: sk("errors.money.enterRefundReason") });

  const refund = await prisma.refund.create({
    data: {
      orderId,
      amount: new Prisma.Decimal(amountRaw),
      reason: reason.trim(),
      processedById: actor.id,
    },
    include: { order: true, processedBy: true },
  });
  await audit(actor.id, "refund_processed", "Refund", refund.id, `Order #${orderId} → ৳${amount.toFixed(2)}`);
  await createNotification(order.customerId, {
    type: "payment",
    titleKey: "notifications.refund.processed.title",
    bodyKey: "notifications.refund.processed.body",
    params: { id: orderId, amount: amount.toFixed(2) },
    link: `/customer/orders/${orderId}`,
  });
  // Financial oversight: super admins are told about every refund.
  await notifySuperAdmins({
    type: "payment",
    titleKey: "notifications.refund.recorded.title",
    bodyKey: "notifications.refund.recorded.body",
    params: { id: orderId, amount: amount.toFixed(2) },
    link: `/admin/orders/${orderId}`,
  });
  return refund;
}

/** Record a branch expense. */
export async function recordExpense(
  actor: User,
  input: { branchId: number; category: string; amount: string; note: string; expenseDate: string },
) {
  if (!EXPENSE_CATEGORIES.includes(input.category as ExpenseCategory)) {
    throw validationError({ category: sk("errors.money.selectValidExpenseCategory") });
  }
  const amount = Number(input.amount);
  if (!input.amount || Number.isNaN(amount) || amount <= 0) {
    throw validationError({ amount: sk("errors.money.enterValidAmount") });
  }
  // WS-2.7 — an expense is filed against a DHAKA business day. `new Date("…T00:00:00")`
  // is the SERVER's midnight, so on a UTC host an expense typed as the 5th landed
  // 6 hours into the 5th in Dhaka — harmless by luck, but on any other host it
  // lands in the neighbouring day and silently misses that day's settlement.
  const date = dhakaDayStartFromKey(input.expenseDate);
  if (!date) throw validationError({ expense_date: sk("errors.money.enterValidDate") });
  const branch = await prisma.branch.findUnique({ where: { id: input.branchId } });
  if (!branch) throw validationError({ branch_id: sk("errors.money.selectBranch") });

  const expense = await prisma.branchExpense.create({
    data: {
      branchId: branch.id,
      category: input.category,
      amount: new Prisma.Decimal(input.amount),
      note: input.note.trim(),
      expenseDate: date,
      createdById: actor.id,
    },
    include: { branch: true, createdBy: true },
  });
  await audit(actor.id, "expense_recorded", "BranchExpense", expense.id, `${branch.name} · ${input.category} · ৳${amount.toFixed(2)}`);
  return expense;
}

/** Record a manual financial adjustment (credit/debit). */
export async function recordAdjustment(
  actor: User,
  input: { type: string; amount: string; note: string; branchId?: number | null },
) {
  if (input.type !== "credit" && input.type !== "debit") {
    throw validationError({ type: sk("errors.money.selectCreditOrDebit") });
  }
  const amount = Number(input.amount);
  if (!input.amount || Number.isNaN(amount) || amount <= 0) {
    throw validationError({ amount: sk("errors.money.enterValidAmount") });
  }
  if (!input.note.trim()) throw validationError({ note: sk("errors.money.enterAdjustmentReason") });

  const adjustment = await prisma.financialAdjustment.create({
    data: {
      type: input.type,
      amount: new Prisma.Decimal(input.amount),
      note: input.note.trim(),
      branchId: input.branchId ?? null,
      createdById: actor.id,
    },
    include: { branch: true, createdBy: true },
  });
  await audit(actor.id, "adjustment_recorded", "FinancialAdjustment", adjustment.id, `${input.type} ৳${amount.toFixed(2)} — ${input.note.trim()}`);
  return adjustment;
}

// ── WS-2.1 / WS-2.2 — period money aggregation & reconciliation ────────
//
// Every figure below is exact Prisma.Decimal arithmetic. Nothing here ever goes
// through a JS float: a Taka rounded by binary floating point is a Taka the
// branch cash box will not agree with.

/**
 * The window every figure is measured over. `to` is EXCLUSIVE; omit it for
 * "everything since `from`". `branchId` narrows to a single outlet — a
 * company-wide FinancialAdjustment (branchId null) is then deliberately left
 * out, because it belongs to no single branch's settlement.
 */
export interface FinancialWindow {
  from: Date;
  to?: Date;
  branchId?: number;
  /**
   * WS-2.7 — which timestamp files an order into the window.
   *
   * `"created"` (the default, and what every existing caller keeps) files an
   * order by when it was PLACED. `"delivered"` files it by when it was actually
   * handed over, resolved from the append-only OrderStatusEvent trail — the only
   * trustworthy delivery time. `Order.updatedAt` is NOT one: payment
   * verification and refunds both bump it long after the food arrived.
   *
   * An end-of-day settlement MUST use `"delivered"`: an order placed at 23:50
   * and delivered at 00:20 is cash the NEXT day's shift hands in.
   */
  basis?: SettlementBasis;
}

export type SettlementBasis = "created" | "delivered";

/**
 * Payment statuses that mean a human or a gateway CONFIRMED the money arrived.
 * Mirrors PAYMENT_STATUSES in lib/services/payments.ts; kept as a local literal
 * so finance never imports the payment write-path.
 */
const CONFIRMED_PAYMENT_STATUSES = ["verified", "paid"];

/** Methods the accounts requirements name explicitly; always rendered, even at zero. */
export const REPORTED_PAYMENT_METHODS = ["cash", "bkash", "card"] as const;

/**
 * WS-2.6 — the LEDGER's own outcome for an order, on top of the kitchen status.
 *
 * "Refunded" was unreachable anywhere in Accounts: the transactions ledger
 * showed the order status (delivered/cancelled/…), so an order whose money had
 * been handed back still read as a completed sale, and there was no value to
 * filter on. A refund is a first-class ledger outcome, so it gets its own
 * status, its own column and its own filter.
 */
export const LEDGER_STATUSES = ["refunded", "partially_refunded", "settled", "outstanding"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/**
 * Classify one order for the ledger. Refund state outranks payment state: money
 * that went back is the outcome, however it was collected. The comparison is
 * `greaterThanOrEqualTo` rather than `equals` because a refund may be authorised
 * up to — and exactly to — the order total.
 */
export function ledgerStatusFor(
  total: Prisma.Decimal,
  refunded: Prisma.Decimal,
  paymentStatus: string,
): LedgerStatus {
  if (refunded.greaterThan(0)) {
    return refunded.greaterThanOrEqualTo(total) ? "refunded" : "partially_refunded";
  }
  return CONFIRMED_PAYMENT_STATUSES.includes(paymentStatus) ? "settled" : "outstanding";
}

/** Cash-on-delivery is the only method the rider physically collects at the door. */
const CASH_METHOD = "cash";

/** One period row of the accounts report. */
export interface FinancialBucket {
  label: string;
  orders: number;
  sales: Prisma.Decimal;
  deliveryRevenue: Prisma.Decimal;
  foodRevenue: Prisma.Decimal;
  refunds: Prisma.Decimal;
  commission: Prisma.Decimal;
  expenses: Prisma.Decimal;
  adjustments: Prisma.Decimal;
  withdrawalsPaid: Prisma.Decimal;
  net: Prisma.Decimal;
}

export interface FinancialTotals {
  orders: number;
  /** Σ Order.totalAmount over delivered orders. ALREADY INCLUDES deliveryCharge. */
  sales: Prisma.Decimal;
  /** Σ Order.deliveryCharge — the delivery SLICE of `sales`, never additive to it. */
  deliveryRevenue: Prisma.Decimal;
  /** sales − deliveryRevenue: the food slice, already net of coupon/coin discount. */
  foodRevenue: Prisma.Decimal;
  /** Σ Refund.amount processed in the window (recognised when paid out, not when ordered). */
  refunds: Prisma.Decimal;
  commission: Prisma.Decimal;
  expenses: Prisma.Decimal;
  adjustmentsCredit: Prisma.Decimal;
  adjustmentsDebit: Prisma.Decimal;
  /** credit − debit. Positive adds to net revenue, negative subtracts. */
  adjustments: Prisma.Decimal;
  /**
   * Rider withdrawals actually paid out. A cash OUTFLOW, not a P&L expense — the
   * commission was already expensed when it accrued, so this stays out of
   * `netRevenue` and is reported alongside it. Always zero for a branch window:
   * RiderWithdrawal carries no branch, so it cannot honestly be attributed.
   */
  withdrawalsPaid: Prisma.Decimal;
  /** sales − refunds. */
  netSales: Prisma.Decimal;
  /** netSales − commission. */
  netAfterCommission: Prisma.Decimal;
  /** netSales − commission − expenses + adjustments. THE headline number. */
  netRevenue: Prisma.Decimal;
}

/**
 * WS-2.1 — the four money figures that must agree, plus the gaps between them.
 * Reporting only `netRevenue` hid every one of these differences; reporting the
 * ladder makes an unexplained gap impossible to absorb silently.
 */
export interface FinancialReconciliation {
  /** What the order book says was due on delivered orders (Σ totalAmount). */
  recorded: Prisma.Decimal;
  /** What should physically be in hand: COD delivered + digitally confirmed. */
  collected: Prisma.Decimal;
  /** What a human or a gateway actually confirmed (paymentStatus verified|paid). */
  verified: Prisma.Decimal;
  /** What a payment gateway actually settled (Σ Order.paidAmount). */
  settled: Prisma.Decimal;
  /** recorded − collected: delivered, yet nobody says the money arrived. */
  uncollected: Prisma.Decimal;
  /** collected − verified: in hand but unverified — normally the COD cash. */
  unverified: Prisma.Decimal;
  /**
   * verified − settled: staff-confirmed yet never settled by a gateway. Goes
   * NEGATIVE when a gateway settled money the order's paymentStatus never
   * acknowledged — which is itself a control failure worth seeing, so the sign
   * is shown rather than clamped away.
   */
  unsettled: Prisma.Decimal;
  /** Cash-on-delivery slice of `collected` — what the branch must hand in. */
  cashCollected: Prisma.Decimal;
  /** Digital (bKash/card) slice of `collected`. */
  digitalCollected: Prisma.Decimal;
  /** Refunds paid back out in the window — money that left again. */
  refunded: Prisma.Decimal;
  /** collected − refunded: what should be bankable at the end of the window. */
  expectedInHand: Prisma.Decimal;
}

/** WS-2.2 — per-method split, food revenue separated from delivery revenue. */
export interface PaymentMethodTotals {
  method: string;
  orders: number;
  sales: Prisma.Decimal;
  deliveryRevenue: Prisma.Decimal;
  foodRevenue: Prisma.Decimal;
  collected: Prisma.Decimal;
  verified: Prisma.Decimal;
  settled: Prisma.Decimal;
}

export interface PeriodFinancials {
  totals: FinancialTotals;
  reconciliation: FinancialReconciliation;
  byMethod: PaymentMethodTotals[];
  /** Empty unless a `bucketKey` was supplied; newest bucket first. */
  buckets: FinancialBucket[];
}

/** Columns every money figure is derived from. Deliberately minimal. */
const MONEY_ORDER_SELECT = {
  id: true,
  createdAt: true,
  totalAmount: true,
  deliveryCharge: true,
  paymentMethod: true,
  paymentStatus: true,
  paidAmount: true,
} as const;

/** A Prisma date filter, `to` exclusive — the one shape every query here uses. */
type DateRange = { gte: Date; lt?: Date };

function withinRange(at: Date, range: DateRange): boolean {
  if (at < range.gte) return false;
  return range.lt === undefined || at < range.lt;
}

/**
 * WS-2.7 — when each delivered order was actually DELIVERED, for every order
 * whose delivery falls inside the window.
 *
 * The delivery time is the FIRST `→ delivered` OrderStatusEvent. Taking the
 * first matters: a re-fired transition (a status corrected back and forth)
 * writes a second event, and counting the later one would move settled money
 * into a day whose cash was already handed in.
 *
 * Orders carrying no delivered event at all — rows written before the event
 * trail existed — fall back to `createdAt`. That is a deliberate choice: an
 * approximate day is recoverable, an order that silently appears in NO day's
 * settlement is money that has vanished from the books.
 */
async function deliveredAtByOrder(
  range: DateRange,
  branchScope: { branchId?: number },
): Promise<Map<number, Date>> {
  const candidates = await prisma.orderStatusEvent.findMany({
    where: { toStatus: "delivered", createdAt: range, order: { ...branchScope, status: "delivered" } },
    select: { orderId: true },
    distinct: ["orderId"],
  });

  const deliveredAt = new Map<number, Date>();
  if (candidates.length > 0) {
    // Re-read the FULL history of each candidate: its first delivery may sit
    // before this window even though a later, repeated event sits inside it.
    const events = await prisma.orderStatusEvent.findMany({
      where: { toStatus: "delivered", orderId: { in: candidates.map((c) => c.orderId) } },
      select: { orderId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const firstAt = new Map<number, Date>();
    for (const e of events) if (!firstAt.has(e.orderId)) firstAt.set(e.orderId, e.createdAt);
    for (const [orderId, at] of firstAt) if (withinRange(at, range)) deliveredAt.set(orderId, at);
  }

  const legacy = await prisma.order.findMany({
    where: {
      ...branchScope,
      status: "delivered",
      createdAt: range,
      statusEvents: { none: { toStatus: "delivered" } },
    },
    select: { id: true, createdAt: true },
  });
  for (const o of legacy) deliveredAt.set(o.id, o.createdAt);

  return deliveredAt;
}

function emptyBucket(label: string): FinancialBucket {
  return {
    label,
    orders: 0,
    sales: ZERO,
    deliveryRevenue: ZERO,
    foodRevenue: ZERO,
    refunds: ZERO,
    commission: ZERO,
    expenses: ZERO,
    adjustments: ZERO,
    withdrawalsPaid: ZERO,
    net: ZERO,
  };
}

function emptyMethod(method: string): PaymentMethodTotals {
  return {
    method,
    orders: 0,
    sales: ZERO,
    deliveryRevenue: ZERO,
    foodRevenue: ZERO,
    collected: ZERO,
    verified: ZERO,
    settled: ZERO,
  };
}

/**
 * The whole money picture for a window: totals, the collected/recorded/verified/
 * settled reconciliation ladder, the payment-method split, and (optionally) one
 * row per period bucket.
 *
 * Corrects the long-standing `sales − commission − expenses` formula, which
 * never subtracted Refund rows and never applied FinancialAdjustment rows even
 * though both models are populated — so the headline number was simply wrong.
 *
 * Refunds are recognised in the period they were PROCESSED (Refund.createdAt),
 * not the period of the original order, so a closed period is never restated
 * behind the accountant's back.
 */
export async function periodFinancials(
  input: FinancialWindow,
  bucketKey?: (d: Date) => string,
): Promise<PeriodFinancials> {
  const range: DateRange = input.to ? { gte: input.from, lt: input.to } : { gte: input.from };
  const branchScope = input.branchId != null ? { branchId: input.branchId } : {};
  // Refund carries no branch of its own; scope it through its order.
  const refundScope = input.branchId != null ? { order: { branchId: input.branchId } } : {};

  // WS-2.7 — on the delivered basis the window is resolved from the status trail
  // FIRST, and the orders are then loaded by id; on the created basis nothing
  // changes from before.
  const deliveredAt =
    input.basis === "delivered" ? await deliveredAtByOrder(range, branchScope) : null;

  const [orders, refunds, commissions, expenses, adjustments, withdrawals] = await Promise.all([
    deliveredAt
      ? deliveredAt.size === 0
        ? Promise.resolve([])
        : prisma.order.findMany({
            where: { id: { in: [...deliveredAt.keys()] } },
            select: MONEY_ORDER_SELECT,
          })
      : prisma.order.findMany({
          where: { ...branchScope, status: "delivered", createdAt: range },
          select: MONEY_ORDER_SELECT,
        }),
    prisma.refund.findMany({
      where: { ...refundScope, createdAt: range },
      select: { createdAt: true, amount: true },
    }),
    prisma.riderCommission.findMany({
      where: { ...branchScope, createdAt: range },
      select: { createdAt: true, amount: true },
    }),
    prisma.branchExpense.findMany({
      where: { ...branchScope, expenseDate: range },
      select: { expenseDate: true, amount: true },
    }),
    // A credit ADDS and a debit SUBTRACTS: the direction lives in `type`, never
    // in `amount` (recordAdjustment refuses a non-positive amount).
    prisma.financialAdjustment.findMany({
      where: { ...branchScope, createdAt: range },
      select: { createdAt: true, type: true, amount: true },
    }),
    input.branchId != null
      ? Promise.resolve([] as { paidAt: Date | null; amount: Prisma.Decimal }[])
      : prisma.riderWithdrawal.findMany({
          where: { status: "paid", paidAt: range },
          select: { paidAt: true, amount: true },
        }),
  ]);

  const buckets = new Map<string, FinancialBucket>();
  const bucketAt = (d: Date | null): FinancialBucket | null => {
    if (!bucketKey || !d) return null;
    const key = bucketKey(d);
    const existing = buckets.get(key);
    if (existing) return existing;
    const fresh = emptyBucket(key);
    buckets.set(key, fresh);
    return fresh;
  };

  const methods = new Map<string, PaymentMethodTotals>(
    REPORTED_PAYMENT_METHODS.map((m) => [m, emptyMethod(m)]),
  );

  let sales = ZERO;
  let deliveryRevenue = ZERO;
  let collected = ZERO;
  let verified = ZERO;
  let settled = ZERO;
  let cashCollected = ZERO;

  for (const o of orders) {
    // totalAmount ALREADY contains deliveryCharge (orders.ts: items + delivery −
    // discount), so delivery revenue is a slice of sales, never an addition.
    const food = o.totalAmount.minus(o.deliveryCharge);
    const isCash = o.paymentMethod === CASH_METHOD;
    const isConfirmed = CONFIRMED_PAYMENT_STATUSES.includes(o.paymentStatus);
    // COD is collected by the rider at the door, so delivery IS the collection
    // event. Every other method only counts once someone confirmed it.
    const isCollected = isCash || isConfirmed;

    sales = sales.plus(o.totalAmount);
    deliveryRevenue = deliveryRevenue.plus(o.deliveryCharge);
    if (isCollected) collected = collected.plus(o.totalAmount);
    if (isCash && isCollected) cashCollected = cashCollected.plus(o.totalAmount);
    if (isConfirmed) verified = verified.plus(o.totalAmount);
    // paidAmount is null until a gateway settles; that null is the whole point.
    if (o.paidAmount) settled = settled.plus(o.paidAmount);

    const m = methods.get(o.paymentMethod) ?? emptyMethod(o.paymentMethod);
    m.orders += 1;
    m.sales = m.sales.plus(o.totalAmount);
    m.deliveryRevenue = m.deliveryRevenue.plus(o.deliveryCharge);
    m.foodRevenue = m.foodRevenue.plus(food);
    if (isCollected) m.collected = m.collected.plus(o.totalAmount);
    if (isConfirmed) m.verified = m.verified.plus(o.totalAmount);
    if (o.paidAmount) m.settled = m.settled.plus(o.paidAmount);
    methods.set(o.paymentMethod, m);

    // On the delivered basis an order belongs to the day it was HANDED OVER.
    const b = bucketAt(deliveredAt?.get(o.id) ?? o.createdAt);
    if (b) {
      b.orders += 1;
      b.sales = b.sales.plus(o.totalAmount);
      b.deliveryRevenue = b.deliveryRevenue.plus(o.deliveryCharge);
      b.foodRevenue = b.foodRevenue.plus(food);
    }
  }

  let refundTotal = ZERO;
  for (const r of refunds) {
    refundTotal = refundTotal.plus(r.amount);
    const b = bucketAt(r.createdAt);
    if (b) b.refunds = b.refunds.plus(r.amount);
  }

  let commission = ZERO;
  for (const c of commissions) {
    commission = commission.plus(c.amount);
    const b = bucketAt(c.createdAt);
    if (b) b.commission = b.commission.plus(c.amount);
  }

  let expenseTotal = ZERO;
  for (const e of expenses) {
    expenseTotal = expenseTotal.plus(e.amount);
    const b = bucketAt(e.expenseDate);
    if (b) b.expenses = b.expenses.plus(e.amount);
  }

  let adjustmentsCredit = ZERO;
  let adjustmentsDebit = ZERO;
  for (const a of adjustments) {
    const signed = a.type === "debit" ? ZERO.minus(a.amount) : a.amount;
    if (a.type === "debit") adjustmentsDebit = adjustmentsDebit.plus(a.amount);
    else adjustmentsCredit = adjustmentsCredit.plus(a.amount);
    const b = bucketAt(a.createdAt);
    if (b) b.adjustments = b.adjustments.plus(signed);
  }

  let withdrawalsPaid = ZERO;
  for (const w of withdrawals) {
    if (!w.paidAt) continue;
    withdrawalsPaid = withdrawalsPaid.plus(w.amount);
    const b = bucketAt(w.paidAt);
    if (b) b.withdrawalsPaid = b.withdrawalsPaid.plus(w.amount);
  }

  const adjustmentsNet = adjustmentsCredit.minus(adjustmentsDebit);
  const netSales = sales.minus(refundTotal);
  const netAfterCommission = netSales.minus(commission);
  const netRevenue = netAfterCommission.minus(expenseTotal).plus(adjustmentsNet);

  for (const b of buckets.values()) {
    b.net = b.sales.minus(b.refunds).minus(b.commission).minus(b.expenses).plus(b.adjustments);
  }

  return {
    totals: {
      orders: orders.length,
      sales,
      deliveryRevenue,
      foodRevenue: sales.minus(deliveryRevenue),
      refunds: refundTotal,
      commission,
      expenses: expenseTotal,
      adjustmentsCredit,
      adjustmentsDebit,
      adjustments: adjustmentsNet,
      withdrawalsPaid,
      netSales,
      netAfterCommission,
      netRevenue,
    },
    reconciliation: {
      recorded: sales,
      collected,
      verified,
      settled,
      uncollected: sales.minus(collected),
      unverified: collected.minus(verified),
      unsettled: verified.minus(settled),
      cashCollected,
      digitalCollected: collected.minus(cashCollected),
      refunded: refundTotal,
      expectedInHand: collected.minus(refundTotal),
    },
    byMethod: [...methods.values()].sort((a, b) => (a.sales.greaterThan(b.sales) ? -1 : 1)),
    // Newest period first, matching the report table's existing ordering.
    buckets: [...buckets.values()].sort((a, b) => (a.label < b.label ? 1 : -1)),
  };
}

/**
 * Generate (or regenerate) the end-of-day settlement for a branch + business day.
 *
 * WS-2.7 — two corrections that decide whether a branch's cash box agrees:
 *
 *  1. THE DAY. `new Date("2026-08-29T00:00:00")` is the SERVER's midnight. On a
 *     UTC host that is 06:00 in Dhaka, so every order taken between midnight and
 *     6am was settled against the WRONG shift. The window is now the Dhaka
 *     business day, from lib/utils/dates.ts, which is the only definition of a
 *     day this application recognises.
 *  2. THE BUCKETING. Sales were filed by `createdAt` — when the order was
 *     PLACED. An order placed at 23:50 and delivered at 00:20 is cash the next
 *     shift physically hands in, so the day's takings are now resolved from the
 *     delivery time on the OrderStatusEvent trail (`basis: "delivered"`).
 *
 * Refunds paid out and authorised adjustments are inside `net` (WS-2.1);
 * BranchSettlement has no column for either (schema frozen), so both are spelled
 * out in the audit detail below and returned with the snapshot, and the cash
 * reconciliation travels alongside so "net" can be checked against the money.
 */
export async function generateSettlement(actor: User, branchId: number, dateStr: string) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw validationError({ branch_id: sk("errors.money.selectBranch") });
  const date = dhakaDayStartFromKey(dateStr);
  if (!date) throw validationError({ date: sk("errors.money.enterValidDate") });
  const next = dhakaAddDays(date, 1);

  const { totals, reconciliation } = await periodFinancials({
    from: date,
    to: next,
    branchId,
    basis: "delivered",
  });

  const sales = totals.sales;
  const commission = totals.commission;
  const expenseSum = totals.expenses;
  const net = totals.netRevenue;

  const settlement = await prisma.branchSettlement.upsert({
    where: { branchId_date: { branchId, date } },
    update: { orders: totals.orders, sales, commission, expenses: expenseSum, net, generatedById: actor.id },
    create: {
      branchId,
      date,
      orders: totals.orders,
      sales,
      commission,
      expenses: expenseSum,
      net,
      generatedById: actor.id,
    },
    include: { branch: true, generatedBy: true },
  });
  await audit(
    actor.id,
    "settlement_generated",
    "BranchSettlement",
    settlement.id,
    `${branch.name} · ${dateStr} · sales ৳${sales.toFixed(2)} (delivery ৳${totals.deliveryRevenue.toFixed(2)})`
      + ` − refunds ৳${totals.refunds.toFixed(2)} − commission ৳${commission.toFixed(2)}`
      + ` − expenses ৳${expenseSum.toFixed(2)} ${totals.adjustments.isNegative() ? "−" : "+"} adjustments ৳${totals.adjustments.abs().toFixed(2)}`
      + ` = net ৳${net.toFixed(2)}`,
  );
  // `breakdown` and `reconciliation` travel with the snapshot so the caller can
  // show WHY net is not simply sales − commission − expenses, and what cash the
  // branch is expected to hand in. Nothing extra is queried for either.
  return { ...settlement, breakdown: totals, reconciliation };
}

// ── WS-2.3 — deductions & charges ───────────────────────────────────────
//
// Tax, service charge, discounts, coupon cost and promotional deductions were
// reported NOWHERE, so nobody could answer "what did we give away this month?"
// or "how much of last month's takings was VAT?".
//
// READ THIS BEFORE CHANGING A FORMULA. `Order.totalAmount` is items + delivery
// − coupon discount − coin discount and nothing else: the order pipeline never
// ADDS tax or a service charge on top. That is the normal Bangladeshi menu
// convention — the shelf price is inclusive — so the configured rates are used
// to EXTRACT the charges already embedded in money that was recorded. Adding
// them on top instead would report revenue that never entered the till.

/** Tax and service charge extracted from an inclusive base, plus the residual. */
export interface ChargeSplit {
  /** The inclusive amount the split was taken out of. */
  base: Prisma.Decimal;
  tax: Prisma.Decimal;
  serviceCharge: Prisma.Decimal;
  /** base − tax − serviceCharge. An exact residual, never independently rounded. */
  net: Prisma.Decimal;
}

/**
 * Split an INCLUSIVE amount into net + tax + service charge.
 *
 * With rates t and s (percent), the recorded amount is net × (100 + t + s)/100,
 * so net = base × 100/(100 + t + s). Tax and service charge are each rounded to
 * the paisa and the net is taken as the RESIDUAL, which is what makes
 * net + tax + service equal `base` exactly — no rounding crumb is ever left
 * unattributed, at any level of aggregation.
 *
 * Applied per ORDER (never to a pre-summed total), so the branch-wise table, the
 * period-wise table and a single invoice all report the identical figure.
 */
export function splitCharges(base: Prisma.Decimal, rates: ChargeRates): ChargeSplit {
  const combined = rates.taxPercent.plus(rates.servicePercent);
  if (combined.lessThanOrEqualTo(0) || base.equals(0)) {
    return { base, tax: ZERO, serviceCharge: ZERO, net: base };
  }
  const netExact = base.times(100).dividedBy(new Prisma.Decimal(100).plus(combined));
  const tax = netExact.times(rates.taxPercent).dividedBy(100).toDecimalPlaces(2);
  const serviceCharge = netExact.times(rates.servicePercent).dividedBy(100).toDecimalPlaces(2);
  return { base, tax, serviceCharge, net: base.minus(tax).minus(serviceCharge) };
}

/** One deductions & charges row (a total, a branch, or a period bucket). */
export interface DeductionTotals {
  orders: number;
  /** Σ (totalAmount + coupon discount + coin discount) — the menu value before any giveaway. */
  grossSales: Prisma.Decimal;
  /** Σ Order.discountAmount — what coupons cost. */
  couponDiscount: Prisma.Decimal;
  /** Σ Order.coinDiscountAmount — what reward coins cost (WS-7.1). */
  coinDiscount: Prisma.Decimal;
  /** couponDiscount + coinDiscount. */
  totalDiscounts: Prisma.Decimal;
  /**
   * The slice of couponDiscount spent on coupons attached to a marketing
   * campaign — the promotional deduction. A SLICE of couponDiscount, never
   * additive to it.
   */
  promotionalDiscount: Prisma.Decimal;
  /** Σ Order.totalAmount — what the customer actually owed. */
  netSales: Prisma.Decimal;
  /** The delivery slice of netSales; no tax or service charge is taken from it. */
  deliveryRevenue: Prisma.Decimal;
  /** netSales − deliveryRevenue: the base the charges are extracted from. */
  foodRevenue: Prisma.Decimal;
  /** VAT/tax embedded in foodRevenue at the configured rate. */
  tax: Prisma.Decimal;
  /** House service charge embedded in foodRevenue at the configured rate. */
  serviceCharge: Prisma.Decimal;
  /** foodRevenue − tax − serviceCharge. */
  netFoodRevenue: Prisma.Decimal;
  /** Refunds PROCESSED in the window (money that left again). */
  refunds: Prisma.Decimal;
  /** totalDiscounts + refunds + tax + serviceCharge — everything taken off gross. */
  totalDeductions: Prisma.Decimal;
}

export interface DeductionBranchRow extends DeductionTotals {
  branchId: number;
  branchName: string;
}

export interface DeductionBucketRow extends DeductionTotals {
  label: string;
}

/** Per-coupon cost, so the most expensive giveaway is never a mystery. */
export interface CouponCostRow {
  couponId: number;
  code: string;
  orders: number;
  discount: Prisma.Decimal;
  /** True when this coupon is attached to a campaign (promotional spend). */
  promotional: boolean;
}

export interface DeductionsReport {
  rates: ChargeRates;
  totals: DeductionTotals;
  byBranch: DeductionBranchRow[];
  buckets: DeductionBucketRow[];
  byCoupon: CouponCostRow[];
}

/** Only the columns the deductions arithmetic needs. */
const DEDUCTION_ORDER_SELECT = {
  id: true,
  branchId: true,
  createdAt: true,
  totalAmount: true,
  deliveryCharge: true,
  discountAmount: true,
  coinDiscountAmount: true,
  couponId: true,
  branch: { select: { name: true } },
  coupon: { select: { code: true } },
} as const;

function emptyDeductions(): DeductionTotals {
  return {
    orders: 0,
    grossSales: ZERO,
    couponDiscount: ZERO,
    coinDiscount: ZERO,
    totalDiscounts: ZERO,
    promotionalDiscount: ZERO,
    netSales: ZERO,
    deliveryRevenue: ZERO,
    foodRevenue: ZERO,
    tax: ZERO,
    serviceCharge: ZERO,
    netFoodRevenue: ZERO,
    refunds: ZERO,
    totalDeductions: ZERO,
  };
}

/** Fold one order's figures into a row. Every row is built through this. */
function addOrder(
  row: DeductionTotals,
  o: {
    totalAmount: Prisma.Decimal;
    deliveryCharge: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    coinDiscountAmount: Prisma.Decimal;
  },
  split: ChargeSplit,
  promotional: boolean,
) {
  row.orders += 1;
  row.netSales = row.netSales.plus(o.totalAmount);
  row.couponDiscount = row.couponDiscount.plus(o.discountAmount);
  row.coinDiscount = row.coinDiscount.plus(o.coinDiscountAmount);
  row.grossSales = row.grossSales.plus(o.totalAmount).plus(o.discountAmount).plus(o.coinDiscountAmount);
  if (promotional) row.promotionalDiscount = row.promotionalDiscount.plus(o.discountAmount);
  row.deliveryRevenue = row.deliveryRevenue.plus(o.deliveryCharge);
  row.foodRevenue = row.foodRevenue.plus(split.base);
  row.tax = row.tax.plus(split.tax);
  row.serviceCharge = row.serviceCharge.plus(split.serviceCharge);
  row.netFoodRevenue = row.netFoodRevenue.plus(split.net);
}

/** Close a row out once every order and refund has been folded in. */
function sealDeductions<T extends DeductionTotals>(row: T): T {
  row.totalDiscounts = row.couponDiscount.plus(row.coinDiscount);
  row.totalDeductions = row.totalDiscounts.plus(row.refunds).plus(row.tax).plus(row.serviceCharge);
  return row;
}

/**
 * WS-2.3 — the deductions & charges report: tax, service charge, discounts,
 * coupon cost and promotional deductions, branch-wise and period-wise.
 *
 * Same window semantics as periodFinancials (delivered orders; `to` exclusive;
 * refunds recognised when PROCESSED). Pass a `bucketKey` for period rows.
 */
export async function deductionsAndCharges(
  input: FinancialWindow,
  bucketKey?: (d: Date) => string,
): Promise<DeductionsReport> {
  const range: DateRange = input.to ? { gte: input.from, lt: input.to } : { gte: input.from };
  const branchScope = input.branchId != null ? { branchId: input.branchId } : {};
  const refundScope = input.branchId != null ? { order: { branchId: input.branchId } } : {};

  const deliveredAt =
    input.basis === "delivered" ? await deliveredAtByOrder(range, branchScope) : null;

  const [rates, orders, refunds, campaignCoupons] = await Promise.all([
    chargeRates(),
    deliveredAt
      ? deliveredAt.size === 0
        ? Promise.resolve([])
        : prisma.order.findMany({
            where: { id: { in: [...deliveredAt.keys()] } },
            select: DEDUCTION_ORDER_SELECT,
          })
      : prisma.order.findMany({
          where: { ...branchScope, status: "delivered", createdAt: range },
          select: DEDUCTION_ORDER_SELECT,
        }),
    prisma.refund.findMany({
      where: { ...refundScope, createdAt: range },
      select: { createdAt: true, amount: true, order: { select: { branchId: true, branch: { select: { name: true } } } } },
    }),
    // A coupon attached to ANY campaign is promotional spend. Read once, so the
    // classification costs one query rather than one per order.
    prisma.campaign.findMany({ where: { couponId: { not: null } }, select: { couponId: true } }),
  ]);

  const promotionalCouponIds = new Set(
    campaignCoupons.map((c) => c.couponId).filter((id): id is number => id != null),
  );

  const totals = emptyDeductions();
  const branches = new Map<number, DeductionBranchRow>();
  const buckets = new Map<string, DeductionBucketRow>();
  const coupons = new Map<number, CouponCostRow>();

  const branchRow = (branchId: number, branchName: string): DeductionBranchRow => {
    const existing = branches.get(branchId);
    if (existing) return existing;
    const fresh: DeductionBranchRow = { branchId, branchName, ...emptyDeductions() };
    branches.set(branchId, fresh);
    return fresh;
  };
  const bucketRow = (d: Date): DeductionBucketRow | null => {
    if (!bucketKey) return null;
    const label = bucketKey(d);
    const existing = buckets.get(label);
    if (existing) return existing;
    const fresh: DeductionBucketRow = { label, ...emptyDeductions() };
    buckets.set(label, fresh);
    return fresh;
  };

  for (const o of orders) {
    // The charge base is the FOOD slice, net of both discounts: a delivery
    // charge funds the rider and the route, and VAT on a discount the customer
    // never paid would be tax on money that does not exist.
    const foodBase = o.totalAmount.minus(o.deliveryCharge);
    const split = splitCharges(foodBase.lessThan(0) ? ZERO : foodBase, rates);
    const promotional = o.couponId != null && promotionalCouponIds.has(o.couponId);

    addOrder(totals, o, split, promotional);
    addOrder(branchRow(o.branchId, o.branch?.name ?? ""), o, split, promotional);
    const bucket = bucketRow(deliveredAt?.get(o.id) ?? o.createdAt);
    if (bucket) addOrder(bucket, o, split, promotional);

    if (o.couponId != null && o.discountAmount.greaterThan(0)) {
      const row = coupons.get(o.couponId) ?? {
        couponId: o.couponId,
        code: o.coupon?.code ?? "",
        orders: 0,
        discount: ZERO,
        promotional,
      };
      row.orders += 1;
      row.discount = row.discount.plus(o.discountAmount);
      coupons.set(o.couponId, row);
    }
  }

  for (const r of refunds) {
    totals.refunds = totals.refunds.plus(r.amount);
    if (r.order) {
      const row = branchRow(r.order.branchId, r.order.branch?.name ?? "");
      row.refunds = row.refunds.plus(r.amount);
    }
    const bucket = bucketRow(r.createdAt);
    if (bucket) bucket.refunds = bucket.refunds.plus(r.amount);
  }

  return {
    rates,
    totals: sealDeductions(totals),
    byBranch: [...branches.values()]
      .map(sealDeductions)
      .sort((a, b) => (a.grossSales.greaterThan(b.grossSales) ? -1 : 1)),
    // Newest period first, matching every other accounts report table.
    buckets: [...buckets.values()].map(sealDeductions).sort((a, b) => (a.label < b.label ? 1 : -1)),
    byCoupon: [...coupons.values()].sort((a, b) => (a.discount.greaterThan(b.discount) ? -1 : 1)),
  };
}
