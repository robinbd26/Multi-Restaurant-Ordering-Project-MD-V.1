import type { Metadata } from "next";

import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { ListPagination, ListSearch } from "@/components/dashboard/list-controls";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  hasActiveFilters,
  pageMeta,
  parseListParams,
  type RawSearchParams,
} from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import type { Prisma } from "@prisma/client";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("financials.auditTitle") };
}

const BASE = "/accounts/audit-log";
const SORTABLE = ["createdAt"] as const;

/** /accounts/audit-log — append-only trail of every financial action. */
export default async function AccountsAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("accounts", "super_admin");
  const sp = await searchParams;

  const { page, pageSize, skip, take, search, direction } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "createdAt",
  });

  const where: Prisma.FinancialAuditLogWhereInput = {};
  if (search) {
    where.OR = [
      { action: { contains: search } },
      { entity: { contains: search } },
      { detail: { contains: search } },
      { actor: { firstName: { contains: search } } },
      { actor: { lastName: { contains: search } } },
      { actor: { username: { contains: search } } },
    ];
  }

  const [count, rows] = await Promise.all([
    prisma.financialAuditLog.count({ where }),
    prisma.financialAuditLog.findMany({
      where,
      include: { actor: true },
      orderBy: { createdAt: direction },
      skip,
      take,
    }),
  ]);
  const meta = pageMeta(count, page, pageSize);
  const filtered = hasActiveFilters(sp, ["search"]);

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/accounts/dashboard" },
          { label: t("financials.auditTitle") },
        ]}
        title={t("financials.auditTitle")}
        subtitle={t("financials.auditSub")}
      />

      <FilterBar
        search={
          <ListSearch
            basePath={BASE}
            searchParams={sp}
            value={search}
            placeholder={t("list.searchLabel")}
            label={t("list.searchLabel")}
            clearLabel={t("list.clearSearch")}
            submitLabel={t("list.searchSubmit")}
          />
        }
        clearHref={BASE}
        clearLabel={t("list.clearFilters")}
        resultsLabel={t("list.results", { total: fmt.num(meta.total) })}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={filtered ? t("list.noResultsTitle") : t("pages.noData")} />
        ) : (
          <>
            <Table headers={[t("pages.colDate"), t("financials.actor"), t("financials.actionLabel"), t("financials.detailLabel")]}>
              {rows.map((l) => (
                <tr key={l.id} className="hover:bg-surface-hover/70">
                  <Td><span className="text-xs text-fg-muted">{fmt.dateTime(l.createdAt.toISOString())}</span></Td>
                  <Td>
                    {l.actor
                      ? `${l.actor.firstName} ${l.actor.lastName}`.trim() || l.actor.username
                      : "—"}
                  </Td>
                  <Td>
                    <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-fg-muted">
                      {l.action}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-sm text-fg-muted">
                      {l.entity} #{l.entityId} — {l.detail}
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
    </DashboardPage>
  );
}
