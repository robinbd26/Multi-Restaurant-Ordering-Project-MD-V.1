import "server-only";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { WITHDRAWAL_STATUSES } from "@/lib/constants/enums";
import type { TranslateFn } from "@/lib/i18n/dictionaries";
import { APP_TIME_ZONE, type Formatters } from "@/lib/i18n/format";
import { EMPLOYEE_ROLES } from "@/lib/services/employees";
import { EXPENSE_CATEGORIES } from "@/lib/services/financials";
import {
  dhakaDayEnd,
  dhakaDayEndFromKey,
  dhakaDayKey,
  dhakaDayStartFromKey,
  dhakaMidnight,
  dhakaMonthBounds,
  dhakaWeekBounds,
  dhakaYearBounds,
  daysAgo,
  endOfDhakaToday,
  startOfDhakaToday,
} from "@/lib/utils/dates";

export const MANAGEMENT_REPORTS = [
  "sales",
  "orders",
  "branches",
  "riders",
  "customers",
  "products",
  "finance",
  // WS-8.4 — branch-wise expense attribution (the cost side the branches report
  // used to be missing) as a report of its own, broken down by category.
  "expenses",
  // WS-8.5 — rider withdrawal requests: requested/approved/rejected/paid money
  // was invisible to Management even though it is an explicit requirement.
  "withdrawals",
  "complaints",
  "marketing",
  "delivery",
  "attendance",
] as const;
export type ManagementReportType = (typeof MANAGEMENT_REPORTS)[number];

/**
 * WS-8.1 — every report is scoped by a PERIOD and (where the data has a branch
 * dimension) a BRANCH. Daily/weekly/monthly/yearly are explicit Super Admin
 * requirements; `custom` carries an arbitrary Dhaka day range.
 */
