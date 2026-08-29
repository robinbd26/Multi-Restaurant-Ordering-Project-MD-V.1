import type { Metadata } from "next";

import { UserAvatar } from "@/components/common/user-avatar";
import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { ListFilterSelect, ListPagination, ListSearch } from "@/components/dashboard/list-controls";
import { ResponsiveDataView } from "@/components/dashboard/responsive-data-view";
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
  param,
  parseListParams,
  type RawSearchParams,
} from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import {
  EMPLOYEE_ROLES,
  EMPLOYMENT_STATUSES,
  STAFF_DIRECTORY_SORTS,
  listStaffDirectory,
  staffDirectorySummary,
  staffDirectoryWhere,
} from "@/lib/services/employees";
import { listReportBranches } from "@/lib/services/management";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("adminExtras.staffTitle") };
}

const BASE = "/admin/staff";

/**
 * /admin/staff — WS-8.9: the real staff directory.
 *
 * This page used to list platform `User` rows, which made "joining date" the
 * ACCOUNT-CREATION date and "company post" the login-role badge — neither is HR
 * data, and every kitchen/floor employee without a dashboard login was missing
 * entirely. It is now backed by BranchEmployee: real name, contact, photo,
 * joining date, employee code, department, branch and company post, with the
 * linked login shown as an extra when the person happens to have one.
 *
 * Paged, searched, filtered and sorted server-side. The summary cards count
 * over the branch+search SCOPE (not the role/employment filter), so a card can
 * never report a number the directory below it would contradict.
 */
