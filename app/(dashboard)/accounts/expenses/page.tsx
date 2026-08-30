import type { Metadata } from "next";
import { Prisma } from "@prisma/client";

import { ExpenseForm } from "@/components/accounts/financial-forms";
import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { ListPagination } from "@/components/dashboard/list-controls";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FIELD_CLASS, SELECT_EXTRA_CLASS } from "@/components/ui/field-class";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  dateParam,
  enumParam,
  pageMeta,
  param,
  parseListParams,
  type RawSearchParams,
} from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import { EXPENSE_CATEGORIES } from "@/lib/services/financials";
import { dhakaDayEndFromKey, dhakaDayStartFromKey } from "@/lib/utils/dates";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("financials.expensesTitle") };
}

const BASE = "/accounts/expenses";
const SORTABLE = ["expenseDate", "amount"] as const;

const ZERO = new Prisma.Decimal(0);

/**
 * /accounts/expenses — branch-wise expense records (rent/utilities/salary/…).
 *
 * WS-2.10 — the page built `const where = {}` and never populated it: the
 * branch/category/date filters did nothing and there was no grouped view. The
 * filters now narrow every figure on the page (history, total AND breakdown),
 * and the branch × category matrix answers "what did each outlet spend on what"
 * in one look. All sums are database-side exact Decimals.
 */
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

  const branchFilter = param(sp, "branch");
  const categoryFilter = enumParam(sp, "category", EXPENSE_CATEGORIES);
  const fromKey = dateParam(sp, "from");
  const toKey = dateParam(sp, "to");
  // An expense is filed against a DHAKA business day (WS-2.7), so the window
  // is resolved through the same Dhaka-day helpers that stored it.
  const fromAt = fromKey ? dhakaDayStartFromKey(fromKey) : null;
  const toAt = toKey ? dhakaDayEndFromKey(toKey) : null;

  const where: Prisma.BranchExpenseWhereInput = {};
  if (branchFilter && Number.isInteger(Number(branchFilter))) {
    where.branchId = Number(branchFilter);
  }
  if (categoryFilter) where.category = categoryFilter;
  if (fromAt || toAt) {
    where.expenseDate = { ...(fromAt ? { gte: fromAt } : {}), ...(toAt ? { lte: toAt } : {}) };
  }

  const orderBy: Prisma.BranchExpenseOrderByWithRelationInput =
    sort === "amount" ? { amount: direction } : { expenseDate: direction };

  const [count, rows, branches, sumAgg, grouped] = await Promise.all([
    prisma.branchExpense.count({ where }),
    prisma.branchExpense.findMany({
      where,
      include: { branch: true, createdBy: true },
      orderBy,
      skip,
      take,
    }),
    // One list serves the filter select, the record form AND the breakdown's
    // branch names; the form only offers branches still active for entry.
    prisma.branch.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
    prisma.branchExpense.aggregate({ where, _sum: { amount: true } }),
    // WS-2.10 — the branch × category matrix, summed in the database over the
    // SAME filtered window as everything else on the page.
    prisma.branchExpense.groupBy({
      by: ["branchId", "category"],
      where,
      _sum: { amount: true },
    }),
  ]);

  const totalAmount = sumAgg._sum.amount ?? ZERO;
  const meta = pageMeta(count, page, pageSize);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  // Fold the grouped sums into one Decimal cell per branch × category, plus a
  // per-branch row total and a per-category column total — every figure is a
  // Decimal .plus() chain, never a float.
  const matrix = new Map<number, Map<string, Prisma.Decimal>>();
  for (const g of grouped) {
    const row = matrix.get(g.branchId) ?? new Map<string, Prisma.Decimal>();
    row.set(g.category, (row.get(g.category) ?? ZERO).plus(g._sum.amount ?? ZERO));
    matrix.set(g.branchId, row);
  }
  const breakdown = [...matrix.entries()]
    .map(([branchId, cells]) => {
      const perCategory = EXPENSE_CATEGORIES.map((c) => cells.get(c) ?? ZERO);
      return {
        branchId,
        branchName: branchName.get(branchId) ?? "",
        perCategory,
        total: perCategory.reduce((acc, v) => acc.plus(v), ZERO),
      };
    })
    .sort((a, b) => (a.total.greaterThan(b.total) ? -1 : 1));
  const categoryTotals = EXPENSE_CATEGORIES.map((_, i) =>
    breakdown.reduce((acc, row) => acc.plus(row.perCategory[i]), ZERO),
  );

  const field = FIELD_CLASS;
  const selectField = `${FIELD_CLASS} ${SELECT_EXTRA_CLASS}`;

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/accounts/dashboard" },
          { label: t("financials.expensesTitle") },
        ]}
        title={t("financials.expensesTitle")}
        subtitle={t("financials.expensesSub", { amount: fmt.money(totalAmount.toFixed(2)) })}
      />

      {/* WS-2.10 — GET filter bar in the /accounts/commissions idiom. */}
      <form method="GET" noValidate className="my-4 flex flex-wrap items-end gap-3 rounded-xl border border-border-base bg-surface-card p-4 shadow-card">
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("pages.colBranch")}
          <select name="branch" defaultValue={branchFilter} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("financials.category")}
          <select name="category" defaultValue={categoryFilter} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(`financials.cat_${c}`)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterFrom")}
          <input type="date" name="from" defaultValue={fromKey} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterTo")}
          <input type="date" name="to" defaultValue={toKey} className={field} />
        </label>
        <button
          type="submit"
          className="h-9 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
        >
          {t("wallet.applyFilters")}
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title={t("financials.recordExpense")} />
          <CardContent>
            <ExpenseForm
              branches={branches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name }))}
            />
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

      {/* WS-2.10 — branch × category matrix over the filtered window. */}
      <Card className="mt-6">
        <CardHeader
          title={t("financials.expenseBreakdownTitle")}
          subtitle={t("financials.expenseBreakdownSub")}
        />
        {breakdown.length === 0 ? (
          <EmptyState title={t("financials.noExpenses")} />
        ) : (
          <Table
            headers={[
              t("pages.colBranch"),
              ...EXPENSE_CATEGORIES.map((c) => t(`financials.cat_${c}`)),
              t("financials.lineTotal"),
            ]}
          >
            {breakdown.map((row) => (
              <tr key={row.branchId} className="hover:bg-surface-hover/70">
                <Td><span className="font-medium text-fg-base">{row.branchName}</span></Td>
                {row.perCategory.map((v, i) => (
                  <Td key={EXPENSE_CATEGORIES[i]} mono>
                    {v.equals(0) ? <span className="text-fg-subtle">—</span> : fmt.money(v.toFixed(2))}
                  </Td>
                ))}
                <Td mono><span className="font-semibold">{fmt.money(row.total.toFixed(2))}</span></Td>
              </tr>
            ))}
            <tr className="border-t border-border-base bg-surface-muted/50">
              <Td><span className="font-semibold text-fg-base">{t("financials.lineTotal")}</span></Td>
              {categoryTotals.map((v, i) => (
                <Td key={EXPENSE_CATEGORIES[i]} mono>
                  <span className="font-semibold">
                    {v.equals(0) ? "—" : fmt.money(v.toFixed(2))}
                  </span>
                </Td>
              ))}
              <Td mono><span className="font-semibold">{fmt.money(totalAmount.toFixed(2))}</span></Td>
            </tr>
          </Table>
        )}
      </Card>
    </DashboardPage>
  );
}
