import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { ListFilterSelect } from "@/components/dashboard/list-controls";
import { ResponsiveDataView } from "@/components/dashboard/responsive-data-view";
import { Icon } from "@/components/layout/icons";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FIELD_CLASS } from "@/components/ui/field-class";
import { Table, Td } from "@/components/ui/table";
import { param, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import {
  BRANCH_FILTERABLE_REPORTS,
  REPORT_PERIODS,
  buildReport,
  listReportBranches,
  localizeReportCell,
  resolveReportFilter,
  type ManagementReportType,
} from "@/lib/services/management";

/**
 * Shared management report table (used by every /management/reports/* page).
 *
 * WS-8.1 — the window (daily | weekly | monthly | yearly | custom range) and the
 * branch live in the URL, so a filtered report is linkable, Back/Forward work,
 * and the CSV/Excel/PDF links below export EXACTLY what is on screen. Every
 * boundary is a Dhaka day boundary, resolved server-side — the query string is
 * never trusted to define the window on its own.
 */
export async function ManagementReportView({
  type,
  searchParams = {},
}: {
  type: ManagementReportType;
  searchParams?: RawSearchParams;
}) {
  const { t, fmt } = await getT();
  const basePath = `/management/reports/${type}`;
  const branchFilterable = BRANCH_FILTERABLE_REPORTS.includes(type);

  const filter = resolveReportFilter({
    period: param(searchParams, "period"),
    branch: branchFilterable ? param(searchParams, "branch") : "",
    from: param(searchParams, "from"),
    to: param(searchParams, "to"),
  });

  const [report, branches] = await Promise.all([
    buildReport(type, filter),
    branchFilterable ? listReportBranches() : Promise.resolve([]),
  ]);
  const labels = report.columns.map((c) => t(`mgmtReports.col.${c}`));
  const branchName = branches.find((b) => b.id === filter.branchId)?.name ?? "";

  // Built from the RESOLVED filter (not the raw query string) so the download
  // can never disagree with the table above it.
  const exportHref = (format: "csv" | "xlsx" | "pdf") => {
    const q = new URLSearchParams({ type, format, period: filter.period });
    if (filter.branchId) q.set("branch", String(filter.branchId));
    if (filter.period === "custom") {
      q.set("from", filter.fromKey);
      q.set("to", filter.toKey);
    }
    return `/api/management/export?${q.toString()}`;
  };

  const exportLink =
    "inline-flex h-10 items-center gap-2 rounded-xl border border-border-strong bg-surface-card px-3.5 text-sm font-medium text-fg-base hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

  /**
   * Money columns render as ৳; numbers get localized digits; everything else
   * goes through the shared localizer, which resolves both the column-0 key
   * columns (finance/orders) and any `reportKeyCell()` marker anywhere in the
   * row (expense category, job post…), exactly as the exports do.
   */
  const displayCell = (value: string | number, col: number): string => {
    if (report.moneyColumns.includes(col)) return fmt.money(value);
    if (typeof value === "number") return fmt.num(value);
    return localizeReportCell(type, value, col, t);
  };

  const periodLabel =
    filter.period === "custom"
      ? `${fmt.date(filter.fromKey)} — ${fmt.date(filter.toKey)}`
      : `${t(`mgmtReports.period.${filter.period}`)} · ${fmt.date(filter.fromKey)} — ${fmt.date(filter.toKey)}`;

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("mgmtReports.backToHub"), href: "/management/reports" },
          { label: t(`mgmtReports.title.${report.key}`) },
        ]}
        title={t(`mgmtReports.title.${report.key}`)}
        subtitle={t(`mgmtReports.sub.${report.key}`)}
        actions={
          <>
            <a href={exportHref("csv")} className={exportLink}>
              <Icon name="list" className="size-4" /> {t("mgmtReports.exportCsv")}
            </a>
            <a href={exportHref("xlsx")} className={exportLink}>
              <Icon name="grid" className="size-4" /> {t("mgmtReports.exportXlsx")}
            </a>
            {/* Opens the printable view, which fires the browser print dialog —
                "Save as PDF" there is the no-external-service PDF path. */}
            <a href={exportHref("pdf")} target="_blank" rel="noopener noreferrer" className={exportLink}>
              <Icon name="chart" className="size-4" /> {t("mgmtReports.exportPdf")}
            </a>
          </>
        }
      />

      <FilterBar
        filters={
          <>
            <ListFilterSelect
              basePath={basePath}
              searchParams={searchParams}
              name="period"
              label={t("mgmtReports.periodLabel")}
              value={filter.period}
              options={REPORT_PERIODS.map((p) => ({ value: p, label: t(`mgmtReports.period.${p}`) }))}
              applyLabel={t("mgmtReports.apply")}
            />
            {branchFilterable ? (
              <ListFilterSelect
                basePath={basePath}
                searchParams={searchParams}
                name="branch"
                label={t("mgmtReports.branchLabel")}
                value={filter.branchId ? String(filter.branchId) : ""}
                options={[
                  { value: "", label: t("mgmtReports.allBranches") },
                  ...branches.map((b) => ({ value: String(b.id), label: b.name })),
                ]}
                applyLabel={t("mgmtReports.apply")}
              />
            ) : null}
            {filter.period === "custom" ? (
              /* Shown only for the custom period, so the date inputs can never
                 look active while a daily/weekly/monthly window is in force. */
              <form action={basePath} method="get" className="flex flex-wrap items-center gap-1.5">
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
        resultsLabel={`${periodLabel}${branchName ? ` · ${branchName}` : ""} · ${t("mgmtReports.rowCount", { count: fmt.num(report.rows.length) })}`}
        clearHref={basePath}
        clearLabel={t("mgmtReports.clearFilters")}
      />

      <Card>
        {report.rows.length === 0 ? (
          <EmptyState title={t("pages.noData")} />
        ) : (
          /* A report row is a plain string tuple, so below `md` each row becomes
             a labelled key/value card instead of a table forced into ~360px. */
          <ResponsiveDataView
            items={report.rows}
            getKey={(row) => report.rows.indexOf(row)}
            desktop={(rows) => (
              <Table headers={labels}>
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-surface-hover/70">
                    {row.map((cell, j) => (
                      <Td key={j}>
                        <span className={j === 0 ? "font-medium text-fg-base" : ""}>
                          {displayCell(cell, j)}
                        </span>
                      </Td>
                    ))}
                  </tr>
                ))}
              </Table>
            )}
            mobile={(row) => (
              <div className="rounded-xl border border-border-base bg-surface-card p-3.5">
                <p className="mb-2 font-semibold text-fg-base">{displayCell(row[0], 0)}</p>
                <dl className="grid gap-1.5">
                  {row.slice(1).map((cell, j) => (
                    <div key={j} className="flex items-baseline justify-between gap-3">
                      <dt className="text-xs text-fg-muted">{labels[j + 1]}</dt>
                      <dd className="text-sm font-medium text-fg-base">{displayCell(cell, j + 1)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          />
        )}
      </Card>

      <p className="text-xs text-fg-subtle">{t("mgmtReports.dhakaDayNote")}</p>
    </DashboardPage>
  );
}
