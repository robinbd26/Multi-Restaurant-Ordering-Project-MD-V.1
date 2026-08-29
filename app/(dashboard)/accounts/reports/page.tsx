import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { SummaryCard, SummaryCardGrid } from "@/components/dashboard/summary-card";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { accountsDashboard } from "@/lib/services/dashboards";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("pages.reportsTitle") };
}

interface ReportPayload {
  period: string;
  totals: {
    orders: number;
    sales: string;
    delivery_revenue: string;
    food_revenue: string;
    refunds: string;
    commission: string;
    withdrawals_paid: string;
    expenses: string;
    adjustments_credit: string;
    adjustments_debit: string;
    adjustments_net: string;
    net_sales: string;
    net_after_commission: string;
    net_revenue: string;
  };
  /** WS-2.1 — collected vs recorded vs verified vs settled, plus the gaps. */
  reconciliation: {
    recorded: string;
    collected: string;
    verified: string;
    settled: string;
    uncollected: string;
    unverified: string;
    unsettled: string;
    cash_collected: string;
    digital_collected: string;
    refunded: string;
    expected_in_hand: string;
  };
  by_method: {
    payment_method: string;
    orders: number;
    sales: string;
    food_revenue: string;
    delivery_revenue: string;
    collected: string;
    verified: string;
    settled: string;
  }[];
  results: {
    label: string;
    orders: number;
    sales: string;
    delivery_revenue: string;
    food_revenue: string;
    refunds: string;
    commission: string;
    expenses: string;
    adjustments: string;
    withdrawals_paid: string;
    net: string;
  }[];
}

type Params = { searchParams: Promise<{ period?: string }> };

const PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;

