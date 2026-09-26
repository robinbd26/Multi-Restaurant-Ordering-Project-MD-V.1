import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Image from "next/image";
import Link from "next/link";

import { ProductRowActions } from "@/components/catalog/product-row-actions";
import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { ListPagination, ListSearch } from "@/components/dashboard/list-controls";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { requireApiUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  hasActiveFilters,
  listHref,
  pageMeta,
  param,
  parseListParams,
  type RawSearchParams,
} from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";
import { serializeProduct } from "@/lib/serializers";
import { categoriesForBranchManager } from "@/lib/services/catalog";
import { cn, mediaUrl } from "@/lib/utils";
import type { Product } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("catalog.title") };
}

const BASE = "/branch-manager/catalog";
const SORTABLE = ["name", "updatedAt"] as const;

/**
 * Branch Manager catalogue — own-branch products only, server-paginated.
 * Replaces the previous self-fetch of page_size=100.
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireRole("branch_manager");
  const me = await requireApiUser();
  const { t, fmt } = await getT();
  const sp = await searchParams;

  const { page, pageSize, skip, take, search, sort, direction } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "name",
    defaultDirection: "asc",
  });
  // Archived (soft-deleted) products are out of the catalogue by default;
  // ?archived=1 lists only them, each with Restore.
  const archivedView = param(sp, "archived") === "1";
  const catRaw = Number.parseInt(param(sp, "cat"), 10);
  const categoryId = Number.isSafeInteger(catRaw) && catRaw > 0 ? catRaw : 0;

  const branch = await branchForManager(me.id);
  const branchId = branch?.id ?? -1;

  const where: Prisma.ProductWhereInput = {
    branchId,
    deletedAt: archivedView ? { not: null } : null,
    ...(categoryId ? { categoryId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } },
          ],
        }
      : {}),
  };

  const [total, rows, categories] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { branch: true, category: true, variations: { orderBy: { sortOrder: "asc" } } },
      orderBy:
        sort === "updatedAt"
          ? { updatedAt: direction }
          : [{ isPopular: "desc" }, { name: direction }],
      skip,
      take,
    }),
    // Own-branch categories only — see categoriesForBranchManager. Global-scope
    // rows are no longer offered as filter chips here.
    categoriesForBranchManager(branchId),
  ]);

  const products = rows.map(serializeProduct) as unknown as Product[];
  const meta = pageMeta(total, page, pageSize);
  const filtered = hasActiveFilters(sp, ["search", "cat", "archived"]);
  const archivedCount = archivedView
    ? total
    : await prisma.product.count({ where: { branchId, deletedAt: { not: null } } });

  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
      active ? "bg-brand-500 text-white" : "bg-surface-card text-fg-muted ring-1 ring-slate-200 hover:bg-surface-hover",
    );

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/branch-manager/dashboard" },
          { label: t("catalog.title") },
        ]}
        title={t("catalog.title")}
        subtitle={t("catalog.subtitle")}
        actions={
          <ButtonLink href="/branch-manager/catalog/products/create">
            + {t("catalog.product")}
          </ButtonLink>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={BASE} className={chip(!categoryId && !archivedView)}>
          {t("common.all")} ({fmt.num(archivedView ? 0 : total)})
        </Link>
        {categories.map((cat) => (
          <Link
            key={cat.id}
            href={listHref(BASE, sp, { cat: String(cat.id), page: undefined })}
            className={chip(categoryId === cat.id)}
          >
            {cat.name} ({fmt.num(cat._count.products)})
          </Link>
        ))}
        <Link
          href={listHref(BASE, sp, { archived: archivedView ? undefined : "1", cat: undefined, page: undefined })}
          className={chip(archivedView)}
          data-testid="catalog-archived-filter"
        >
          {t("productRemoval.filterArchived")} ({fmt.num(archivedCount)})
        </Link>
      </div>

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
        activeFilters={
          search
            ? [{
                key: "search",
                label: t("list.searchLabel"),
                value: search,
                removeHref: listHref(BASE, sp, { search: undefined }),
              }]
            : []
        }
        clearHref={BASE}
        clearLabel={t("list.clearFilters")}
        resultsLabel={t("list.results", { total: fmt.num(meta.total) })}
      />

      <Card>
        <CardHeader title={`${t("catalog.product")} (${fmt.num(meta.total)})`} />
        {products.length === 0 ? (
          <EmptyState
            title={filtered ? t("list.noResultsTitle") : t("catalog.noProducts")}
            description={filtered ? t("list.noResultsDesc") : t("catalog.noProductsDesc")}
            action={
              filtered ? (
                <ButtonLink href={BASE} size="sm" variant="outline">
                  {t("list.clearFilters")}
                </ButtonLink>
              ) : (
                <ButtonLink href="/branch-manager/catalog/products/create">
                  {t("catalog.addProduct")}
                </ButtonLink>
              )
            }
          />
        ) : (
          <>
            <Table headers={[t("catalog.product"), t("catalog.category"), t("common.price"), t("common.status"), ""]}>
              {products.map((product) => {
                const image = mediaUrl(product.image);
                const hasDiscount = Number(product.discount) > 0;
                return (
                  <tr key={product.id} className="hover:bg-surface-hover/70">
                    <Td>
                      <span className="flex items-center gap-3">
                        {image ? (
                          <Image src={image} alt="" width={44} height={44} className="size-11 rounded-xl object-cover" />
                        ) : (
                          <span className="flex size-11 items-center justify-center rounded-xl bg-surface-muted text-lg">🍛</span>
                        )}
                        <span>
                          <span className="flex items-center gap-2 font-medium text-fg-base">
                            {/* The name itself opens the product, so the inline
                                action bar can keep View down to one icon. */}
                            <Link
                              href={`/branch-manager/catalog/products/${product.id}`}
                              className="rounded hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                            >
                              {product.name}
                            </Link>
                            {product.is_popular ? <Badge tone="brand">{t("catalog.popular")}</Badge> : null}
                            {product.is_recommended ? <Badge tone="violet">{t("catalog.recommended")}</Badge> : null}
                          </span>
                          <span className="block text-xs text-fg-subtle">⏱ {fmt.num(product.preparation_time)} {t("catalog.minutes")}</span>
                        </span>
                      </span>
                    </Td>
                    <Td>{product.category_name ?? "—"}</Td>
                    <Td>
                      <span className="font-semibold">{fmt.money(product.discounted_price)}</span>
                      {hasDiscount ? (
                        <span className="block text-xs text-fg-subtle line-through">{fmt.money(product.price)}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        {/* A super-admin hold is called out here because it is
                            what withholds Delete from the manager below. */}
                        {product.held_by_admin ? <Badge tone="red">{t("adminExtras.heldBadge")}</Badge> : null}
                        {archivedView ? (
                          <Badge tone="slate">{t("productRemoval.archivedBadge")}</Badge>
                        ) : product.is_available ? (
                          <Badge tone="green">{t("catalog.available")}</Badge>
                        ) : (
                          <Badge tone="red">{t("catalog.unavailable")}</Badge>
                        )}
                      </span>
                    </Td>
                    <Td>
                      {/* Laid out INLINE (not behind a menu): the manager asked
                          to reach Edit/Delete without hunting for a trigger or
                          scrolling the table. `canDelete` is a soft delete —
                          the API re-checks the branch and the admin hold. */}
                      <ProductRowActions
                        productId={product.id}
                        productName={product.name}
                        branchName={product.branch_name}
                        isAvailable={product.is_available}
                        heldByAdmin={product.held_by_admin}
                        basePath="/branch-manager/catalog/products"
                        layout="inline"
                        canDelete={!product.held_by_admin}
                        isArchived={archivedView}
                        canRestore={!product.held_by_admin}
                      />
                    </Td>
                  </tr>
                );
              })}
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
