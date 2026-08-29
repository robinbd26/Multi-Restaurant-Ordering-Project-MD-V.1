import type { Metadata } from "next";

import {
  CommissionRulesPanel,
  type CommissionRuleRow,
} from "@/components/accounts/commission-rules-panel";
import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { ListPagination } from "@/components/dashboard/list-controls";
import { SummaryCard, SummaryCardGrid } from "@/components/dashboard/summary-card";
import { Icon } from "@/components/layout/icons";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FIELD_CLASS, SELECT_EXTRA_CLASS } from "@/components/ui/field-class";
import { Table, Td } from "@/components/ui/table";
import { getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { pageMeta, param, parseListParams, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("wallet.commissionLedger") };
}

const BASE = "/accounts/commissions";

interface CommissionRow {
  id: number;
  order: number;
  order_number: string | null;
  rider: number;
  rider_name: string;
  rider_username: string;
  branch: number | null;
  branch_name: string | null;
  amount: string;
  order_total: string;
  created_at: string;
}

interface CommissionPayload {
  count: number;
  totals: { commission: string; records: number; riders: number };
  results: CommissionRow[];
}

interface RulesPayload {
  default_rate: string;
  fallback_rate: string;
  branches: CommissionRuleRow[];
}

/**
 * /accounts/commissions — WS-2.8.
 *
 * Accounts could not manage commissions at all: no route or page listed
 * individual RiderCommission rows, so a disputed payout could not be traced to
 * the deliveries behind it, and the commission RULE lived behind a
 * super-admin-only settings route that Accounts could not even read.
 *
 * This page is both halves — the row-level ledger with rider/branch/period
 * filters, and the rule book Accounts is permitted to maintain (per-branch
 * overrides over the super admin's global rate).
 */
export default async function AccountsCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("accounts", "super_admin");
  const sp = await searchParams;

  // Sorting is fixed (newest first) on this list, so only the paging half of
  // parseListParams is used; `sortable` still has to be given a whitelist.
  const { page, pageSize } = parseListParams(sp, {
    sortable: ["createdAt"] as const,
    defaultSort: "createdAt",
  });

  const rider = param(sp, "rider");
  const branch = param(sp, "branch");
  const order = param(sp, "order");
  const from = param(sp, "from");
  const to = param(sp, "to");

  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  for (const [key, value] of Object.entries({ rider, branch, order, from, to })) {
    if (value) query.set(key, value);
  }

  const [ledger, rules, branches, riders] = await Promise.all([
    getJSON<CommissionPayload>(`/accounts/commissions/?${query}`),
    getJSON<RulesPayload>("/accounts/commissions/rules/"),
    prisma.branch.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { role: "rider", status: "approved" },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true, username: true },
    }),
  ]);

  const meta = pageMeta(ledger.count, page, pageSize);
  const field = FIELD_CLASS;
  const selectField = `${FIELD_CLASS} ${SELECT_EXTRA_CLASS}`;

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/accounts/dashboard" },
          { label: t("wallet.commissionLedger") },
        ]}
        title={t("wallet.commissionLedger")}
        subtitle={t("wallet.commissionLedgerSub")}
      />

      {/* Totals cover the WHOLE filtered set, not the page on screen — a page
          total tells an accountant nothing about what is owed. */}
      <SummaryCardGrid className="xl:grid-cols-3">
        <SummaryCard
          title={t("wallet.totalCommission")}
          value={fmt.money(ledger.totals.commission)}
          description={t("accounts.recordsCount", { count: fmt.num(ledger.totals.records) })}
          icon={<Icon name="money" />}
          accent="brand"
        />
        <SummaryCard
          title={t("wallet.colRider")}
          value={fmt.num(ledger.totals.riders)}
          description={t("financials.ridersInSelection")}
          icon={<Icon name="bike" />}
          accent="info"
        />
        <SummaryCard
          title={t("wallet.ratePerDelivery")}
          value={fmt.money(rules.default_rate)}
          description={t("financials.defaultRateHint")}
          icon={<Icon name="chart" />}
          accent="neutral"
        />
      </SummaryCardGrid>

      <form method="GET" noValidate className="my-4 flex flex-wrap items-end gap-3 rounded-xl border border-border-base bg-surface-card p-4 shadow-card">
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.colRider")}
          <select name="rider" defaultValue={rider} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>
                {`${r.firstName} ${r.lastName}`.trim() || r.username}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("pages.colBranch")}
          <select name="branch" defaultValue={branch} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterOrderId")}
          <input name="order" defaultValue={order} className={field} placeholder="#" inputMode="numeric" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterFrom")}
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterTo")}
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        <button
          type="submit"
          className="h-9 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
        >
          {t("wallet.applyFilters")}
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("wallet.commissionLedger")} subtitle={t("financials.commissionSnapshotNote")} />
          {ledger.results.length === 0 ? (
            <EmptyState title={t("wallet.noCommissionsTitle")} description={t("wallet.noCommissionsDesc")} />
          ) : (
            <>
              <Table
                headers={[
                  t("pages.colDate"),
                  t("wallet.colRider"),
                  t("pages.colBranch"),
                  t("wallet.colOrder"),
                  t("accounts.colSales"),
                  t("pages.colAmount"),
                ]}
              >
                {ledger.results.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover/70">
                    <Td><span className="text-xs text-fg-muted">{fmt.dateTime(row.created_at)}</span></Td>
                    <Td>
                      <span className="font-medium text-fg-base">{row.rider_name}</span>
                      <span className="block text-xs text-fg-subtle">@{row.rider_username}</span>
                    </Td>
                    <Td>{row.branch_name ?? "—"}</Td>
                    <Td>
                      <span className="font-semibold text-fg-base">
                        {row.order_number || `#${fmt.num(row.order)}`}
                      </span>
                    </Td>
                    <Td mono>{fmt.money(row.order_total)}</Td>
                    <Td mono><span className="font-semibold text-emerald-600">{fmt.money(row.amount)}</span></Td>
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

        <Card className="h-fit">
          <CardHeader title={t("financials.commissionRulesTitle")} subtitle={t("financials.commissionRulesSub")} />
          <CardContent>
            <CommissionRulesPanel defaultRate={rules.default_rate} rows={rules.branches} />
          </CardContent>
        </Card>
      </div>
    </DashboardPage>
  );
}
