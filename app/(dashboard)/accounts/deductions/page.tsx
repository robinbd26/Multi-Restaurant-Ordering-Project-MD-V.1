import type { Metadata } from "next";

import { ChargeRatesPanel } from "@/components/accounts/charge-rates-panel";
import { Icon } from "@/components/layout/icons";
import { SummaryCard, SummaryCardGrid } from "@/components/dashboard/summary-card";
import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { FIELD_CLASS, SELECT_EXTRA_CLASS } from "@/components/ui/field-class";
import { getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("financials.deductionsTitle") };
}

const PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;
type Period = (typeof PERIODS)[number];

/** One deductions row as app/api/accounts/deductions/route.ts serializes it. */
interface DeductionRow {
  orders: number;
  gross_sales: string;
  coupon_discount: string;
  coin_discount: string;
  total_discounts: string;
  promotional_discount: string;
  net_sales: string;
  delivery_revenue: string;
  food_revenue: string;
  tax: string;
  service_charge: string;
  net_food_revenue: string;
  refunds: string;
  total_deductions: string;
}

interface DeductionsPayload {
  period: Period;
  basis: string;
  from: string;
  to: string | null;
  branch: number | null;
  rates: { tax_percent: string; service_charge_percent: string };
  totals: DeductionRow;
  by_branch: (DeductionRow & { branch: number; branch_name: string })[];
  results: (DeductionRow & { label: string })[];
  by_coupon: {
    coupon: number;
    code: string;
    orders: number;
    discount: string;
    promotional: boolean;
  }[];
}

type Params = {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    branch?: string;
    basis?: string;
  }>;
};

/**
 * /accounts/deductions — WS-2.3 deductions & charges.
 *
 * Tax, service charge, discounts, coupon cost and promotional deductions were
 * reported NOWHERE in the application, so nobody could answer "what did we give
 * away this month?" or "how much of the takings was VAT?" — even though both
 * rates are configured and every discount is stored on the order.
 *
 * The charges are EXTRACTED from recorded sales, not added to them: the order
 * pipeline never adds tax or a service charge on top of a total, so a report
 * that added them would invent revenue. See splitCharges() in
 * lib/services/financials.ts.
 */
