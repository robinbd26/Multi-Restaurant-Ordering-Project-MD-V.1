import type { Metadata } from "next";

import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { accountsDashboard } from "@/lib/services/dashboards";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Sales" };

/** /accounts/sales — branch-wise sales breakdown for finance. */
export default async function AccountsSalesPage() {
  await requireRole("accounts");
  const { t, fmt } = await getT();
  const data = await accountsDashboard();

  return (
    <>
      <PageHeader title={t("pages.salesTitle")} subtitle={t("pages.salesSub")} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("accounts.totalSalesDelivered")} value={fmt.money(data.total_sales)} icon={<Icon name="money" />} accent="green" />
        <StatCard label={t("accounts.deliveredOrders")} value={fmt.num(data.delivered_orders)} icon={<Icon name="check" />} accent="blue" />
        <StatCard label={t("accounts.cancelledOrders")} value={fmt.num(data.cancelled_orders)} icon={<Icon name="x" />} accent="slate" />
      </div>

      {/* WS-2.2 — delivery charges are a snapshotted, immutable part of every
          order total; splitting them out is what lets the branch settlement
          reconcile against the cash actually handed in. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label={t("accounts.foodRevenue")} value={fmt.money(data.settlement.food_revenue)} icon={<Icon name="list" />} accent="blue" />
        <StatCard label={t("accounts.deliveryRevenue")} value={fmt.money(data.settlement.delivery_revenue)} icon={<Icon name="bike" />} accent="amber" />
        <StatCard label={t("accounts.refundsLabel")} value={fmt.money(data.settlement.refunds)} icon={<Icon name="x" />} accent="red" />
      </div>

      <Card className="mt-6">
        <CardHeader title={t("accounts.salesByBranch")} subtitle={t("accounts.salesByBranchSub")} />
        {data.sales_by_branch.length === 0 ? (
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
            {data.sales_by_branch.map((row) => (
              <tr key={row.branch__id} className="hover:bg-surface-hover/70">
                <Td><span className="font-medium text-fg-base">{row.branch__name}</span></Td>
                <Td>{fmt.num(row.orders)}</Td>
                <Td><span className="font-semibold">{fmt.money(row.sales)}</span></Td>
                <Td>{fmt.money(row.food_revenue)}</Td>
                <Td>{fmt.money(row.delivery_revenue)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
