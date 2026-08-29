import type { Metadata } from "next";

import { CustomerBlockButton } from "@/components/admin/customer-block-button";
import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { ListPagination, ListSearch } from "@/components/dashboard/list-controls";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
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
  return { title: t("adminExtras.blockedTitle") };
}

const BASE = "/admin/customers/blocked";
const SORTABLE = ["updatedAt", "firstName"] as const;

/** /admin/customers/blocked — blocked (fake-order) customers with reasons. */
export default async function AdminBlockedCustomersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("super_admin");
  const sp = await searchParams;

  const { page, pageSize, skip, take, search, sort, direction } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "updatedAt",
  });

  const where: Prisma.UserWhereInput = { role: "customer", isBlocked: true };
  if (search) {
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { username: { contains: search } },
      { email: { contains: search } },
      { phone: { contains: search } },
      { blockedReason: { contains: search } },
    ];
  }

  const [total, blocked] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { _count: { select: { orders: true } } },
      orderBy: sort === "firstName" ? { firstName: direction } : { updatedAt: direction },
      skip,
      take,
    }),
  ]);
  const meta = pageMeta(total, page, pageSize);
  const filtered = hasActiveFilters(sp, ["search"]);

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/admin/dashboard" },
          { label: t("adminExtras.customersTitle"), href: "/admin/customers" },
          { label: t("adminExtras.blockedTitle") },
        ]}
        title={t("adminExtras.blockedTitle")}
        subtitle={t("adminExtras.blockedSub")}
        actions={
          <ButtonLink href="/admin/customers" variant="outline">
            {t("adminExtras.allCustomers")}
          </ButtonLink>
        }
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
        {blocked.length === 0 ? (
          <EmptyState
            title={filtered ? t("list.noResultsTitle") : t("adminExtras.noBlockedTitle")}
            description={filtered ? t("list.noResultsDesc") : t("adminExtras.noBlockedDesc")}
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
            <Table
              headers={[
                t("adminExtras.colCustomer"),
                t("adminExtras.colContact"),
                t("adminExtras.colOrders"),
                t("adminExtras.colReason"),
                t("pages.colActions"),
              ]}
            >
              {blocked.map((c) => (
                <tr key={c.id} className="hover:bg-surface-hover/70">
                  <Td>
                    <span className="block font-medium text-fg-base">
                      {`${c.firstName} ${c.lastName}`.trim() || c.username}
                    </span>
                    <span className="block text-xs text-fg-subtle">@{c.username}</span>
                  </Td>
                  <Td>
                    <span className="block text-sm">{c.phone || "—"}</span>
                    <span className="block text-xs text-fg-subtle">{c.email}</span>
                  </Td>
                  <Td>{fmt.num(c._count.orders)}</Td>
                  <Td>
                    <span className="text-sm text-red-600">{c.blockedReason || "—"}</span>
                  </Td>
                  <Td className="text-right">
                    <CustomerBlockButton userId={c.id} isBlocked />
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
