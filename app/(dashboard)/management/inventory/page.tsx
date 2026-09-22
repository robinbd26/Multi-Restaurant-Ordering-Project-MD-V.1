import type { Metadata } from "next";

import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { ListFilterSelect, ListPagination, ListSearch } from "@/components/dashboard/list-controls";
import { ResponsiveDataView } from "@/components/dashboard/responsive-data-view";
import { SummaryCard, SummaryCardGrid } from "@/components/dashboard/summary-card";
import { Icon } from "@/components/layout/icons";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import {
  enumParam,
  hasActiveFilters,
  listHref,
  pageMeta,
  param,
  parseListParams,
  type RawSearchParams,
} from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import { INVENTORY_STATES, listInventory, listReportBranches } from "@/lib/services/management";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("mgmtInventory.title") };
}

const BASE = "/management/inventory";
const SORTABLE = ["name"] as const;

/**
 * /management/inventory — WS-8.3.
 *
 * Management is required to "monitor inventory and product availability across
 * all branches" but had no page, route or query for it: the catalog lives
 * behind /admin and /branch-manager, and ROUTE_ROLES closes both to the role.
 *
 * READ-ONLY by design — Management observes, the branch manager (and the super
 * admin's global hold) decides. Filters live in the URL so a "what is off the
 * menu at Dhanmondi right now" view is linkable, and the summary cards count
 * over the branch+search scope rather than the state filter, so a card can
 * never contradict the list beneath it.
 */