export default async function AccountsDeductionsPage({ searchParams }: Params) {
  const { t, fmt } = await getT();
  const me = await requireRole("accounts", "super_admin");
  const sp = await searchParams;

  const period: Period = PERIODS.includes(sp.period as Period) ? (sp.period as Period) : "daily";
  const basis = sp.basis === "delivered" ? "delivered" : "created";

  const query = new URLSearchParams({ period, basis });
  for (const key of ["from", "to", "branch"] as const) {
    if (sp[key]) query.set(key, sp[key]!);
  }

  const [report, branches] = await Promise.all([
    getJSON<DeductionsPayload>(`/accounts/deductions/?${query}`),
    prisma.branch.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const totals = report.totals;
  const field = FIELD_CLASS;
  const selectField = `${FIELD_CLASS} ${SELECT_EXTRA_CLASS}`;

  // The money columns every table repeats, in the order an accountant reads
  // them: what was given away, then what was carved out of what remained.
  const columns = [
    t("accounts.colOrders"),
    t("financials.grossSales"),
    t("financials.couponDiscount"),
    t("financials.coinDiscountShort"),
    t("financials.promotionalDeduction"),
    t("accounts.colSales"),
    t("financials.taxShort"),
    t("financials.serviceChargeShort"),
    t("accounts.colRefunds"),
    t("financials.totalDeductions"),
  ];
  const cells = (row: DeductionRow) => (
    <>
      <Td>{fmt.num(row.orders)}</Td>
      <Td mono>{fmt.money(row.gross_sales)}</Td>
      <Td mono>{fmt.money(row.coupon_discount)}</Td>
      <Td mono>{fmt.money(row.coin_discount)}</Td>
      <Td mono>{fmt.money(row.promotional_discount)}</Td>
      <Td mono><span className="font-semibold">{fmt.money(row.net_sales)}</span></Td>
      <Td mono>{fmt.money(row.tax)}</Td>
      <Td mono>{fmt.money(row.service_charge)}</Td>
      <Td mono>{fmt.money(row.refunds)}</Td>
      <Td mono><span className="font-semibold text-amber-600">{fmt.money(row.total_deductions)}</span></Td>
    </>
  );

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/accounts/dashboard" },
          { label: t("financials.deductionsTitle") },
        ]}
        title={t("financials.deductionsTitle")}
        subtitle={t("financials.deductionsSub")}
      />

      <form method="GET" noValidate className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border-base bg-surface-card p-4 shadow-card">
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.colPeriod")}
          <select name="period" defaultValue={period} className={selectField}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>{t(`wallet.period_${p}`)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("pages.colBranch")}
          <select name="branch" defaultValue={sp.branch ?? ""} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterFrom")}
          <input type="date" name="from" defaultValue={sp.from ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterTo")}
          <input type="date" name="to" defaultValue={sp.to ?? ""} className={field} />
        </label>
        {/* WS-2.7 — the same choice the end-of-day settlement makes: file an
            order by when it was placed, or by when it was actually delivered. */}
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("financials.basisLabel")}
          <select name="basis" defaultValue={basis} className={selectField}>
            <option value="created">{t("financials.basisCreated")}</option>
            <option value="delivered">{t("financials.basisDelivered")}</option>
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
        >
          {t("wallet.applyFilters")}
        </button>
      </form>

      <SummaryCardGrid className="xl:grid-cols-4">
        <SummaryCard
          title={t("financials.grossSales")}
          value={fmt.money(totals.gross_sales)}
          description={t("financials.grossSalesHint")}
          icon={<Icon name="money" />}
          accent="brand"
        />
        <SummaryCard
          title={t("financials.totalDiscounts")}
          value={fmt.money(totals.total_discounts)}
          description={t("financials.discountSplit", {
            coupon: fmt.money(totals.coupon_discount),
            coins: fmt.money(totals.coin_discount),
          })}
          icon={<Icon name="edit" />}
          accent="warning"
        />
        <SummaryCard
          title={t("financials.promotionalDeduction")}
          value={fmt.money(totals.promotional_discount)}
          description={t("financials.promotionalHint")}
          icon={<Icon name="chart" />}
          accent="violet"
        />
        <SummaryCard
          title={t("accounts.colSales")}
          value={fmt.money(totals.net_sales)}
          description={t("financials.netSalesHint")}
          icon={<Icon name="check" />}
          accent="success"
        />
        <SummaryCard
          title={t("financials.taxLabel", { rate: report.rates.tax_percent })}
          value={fmt.money(totals.tax)}
          description={t("financials.chargesIncluded")}
          icon={<Icon name="list" />}
          accent="info"
        />
        <SummaryCard
          title={t("financials.serviceChargeLabel", { rate: report.rates.service_charge_percent })}
          value={fmt.money(totals.service_charge)}
          description={t("financials.chargesIncluded")}
          icon={<Icon name="list" />}
          accent="info"
        />
        <SummaryCard
          title={t("accounts.refundsLabel")}
          value={fmt.money(totals.refunds)}
          description={t("financials.refundsWindowHint")}
          icon={<Icon name="x" />}
          accent="danger"
        />
        <SummaryCard
          title={t("financials.totalDeductions")}
          value={fmt.money(totals.total_deductions)}
          description={t("financials.totalDeductionsHint")}
          icon={<Icon name="grid" />}
          accent="neutral"
        />
      </SummaryCardGrid>

      {/* WS-2.3 — the rates the whole report is built on. Only the super admin
          may change them (the API refuses anyone else), so the form is only
          rendered for one; everybody else reads the rates off the cards above. */}
      {me.role === "super_admin" ? (
        <Card className="mt-6">
          <CardHeader title={t("financials.chargeRatesTitle")} subtitle={t("financials.chargeRatesSub")} />
          <CardContent className="max-w-md">
            <ChargeRatesPanel
              taxPercent={report.rates.tax_percent}
              servicePercent={report.rates.service_charge_percent}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* The food slice is the base the charges come out of — delivery is never
          taxed here, because the charge funds the rider and the route. */}
      <Card className="mt-6">
        <CardHeader title={t("financials.chargeBaseTitle")} subtitle={t("financials.chargeBaseSub")} />
        <Table headers={[t("accounts.colStage"), t("accounts.colAmount"), t("accounts.colMeaning")]}>
          {[
            { key: "food", value: totals.food_revenue, label: t("accounts.foodRevenue"), hint: t("financials.chargeBaseHint") },
            { key: "delivery", value: totals.delivery_revenue, label: t("accounts.deliveryRevenue"), hint: t("financials.deliveryNotTaxedHint") },
            { key: "tax", value: totals.tax, label: t("financials.taxShort"), hint: t("financials.taxHint", { rate: report.rates.tax_percent }) },
            { key: "service", value: totals.service_charge, label: t("financials.serviceChargeShort"), hint: t("financials.serviceChargeHint", { rate: report.rates.service_charge_percent }) },
            { key: "net", value: totals.net_food_revenue, label: t("financials.netFoodRevenue"), hint: t("financials.netFoodRevenueHint") },
          ].map((row) => (
            <tr key={row.key} className="hover:bg-surface-hover/70">
              <Td><span className="font-medium text-fg-base">{row.label}</span></Td>
              <Td mono><span className="font-semibold">{fmt.money(row.value)}</span></Td>
              <Td><span className="text-xs text-fg-muted">{row.hint}</span></Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader title={t("financials.deductionsByBranch")} subtitle={t("financials.deductionsByBranchSub")} />
        {report.by_branch.length === 0 ? (
          <EmptyState title={t("pages.noData")} />
        ) : (
          <Table headers={[t("pages.colBranch"), ...columns]}>
            {report.by_branch.map((row) => (
              <tr key={row.branch} className="hover:bg-surface-hover/70">
                <Td><span className="font-medium text-fg-base">{row.branch_name}</span></Td>
                {cells(row)}
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title={t("financials.deductionsByPeriod")} subtitle={t("financials.deductionsByPeriodSub")} />
        {report.results.length === 0 ? (
          <EmptyState title={t("pages.noData")} />
        ) : (
          <Table headers={[t("wallet.colPeriod"), ...columns]}>
            {report.results.map((row) => (
              <tr key={row.label} className="hover:bg-surface-hover/70">
                <Td><span className="font-medium text-fg-base">{row.label}</span></Td>
                {cells(row)}
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Which coupon actually cost the money — the total alone never says. */}
      <Card className="mt-6">
        <CardHeader title={t("financials.couponCostTitle")} subtitle={t("financials.couponCostSub")} />
        {report.by_coupon.length === 0 ? (
          <CardContent>
            <EmptyState title={t("financials.noCouponCost")} />
          </CardContent>
        ) : (
          <Table
            headers={[
              t("financials.couponCode"),
              t("accounts.colOrders"),
              t("financials.couponDiscount"),
              t("financials.typeLabel"),
            ]}
          >
            {report.by_coupon.map((row) => (
              <tr key={row.coupon} className="hover:bg-surface-hover/70">
                <Td><span className="font-semibold text-fg-base">{row.code || `#${fmt.num(row.coupon)}`}</span></Td>
                <Td>{fmt.num(row.orders)}</Td>
                <Td mono><span className="font-semibold">{fmt.money(row.discount)}</span></Td>
                <Td>
                  <Badge tone={row.promotional ? "violet" : "slate"}>
                    {row.promotional ? t("financials.promotionalDeduction") : t("financials.couponDiscount")}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </DashboardPage>
  );
}
