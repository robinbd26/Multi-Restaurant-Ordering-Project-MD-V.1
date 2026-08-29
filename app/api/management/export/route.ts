import { NextResponse } from "next/server";

import { requireApiRole } from "@/lib/auth/current-user";
import { handle, validationError } from "@/lib/http/errors";
import { getT } from "@/lib/i18n/server";
import {
  MANAGEMENT_REPORTS,
  buildExportDocument,
  buildReport,
  listReportBranches,
  reportToCsv,
  reportToPrintableHtml,
  reportToXlsx,
  resolveExportFormat,
  resolveReportFilter,
  type ManagementReportType,
} from "@/lib/services/management";

// GET /api/management/export
//   ?type=<report>&format=csv|xlsx|pdf&period=daily|weekly|monthly|yearly|custom
//   &branch=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// WS-8.2 — `format` used to be accepted and silently ignored (CSV always came
// back). All three formats are now real: CSV text, a valid .xlsx workbook, and
// a print-optimised HTML view the browser saves as PDF (the documented no-key
// fallback — no headless browser or PDF service to install).
//
// WS-8.1 — the window and branch come from the query string but are resolved
// server-side against Dhaka day boundaries, so a crafted range cannot widen the
// report beyond a validated window and role is checked before anything is read.
export const GET = handle(async (req: Request) => {
  await requireApiRole("management", "super_admin");
  const url = new URL(req.url);
  const type = url.searchParams.get("type") as ManagementReportType;
  if (!MANAGEMENT_REPORTS.includes(type)) {
    throw validationError({ type: "Unknown report type." });
  }

  const format = resolveExportFormat(url.searchParams.get("format"));
  const filter = resolveReportFilter({
    period: url.searchParams.get("period"),
    branch: url.searchParams.get("branch"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });

  const { t, fmt, locale } = await getT();
  const [report, branches] = await Promise.all([
    buildReport(type, filter),
    filter.branchId ? listReportBranches() : Promise.resolve([]),
  ]);
  const branchName = branches.find((b) => b.id === filter.branchId)?.name ?? "";
  const doc = buildExportDocument(report, t, fmt, branchName);

  // Dhaka day keys in the filename so a folder of downloads self-sorts by the
  // window they actually cover, not by the UTC day the click happened on.
  const stem = `mad-${type}-${filter.fromKey}_${filter.toKey}`;

  if (format === "xlsx") {
    const book = reportToXlsx(doc, doc.title);
    return new NextResponse(new Uint8Array(book), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${stem}.xlsx"`,
      },
    });
  }

  if (format === "pdf") {
    const html = reportToPrintableHtml(
      doc,
      { print: t("mgmtReports.printPdf"), empty: t("pages.noData") },
      locale,
    );
    // Served inline: the page opens, the print dialog fires, "Save as PDF" ends
    // with a PDF on disk. A download would hand the user a bare .html file.
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${stem}.html"`,
      },
    });
  }

  return new NextResponse(reportToCsv(doc), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${stem}.csv"`,
    },
  });
});
