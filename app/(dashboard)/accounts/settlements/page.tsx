import type { Metadata } from "next";

import { SettlementPanel } from "@/components/accounts/settlement-panel";
import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { ListPagination } from "@/components/dashboard/list-controls";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { pageMeta, parseListParams, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("financials.settlementsTitle") };
}

const BASE = "/accounts/settlements";
const SORTABLE = ["date", "net"] as const;

/** /accounts/settlements — end-of-day branch settlement snapshots. */
export default async function AccountsSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("accounts", "super_admin");
  const sp = await searchParams;

  const { page, pageSize, skip, take, sort, direction } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "date",
  });

  const [count, rows, branches] = await Promise.all([
    prisma.branchSettlement.count(),
    prisma.branchSettlement.findMany({
      include: { branch: true, generatedBy: true },
      orderBy: sort === "net" ? { net: direction } : { date: direction },
      skip,
      take,
    }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const meta = pageMeta(count, page, pageSize);

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/accounts/dashboard" },
          { label: t("financials.settlementsTitle") },
        ]}
        title={t("financials.settlementsTitle")}
        subtitle={t("financials.settlementsSub")}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title={t("financials.generateSettlement")} subtitle={t("financials.generateSub")} />
          <CardContent>
            {/* WS-2.7 — the generator now reports the full derivation and the
                day's cash position, because a stored `net` that silently folds
                in refunds and adjustments is an unexplained number. */}
            <SettlementPanel branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          {/* WS-2.1 — `net` is no longer sales − commission − expenses: it also
              subtracts refunds paid out and applies authorised adjustments, so
              the subtitle spells that out rather than leaving an unexplained gap. */}
          <CardHeader title={t("financials.settlementHistory")} subtitle={t("financials.netIncludesNote")} />
          {rows.length === 0 ? (
            <EmptyState title={t("financials.noSettlements")} />
          ) : (
            <>
              <Table headers={[t("pages.colDate"), t("pages.colBranch"), t("accounts.colOrders"), t("accounts.colSales"), t("wallet.totalCommission"), t("financials.expensesLabel"), t("financials.netLabel")]}>
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-hover/70">
                    <Td><span className="text-xs text-fg-muted">{fmt.date(s.date.toISOString())}</span></Td>
                    <Td>{s.branch.name}</Td>
                    <Td>{fmt.num(s.orders)}</Td>
                    <Td>{fmt.money(s.sales.toFixed(2))}</Td>
                    <Td>{fmt.money(s.commission.toFixed(2))}</Td>
                    <Td>{fmt.money(s.expenses.toFixed(2))}</Td>
                    <Td><span className="font-semibold text-emerald-600">{fmt.money(s.net.toFixed(2))}</span></Td>
                  </tr>
                ))}
              </Table>
              <ListPagination
                basePath={BASE}
                searchParams={sp}
                meta={meta}
                labels={{
                  showing: t("list.showing", {
                    from: fmt.num(meta.from),
                    to: fmt.num(meta.to),
                    total: fmt.num(meta.total),
                  }),
                  previous: t("list.previous"),
                  next: t("list.next"),
                  pagination: t("list.pagination"),
                }}
              />
            </>
          )}
        </Card>
      </div>
    </DashboardPage>
  );
}