export const REPORT_PERIODS = ["daily", "weekly", "monthly", "yearly", "custom"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** The month-to-date view is the most useful default for a business report. */
export const DEFAULT_REPORT_PERIOD: ReportPeriod = "monthly";

/**
 * Reports whose underlying rows belong to a branch. `customers` (registrations
 * are account-level, not branch-level) and `marketing` (a coupon is global and
 * CouponRedemption stores a plain orderId, not a branch) deliberately ignore a
 * branch id rather than pretending to filter by it.
 */
export const BRANCH_FILTERABLE_REPORTS: readonly ManagementReportType[] = [
  "sales",
  "orders",
  "branches",
  "riders",
  "products",
  "finance",
  "expenses",
  // A withdrawal has no branch column of its own; it is scoped through the
  // rider's assigned branch, which is the branch that carries their cost.
  "withdrawals",
  "complaints",
  "delivery",
  "attendance",
];

/** Raw (untrusted) filter values, straight off a query string. */
export interface ReportFilterInput {
  period?: string | null;
  branch?: string | number | null;
  from?: string | null;
  to?: string | null;
}

/** A validated, clamped report window. Every boundary is a Dhaka day boundary. */
export interface ReportFilter {
  period: ReportPeriod;
  /** null = every branch. */
  branchId: number | null;
  /** Inclusive window as real instants. */
  from: Date;
  to: Date;
  /** The same window as Dhaka `YYYY-MM-DD` keys (form values, filenames, labels). */
  fromKey: string;
  toKey: string;
}

export interface ReportData {
  /** i18n key suffix under `mgmtReports.*` for the title. */
  key: ManagementReportType;
  columns: string[]; // i18n key suffixes under `mgmtReports.col.*`
  rows: (string | number)[][];
  /** Column indexes holding BDT amounts (plain decimal strings, never floats). */
  moneyColumns: number[];
  /** The window this report was actually built for — echoed back for the UI. */
  filter: ReportFilter;
}

const ZERO = new Prisma.Decimal(0);
const money = (d: Prisma.Decimal) => Number(d).toFixed(2);

/**
 * Marker for a report cell that carries an i18n KEY instead of literal data
 * (an expense category, a job post, a withdrawal status…). Same `i18n:` marker
 * convention `sk()` uses for server-side messages, so a translatable cell is
 * obvious in the row and is resolved in exactly one place —
 * `localizeReportCell` — for the on-screen table AND every export. A report row
 * must never carry a hardcoded English label.
 */
const CELL_I18N = "i18n:";

/** Wrap an i18n key so it is rendered translated wherever the row is shown. */
export const reportKeyCell = (key: string) => `${CELL_I18N}${key}`;

/**
 * Resolve untrusted filter input into a real window. Anything unrecognised
 * falls back to the default period, so a hand-typed query string can never
 * produce an unbounded scan or an Invalid Date.
 */
export function resolveReportFilter(input: ReportFilterInput = {}): ReportFilter {
  const rawPeriod = String(input.period ?? "");
  const period = (REPORT_PERIODS as readonly string[]).includes(rawPeriod)
    ? (rawPeriod as ReportPeriod)
    : DEFAULT_REPORT_PERIOD;

  const rawBranch = Number.parseInt(String(input.branch ?? ""), 10);
  const branchId = Number.isFinite(rawBranch) && rawBranch > 0 ? rawBranch : null;

  let from: Date;
  let to: Date;
  switch (period) {
    case "daily":
      from = startOfDhakaToday();
      to = endOfDhakaToday();
      break;
    case "weekly": {
      const bounds = dhakaWeekBounds();
      from = bounds.start;
      to = bounds.end;
      break;
    }
    case "yearly": {
      const bounds = dhakaYearBounds();
      from = bounds.start;
      to = bounds.end;
      break;
    }
    case "custom": {
      // A missing or malformed end degrades to the last 30 Dhaka days rather
      // than to "all time" — a report is never accidentally unbounded.
      const start = dhakaDayStartFromKey(String(input.from ?? "")) ?? daysAgo(29);
      const end = dhakaDayEndFromKey(String(input.to ?? "")) ?? endOfDhakaToday();
      // A reversed range is swapped, not rejected: the user meant those two days.
      const reversed = start.getTime() > end.getTime();
      from = reversed ? dhakaMidnight(end) : start;
      to = reversed ? dhakaDayEnd(start) : end;
      break;
    }
    case "monthly":
    default: {
      const bounds = dhakaMonthBounds();
      from = bounds.start;
      to = bounds.end;
      break;
    }
  }

  return { period, branchId, from, to, fromKey: dhakaDayKey(from), toKey: dhakaDayKey(to) };
}

/** Branch options for the report filter (archived branches still hold history). */
export async function listReportBranches(): Promise<{ id: number; name: string }[]> {
  return prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

// ── WS-8.3: inventory & product availability across every branch ─────────
// Management is required to "monitor inventory and product availability across
// all branches" but had no page, route or query for it at all — the product
// catalog lives behind /admin and /branch-manager, both closed to the role.
// This is a READ-ONLY snapshot: Management never toggles a branch's menu.
//
// Deliberately NOT one of MANAGEMENT_REPORTS: those are all period-scoped
// (daily/weekly/…), while availability is a right-now state that a date window
// would only make meaningless.

/** Availability states a product can be monitored in. */
export const INVENTORY_STATES = ["available", "unavailable", "held"] as const;
export type InventoryState = (typeof INVENTORY_STATES)[number];

export interface InventoryQuery {
  /** null = every branch. */
  branchId: number | null;
  /** "" = every state. */
  state: InventoryState | "";
  search: string;
}

/**
 * The scope being monitored (branch + search), WITHOUT the availability filter.
 * The summary cards and the per-branch breakdown count over this scope, so a
 * card can never contradict the list under it once a state filter is applied.
 * Soft-deleted products are excluded everywhere: they are not inventory.
 */
function inventoryScope(q: Pick<InventoryQuery, "branchId" | "search">): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { deletedAt: null };
  if (q.branchId) where.branchId = q.branchId;
  if (q.search) {
    where.OR = [
      { name: { contains: q.search } },
      { description: { contains: q.search } },
      { category: { name: { contains: q.search } } },
      { branch: { name: { contains: q.search } } },
    ];
  }
  return where;
}

/**
 * The predicate for one availability state. A super-admin hold outranks the
 * branch's own switch — a held product is not "available" no matter what the
 * branch set — so the three states stay mutually exclusive and sum to the total.
 */
function inventoryStateWhere(state: InventoryState | ""): Prisma.ProductWhereInput {
  if (state === "held") return { heldByAdmin: true };
  if (state === "available") return { heldByAdmin: false, isAvailable: true };
  if (state === "unavailable") return { heldByAdmin: false, isAvailable: false };
  return {};
}

export interface InventoryCounts {
  total: number;
  available: number;
  unavailable: number;
  held: number;
  /** Sellable on paper but with no enabled size/variation — effectively dead. */
  unsellable: number;
}

export interface InventoryBranchRow {
  id: number;
  branch: string;
  isActive: boolean;
  isArchived: boolean;
  total: number;
  available: number;
  unavailable: number;
  held: number;
}

/**
 * One page of the inventory monitor: the scope-wide counts, the per-branch
 * breakdown and the filtered product page, in a single round of queries.
 */
export async function listInventory(q: InventoryQuery, skip: number, take: number) {
  const scope = inventoryScope(q);
  const where: Prisma.ProductWhereInput = { AND: [scope, inventoryStateWhere(q.state)] };

  const [total, products, counts, branches, scoped] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        price: true,
        isAvailable: true,
        heldByAdmin: true,
        deactivationReason: true,
        updatedAt: true,
        branch: { select: { id: true, name: true } },
        category: { select: { name: true } },
        variations: { select: { isEnabled: true } },
      },
      orderBy: [{ branch: { name: "asc" } }, { name: "asc" }],
      skip,
      take,
    }),
    Promise.all([
      prisma.product.count({ where: scope }),
      prisma.product.count({ where: { ...scope, heldByAdmin: false, isAvailable: true } }),
      prisma.product.count({ where: { ...scope, heldByAdmin: false, isAvailable: false } }),
      prisma.product.count({ where: { ...scope, heldByAdmin: true } }),
      // A product whose variations are ALL disabled cannot be added to a cart
      // even though the branch believes it is on the menu — the quietest way for
      // a branch to be silently out of stock. (No variations at all is fine:
      // it is sold at its own price.)
      prisma.product.count({
        where: {
          ...scope,
          isAvailable: true,
          heldByAdmin: false,
          variations: { some: {}, none: { isEnabled: true } },
        },
      }),
    ]),
    prisma.branch.findMany({
      where: q.branchId ? { id: q.branchId } : {},
      select: { id: true, name: true, isActive: true, isArchived: true },
      orderBy: { name: "asc" },
    }),
    // Three scalars per product in scope: enough to break the scope down by
    // branch in memory without a query per branch.
    prisma.product.findMany({
      where: scope,
      select: { branchId: true, isAvailable: true, heldByAdmin: true },
    }),
  ]);

  const [all, available, unavailable, held, unsellable] = counts;
  const perBranch = new Map<number, { total: number; available: number; unavailable: number; held: number }>();
  for (const p of scoped) {
    const row = perBranch.get(p.branchId) ?? { total: 0, available: 0, unavailable: 0, held: 0 };
    row.total += 1;
    if (p.heldByAdmin) row.held += 1;
    else if (p.isAvailable) row.available += 1;
    else row.unavailable += 1;
    perBranch.set(p.branchId, row);
  }

  return {
    total,
    products,
    counts: { total: all, available, unavailable, held, unsellable } satisfies InventoryCounts,
    // Every branch is listed, including one with zero products — "this branch
    // has no menu at all" is exactly the kind of thing this page must surface.
    branches: branches.map((b) => ({
      id: b.id,
      branch: b.name,
      isActive: b.isActive,
      isArchived: b.isArchived,
      ...(perBranch.get(b.id) ?? { total: 0, available: 0, unavailable: 0, held: 0 }),
    })) satisfies InventoryBranchRow[],
  };
}

// ── WS-8.13: business growth trends ──────────────────────────────────────
// "Business growth" did not exist as data: the analytics page had a 7-day
// sales chart and a lifetime retention number, with no period-over-period
// comparison, no growth percentage and no per-period repeat rate. This
// compares the report window against the SAME number of Dhaka days
// immediately before it — for the default monthly window that is the ~31 days
// ending the instant the month opened (i.e. the previous month, give or take
// the calendar's unequal month lengths), and for a custom range it is always
// an equal-length range, so a growth % never compares 7 days against 30.

