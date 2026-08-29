import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import {
  deductionsAndCharges,
  type DeductionTotals,
  type SettlementBasis,
} from "@/lib/services/financials";
import { dhakaDayEndFromKey, dhakaDayKey, dhakaDayStartFromKey, isoDate } from "@/lib/utils/dates";

type PeriodKind = "daily" | "weekly" | "monthly" | "yearly";

const PERIODS: PeriodKind[] = ["daily", "weekly", "monthly", "yearly"];

/**
 * Bucket key for a date under the chosen granularity. Identical to the one the
 * period report uses (app/api/accounts/reports/route.ts): the calendar day comes
 * from isoDate(), which owns the business timezone, and the ISO-week arithmetic
 * below runs on an already-resolved Dhaka day.
 */
function periodKey(d: Date, kind: PeriodKind): string {
  const day = isoDate(d); // YYYY-MM-DD
  if (kind === "daily") return day;
  if (kind === "monthly") return day.slice(0, 7); // YYYY-MM
  if (kind === "yearly") return day.slice(0, 4); // YYYY
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Every figure of a deductions row, as fixed-2 strings. */
function serializeRow(row: DeductionTotals) {
  return {
    orders: row.orders,
    gross_sales: row.grossSales.toFixed(2),
    coupon_discount: row.couponDiscount.toFixed(2),
    coin_discount: row.coinDiscount.toFixed(2),
    total_discounts: row.totalDiscounts.toFixed(2),
    // A SLICE of coupon_discount (campaign-attached coupons), never additive.
    promotional_discount: row.promotionalDiscount.toFixed(2),
    net_sales: row.netSales.toFixed(2),
    delivery_revenue: row.deliveryRevenue.toFixed(2),
    food_revenue: row.foodRevenue.toFixed(2),
    tax: row.tax.toFixed(2),
    service_charge: row.serviceCharge.toFixed(2),
    net_food_revenue: row.netFoodRevenue.toFixed(2),
    refunds: row.refunds.toFixed(2),
    total_deductions: row.totalDeductions.toFixed(2),
  };
}

// GET /api/accounts/deductions
//   ?period=daily|weekly|monthly|yearly &days=30 &from=YYYY-MM-DD &to=YYYY-MM-DD
//   &branch=<id> &basis=created|delivered
//
// WS-2.3 — tax, service charge, discounts, coupon cost and promotional
// deductions, branch-wise and period-wise. Nothing here existed before: tax and
// the service charge are configured but were reported nowhere, and the money
// given away as coupon/coin discount was invisible in every accounts screen.
//
// The rates EXTRACT the charges embedded in recorded sales — see splitCharges()
// in lib/services/financials.ts for why adding them on top would be wrong.
export const GET = handle(async (req: Request) => {
  await requireApiRole("accounts", "super_admin", "management");
  const url = new URL(req.url);

  const requested = url.searchParams.get("period") ?? "daily";
  const kind: PeriodKind = PERIODS.includes(requested as PeriodKind) ? (requested as PeriodKind) : "daily";
  const basis: SettlementBasis = url.searchParams.get("basis") === "delivered" ? "delivered" : "created";

  // An explicit Dhaka day range wins; otherwise fall back to a rolling window
  // whose length matches the granularity, exactly as the period report does.
  const fromKey = url.searchParams.get("from") ?? "";
  const toKey = url.searchParams.get("to") ?? "";
  const explicitFrom = fromKey ? dhakaDayStartFromKey(fromKey) : null;
  const explicitToEnd = toKey ? dhakaDayEndFromKey(toKey) : null;

  const defaultDays = kind === "daily" ? 30 : kind === "weekly" ? 84 : kind === "monthly" ? 365 : 1095;
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || defaultDays, 1), 1825);

  const from = explicitFrom ?? new Date(Date.now() - days * 86400000);
  // dhakaDayEndFromKey is INCLUSIVE (23:59:59.999); the window's `to` is
  // exclusive, so the last millisecond of the chosen day is added back.
  const to = explicitToEnd ? new Date(explicitToEnd.getTime() + 1) : undefined;

  const branchParam = Number(url.searchParams.get("branch"));
  const branchId = Number.isInteger(branchParam) && branchParam > 0 ? branchParam : undefined;

  const report = await deductionsAndCharges({ from, to, branchId, basis }, (d) => periodKey(d, kind));

  return json({
    period: kind,
    basis,
    from: dhakaDayKey(from),
    to: to ? dhakaDayKey(new Date(to.getTime() - 1)) : null,
    branch: branchId ?? null,
    // The configured rates travel with the report so a reader can see which
    // percentages produced the figures instead of having to guess.
    rates: {
      tax_percent: report.rates.taxPercent.toFixed(2),
      service_charge_percent: report.rates.servicePercent.toFixed(2),
    },
    totals: serializeRow(report.totals),
    by_branch: report.byBranch.map((b) => ({
      branch: b.branchId,
      branch_name: b.branchName,
      ...serializeRow(b),
    })),
    results: report.buckets.map((b) => ({ label: b.label, ...serializeRow(b) })),
    by_coupon: report.byCoupon.map((c) => ({
      coupon: c.couponId,
      code: c.code,
      orders: c.orders,
      discount: c.discount.toFixed(2),
      promotional: c.promotional,
    })),
  });
});
