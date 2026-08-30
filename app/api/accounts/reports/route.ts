import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { branchSales, periodFinancials } from "@/lib/services/financials";
import { dhakaAddDays, isoDate, startOfDhakaToday } from "@/lib/utils/dates";

type PeriodKind = "daily" | "weekly" | "monthly" | "yearly";

/**
 * Bucket key for a date under the chosen period granularity.
 *
 * The calendar day comes from isoDate(), which owns the business timezone, so
 * this inherits that conversion instead of rolling its own offset maths. The
 * UTC anchor below is pure ISO-week arithmetic on an already-resolved day.
 */
function periodKey(d: Date, kind: PeriodKind): string {
  const day = isoDate(d); // YYYY-MM-DD
  if (kind === "daily") return day;
  if (kind === "monthly") return day.slice(0, 7); // YYYY-MM
  if (kind === "yearly") return day.slice(0, 4); // YYYY
  // ISO week: YYYY-Www
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// GET /api/accounts/reports?period=daily|weekly|monthly&days=30
// Period rows (orders, sales, delivery revenue, refunds, commission, expenses,
// adjustments, withdrawals paid) + totals + the money reconciliation ladder.
//
// WS-2.1 — net revenue used to be sales − commission − expenses, which never
// subtracted Refund rows and never applied FinancialAdjustment rows even though
// both models are populated, so the headline number was wrong. All arithmetic
// now lives in periodFinancials() and stays in Prisma.Decimal end to end.
export const GET = handle(async (req: Request) => {
  await requireApiRole("accounts", "super_admin", "management");
  const url = new URL(req.url);
  const period = (url.searchParams.get("period") ?? "daily") as PeriodKind;
  const kind: PeriodKind = ["daily", "weekly", "monthly", "yearly"].includes(period) ? period : "daily";
  const defaultDays = kind === "daily" ? 30 : kind === "weekly" ? 84 : kind === "monthly" ? 365 : 1095;
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || defaultDays, 1), 1825);
  // WS-2.11 — the window opens at a DHAKA midnight, covering the last `days`
  // whole Dhaka business days INCLUDING today. `Date.now() − n·86400000` started
  // the window mid-day, so the oldest bucket was always a partial day quietly
  // under-reporting against its settlement.
  const since = dhakaAddDays(startOfDhakaToday(), -(days - 1));

  // WS-2.11 — the branch table shares the report window. It used to come from
  // the dashboard's ALL-TIME figures, silently masquerading as a period figure
  // beside genuinely period-scoped cards.
  const [{ totals, reconciliation, byMethod, buckets }, byBranch] = await Promise.all([
    periodFinancials({ from: since }, (d) => periodKey(d, kind)),
    branchSales({ from: since }),
  ]);

  return json({
    period: kind,
    days,
    totals: {
      orders: totals.orders,
      sales: totals.sales.toFixed(2),
      // The delivery slice of `sales` (WS-2.2) — never add it back on top.
      delivery_revenue: totals.deliveryRevenue.toFixed(2),
      food_revenue: totals.foodRevenue.toFixed(2),
      refunds: totals.refunds.toFixed(2),
      commission: totals.commission.toFixed(2),
      withdrawals_paid: totals.withdrawalsPaid.toFixed(2),
      expenses: totals.expenses.toFixed(2),
      adjustments_credit: totals.adjustmentsCredit.toFixed(2),
      adjustments_debit: totals.adjustmentsDebit.toFixed(2),
      adjustments_net: totals.adjustments.toFixed(2),
      net_sales: totals.netSales.toFixed(2),
      net_after_commission: totals.netAfterCommission.toFixed(2),
      net_revenue: totals.netRevenue.toFixed(2),
    },
    // collected vs recorded vs verified vs settled — a gap is now visible
    // instead of being silently absorbed into net revenue.
    reconciliation: {
      recorded: reconciliation.recorded.toFixed(2),
      collected: reconciliation.collected.toFixed(2),
      verified: reconciliation.verified.toFixed(2),
      settled: reconciliation.settled.toFixed(2),
      uncollected: reconciliation.uncollected.toFixed(2),
      unverified: reconciliation.unverified.toFixed(2),
      unsettled: reconciliation.unsettled.toFixed(2),
      cash_collected: reconciliation.cashCollected.toFixed(2),
      digital_collected: reconciliation.digitalCollected.toFixed(2),
      refunded: reconciliation.refunded.toFixed(2),
      expected_in_hand: reconciliation.expectedInHand.toFixed(2),
    },
    // WS-2.11 — delivered sales per branch over the SAME window as everything
    // else in this payload.
    by_branch: byBranch.map((b) => ({
      branch_id: b.branchId,
      branch_name: b.branchName,
      orders: b.orders,
      sales: b.sales.toFixed(2),
      food_revenue: b.foodRevenue.toFixed(2),
      delivery_revenue: b.deliveryRevenue.toFixed(2),
    })),
    by_method: byMethod.map((m) => ({
      payment_method: m.method,
      orders: m.orders,
      sales: m.sales.toFixed(2),
      food_revenue: m.foodRevenue.toFixed(2),
      delivery_revenue: m.deliveryRevenue.toFixed(2),
      collected: m.collected.toFixed(2),
      verified: m.verified.toFixed(2),
      settled: m.settled.toFixed(2),
    })),
    results: buckets.map((b) => ({
      label: b.label,
      orders: b.orders,
      sales: b.sales.toFixed(2),
      delivery_revenue: b.deliveryRevenue.toFixed(2),
      food_revenue: b.foodRevenue.toFixed(2),
      refunds: b.refunds.toFixed(2),
      commission: b.commission.toFixed(2),
      expenses: b.expenses.toFixed(2),
      adjustments: b.adjustments.toFixed(2),
      withdrawals_paid: b.withdrawalsPaid.toFixed(2),
      net: b.net.toFixed(2),
    })),
  });
});
