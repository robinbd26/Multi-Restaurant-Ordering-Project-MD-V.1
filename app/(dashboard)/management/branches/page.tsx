import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";

import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { ListFilterSelect, ListPagination, ListSearch } from "@/components/dashboard/list-controls";
import { SummaryCard, SummaryCardGrid } from "@/components/dashboard/summary-card";
import { Icon } from "@/components/layout/icons";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  enumParam,
  hasActiveFilters,
  listHref,
  pageMeta,
  parseListParams,
  type RawSearchParams,
} from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Branches" };

const BASE = "/management/branches";
const SORTABLE = ["name", "createdAt"] as const;
const STATES = ["active", "inactive", "archived"] as const;

/** /management/branches — read-only branch directory, server-paginated. */
export default async function ManagementBranchesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireRole("management");
  const { t, fmt } = await getT();
  const sp = await searchParams;

  const { page, pageSize, skip, take, search, sort, direction } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "name",
    defaultDirection: "asc",
  });
  const state = enumParam(sp, "state", STATES);

  const where: Prisma.BranchWhereInput = {};
  if (state === "active") {
    where.isActive = true;
    where.isArchived = false;
  }
  if (state === "inactive") {
    where.isActive = false;
    where.isArchived = false;
  }
  if (state === "archived") where.isArchived = true;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { address: { contains: search } },
      { phone: { contains: search } },
      { manager: { firstName: { contains: search } } },
      { manager: { lastName: { contains: search } } },
    ];
  }

  const [total, rows, summary] = await Promise.all([
    prisma.branch.count({ where }),
    prisma.branch.findMany({
      where,
      include: { manager: true },
      orderBy: sort === "createdAt" ? { createdAt: direction } : { name: direction },
      skip,
      take,
    }),
    Promise.all([
      prisma.branch.count({ where: { isArchived: false } }),
      prisma.branch.count({ where: { isActive: true, isArchived: false } }),
      prisma.branch.count({ where: { isActive: false, isArchived: false } }),
      prisma.branch.count({ where: { isArchived: true } }),
    ]),
  ]);

  const [allCount, activeCount, inactiveCount, archivedCount] = summary;
  const meta = pageMeta(total, page, pageSize);
  const filtered = hasActiveFilters(sp, ["search", "state"]);

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/management/dashboard" },
          { label: t("pages.branchesTitle") },
        ]}
        title={t("pages.branchesTitle")}
        subtitle={t("pages.branchesSub")}
      />

      <SummaryCardGrid>
        <SummaryCard title={t("common.total")} value={fmt.num(allCount)} icon={<Icon name="building" />} href={BASE} />
        <SummaryCard title={t("common.active")} value={fmt.num(activeCount)} icon={<Icon name="check" />} accent="success" href={listHref(BASE, sp, { state: "active" })} />
        <SummaryCard title={t("common.inactive")} value={fmt.num(inactiveCount)} icon={<Icon name="x" />} accent="danger" href={listHref(BASE, sp, { state: "inactive" })} />
        <SummaryCard title={t("branchInfo.archived")} value={fmt.num(archivedCount)} icon={<Icon name="inbox" />} accent="warning" href={listHref(BASE, sp, { state: "archived" })} />
      </SummaryCardGrid>

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
        filters={
          <ListFilterSelect
            basePath={BASE}
            searchParams={sp}
            name="state"
            label={t("list.filterStatus")}
            value={state}
            applyLabel={t("list.apply")}
            options={[
              { value: "", label: t("list.filterAll") },
              { value: "active", label: t("common.active") },
              { value: "inactive", label: t("common.inactive") },
              { value: "archived", label: t("branchInfo.archived") },
            ]}
          />
        }
        clearHref={BASE}
        clearLabel={t("list.clearFilters")}
        resultsLabel={t("list.results", { total: fmt.num(meta.total) })}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? t("list.noResultsTitle") : t("pages.noData")}
            description={filtered ? t("list.noResultsDesc") : undefined}
            action={
              filtered ? (
                <ButtonLink href={BASE} size="sm" variant="outline">
                  {t("list.clearFilters")}
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table headers={[t("branches.branch"), t("common.phone"), t("branches.manager"), t("common.status")]}>
              {rows.map((branch) => (
                <tr key={branch.id} className="hover:bg-surface-hover/70">
                  <Td>
                    <span className="font-semibold text-fg-base">{branch.name}</span>
                    <span className="block max-w-56 truncate text-xs text-fg-subtle">{branch.address}</span>
                  </Td>
                  <Td>{branch.phone}</Td>
                  <Td>
                    {branch.manager ? (
                      `${branch.manager.firstName} ${branch.manager.lastName}`.trim()
                    ) : (
                      <span className="text-fg-subtle">{t("common.notAssigned")}</span>
                    )}
                  </Td>
                  <Td>
                    {branch.isArchived ? (
                      <Badge tone="amber">{t("branchInfo.archived")}</Badge>
                    ) : branch.isActive ? (
                      <Badge tone="green">{t("common.active")}</Badge>
                    ) : (
                      <Badge tone="red">{t("common.inactive")}</Badge>
                    )}
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
