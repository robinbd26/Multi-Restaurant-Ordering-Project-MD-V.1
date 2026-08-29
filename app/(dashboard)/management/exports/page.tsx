import type { Metadata } from "next";

import { FilterBar } from "@/components/dashboard/filter-bar";
import { ListFilterSelect } from "@/components/dashboard/list-controls";
import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { FIELD_CLASS } from "@/components/ui/field-class";
import { requireRole } from "@/lib/auth/session";
import { param, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import {
  BRANCH_FILTERABLE_REPORTS,
  MANAGEMENT_REPORTS,
  REPORT_PERIODS,
  listReportBranches,
  resolveReportFilter,
} from "@/lib/services/management";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("mgmtReports.exportsTitle") };
}

const BASE_PATH = "/management/exports";

/**
 * /management/exports — download every report as CSV, Excel (.xlsx) or PDF.
 *
 * WS-8.1/8.2 — the period and branch chosen here are carried into every
 * download link, so the whole page exports one consistent window instead of the
 * old hardcoded 30-day/all-time CSV. Windows are Dhaka business days.
 */
export default async function ManagementExportsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("management", "super_admin");

  const sp = await searchParams;
  const filter = resolveReportFilter({
    period: param(sp, "period"),
    branch: param(sp, "branch"),
    from: param(sp, "from"),
    to: param(sp, "to"),
  });
  const branches = await listReportBranches();
  const branchName = branches.find((b) => b.id === filter.branchId)?.name ?? "";

  const exportHref = (type: (typeof MANAGEMENT_REPORTS)[number], format: "csv" | "xlsx" | "pdf") => {
    const q = new URLSearchParams({ type, format, period: filter.period });
    if (filter.branchId && BRANCH_FILTERABLE_REPORTS.includes(type)) {
      q.set("branch", String(filter.branchId));
    }
    if (filter.period === "custom") {
      q.set("from", filter.fromKey);
      q.set("to", filter.toKey);
    }
    return `/api/management/export?${q.toString()}`;
  };

  const chip =
    "inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-fg-base hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

  const periodLabel =
    filter.period === "custom"
      ? `${fmt.date(filter.fromKey)} — ${fmt.date(filter.toKey)}`
      : `${t(`mgmtReports.period.${filter.period}`)} · ${fmt.date(filter.fromKey)} — ${fmt.date(filter.toKey)}`;

  return (
    <>
      <PageHeader title={t("mgmtReports.exportsTitle")} subtitle={t("mgmtReports.exportsSub")} />

      <FilterBar
        className="mb-4"
        filters={
          <>
            <ListFilterSelect
              basePath={BASE_PATH}
              searchParams={sp}
              name="period"
              label={t("mgmtReports.periodLabel")}
              value={filter.period}
              options={REPORT_PERIODS.map((p) => ({ value: p, label: t(`mgmtReports.period.${p}`) }))}
              applyLabel={t("mgmtReports.apply")}
            />
            <ListFilterSelect
              basePath={BASE_PATH}
              searchParams={sp}
              name="branch"
              label={t("mgmtReports.branchLabel")}
              value={filter.branchId ? String(filter.branchId) : ""}
              options={[
                { value: "", label: t("mgmtReports.allBranches") },
                ...branches.map((b) => ({ value: String(b.id), label: b.name })),
              ]}
              applyLabel={t("mgmtReports.apply")}
            />
            {filter.period === "custom" ? (
              <form action={BASE_PATH} method="get" className="flex flex-wrap items-center gap-1.5">
                <input type="hidden" name="period" value="custom" />
                {filter.branchId ? <input type="hidden" name="branch" value={filter.branchId} /> : null}
                <label className="min-w-0">
                  <span className="sr-only">{t("mgmtReports.fromLabel")}</span>
                  <input
                    type="date"
                    name="from"
                    defaultValue={filter.fromKey}
                    aria-label={t("mgmtReports.fromLabel")}
                    className={`${FIELD_CLASS} h-11 w-40 py-0 text-sm`}
                  />
                </label>
                <span className="text-xs text-fg-subtle">—</span>
                <label className="min-w-0">
                  <span className="sr-only">{t("mgmtReports.toLabel")}</span>
                  <input
                    type="date"
                    name="to"
                    defaultValue={filter.toKey}
                    aria-label={t("mgmtReports.toLabel")}
                    className={`${FIELD_CLASS} h-11 w-40 py-0 text-sm`}
                  />
                </label>
                <button
                  type="submit"
                  className="inline-flex h-11 shrink-0 items-center rounded-lg border border-border-strong px-2.5 text-xs font-semibold text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {t("mgmtReports.apply")}
                </button>
              </form>
            ) : null}
          </>
        }
        resultsLabel={`${periodLabel}${branchName ? ` · ${branchName}` : ""}`}
        clearHref={BASE_PATH}
        clearLabel={t("mgmtReports.clearFilters")}
      />

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border-base">
            {MANAGEMENT_REPORTS.map((type) => (
              <li key={type} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <span className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-surface-muted text-fg-muted">
                    <Icon name="list" className="size-4" />
                  </span>
                  <span className="font-medium text-fg-base">{t(`mgmtReports.title.${type}`)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <a href={exportHref(type, "csv")} className={chip}>
                    <Icon name="chevron" className="size-4 rotate-90" /> CSV
                  </a>
                  <a href={exportHref(type, "xlsx")} className={chip}>
                    <Icon name="grid" className="size-4" /> Excel
                  </a>
                  {/* Opens the print-optimised view; the browser's print dialog
                      saves it as a PDF without any server-side PDF service. */}
                  <a
                    href={exportHref(type, "pdf")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={chip}
                  >
                    <Icon name="chart" className="size-4" /> PDF
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <p className="mt-4 text-xs text-fg-subtle">{t("mgmtReports.exportNote")}</p>
    </>
  );
}