export default async function ManagementInventoryPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("management", "super_admin");
  const sp = await searchParams;

  const { page, pageSize, skip, take, search } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "name",
    defaultDirection: "asc",
  });
  const state = enumParam(sp, "state", INVENTORY_STATES);
  const branchRaw = Number.parseInt(param(sp, "branch"), 10);
  const branchId = Number.isFinite(branchRaw) && branchRaw > 0 ? branchRaw : null;

  const [inventory, branchOptions] = await Promise.all([
    listInventory({ branchId, state, search }, skip, take),
    listReportBranches(),
  ]);
  const { counts, branches, products } = inventory;
  const meta = pageMeta(inventory.total, page, pageSize);
  const filtered = hasActiveFilters(sp, ["search", "state", "branch"]);
  const branchName = branchOptions.find((b) => b.id === branchId)?.name ?? "";

  const activeFilters = [
    ...(search
      ? [{ key: "search", label: t("list.searchLabel"), value: search, removeHref: listHref(BASE, sp, { search: undefined }) }]
      : []),
    ...(branchName
      ? [{ key: "branch", label: t("pages.colBranch"), value: branchName, removeHref: listHref(BASE, sp, { branch: undefined }) }]
      : []),
    ...(state
      ? [{ key: "state", label: t("common.status"), value: t(`mgmtInventory.state.${state}`), removeHref: listHref(BASE, sp, { state: undefined }) }]
      : []),
  ];

  /** A super-admin hold outranks the branch's own switch, so it is checked first. */
  const availabilityBadge = (p: (typeof products)[number]) => {
    if (p.heldByAdmin) return <Badge tone="amber">{t("adminExtras.heldBadge")}</Badge>;
    if (!p.isAvailable) return <Badge tone="red">{t("pages.unavailable")}</Badge>;
    // On the menu, not held — but with every size disabled it cannot be ordered.
    // (A product with no variations at all is sold at its own price.)
    if (p.variations.length > 0 && !p.variations.some((v) => v.isEnabled)) return <Badge tone="amber">{t("mgmtInventory.noVariations")}</Badge>;
    return <Badge tone="green">{t("pages.available")}</Badge>;
  };

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/management/dashboard" },
          { label: t("mgmtInventory.title") },
        ]}
        title={t("mgmtInventory.title")}
        subtitle={t("mgmtInventory.subtitle")}
      />

      <SummaryCardGrid>
        <SummaryCard title={t("mgmtInventory.total")} value={fmt.num(counts.total)} icon={<Icon name="grid" />} href={listHref(BASE, sp, { state: undefined })} />
        <SummaryCard title={t("mgmtInventory.state.available")} value={fmt.num(counts.available)} icon={<Icon name="check" />} accent="success" href={listHref(BASE, sp, { state: "available" })} />
        <SummaryCard title={t("mgmtInventory.state.unavailable")} value={fmt.num(counts.unavailable)} icon={<Icon name="x" />} accent="danger" href={listHref(BASE, sp, { state: "unavailable" })} />
        <SummaryCard title={t("mgmtInventory.state.held")} value={fmt.num(counts.held)} icon={<Icon name="lock" />} accent="warning" href={listHref(BASE, sp, { state: "held" })} />
        <SummaryCard
          title={t("mgmtInventory.unsellable")}
          value={fmt.num(counts.unsellable)}
          icon={<Icon name="bolt" />}
          accent="warning"
          description={t("mgmtInventory.unsellableHint")}
        />
      </SummaryCardGrid>

      <FilterBar
        search={
          <ListSearch
            basePath={BASE}
            searchParams={sp}
            value={search}
            placeholder={t("list.searchProducts")}
            label={t("list.searchLabel")}
            clearLabel={t("list.clearSearch")}
            submitLabel={t("list.searchSubmit")}
          />
        }
        filters={
          <>
            <ListFilterSelect
              basePath={BASE}
              searchParams={sp}
              name="branch"
              label={t("pages.colBranch")}
              value={branchId ? String(branchId) : ""}
              applyLabel={t("list.apply")}
              options={[
                { value: "", label: t("mgmtReports.allBranches") },
                ...branchOptions.map((b) => ({ value: String(b.id), label: b.name })),
              ]}
            />
            <ListFilterSelect
              basePath={BASE}
              searchParams={sp}
              name="state"
              label={t("common.status")}
              value={state}
              applyLabel={t("list.apply")}
              options={[
                { value: "", label: t("list.filterAll") },
                ...INVENTORY_STATES.map((s) => ({ value: s, label: t(`mgmtInventory.state.${s}`) })),
              ]}
            />
          </>
        }
        activeFilters={activeFilters}
        clearHref={BASE}
        clearLabel={t("list.clearFilters")}
        resultsLabel={t("list.results", { total: fmt.num(meta.total) })}
      />

      {/* The cross-branch view the requirement actually asks for: every branch,
          including one with an empty menu, which a product list alone hides. */}
      <Card>
        <CardHeader title={t("mgmtInventory.byBranch")} />
        {branches.length === 0 ? (
          <EmptyState title={t("pages.noData")} />
        ) : (
          <Table
            headers={[
              t("pages.colBranch"),
              t("mgmtInventory.total"),
              t("mgmtInventory.state.available"),
              t("mgmtInventory.state.unavailable"),
              t("mgmtInventory.state.held"),
            ]}
          >
            {branches.map((b) => (
              <tr key={b.id} className="hover:bg-surface-hover/70">
                <Td>
                  <span className="font-medium text-fg-base">{b.branch}</span>
                  {b.isArchived ? (
                    <span className="ms-2 align-middle"><Badge tone="amber">{t("branchInfo.archived")}</Badge></span>
                  ) : !b.isActive ? (
                    <span className="ms-2 align-middle"><Badge tone="red">{t("common.inactive")}</Badge></span>
                  ) : null}
                </Td>
                <Td mono>{fmt.num(b.total)}</Td>
                <Td mono>{fmt.num(b.available)}</Td>
                <Td mono>{fmt.num(b.unavailable)}</Td>
                <Td mono>{fmt.num(b.held)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        {products.length === 0 ? (
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
            <ResponsiveDataView
              items={products}
              getKey={(p) => p.id}
              desktop={(rows) => (
                <Table
                  headers={[
                    t("adminExtras.colProduct"),
                    t("pages.colBranch"),
                    t("adminExtras.colCategory"),
                    t("adminExtras.colPrice"),
                    t("common.status"),
                  ]}
                >
                  {rows.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-hover/70">
                      <Td>
                        <span className="block font-medium text-fg-base">{p.name}</span>
                        {p.deactivationReason ? (
                          <span className="block max-w-64 truncate text-xs text-fg-subtle">{p.deactivationReason}</span>
                        ) : null}
                      </Td>
                      <Td>{p.branch.name}</Td>
                      <Td>{p.category?.name ?? "—"}</Td>
                      <Td mono>{fmt.money(p.price.toString())}</Td>
                      <Td>
                        {availabilityBadge(p)}
                        <span className="mt-1 block text-xs text-fg-subtle">{fmt.date(p.updatedAt.toISOString())}</span>
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
              mobile={(p) => (
                <div className="rounded-xl border border-border-base bg-surface-card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate font-semibold text-fg-base">{p.name}</p>
                    {availabilityBadge(p)}
                  </div>
                  <dl className="mt-2.5 grid gap-1.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-xs text-fg-muted">{t("pages.colBranch")}</dt>
                      <dd className="min-w-0 truncate text-right text-fg-base">{p.branch.name}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-xs text-fg-muted">{t("adminExtras.colCategory")}</dt>
                      <dd className="min-w-0 truncate text-right text-fg-base">{p.category?.name ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-xs text-fg-muted">{t("adminExtras.colPrice")}</dt>
                      <dd className="text-fg-base">{fmt.money(p.price.toString())}</dd>
                    </div>
                  </dl>
                </div>
              )}
            />
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

      <p className="text-xs text-fg-subtle">{t("mgmtInventory.readOnlyNote")}</p>
    </DashboardPage>
  );
}