/** One metric measured in this window and the equal-length window before it. */
export interface GrowthMetric {
  current: number;
  previous: number;
  /** % change vs the previous window, one decimal; null when it has no base. */
  growth_pct: number | null;
}

export interface BusinessGrowth {
  filter: ReportFilter;
  /** The comparison window, as Dhaka day keys (for labelling). */
  previousFromKey: string;
  previousToKey: string;
  /** Delivered-order revenue; amounts are plain decimal strings, never floats. */
  revenue: { current: string; previous: string; growth_pct: number | null };
  orders: GrowthMetric;
  newCustomers: GrowthMetric;
  /** Repeat rate INSIDE the window: customers with ≥2 orders / customers with ≥1. */
  repeat: { ordering: number; repeat: number; rate_pct: number };
}

/** % change to one decimal. Null (not 0, not ∞) when the base window is empty. */
const growthPct = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

export async function businessGrowth(
  filter: ReportFilter = resolveReportFilter(),
): Promise<BusinessGrowth> {
  // Both boundaries of `filter` are Dhaka midnights and Bangladesh runs a fixed
  // UTC+6 with no DST, so plain millisecond arithmetic lands the previous
  // window exactly on Dhaka day boundaries too.
  const spanMs = filter.to.getTime() - filter.from.getTime() + 1;
  const prevTo = new Date(filter.from.getTime() - 1);
  const prevFrom = new Date(filter.from.getTime() - spanMs);
  const branchOnly = filter.branchId ? { branchId: filter.branchId } : {};

  const windowStats = async (gte: Date, lte: Date) => {
    const [sales, newCustomers] = await Promise.all([
      prisma.order.aggregate({
        where: { status: "delivered", createdAt: { gte, lte }, ...branchOnly },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      // Registrations are account-level, not branch-level — same rule as the
      // customers report, which ignores the branch filter for the same reason.
      prisma.user.count({ where: { role: "customer", dateJoined: { gte, lte } } }),
    ]);
    return {
      orders: sales._count._all,
      revenue: sales._sum.totalAmount ?? ZERO,
      newCustomers,
    };
  };

  const [current, previous, perCustomer] = await Promise.all([
    windowStats(filter.from, filter.to),
    windowStats(prevFrom, prevTo),
    // A cancelled order proves nothing about a customer's loyalty.
    prisma.order.groupBy({
      by: ["customerId"],
      where: { status: { not: "cancelled" }, createdAt: { gte: filter.from, lte: filter.to }, ...branchOnly },
      _count: { _all: true },
    }),
  ]);

  const ordering = perCustomer.length;
  const repeat = perCustomer.filter((c) => c._count._all > 1).length;

  return {
    filter,
    previousFromKey: dhakaDayKey(prevFrom),
    previousToKey: dhakaDayKey(prevTo),
    revenue: {
      current: money(current.revenue),
      previous: money(previous.revenue),
      // The percentage is display-only, so a float comparison is fine here;
      // the amounts themselves stay Decimal-derived strings.
      growth_pct: growthPct(Number(current.revenue), Number(previous.revenue)),
    },
    orders: {
      current: current.orders,
      previous: previous.orders,
      growth_pct: growthPct(current.orders, previous.orders),
    },
    newCustomers: {
      current: current.newCustomers,
      previous: previous.newCustomers,
      growth_pct: growthPct(current.newCustomers, previous.newCustomers),
    },
    repeat: {
      ordering,
      repeat,
      rate_pct: ordering ? Math.round((repeat / ordering) * 1000) / 10 : 0,
    },
  };
}

/** Build a management report of the given type for the given window + branch. */
export async function buildReport(
  type: ManagementReportType,
  filter: ReportFilter = resolveReportFilter(),
): Promise<ReportData> {
  // Every window boundary is a Dhaka midnight, so `lte` on the inclusive end is
  // exactly "up to 23:59:59.999 Dhaka" and no order is double-counted.
  const window = { gte: filter.from, lte: filter.to };
  const branchOnly = filter.branchId ? { branchId: filter.branchId } : {};

  switch (type) {
    case "sales": {
      const orders = await prisma.order.findMany({
        where: { status: "delivered", createdAt: window, ...branchOnly },
        select: { createdAt: true, totalAmount: true },
      });
      const byDay = new Map<string, { orders: number; sales: Prisma.Decimal }>();
      for (const o of orders) {
        const k = dhakaDayKey(o.createdAt);
        const b = byDay.get(k) ?? { orders: 0, sales: ZERO };
        b.orders += 1;
        b.sales = b.sales.plus(o.totalAmount);
        byDay.set(k, b);
      }
      return {
        key: "sales",
        columns: ["date", "orders", "sales"],
        rows: [...byDay.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([d, v]) => [d, v.orders, money(v.sales)]),
        moneyColumns: [2],
        filter,
      };
    }
    case "orders": {
      const grouped = await prisma.order.groupBy({
        by: ["status"],
        where: { createdAt: window, ...branchOnly },
        _count: true,
      });
      return {
        key: "orders",
        columns: ["status", "count"],
        rows: grouped.map((g) => [g.status, g._count]),
        moneyColumns: [],
        filter,
      };
    }
    case "branches": {
      // WS-8.4 — the branches report used to stop at sales, so a branch that
      // sold well while bleeding rent and commission looked identical to a
      // profitable one. Every cost is now attributed to the branch that
      // incurred it and profit is derived exactly:
      //   profit = sales − rider commission − expenses − refunds
      // in Decimal throughout (never a JS float), matching how the `finance`
      // report computes net revenue for the whole company.
      const [branches, commissions, expenses, refunds] = await Promise.all([
        prisma.branch.findMany({
          where: filter.branchId ? { id: filter.branchId } : {},
          include: {
            manager: true,
            _count: { select: { riders: true } },
            orders: {
              where: { status: "delivered", createdAt: window },
              select: { totalAmount: true },
            },
          },
          orderBy: { name: "asc" },
        }),
        prisma.riderCommission.groupBy({
          by: ["branchId"],
          where: { createdAt: window, ...branchOnly },
          _sum: { amount: true },
        }),
        // An expense is bucketed by the day it was INCURRED (expenseDate).
        prisma.branchExpense.groupBy({
          by: ["branchId"],
          where: { expenseDate: window, ...branchOnly },
          _sum: { amount: true },
        }),
        // A refund carries no branch of its own — it is attributed through the
        // order it reverses, which is where the sale was booked.
        prisma.refund.findMany({
          where: { createdAt: window, ...(filter.branchId ? { order: { branchId: filter.branchId } } : {}) },
          select: { amount: true, order: { select: { branchId: true } } },
        }),
      ]);

      // A commission row may have lost its branch (SetNull); such a row belongs
      // to no branch and is deliberately left out rather than charged at random.
      const commissionByBranch = new Map<number, Prisma.Decimal>();
      for (const g of commissions) {
        if (g.branchId !== null) commissionByBranch.set(g.branchId, g._sum.amount ?? ZERO);
      }
      const expenseByBranch = new Map<number, Prisma.Decimal>();
      for (const g of expenses) expenseByBranch.set(g.branchId, g._sum.amount ?? ZERO);
      const refundByBranch = new Map<number, Prisma.Decimal>();
      for (const r of refunds) {
        const id = r.order.branchId;
        refundByBranch.set(id, (refundByBranch.get(id) ?? ZERO).plus(r.amount));
      }

      return {
        key: "branches",
        columns: ["branch", "manager", "riders", "orders", "sales", "commission", "expenses", "refunds", "profit"],
        rows: branches.map((b) => {
          const sales = b.orders.reduce((a, o) => a.plus(o.totalAmount), ZERO);
          const commission = commissionByBranch.get(b.id) ?? ZERO;
          const expense = expenseByBranch.get(b.id) ?? ZERO;
          const refund = refundByBranch.get(b.id) ?? ZERO;
          return [
            b.name,
            b.manager ? `${b.manager.firstName} ${b.manager.lastName}`.trim() || b.manager.username : "—",
            b._count.riders,
            b.orders.length,
            money(sales),
            money(commission),
            money(expense),
            money(refund),
            money(sales.minus(commission).minus(expense).minus(refund)),
          ];
        }),
        moneyColumns: [4, 5, 6, 7, 8],
        filter,
      };
    }
    case "riders": {
      const riders = await prisma.user.findMany({
        where: {
          role: "rider",
          status: "approved",
          // A rider belongs to a branch through their profile, not the User row.
          ...(filter.branchId ? { riderProfile: { assignedBranchId: filter.branchId } } : {}),
        },
        include: {
          deliveries: {
            where: { status: "delivered", createdAt: window, ...branchOnly },
            select: { id: true },
          },
          commissions: { where: { createdAt: window, ...branchOnly }, select: { amount: true } },
          riderReviewsReceived: { where: { createdAt: window }, select: { rating: true } },
        },
        orderBy: { firstName: "asc" },
      });
      return {
        key: "riders",
        columns: ["rider", "deliveries", "earnings", "rating"],
        rows: riders.map((r) => {
          const ratings = r.riderReviewsReceived;
          const avg = ratings.length ? (ratings.reduce((a, x) => a + x.rating, 0) / ratings.length).toFixed(1) : "—";
          return [
            `${r.firstName} ${r.lastName}`.trim() || r.username,
            r.deliveries.length,
            money(r.commissions.reduce((a, c) => a.plus(c.amount), ZERO)),
            avg,
          ];
        }),
        moneyColumns: [2],
        filter,
      };
    }
    case "customers": {
      const customers = await prisma.user.findMany({
        where: { role: "customer", dateJoined: window },
        select: { dateJoined: true },
      });
      const byDay = new Map<string, number>();
      for (const c of customers) {
        const k = dhakaDayKey(c.dateJoined);
        byDay.set(k, (byDay.get(k) ?? 0) + 1);
      }
      return {
        key: "customers",
        columns: ["date", "newCustomers"],
        rows: [...byDay.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([d, n]) => [d, n]),
        moneyColumns: [],
        filter,
      };
    }
    case "products": {
      // WS-8.12 — "most and least selling" used to iterate OrderItem only, so a
      // product that sold NOTHING in the window — the genuinely least-selling —
      // was simply absent, and the category dimension the requirement names was
      // not reported at all. The catalog is now the LEFT side of the join:
      // every live product appears (zero-sellers included, qty 0), keyed by id
      // rather than by name so two same-named products in different branches
      // stay distinct rows.
      const items = await prisma.orderItem.findMany({
        where: { order: { status: "delivered", createdAt: window, ...branchOnly } },
        select: { productId: true, quantity: true, unitPrice: true },
      });
      const sold = new Map<number, { qty: number; revenue: Prisma.Decimal }>();
      for (const i of items) {
        const b = sold.get(i.productId) ?? { qty: 0, revenue: ZERO };
        b.qty += i.quantity;
        b.revenue = b.revenue.plus(i.unitPrice.mul(i.quantity));
        sold.set(i.productId, b);
      }
      // A product soft-deleted AFTER selling in the window still earned this
      // period's revenue, so it is kept; deleted products that sold nothing are
      // not inventory and are left out.
      const products = await prisma.product.findMany({
        where: {
          ...branchOnly,
          OR: [{ deletedAt: null }, { id: { in: [...sold.keys()] } }],
        },
        select: { id: true, name: true, category: { select: { name: true } } },
      });
      return {
        key: "products",
        columns: ["product", "category", "qtySold", "revenue"],
        rows: products
          .map((p) => {
            const s = sold.get(p.id) ?? { qty: 0, revenue: ZERO };
            return { name: p.name, category: p.category?.name ?? "—", ...s };
          })
          // Best sellers first; the never-sold tail IS the least-selling list.
          .sort(
            (a, b) =>
              b.qty - a.qty || Number(b.revenue.minus(a.revenue)) || a.name.localeCompare(b.name),
          )
          .map((r) => [r.name, r.category, r.qty, money(r.revenue)]),
        moneyColumns: [3],
        filter,
      };
    }
    case "finance": {
      const [orders, commissions, expenses, refunds] = await Promise.all([
        prisma.order.findMany({
          where: { status: "delivered", createdAt: window, ...branchOnly },
          select: { totalAmount: true },
        }),
        prisma.riderCommission.findMany({ where: { createdAt: window, ...branchOnly }, select: { amount: true } }),
        // An expense is bucketed by the day it was INCURRED (expenseDate), not
        // by the day it happened to be typed in.
        prisma.branchExpense.findMany({ where: { expenseDate: window, ...branchOnly }, select: { amount: true } }),
        prisma.refund.findMany({
          where: { createdAt: window, ...(filter.branchId ? { order: { branchId: filter.branchId } } : {}) },
          select: { amount: true },
        }),
      ]);
      const sales = orders.reduce((a, o) => a.plus(o.totalAmount), ZERO);
      const comm = commissions.reduce((a, c) => a.plus(c.amount), ZERO);
      const exp = expenses.reduce((a, e) => a.plus(e.amount), ZERO);
      const ref = refunds.reduce((a, r) => a.plus(r.amount), ZERO);
      const net = sales.minus(comm).minus(exp).minus(ref);
      return {
        key: "finance",
        columns: ["metric", "amount"],
        rows: [
          ["totalSales", money(sales)],
          ["riderCommission", money(comm)],
          ["expenses", money(exp)],
          ["refunds", money(ref)],
          ["netRevenue", money(net)],
        ],
        moneyColumns: [1],
        filter,
      };
    }
    case "expenses": {
      // WS-8.4 — branch-wise expense attribution. The finance report only ever
      // showed ONE company-wide expense total, so "which branch spends what, on
      // what" was unanswerable. Grouped in the database (one query), never by
      // pulling every expense row into memory.
      const [grouped, branches] = await Promise.all([
        prisma.branchExpense.groupBy({
          by: ["branchId", "category"],
          where: { expenseDate: window, ...branchOnly },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        listReportBranches(),
      ]);
      const branchNames = new Map(branches.map((b) => [b.id, b.name]));
      const rows = grouped
        .map((g) => ({
          branch: branchNames.get(g.branchId) ?? `#${g.branchId}`,
          category: g.category,
          entries: g._count._all,
          amount: g._sum.amount ?? ZERO,
        }))
        // Branch A→Z, then the biggest spend inside each branch first.
        .sort((a, b) =>
          a.branch === b.branch ? Number(b.amount.minus(a.amount)) : a.branch < b.branch ? -1 : 1,
        );
      return {
        key: "expenses",
        columns: ["branch", "category", "entries", "amount"],
        rows: rows.map((r) => [
          r.branch,
          // A category outside the validated set (legacy data) is shown as
          // stored rather than as a missing translation key.
          (EXPENSE_CATEGORIES as readonly string[]).includes(r.category)
            ? reportKeyCell(`financials.cat_${r.category}`)
            : r.category,
          r.entries,
          money(r.amount),
        ]),
        moneyColumns: [3],
        filter,
      };
    }
    case "withdrawals": {
      // WS-8.5 — RiderWithdrawal was read by no management page or service at
      // all, so requested/approved/rejected/paid money was invisible to
      // Management. One row per rider, the money split by lifecycle state.
      //
      // The window is the REQUEST date (createdAt), not the decision date, so
      // the request count and all four money columns describe exactly the same
      // set of rows: "what was asked for in this period, and where does it
      // stand now". Bucketing each column by its own timestamp would let the
      // columns of a single row describe four different populations.
      const withdrawals = await prisma.riderWithdrawal.findMany({
        where: {
          createdAt: window,
          // A withdrawal has no branch column; the rider's assigned branch is
          // the branch whose delivery cost the payout settles.
          ...(filter.branchId ? { rider: { riderProfile: { assignedBranchId: filter.branchId } } } : {}),
        },
        select: {
          amount: true,
          status: true,
          riderId: true,
          rider: {
            select: {
              firstName: true,
              lastName: true,
              username: true,
              riderProfile: { select: { assignedBranch: { select: { name: true } } } },
            },
          },
        },
      });

      interface WithdrawalRow {
        rider: string;
        branch: string;
        requests: number;
        totals: Map<string, Prisma.Decimal>;
      }
      const byRider = new Map<number, WithdrawalRow>();
      for (const w of withdrawals) {
        const row = byRider.get(w.riderId) ?? {
          rider: `${w.rider.firstName} ${w.rider.lastName}`.trim() || w.rider.username,
          branch: w.rider.riderProfile?.assignedBranch?.name ?? "—",
          requests: 0,
          totals: new Map<string, Prisma.Decimal>(),
        };
        row.requests += 1;
        // An unknown status is still counted as a request but is not silently
        // folded into one of the four money buckets.
        if ((WITHDRAWAL_STATUSES as readonly string[]).includes(w.status)) {
          row.totals.set(w.status, (row.totals.get(w.status) ?? ZERO).plus(w.amount));
        }
        byRider.set(w.riderId, row);
      }

      return {
        key: "withdrawals",
        columns: ["rider", "branch", "requests", "pending", "approved", "paid", "rejected"],
        rows: [...byRider.values()]
          .sort((a, b) => Number((b.totals.get("paid") ?? ZERO).minus(a.totals.get("paid") ?? ZERO)))
          .map((r) => [
            r.rider,
            r.branch,
            r.requests,
            money(r.totals.get("pending") ?? ZERO),
            money(r.totals.get("approved") ?? ZERO),
            money(r.totals.get("paid") ?? ZERO),
            money(r.totals.get("rejected") ?? ZERO),
          ]),
        moneyColumns: [3, 4, 5, 6],
        filter,
      };
    }
    case "complaints": {
      const grouped = await prisma.complaint.groupBy({
        by: ["status", "recipientRole"],
        where: { createdAt: window, ...branchOnly },
        _count: true,
      });
      return {
        key: "complaints",
        columns: ["recipient", "status", "count"],
        rows: grouped.map((g) => [g.recipientRole, g.status, g._count]),
        moneyColumns: [],
        filter,
      };
    }
    case "marketing": {
      // WS-8.11 — this report used to list coupon counters only: Campaign was
      // never read and the money side of marketing (Order.discountAmount) was
      // never aggregated, so "what did campaigns achieve this period and what
      // did the discounts cost" was unanswerable. CampaignEvent (append-only,
      // landed with WS-7.5) is the PERIOD source of truth for engagement — the
      // Campaign.*Count columns are lifetime counters and cannot answer a
      // windowed report — and the coupon cost comes from the orders that
      // actually redeemed a coupon inside the window.
      const [campaigns, events, converted, coupons, couponOrders] = await Promise.all([
        prisma.campaign.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.campaignEvent.groupBy({
          by: ["campaignId", "type"],
          where: { createdAt: window },
          _count: { _all: true },
        }),
        // Conversions carry the credited order, which is where the revenue is.
        prisma.campaignEvent.findMany({
          where: { type: "converted", createdAt: window, orderId: { not: null } },
          select: { campaignId: true, orderId: true },
        }),
        prisma.coupon.findMany({ orderBy: { usedCount: "desc" } }),
        // A cancelled order releases its coupon use (WS-7.2), so its discount
        // never became a real cost and is deliberately left out.
        prisma.order.groupBy({
          by: ["couponId"],
          where: { couponId: { not: null }, status: { not: "cancelled" }, createdAt: window },
          _count: { _all: true },
          _sum: { discountAmount: true, totalAmount: true },
        }),
      ]);

      const eventCount = new Map<string, number>();
      for (const g of events) eventCount.set(`${g.campaignId}:${g.type}`, g._count._all);
      const count = (campaignId: number, type: string) => eventCount.get(`${campaignId}:${type}`) ?? 0;

      const orderIds = [...new Set(converted.map((e) => e.orderId as number))];
      const orders = orderIds.length
        ? await prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, totalAmount: true },
          })
        : [];
      const amountByOrder = new Map(orders.map((o) => [o.id, o.totalAmount]));
      const revenueByCampaign = new Map<number, Prisma.Decimal>();
      for (const e of converted) {
        const amount = e.orderId === null ? undefined : amountByOrder.get(e.orderId);
        if (!amount) continue;
        revenueByCampaign.set(
          e.campaignId,
          (revenueByCampaign.get(e.campaignId) ?? ZERO).plus(amount),
        );
      }

      const couponStat = new Map(couponOrders.map((g) => [g.couponId, g]));
      return {
        key: "marketing",
        columns: ["item", "kind", "sent", "opened", "clicked", "conversions", "revenue", "discountCost"],
        rows: [
          ...campaigns.map((c): (string | number)[] => [
            c.title,
            reportKeyCell("mgmtReports.kind.campaign"),
            count(c.id, "sent"),
            count(c.id, "opened"),
            count(c.id, "clicked"),
            count(c.id, "converted"),
            money(revenueByCampaign.get(c.id) ?? ZERO),
            // The discount a campaign's coupon gave away is reported once, on
            // the coupon's own row below — never double-counted here.
            money(ZERO),
          ]),
          ...coupons.map((c): (string | number)[] => {
            const stat = couponStat.get(c.id);
            return [
              c.code,
              reportKeyCell("mgmtReports.kind.coupon"),
              // Send/open/click are campaign-channel concepts; a bare coupon
              // has none, and "0" would read as measured silence rather than
              // "not applicable".
              "—",
              "—",
              "—",
              stat?._count._all ?? 0,
              money(stat?._sum.totalAmount ?? ZERO),
              money(stat?._sum.discountAmount ?? ZERO),
            ];
          }),
        ],
        moneyColumns: [6, 7],
        filter,
      };
    }
    case "delivery": {
      // WS-4.12 — the average used to be measured to Order.updatedAt, which is
      // bumped long after the food arrived by payment verification, refunds and
      // any later edit, so the headline delivery number was silently wrong (and
      // always too high). The `delivered` transition in the OrderStatusEvent
      // trail is the real completion instant. The FIRST such event is used: a
      // re-delivered/corrected order still reports when it actually landed.
      //
      // `measured` says how many of the deliveries carry that trail, so an
      // average built on partially back-filled history is never mistaken for a
      // complete one instead of being quietly diluted.
      const [branches, orders] = await Promise.all([
        prisma.branch.findMany({
          where: filter.branchId ? { id: filter.branchId } : {},
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.order.findMany({
          where: { status: "delivered", createdAt: window, ...branchOnly },
          select: {
            branchId: true,
            createdAt: true,
            statusEvents: {
              where: { toStatus: "delivered" },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { createdAt: true },
            },
          },
        }),
      ]);

      const stats = new Map<number, { delivered: number; measured: number; minutes: number }>();
      for (const o of orders) {
        const s = stats.get(o.branchId) ?? { delivered: 0, measured: 0, minutes: 0 };
        s.delivered += 1;
        const deliveredAt = o.statusEvents[0]?.createdAt;
        if (deliveredAt) {
          s.measured += 1;
          s.minutes += (deliveredAt.getTime() - o.createdAt.getTime()) / 60000;
        }
        stats.set(o.branchId, s);
      }

      return {
        key: "delivery",
        columns: ["branch", "deliveries", "measured", "avgMinutes"],
        rows: branches.map((b) => {
          const s = stats.get(b.id) ?? { delivered: 0, measured: 0, minutes: 0 };
          return [b.name, s.delivered, s.measured, s.measured ? Math.round(s.minutes / s.measured) : 0];
        }),
        moneyColumns: [],
        filter,
      };
    }
    case "attendance": {
      // WS-8.7 — this was a RiderDutyLog tally: a rider-shift count with no
      // branch column and no other staff, which is not a branch attendance
      // report. It is now built on the real HR models — EmployeeAttendance
      // (branch employees) merged with StaffAttendance (dashboard logins:
      // managers, riders) — with a branch dimension and the five real statuses.
      //
      // Someone who is BOTH a branch employee and a login is ONE row, joined
      // through BranchEmployee.userId, so a rider's HR record and their staff
      // attendance never appear as two different people.
      const [employeeRows, staffRows] = await Promise.all([
        prisma.employeeAttendance.findMany({
          where: { date: window, ...branchOnly },
          select: {
            status: true,
            branch: { select: { name: true } },
            employee: {
              select: { id: true, firstName: true, lastName: true, role: true, customRole: true },
            },
          },
        }),
        prisma.staffAttendance.findMany({
          // StaffAttendance.branchId is nullable; a row with no branch cannot
          // answer a branch-filtered question and is left out of that view.
          where: { date: window, ...(filter.branchId ? { branchId: filter.branchId } : {}) },
          select: {
            status: true,
            userId: true,
            branch: { select: { name: true } },
            user: { select: { firstName: true, lastName: true, username: true, role: true } },
          },
        }),
      ]);

      const userIds = [...new Set(staffRows.map((r) => r.userId))];
      const linked = userIds.length
        ? await prisma.branchEmployee.findMany({
            where: { userId: { in: userIds } },
            select: { id: true, userId: true },
          })
        : [];
      const employeeIdByUser = new Map<number, number>();
      for (const e of linked) if (e.userId !== null) employeeIdByUser.set(e.userId, e.id);

      interface AttendanceRow {
        branch: string;
        person: string;
        post: string;
        counts: Map<string, number>;
      }
      const rows = new Map<string, AttendanceRow>();
      const mark = (key: string, seed: AttendanceRow, status: string) => {
        const row = rows.get(key) ?? seed;
        row.counts.set(status, (row.counts.get(status) ?? 0) + 1);
        rows.set(key, row);
      };

      for (const a of employeeRows) {
        const e = a.employee;
        mark(
          `employee:${e.id}`,
          {
            branch: a.branch.name,
            person: `${e.firstName} ${e.lastName}`.trim() || `#${e.id}`,
            // "others" is the one role that carries a free-text job term; every
            // other role is a validated key with a translated label.
            post:
              e.role === "others" && e.customRole
                ? e.customRole
                : (EMPLOYEE_ROLES as readonly string[]).includes(e.role)
                  ? reportKeyCell(`b5.roles.${e.role}`)
                  : e.role,
            counts: new Map<string, number>(),
          },
          a.status,
        );
      }

      for (const a of staffRows) {
        // Fold a login into its HR record when one exists, so the person's
        // employee row and their staff attendance are the same line.
        const employeeId = employeeIdByUser.get(a.userId);
        mark(
          employeeId ? `employee:${employeeId}` : `user:${a.userId}`,
          {
            branch: a.branch?.name ?? "—",
            person: `${a.user.firstName} ${a.user.lastName}`.trim() || a.user.username,
            post: reportKeyCell(`roles.${a.user.role}`),
            counts: new Map<string, number>(),
          },
          a.status,
        );
      }

      const count = (row: AttendanceRow, status: string) => row.counts.get(status) ?? 0;
      return {
        key: "attendance",
        columns: ["branch", "person", "post", "present", "late", "absent", "leave", "halfDay"],
        rows: [...rows.values()]
          .sort((a, b) => a.branch.localeCompare(b.branch) || a.person.localeCompare(b.person))
          .map((r) => [
            r.branch,
            r.person,
            r.post,
            count(r, "present"),
            count(r, "late"),
            count(r, "absent"),
            count(r, "leave"),
            count(r, "half_day"),
          ]),
        moneyColumns: [],
        filter,
      };
    }
  }
}

/**
 * Localize a key-carrying report cell. Two kinds exist:
 *   • any column — a cell wrapped by `reportKeyCell()` carries a full i18n key
 *     (expense category, job post, …) and is translated wherever it sits;
 *   • column 0 — finance rows hold `mgmtReports.metric.*` keys and orders hold
 *     order-status keys, which predate the marker and stay supported.
 * Every other cell is real data and is returned verbatim. Shared by the
 * on-screen table and every export so the three never drift apart.
 */
export function localizeReportCell(
  type: ManagementReportType,
  value: string | number,
  col: number,
  t: TranslateFn,
): string {
  const raw = String(value);
  if (raw.startsWith(CELL_I18N)) return t(raw.slice(CELL_I18N.length));
  if (col !== 0) return raw;
  if (type === "finance") return t(`mgmtReports.metric.${value}`);
  if (type === "orders") return t(`orderStatus.${value}`);
  return raw;
}

/**
 * Assemble the localized document every export format renders from, so CSV,
 * XLSX and the printable PDF view carry identical numbers, identical headers
 * and the same "which window / which branch" provenance block.
 */
export function buildExportDocument(
  report: ReportData,
  t: TranslateFn,
  fmt: Formatters,
  branchName = "",
): ExportDocument {
  const { filter } = report;
  const periodLabel =
    filter.period === "custom"
      ? `${fmt.date(filter.fromKey)} — ${fmt.date(filter.toKey)}`
      : `${t(`mgmtReports.period.${filter.period}`)} (${fmt.date(filter.fromKey)} — ${fmt.date(filter.toKey)})`;

  return {
    title: t(`mgmtReports.title.${report.key}`),
    metaLines: [
      `${t("mgmtReports.periodLabel")}: ${periodLabel}`,
      `${t("mgmtReports.branchLabel")}: ${branchName || t("mgmtReports.allBranches")}`,
      `${t("mgmtReports.generatedAt")}: ${fmt.dateTime(new Date().toISOString())} (${APP_TIME_ZONE})`,
    ],
    // Money columns say so in the header, which keeps the cells themselves
    // plain numbers that Excel and Sheets can still total.
    headers: report.columns.map((c, i) =>
      report.moneyColumns.includes(i)
        ? `${t(`mgmtReports.col.${c}`)} (৳)`
        : t(`mgmtReports.col.${c}`),
    ),
    // Money and plain counts stay NUMBERS so Excel can still total them; every
    // other cell goes through the localizer, which resolves both the column-0
    // key columns and any `reportKeyCell()` marker anywhere in the row.
    rows: report.rows.map((row) =>
      row.map((cell, i) =>
        report.moneyColumns.includes(i) || typeof cell === "number"
          ? cell
          : localizeReportCell(report.key, cell, i, t),
      ),
    ),
    moneyColumns: report.moneyColumns,
  };
}

// ── WS-8.2: export renderers (csv | xlsx | pdf) ──────────────────────────
// The `format` query parameter used to be read nowhere. All three formats are
// produced here with no external dependency: CSV is text, XLSX is a hand-built
// (but fully valid) OOXML package, and "PDF" is a print-optimised HTML view the
// browser saves as PDF — the no-key fallback .env.example already endorses.

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function resolveExportFormat(raw: string | null | undefined): ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(String(raw ?? ""))
    ? (raw as ExportFormat)
    : "csv";
}

/** Header/footer context lines carried into every exported file. */
export interface ExportDocument {
  /** Localized report title. */
  title: string;
  /** Localized "Period / Branch / Generated" lines. */
  metaLines: string[];
  /** Localized column labels. */
  headers: string[];
  /** Rows with key columns already localized; money cells stay plain decimals. */
  rows: (string | number)[][];
  moneyColumns: number[];
}

/**
 * Render a report as CSV.
 *
 * Money stays a plain decimal so Excel can still SUM the column; the currency
 * is carried in the header label (BDT) instead of in every cell. A UTF-8 BOM is
 * prepended so Excel on Windows renders the Bangla labels instead of mojibake.
 */
export function reportToCsv(doc: ExportDocument): string {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const meta = doc.metaLines.map((line) => `${escape(line)}\n`).join("");
  const header = doc.headers.map(escape).join(",");
  const body = doc.rows.map((r) => r.map(escape).join(",")).join("\n");
  return `﻿${escape(doc.title)}\n${meta}\n${header}\n${body}\n`;
}

/**
 * Render a report as a print-optimised HTML page. Opening it triggers the
 * browser's print dialog, where "Save as PDF" produces the PDF — no headless
 * Chrome, no PDF service, nothing to install, and it works on a 3G phone.
 */
export function reportToPrintableHtml(
  doc: ExportDocument,
  labels: { print: string; empty: string },
  locale: string,
): string {
  const esc = (v: string | number) =>
    String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const head = doc.headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = doc.rows
    .map((row) => `<tr>${row.map((c, i) => `<td class="${i === 0 ? "first" : "num"}">${esc(c)}</td>`).join("")}</tr>`)
    .join("");

  return `<!doctype html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #fff; color: #111827;
         font-family: system-ui, "Noto Sans Bengali", "Hind Siliguri", sans-serif; font-size: 13px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .meta { margin: 0 0 16px; color: #4b5563; font-size: 12px; }
  .meta span { display: block; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 600; }
  td.first { font-weight: 500; }
  td.num { white-space: nowrap; }
  tbody tr:nth-child(even) { background: #fafafa; }
  .empty { padding: 24px; text-align: center; color: #6b7280; border: 1px dashed #d1d5db; }
  .actions { margin-bottom: 16px; }
  button { padding: 8px 14px; font: inherit; border-radius: 8px; border: 1px solid #d1d5db;
           background: #fff; cursor: pointer; }
  @media print { .actions { display: none; } body { padding: 0; } thead { display: table-header-group; } }
</style>
</head>
<body>
  <div class="actions"><button type="button" onclick="window.print()">${esc(labels.print)}</button></div>
  <h1>${esc(doc.title)}</h1>
  <p class="meta">${doc.metaLines.map((l) => `<span>${esc(l)}</span>`).join("")}</p>
  ${
    doc.rows.length === 0
      ? `<p class="empty">${esc(labels.empty)}</p>`
      : `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  }
  <script>window.addEventListener("load", function () { window.print(); });</script>
</body>
</html>
`;
}

// ── Minimal XLSX writer ──────────────────────────────────────────────────
// A .xlsx is a ZIP of XML parts. Writing the handful of parts Excel actually
// requires is ~80 lines and keeps the export dependency-free, which matters
// here: the deploy target has no build toolchain and the repo's rule is that a
// feature must degrade rather than demand an external piece. Entries are STORED
// (no compression) so nothing beyond a CRC-32 is needed.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = -1;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zipStore(entries: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // local file header signature
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // method 0 = stored
    header.writeUInt16LE(0, 10); // mod time
    header.writeUInt16LE(0x21, 12); // mod date = 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(entry.data.length, 18); // compressed size
    header.writeUInt32LE(entry.data.length, 22); // uncompressed size
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // extra length
    local.push(header, name, entry.data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); // central directory signature
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(entry.data.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30); // extra length
    dir.writeUInt16LE(0, 32); // comment length
    dir.writeUInt16LE(0, 34); // disk number
    dir.writeUInt16LE(0, 36); // internal attributes
    dir.writeUInt32LE(0, 38); // external attributes
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += header.length + name.length + entry.data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([Buffer.concat(local), centralBuf, end]);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 0 → A, 25 → Z, 26 → AA … */
function columnName(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Render a report as a real .xlsx workbook.
 *
 * Money cells are written as NUMBERS with a Taka currency number-format, so the
 * column stays summable in Excel while still displaying as ৳1,234.50. Text
 * cells use inline strings, which removes the need for a shared-strings part.
 */
export function reportToXlsx(doc: ExportDocument, sheetName: string): Buffer {
  const moneyCols = new Set(doc.moneyColumns);
  const rows: string[] = [];
  let rowNumber = 1;

  const cell = (col: number, style: number | null, value: string | number, numeric: boolean) => {
    const ref = `${columnName(col)}${rowNumber}`;
    const s = style === null ? "" : ` s="${style}"`;
    return numeric
      ? `<c r="${ref}"${s}><v>${value}</v></c>`
      : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
  };

  // Title + context lines first, so a printed/emailed sheet always says which
  // window and branch it covers.
  rows.push(`<row r="${rowNumber}">${cell(0, 1, doc.title, false)}</row>`);
  rowNumber += 1;
  for (const line of doc.metaLines) {
    rows.push(`<row r="${rowNumber}">${cell(0, null, line, false)}</row>`);
    rowNumber += 1;
  }
  rowNumber += 1; // blank spacer row

  rows.push(
    `<row r="${rowNumber}">${doc.headers.map((h, i) => cell(i, 2, h, false)).join("")}</row>`,
  );
  rowNumber += 1;

  for (const row of doc.rows) {
    const cells = row.map((value, i) => {
      if (moneyCols.has(i)) {
        const n = Number(value);
        return cell(i, 3, Number.isFinite(n) ? n : 0, true);
      }
      if (typeof value === "number" && Number.isFinite(value)) return cell(i, null, value, true);
      return cell(i, null, value, false);
    });
    rows.push(`<row r="${rowNumber}">${cells.join("")}</row>`);
    rowNumber += 1;
  }

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  // Excel truncates a sheet name at 31 chars and rejects : \ / ? * [ ].
  const safeSheet = xmlEscape(sheetName.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Report");
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  // numFmtId 164 = BDT. cellXfs: 0 default, 1 title, 2 header, 3 money.
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;৳&quot;#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(styles, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") },
  ]);
}
