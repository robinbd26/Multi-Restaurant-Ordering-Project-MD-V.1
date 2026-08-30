import type { Metadata } from "next";

import { WeeklySalesChart } from "@/components/dashboard/bar-chart";
import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { managementDashboard } from "@/lib/services/dashboards";
import { businessGrowth } from "@/lib/services/management";
import { daysAgo } from "@/lib/utils/dates";
import { getT, getLocale } from "@/lib/i18n/server";
import type { ManagementDashboard } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("mgmtReports.analyticsTitle") };
}

/** /management/analytics — graphical dashboard + growth trends + retention stats. */
export default async function ManagementAnalyticsPage() {
  const { t, fmt } = await getT();
  const locale = await getLocale();
  await requireRole("management", "super_admin");

  const [data, customers, repeatAgg, growth] = await Promise.all([
    managementDashboard() as Promise<ManagementDashboard>,
    prisma.user.count({ where: { role: "customer" } }),
    prisma.order.groupBy({ by: ["customerId"], _count: true }),
    // WS-8.13 — month-to-date vs the equal-length window before it (Dhaka days).
    businessGrowth(),
  ]);

  const repeatCustomers = repeatAgg.filter((r) => r._count > 1).length;
  const orderingCustomers = repeatAgg.length;
  const retentionPct = orderingCustomers ? Math.round((repeatCustomers / orderingCustomers) * 100) : 0;
  const newLast30 = await prisma.user.count({
    where: { role: "customer", dateJoined: { gte: daysAgo(30) } },
  });

  const maxBranchSales = Math.max(1, ...data.branch_performance.map((b) => Number(b.sales)));

  /** ▲ +12.5% / ▼ −8% badge; "—" when the previous window has no base. */
  const growthCell = (pct: number | null) =>
    pct === null ? (
      <span className="text-fg-subtle">—</span>
    ) : (
      <Badge tone={pct >= 0 ? "green" : "red"}>
        {pct >= 0 ? "▲" : "▼"} {fmt.num(Math.abs(pct))}%
      </Badge>
    );

  const windowLabel = (fromKey: string, toKey: string) => `${fmt.date(fromKey)} — ${fmt.date(toKey)}`;

  return (
    <>
      <PageHeader title={t("mgmtReports.analyticsTitle")} subtitle={t("mgmtReports.analyticsSub")} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("mgmtReports.totalCustomers")} value={fmt.num(customers)} icon={<Icon name="users" />} accent="brand" />
        <StatCard label={t("mgmtReports.newLast30")} value={fmt.num(newLast30)} icon={<Icon name="user" />} accent="green" />
        <StatCard label={t("mgmtReports.repeatCustomers")} value={fmt.num(repeatCustomers)} icon={<Icon name="check" />} accent="violet" />
        <StatCard label={t("mgmtReports.retention")} value={`${fmt.num(retentionPct)}%`} icon={<Icon name="chart" />} accent="amber" />
      </div>

      {/* WS-8.13 — business growth trends: this period vs the previous one. */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title={t("mgmtReports.growthTitle")}
            subtitle={`${windowLabel(growth.filter.fromKey, growth.filter.toKey)} · ${t("mgmtReports.previousPeriod")}: ${windowLabel(growth.previousFromKey, growth.previousToKey)}`}
          />
          <Table
            headers={[
              t("mgmtReports.col.metric"),
              t("mgmtReports.currentPeriod"),
              t("mgmtReports.previousPeriod"),
              t("mgmtReports.growthLabel"),
            ]}
          >
            <tr className="hover:bg-surface-hover/70">
              <Td><span className="font-medium text-fg-base">{t("mgmtReports.col.revenue")}</span></Td>
              <Td><span className="font-semibold">{fmt.money(growth.revenue.current)}</span></Td>
              <Td>{fmt.money(growth.revenue.previous)}</Td>
              <Td>{growthCell(growth.revenue.growth_pct)}</Td>
            </tr>
            <tr className="hover:bg-surface-hover/70">
              <Td><span className="font-medium text-fg-base">{t("mgmtReports.col.orders")}</span></Td>
              <Td><span className="font-semibold">{fmt.num(growth.orders.current)}</span></Td>
              <Td>{fmt.num(growth.orders.previous)}</Td>
              <Td>{growthCell(growth.orders.growth_pct)}</Td>
            </tr>
            <tr className="hover:bg-surface-hover/70">
              <Td><span className="font-medium text-fg-base">{t("mgmtReports.col.newCustomers")}</span></Td>
              <Td><span className="font-semibold">{fmt.num(growth.newCustomers.current)}</span></Td>
              <Td>{fmt.num(growth.newCustomers.previous)}</Td>
              <Td>{growthCell(growth.newCustomers.growth_pct)}</Td>
            </tr>
          </Table>
          <p className="px-5 py-3 text-sm text-fg-muted">
            {t("mgmtReports.repeatRate")}:{" "}
            <span className="font-semibold text-fg-base">{fmt.num(growth.repeat.rate_pct)}%</span>{" "}
            ({fmt.num(growth.repeat.repeat)}/{fmt.num(growth.repeat.ordering)})
          </p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("mgmtReports.weeklySales")} />
          <CardContent>
            <WeeklySalesChart data={data.weekly_sales} locale={locale} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title={t("mgmtReports.branchCompare")} />
          <CardContent>
            {data.branch_performance.length === 0 ? (
              <EmptyState title={t("pages.noData")} />
            ) : (
              <ul className="space-y-3">
                {data.branch_performance.map((b) => (
                  <li key={b.branch__id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-fg-base">{b.branch__name}</span>
                      <span className="font-semibold text-fg-base">{fmt.money(b.sales)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${(Number(b.sales) / maxBranchSales) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
