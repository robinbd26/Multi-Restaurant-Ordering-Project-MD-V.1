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

export const metadata: Metadata = { title: "Products" };

const BASE = "/marketing/products";
const SORTABLE = ["name", "price", "updatedAt"] as const;
const AVAILABILITY = ["available", "unavailable"] as const;

/** /marketing/products — read-only catalog across active branches, server-paginated. */
export default async function MarketingProductsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireRole("marketing");
  const { t, fmt } = await getT();
  const sp = await searchParams;

  const { page, pageSize, skip, take, search, sort, direction } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "name",
    defaultDirection: "asc",
  });
  const availability = enumParam(sp, "availability", AVAILABILITY);

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    branch: { isActive: true, isArchived: false },
  };
  if (availability === "available") where.isAvailable = true;
  if (availability === "unavailable") where.isAvailable = false;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { branch: { name: { contains: search } } },
      { category: { name: { contains: search } } },
    ];
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput =
    sort === "price"
      ? { price: direction }
      : sort === "updatedAt"
        ? { updatedAt: direction }
        : { name: direction };

  const [total, rows, availableCount, unavailableCount] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { branch: true, category: true },
      orderBy,
      skip,
      take,
    }),
    prisma.product.count({
      where: { deletedAt: null, isAvailable: true, branch: { isActive: true, isArchived: false } },
    }),
    prisma.product.count({
      where: { deletedAt: null, isAvailable: false, branch: { isActive: true, isArchived: false } },
    }),
  ]);

  const meta = pageMeta(total, page, pageSize);
  const filtered = hasActiveFilters(sp, ["search", "availability"]);

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/marketing/dashboard" },
          { label: t("pages.productsTitle") },
        ]}
        title={t("pages.productsTitle")}
        subtitle={t("pages.productsSub")}
      />

      <SummaryCardGrid>
        <SummaryCard title={t("common.total")} value={fmt.num(availableCount + unavailableCount)} icon={<Icon name="bag" />} />
        <SummaryCard title={t("pages.available")} value={fmt.num(availableCount)} icon={<Icon name="check" />} accent="success" href={listHref(BASE, sp, { availability: "available" })} />
        <SummaryCard title={t("pages.unavailable")} value={fmt.num(unavailableCount)} icon={<Icon name="x" />} accent="danger" href={listHref(BASE, sp, { availability: "unavailable" })} />
      </SummaryCardGrid>

      <FilterBar
        search={
          <ListSearch
            basePath={BASE}
            searchParams={sp}
            value={search}
            placeholder={t("catalog.searchProduct")}
            label={t("list.searchLabel")}
            clearLabel={t("list.clearSearch")}
            submitLabel={t("list.searchSubmit")}
          />
        }
        filters={
          <ListFilterSelect
            basePath={BASE}
            searchParams={sp}
            name="availability"
            label={t("list.filterStatus")}
            value={availability}
            applyLabel={t("list.apply")}
            options={[
              { value: "", label: t("list.filterAll") },
              { value: "available", label: t("pages.available") },
              { value: "unavailable", label: t("pages.unavailable") },
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
            <Table headers={[t("pages.colProduct"), t("pages.colBranch"), t("pages.colCategory"), t("pages.price"), t("common.status")]}>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-surface-hover/70">
                  <Td><span className="font-medium text-fg-base">{p.name}</span></Td>
                  <Td>{p.branch.name}</Td>
                  <Td>{p.category?.name ?? "—"}</Td>
                  <Td><span className="font-semibold">{fmt.money(Number(p.price))}</span></Td>
                  <Td>
                    {p.isAvailable ? (
                      <Badge tone="green">{t("pages.available")}</Badge>
                    ) : (
                      <Badge tone="red">{t("pages.unavailable")}</Badge>
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