/** /accounts/reports — period financial summary + branch/payment breakdowns. */
export default async function AccountsReportsPage({ searchParams }: Params) {
  await requireRole("accounts", "super_admin");
  const { t, fmt } = await getT();
  const sp = await searchParams;
  const period = PERIODS.includes(sp.period as (typeof PERIODS)[number]) ? sp.period : "daily";

  const [report, dashboard] = await Promise.all([
    getJSON<ReportPayload>(`/accounts/reports/?period=${period}`),
    accountsDashboard(),
  ]);

  const tab = "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors";

  // A gap is only "clean" at exactly zero — materiality decides urgency, never
  // whether we look. Compared as a string→Number only for the zero test; every
  // figure itself was computed as an exact Decimal server-side.
  const gap = (value: string) => Number(value) !== 0;
  const recon = report.reconciliation;
  const gaps = [
    { key: "uncollected", value: recon.uncollected, label: t("accounts.uncollected"), hint: t("accounts.uncollectedHint") },
    { key: "unverified", value: recon.unverified, label: t("accounts.unverified"), hint: t("accounts.unverifiedHint") },
    { key: "unsettled", value: recon.unsettled, label: t("accounts.unsettled"), hint: t("accounts.unsettledHint") },
  ];
  const ladder = [
    { key: "recorded", value: recon.recorded, label: t("accounts.recorded"), hint: t("accounts.recordedHint") },
    { key: "collected", value: recon.collected, label: t("accounts.collected"), hint: t("accounts.collectedHint") },
    { key: "verified", value: recon.verified, label: t("accounts.verified"), hint: t("accounts.verifiedHint") },
    { key: "settled", value: recon.settled, label: t("accounts.settled"), hint: t("accounts.settledHint") },
  ];

  return (
    <>
      <PageHeader title={t("pages.reportsTitle")} subtitle={t("pages.reportsSub")} />

      <SummaryCardGrid className="xl:grid-cols-4">
        <SummaryCard title={t("accounts.totalSalesDelivered")} value={fmt.money(report.totals.sales)} icon={<Icon name="money" />} accent="success" />
        <SummaryCard title={t("accounts.foodRevenue")} value={fmt.money(report.totals.food_revenue)} icon={<Icon name="list" />} accent="brand" />
        {/* WS-2.2 — delivery-charge collections, previously absent from every finance figure. */}
        <SummaryCard title={t("accounts.deliveryRevenue")} value={fmt.money(report.totals.delivery_revenue)} icon={<Icon name="bike" />} accent="info" />
        <SummaryCard title={t("accounts.refundsLabel")} value={fmt.money(report.totals.refunds)} icon={<Icon name="x" />} accent="danger" />
        <SummaryCard title={t("wallet.totalCommission")} value={fmt.money(report.totals.commission)} icon={<Icon name="bike" />} accent="warning" />
        <SummaryCard title={t("financials.expensesLabel")} value={fmt.money(report.totals.expenses)} icon={<Icon name="list" />} accent="neutral" />
        <SummaryCard
          title={t("accounts.adjustmentsNet")}
          value={fmt.money(report.totals.adjustments_net)}
          description={t("accounts.adjustmentsSplit", {
            credit: fmt.money(report.totals.adjustments_credit),
            debit: fmt.money(report.totals.adjustments_debit),
          })}
          icon={<Icon name="edit" />}
          accent="violet"
        />
        {/* sales − refunds − commission − expenses ± adjustments. */}
        <SummaryCard
          title={t("financials.netRevenue")}
          value={fmt.money(report.totals.net_revenue)}
          description={t("accounts.netRevenueFormula")}
          icon={<Icon name="chart" />}
          accent="brand"
        />
      </SummaryCardGrid>

      {/* WS-2.1 — the reconciliation ladder. A difference between these four
          figures is now shown outright instead of being absorbed into net revenue. */}
      <Card className="mt-6">
        <CardHeader title={t("accounts.reconciliationTitle")} subtitle={t("accounts.reconciliationSub")} />
        <Table headers={[t("accounts.colStage"), t("accounts.colAmount"), t("accounts.colMeaning")]}>
          {ladder.map((row) => (
            <tr key={row.key} className="hover:bg-surface-hover/70">
              <Td><span className="font-medium text-fg-base">{row.label}</span></Td>
              <Td mono><span className="font-semibold">{fmt.money(row.value)}</span></Td>
              <Td><span className="text-xs text-fg-muted">{row.hint}</span></Td>
            </tr>
          ))}
          {gaps.map((row) => (
            <tr key={row.key} className="hover:bg-surface-hover/70">
              <Td>
                <span className={cn("font-medium", gap(row.value) ? "text-amber-600" : "text-fg-muted")}>
                  {row.label}
                </span>
              </Td>
              <Td mono>
                <span className={cn("font-semibold", gap(row.value) ? "text-amber-600" : "text-fg-muted")}>
                  {fmt.money(row.value)}
                </span>
              </Td>
              <Td>
                <span className="text-xs text-fg-muted">
                  {gap(row.value) ? row.hint : t("accounts.reconClean")}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
        <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title={t("accounts.cashCollected")} value={fmt.money(recon.cash_collected)} icon={<Icon name="money" />} accent="success" />
          <SummaryCard title={t("accounts.digitalCollected")} value={fmt.money(recon.digital_collected)} icon={<Icon name="wallet" />} accent="info" />
          <SummaryCard title={t("accounts.refundedOut")} value={fmt.money(recon.refunded)} icon={<Icon name="x" />} accent="danger" />
          <SummaryCard title={t("accounts.expectedInHand")} value={fmt.money(recon.expected_in_hand)} icon={<Icon name="check" />} accent="brand" />
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title={t("wallet.periodReport")}
          action={
            <div className="flex items-center gap-1.5 rounded-full bg-surface-muted p-1">
              {PERIODS.map((p) => (
                <Link
                  key={p}
                  href={`/accounts/reports?period=${p}`}
                  className={cn(tab, period === p ? "bg-surface-card text-brand-600 shadow-sm" : "text-fg-muted")}
                >
                  {t(`wallet.period_${p}`)}
                </Link>
              ))}
            </div>
          }
        />
        {report.results.length === 0 ? (
          <EmptyState title={t("pages.noData")} />
        ) : (
          <Table
            headers={[
              t("wallet.colPeriod"),
              t("accounts.colOrders"),
              t("accounts.colSales"),
              t("accounts.colDeliveryRevenue"),
              t("accounts.colRefunds"),
              t("wallet.totalCommission"),
              t("financials.expensesLabel"),
              t("accounts.colAdjustments"),
              t("wallet.paidWithdrawals"),
              t("financials.netLabel"),
            ]}
          >
            {report.results.map((row) => (
              <tr key={row.label} className="hover:bg-surface-hover/70">
                <Td><span className="font-medium text-fg-base">{row.label}</span></Td>
                <Td>{fmt.num(row.orders)}</Td>
                <Td mono><span className="font-semibold">{fmt.money(row.sales)}</span></Td>
                <Td mono>{fmt.money(row.delivery_revenue)}</Td>
                <Td mono>{fmt.money(row.refunds)}</Td>
                <Td mono>{fmt.money(row.commission)}</Td>
                <Td mono>{fmt.money(row.expenses)}</Td>
                <Td mono>{fmt.money(row.adjustments)}</Td>
                <Td mono>{fmt.money(row.withdrawals_paid)}</Td>
                <Td mono><span className="font-semibold text-emerald-600">{fmt.money(row.net)}</span></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("accounts.salesByBranch")} />
          {dashboard.sales_by_branch.length === 0 ? (
            <EmptyState title={t("accounts.noSalesYet")} />
          ) : (
            <Table
              headers={[
                t("accounts.colBranch"),
                t("accounts.colOrders"),
                t("accounts.colSales"),
                t("accounts.colFoodRevenue"),
                t("accounts.colDeliveryRevenue"),
              ]}
            >
              {dashboard.sales_by_branch.map((row) => (
                <tr key={row.branch__id} className="hover:bg-surface-hover/70">
                  <Td><span className="font-medium text-fg-base">{row.branch__name}</span></Td>
                  <Td>{fmt.num(row.orders)}</Td>
                  <Td mono><span className="font-semibold">{fmt.money(row.sales)}</span></Td>
                  <Td mono>{fmt.money(row.food_revenue)}</Td>
                  <Td mono>{fmt.money(row.delivery_revenue)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {/* WS-2.2 — cash / bKash / card, with the delivery slice split out so the
            branch settlement reconciles against the cash actually handed in. */}
        <Card>
          <CardHeader title={t("accounts.salesByPayment")} subtitle={t("accounts.salesByPaymentSub")} />
          {report.by_method.length === 0 ? (
            <EmptyState title={t("accounts.noSalesYet")} />
          ) : (
            <Table
              headers={[
                t("accounts.colMethod"),
                t("accounts.colOrders"),
                t("accounts.colSales"),
                t("accounts.colFoodRevenue"),
                t("accounts.colDeliveryRevenue"),
                t("accounts.colCollected"),
              ]}
            >
              {report.by_method.map((row) => (
                <tr key={row.payment_method} className="hover:bg-surface-hover/70">
                  <Td><span className="font-medium text-fg-base">{t(`payment.${row.payment_method}`)}</span></Td>
                  <Td>{fmt.num(row.orders)}</Td>
                  <Td mono><span className="font-semibold">{fmt.money(row.sales)}</span></Td>
                  <Td mono>{fmt.money(row.food_revenue)}</Td>
                  <Td mono>{fmt.money(row.delivery_revenue)}</Td>
                  <Td mono>{fmt.money(row.collected)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