export default async function AdminStaffPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("super_admin");
  const sp = await searchParams;

  const { page, pageSize, skip, take, search, sort, direction } = parseListParams(sp, {
    sortable: STAFF_DIRECTORY_SORTS,
    defaultSort: "joiningDate",
  });
  const role = enumParam(sp, "role", EMPLOYEE_ROLES);
  const employment = enumParam(sp, "employment", EMPLOYMENT_STATUSES);
  const branchRaw = Number.parseInt(param(sp, "branch"), 10);
  const branchId = Number.isFinite(branchRaw) && branchRaw > 0 ? branchRaw : null;

  const scope = staffDirectoryWhere({ branchId, search });
  const where = staffDirectoryWhere({ branchId, search, role, employmentStatus: employment });

  const [total, staff, summary, branches] = await Promise.all([
    prisma.branchEmployee.count({ where }),
    listStaffDirectory(where, sort, direction, skip, take),
    staffDirectorySummary(scope),
    listReportBranches(),
  ]);
  const meta = pageMeta(total, page, pageSize);
  const filtered = hasActiveFilters(sp, ["search", "role", "employment", "branch"]);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";

  /** "others" carries a free-text job term; every other role is a stored key. */
  const postLabel = (s: (typeof staff)[number]) =>
    s.role === "others" && s.customRole ? s.customRole : t(`b5.roles.${s.role}`);

  const name = (s: (typeof staff)[number]) =>
    `${s.firstName} ${s.lastName}`.trim() || s.employeeCode;

  /** Only two employment states exist; "quit_job" is the sole non-active one. */
  const employmentLabel = (status: string) =>
    t(status === "quit_job" ? "employees.statusQuit" : "employees.statusActive");

  const activeFilters = [
    ...(search
      ? [{ key: "search", label: t("list.searchLabel"), value: search, removeHref: listHref(BASE, sp, { search: undefined }) }]
      : []),
    ...(branchName
      ? [{ key: "branch", label: t("pages.colBranch"), value: branchName, removeHref: listHref(BASE, sp, { branch: undefined }) }]
      : []),
    ...(role
      ? [{ key: "role", label: t("adminExtras.colPost"), value: t(`b5.roles.${role}`), removeHref: listHref(BASE, sp, { role: undefined }) }]
      : []),
    ...(employment
      ? [{ key: "employment", label: t("list.filterStatus"), value: employmentLabel(employment), removeHref: listHref(BASE, sp, { employment: undefined }) }]
      : []),
  ];

  const employmentBadge = (status: string) =>
    status === "quit_job" ? (
      <Badge dot tone="red">{employmentLabel("quit_job")}</Badge>
    ) : (
      <Badge dot tone="green">{employmentLabel("active")}</Badge>
    );

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/admin/dashboard" },
          { label: t("adminExtras.staffTitle") },
        ]}
        title={t("adminExtras.staffTitle")}
        subtitle={t("adminExtras.staffSub")}
      />

      <SummaryCardGrid>
        <SummaryCard title={t("adminExtras.staffTotal")} value={fmt.num(summary.total)} icon={<Icon name="users" />} href={BASE} />
        <SummaryCard
          title={employmentLabel("active")}
          value={fmt.num(summary.active)}
          icon={<Icon name="check" />}
          accent="success"
          href={listHref(BASE, sp, { employment: "active" })}
        />
        <SummaryCard
          title={employmentLabel("quit_job")}
          value={fmt.num(summary.quit)}
          icon={<Icon name="logout" />}
          accent="warning"
          href={listHref(BASE, sp, { employment: "quit_job" })}
        />
        <SummaryCard title={t("adminExtras.staffBranches")} value={fmt.num(summary.branches)} icon={<Icon name="store" />} accent="info" />
        <SummaryCard title={t("adminExtras.staffWithLogin")} value={fmt.num(summary.withLogin)} icon={<Icon name="lock" />} accent="violet" />
      </SummaryCardGrid>

      <FilterBar
        search={
          <ListSearch
            basePath={BASE}
            searchParams={sp}
            value={search}
            placeholder={t("b5.searchPlaceholder")}
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
                { value: "", label: t("list.filterAll") },
                ...branches.map((b) => ({ value: String(b.id), label: b.name })),
              ]}
            />
            <ListFilterSelect
              basePath={BASE}
              searchParams={sp}
              name="role"
              label={t("adminExtras.colPost")}
              value={role}
              applyLabel={t("list.apply")}
              options={[
                { value: "", label: t("list.filterAll") },
                ...EMPLOYEE_ROLES.map((r) => ({ value: r, label: t(`b5.roles.${r}`) })),
              ]}
            />
            <ListFilterSelect
              basePath={BASE}
              searchParams={sp}
              name="employment"
              label={t("list.filterStatus")}
              value={employment}
              applyLabel={t("list.apply")}
              options={[
                { value: "", label: t("list.filterAll") },
                ...EMPLOYMENT_STATUSES.map((s) => ({ value: s, label: employmentLabel(s) })),
              ]}
            />
          </>
        }
        activeFilters={activeFilters}
        clearHref={BASE}
        clearLabel={t("list.clearFilters")}
        resultsLabel={t("list.results", { total: fmt.num(meta.total) })}
      />

      <Card>
        {staff.length === 0 ? (
          filtered ? (
            <EmptyState
              title={t("list.noResultsTitle")}
              description={t("list.noResultsDesc")}
              action={
                <ButtonLink href={BASE} size="sm" variant="outline">
                  {t("list.clearFilters")}
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState title={t("adminExtras.staffEmpty")} description={t("adminExtras.staffEmptyDesc")} />
          )
        ) : (
          <>
            <ResponsiveDataView
              items={staff}
              getKey={(s) => s.id}
              desktop={(rows) => (
                <Table
                  headers={[
                    t("adminExtras.colStaff"),
                    t("adminExtras.colContact"),
                    t("adminExtras.colPost"),
                    t("pages.colBranch"),
                    t("adminExtras.colJoined"),
                    t("pages.colStatus"),
                  ]}
                >
                  {rows.map((s) => (
                    <tr key={s.id} className="hover:bg-surface-hover/70">
                      <Td>
                        <span className="flex items-center gap-2.5">
                          {/* The HR photo is the staff record's own; the login's
                              profile photo is only a fallback for someone whose
                              HR record has no upload yet. */}
                          <UserAvatar
                            name={name(s)}
                            photo={s.photo ?? s.user?.profilePhoto}
                            version={s.updatedAt.toISOString()}
                            className="size-9 text-xs"
                          />
                          <span>
                            <span className="block font-medium text-fg-base">{name(s)}</span>
                            <span className="block text-xs text-fg-subtle">
                              {s.employeeCode}
                              {s.user ? ` · @${s.user.username}` : ""}
                            </span>
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <span className="block text-sm">{s.phone || "—"}</span>
                        <span className="block text-xs text-fg-subtle">{s.email || "—"}</span>
                      </Td>
                      <Td>
                        <span className="block text-sm text-fg-base">{postLabel(s)}</span>
                        {s.department ? (
                          <span className="block text-xs text-fg-subtle">{s.department}</span>
                        ) : null}
                      </Td>
                      <Td>
                        <span className="block text-sm">{s.branch.name}</span>
                        {s.team ? <span className="block text-xs text-fg-subtle">{s.team.name}</span> : null}
                      </Td>
                      <Td>
                        <span className="text-xs text-fg-muted">
                          {s.joiningDate ? fmt.date(s.joiningDate.toISOString()) : "—"}
                        </span>
                      </Td>
                      <Td>{employmentBadge(s.employmentStatus)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
              mobile={(s) => (
                <div className="rounded-xl border border-border-base bg-surface-card p-3.5">
                  <div className="flex items-start gap-2.5">
                    <UserAvatar
                      name={name(s)}
                      photo={s.photo ?? s.user?.profilePhoto}
                      version={s.updatedAt.toISOString()}
                      className="size-9 text-xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-fg-base">{name(s)}</p>
                      <p className="truncate text-xs text-fg-subtle">{s.employeeCode}</p>
                    </div>
                    {employmentBadge(s.employmentStatus)}
                  </div>
                  <dl className="mt-2.5 grid gap-1.5 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-xs text-fg-muted">{t("adminExtras.colPost")}</dt>
                      <dd className="min-w-0 truncate text-right text-fg-base">{postLabel(s)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-xs text-fg-muted">{t("pages.colBranch")}</dt>
                      <dd className="min-w-0 truncate text-right text-fg-base">{s.branch.name}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-xs text-fg-muted">{t("adminExtras.colContact")}</dt>
                      <dd className="min-w-0 truncate text-right text-fg-base">{s.phone || s.email || "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-xs text-fg-muted">{t("adminExtras.colJoined")}</dt>
                      <dd className="text-fg-base">
                        {s.joiningDate ? fmt.date(s.joiningDate.toISOString()) : "—"}
                      </dd>
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
    </DashboardPage>
  );
}
