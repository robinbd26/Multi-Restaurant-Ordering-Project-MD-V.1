import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";

import { ExpenseForm } from "@/components/accounts/financial-forms";
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
  return { title: t("financials.expensesTitle") };
}

const BASE = "/accounts/expenses";
const SORTABLE = ["expenseDate", "amount"] as const;

/** /accounts/expenses — branch-wise expense records (rent/utilities/salary/…). */
export default async function AccountsExpensesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("accounts", "super_admin");
  const sp = await searchParams;

  const { page, pageSize, skip, take, sort, direction } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "expenseDate",
  });

  const where: Prisma.BranchExpenseWhereInput = {};
  const orderBy: Prisma.BranchExpenseOrderByWithRelationInput =
    sort === "amount" ? { amount: direction } : { expenseDate: direction };

  const [count, rows, branches, sumAgg] = await Promise.all([
    prisma.branchExpense.count({ where }),
    prisma.branchExpense.findMany({
      where,
      include: { branch: true, createdBy: true },
      orderBy,
      skip,
      take,
    }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.branchExpense.aggregate({ _sum: { amount: true } }),
  ]);

  const totalAmount = Number(sumAgg._sum.amount ?? 0);
  const meta = pageMeta(count, page, pageSize);

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/accounts/dashboard" },
          { label: t("financials.expensesTitle") },
        ]}
        title={t("financials.expensesTitle")}
        subtitle={t("financials.expensesSub", { amount: fmt.money(totalAmount) })}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title={t("financials.recordExpense")} />
          <CardContent>
            <ExpenseForm branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("financials.expenseHistory")} />
          {rows.length === 0 ? (
            <EmptyState title={t("financials.noExpenses")} />
          ) : (
            <>
              <Table headers={[t("pages.colDate"), t("pages.colBranch"), t("financials.category"), t("pages.colAmount"), t("financials.noteLabel"), t("financials.recordedBy")]}>
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-hover/70">
                    <Td><span className="text-xs text-fg-muted">{fmt.date(e.expenseDate.toISOString())}</span></Td>
                    <Td>{e.branch.name}</Td>
                    <Td>{t(`financials.cat_${e.category}`)}</Td>
                    <Td><span className="font-semibold">{fmt.money(e.amount.toFixed(2))}</span></Td>
                    <Td><span className="text-xs text-fg-muted">{e.note || "—"}</span></Td>
                    <Td>
                      <span className="text-xs text-fg-muted">
                        {e.createdBy
                          ? `${e.createdBy.firstName} ${e.createdBy.lastName}`.trim() || e.createdBy.username
                          : "—"}
                      </span>
                    </Td>
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
