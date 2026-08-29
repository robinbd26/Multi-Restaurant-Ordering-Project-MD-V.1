import type { Metadata } from "next";
import Link from "next/link";

import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { SummaryCard, SummaryCardGrid } from "@/components/dashboard/summary-card";
import { Icon } from "@/components/layout/icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FIELD_CLASS } from "@/components/ui/field-class";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { dateParam, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import { EMPLOYEE_ROLES } from "@/lib/services/employees";
import {
  dhakaAddDays,
  dhakaDayEndFromKey,
  dhakaDayKey,
  dhakaDayStartFromKey,
  endOfDhakaToday,
  startOfDhakaToday,
} from "@/lib/utils/dates";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("adminReports.attendanceTitle") };
}

const BASE = "/admin/reports/attendance";

/** Status pill tone shared by both attendance sections. */
const STATUS_TONES: Record<string, "green" | "amber" | "red" | "blue" | "slate"> = {
  present: "green",
  late: "amber",
  half_day: "amber",
  absent: "red",
  leave: "blue",
};

/**
 * /admin/reports/attendance — WS-8.8.
 *
 * "Daily attendance across all sections" used to mean two things only — rider
 * duty logs and manager login events — hardcoded to the last 7 days with no way
 * to ask about any other day. It now covers every section that actually records
 * attendance:
 *
 *   1. branch employees   — EmployeeAttendance (the real HR roster)
 *   2. riders             — RiderDutyLog (clock in/out)
 *   3. dashboard staff    — StaffAttendance (managers/riders marked present)
 *   4. manager presence   — ManagerActivityLog login events
 *
 * and is date-selectable. The day is ONE Dhaka business day resolved from the
 * shared helpers — never a UTC slice, which before 06:00 Dhaka would have shown
 * the previous day's roster.
 */
export default async function AdminAttendanceReportPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("super_admin");
  const sp = await searchParams;

  // A missing or malformed ?date= falls back to today in Dhaka rather than to
  // an Invalid Date or an unbounded scan.
  const requested = dateParam(sp, "date");
  const from = (requested && dhakaDayStartFromKey(requested)) || startOfDhakaToday();
  const to = (requested && dhakaDayEndFromKey(requested)) || endOfDhakaToday();
  const dayKey = dhakaDayKey(from);
  const window = { gte: from, lte: to };

  // Date-only models (EmployeeAttendance / StaffAttendance / RiderDutyLog) store
  // the calendar day at UTC midnight, which always falls INSIDE the Dhaka day it
  // belongs to (Dhaka is UTC+6), so one window serves both them and the
  // instant-stamped activity log.
  const [employees, duties, staff, managerLogins] = await Promise.all([
    prisma.employeeAttendance.findMany({
      where: { date: window },
      select: {
        id: true,
        status: true,
        checkIn: true,
        checkOut: true,
        branch: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true, role: true, customRole: true, employeeCode: true } },
      },
      orderBy: [{ branchId: "asc" }, { employeeId: "asc" }],
    }),
    prisma.riderDutyLog.findMany({
      where: { date: window },
      include: { rider: true, branch: true },
      orderBy: [{ branchId: "asc" }, { clockIn: "desc" }],
    }),
    prisma.staffAttendance.findMany({
      where: { date: window },
      select: {
        id: true,
        status: true,
        markedAt: true,
        branch: { select: { name: true } },
        user: { select: { firstName: true, lastName: true, username: true, role: true } },
      },
      orderBy: { markedAt: "desc" },
    }),
    prisma.managerActivityLog.findMany({
      where: { activityType: "login", timestamp: window },
      include: { manager: true, branch: true },
      orderBy: { timestamp: "desc" },
      take: 100,
    }),
  ]);

  const presentCount =
    employees.filter((e) => e.status === "present" || e.status === "late").length +
    staff.filter((s) => s.status === "present").length;
  const awayCount =
    employees.filter((e) => e.status === "absent" || e.status === "leave").length +
    staff.filter((s) => s.status === "absent" || s.status === "leave").length;

  const statusBadge = (status: string) => (
    <Badge dot tone={STATUS_TONES[status] ?? "slate"}>{t(`b6.status.${status}`)}</Badge>
  );

  /** "others" is the one role carrying a free-text job term; the rest are keys. */
  const post = (role: string, customRole: string) =>
    role === "others" && customRole
      ? customRole
      : (EMPLOYEE_ROLES as readonly string[]).includes(role)
        ? t(`b5.roles.${role}`)
        : role;

  const navLink =
    "inline-flex h-11 shrink-0 items-center rounded-lg border border-border-strong px-3 text-xs font-semibold text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("pages.reportsTitle"), href: "/admin/reports" },
          { label: t("adminReports.attendanceTitle") },
        ]}
        title={t("adminReports.attendanceTitle")}
        subtitle={t("adminReports.attendanceSub")}
      />

      <SummaryCardGrid>
        <SummaryCard title={t("b6.status.present")} value={fmt.num(presentCount)} icon={<Icon name="check" />} accent="success" />
        <SummaryCard title={t("adminReports.away")} value={fmt.num(awayCount)} icon={<Icon name="x" />} accent="danger" />
        <SummaryCard title={t("adminReports.riderDuty")} value={fmt.num(duties.length)} icon={<Icon name="bike" />} accent="info" />
        <SummaryCard title={t("adminReports.managerLogins")} value={fmt.num(managerLogins.length)} icon={<Icon name="lock" />} accent="violet" />
      </SummaryCardGrid>

      <FilterBar
        filters={
          <>
            <Link href={`${BASE}?date=${dhakaDayKey(dhakaAddDays(from, -1))}`} className={navLink} rel="prev">
              {t("adminReports.previousDay")}
            </Link>
            {/* A GET form: the chosen day lands in the URL, so a specific day's
                attendance is linkable and Back/Forward behave. */}
            <form action={BASE} method="get" className="flex flex-wrap items-center gap-1.5">
              <label className="min-w-0">
                <span className="sr-only">{t("pages.colDate")}</span>
                <input
                  type="date"
                  name="date"
                  defaultValue={dayKey}
                  aria-label={t("pages.colDate")}
                  className={`${FIELD_CLASS} h-11 w-44 py-0 text-sm`}
                />
              </label>
              <button
                type="submit"
                className="inline-flex h-11 shrink-0 items-center rounded-lg border border-border-strong px-2.5 text-xs font-semibold text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {t("list.apply")}
              </button>
            </form>
            <Link href={`${BASE}?date=${dhakaDayKey(dhakaAddDays(from, 1))}`} className={navLink} rel="next">
              {t("adminReports.nextDay")}
            </Link>
          </>
        }
        resultsLabel={fmt.date(dayKey)}
        clearHref={BASE}
        clearLabel={t("common.today")}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("adminReports.branchEmployees")} />
          {employees.length === 0 ? (
            <EmptyState title={t("pages.noData")} />
          ) : (
            <Table
              headers={[
                t("adminExtras.colStaff"),
                t("pages.colBranch"),
                t("adminExtras.colPost"),
                t("pages.colStatus"),
                t("adminReports.clockIn"),
                t("adminReports.clockOut"),
              ]}
            >
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-surface-hover/70">
                  <Td>
                    <span className="block font-medium text-fg-base">
                      {`${e.employee.firstName} ${e.employee.lastName}`.trim()}
                    </span>
                    <span className="block text-xs text-fg-subtle">{e.employee.employeeCode}</span>
                  </Td>
                  <Td>{e.branch.name}</Td>
                  <Td>{post(e.employee.role, e.employee.customRole)}</Td>
                  <Td>{statusBadge(e.status)}</Td>
                  <Td mono><span className="text-xs">{e.checkIn ?? "—"}</span></Td>
                  <Td mono><span className="text-xs">{e.checkOut ?? "—"}</span></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title={t("adminReports.riderDuty")} />
          {duties.length === 0 ? (
            <EmptyState title={t("pages.noData")} />
          ) : (
            <Table headers={[t("wallet.colRider"), t("pages.colBranch"), t("adminReports.clockIn"), t("adminReports.clockOut")]}>
              {duties.map((d) => (
                <tr key={d.id} className="hover:bg-surface-hover/70">
                  <Td>{`${d.rider.firstName} ${d.rider.lastName}`.trim() || d.rider.username}</Td>
                  <Td>{d.branch.name}</Td>
                  <Td mono><span className="text-xs">{fmt.time(d.clockIn.toISOString())}</span></Td>
                  <Td mono>
                    <span className="text-xs">
                      {d.clockOut ? fmt.time(d.clockOut.toISOString()) : t("adminReports.onDuty")}
                    </span>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title={t("adminReports.staffAttendance")} />
          {staff.length === 0 ? (
            <EmptyState title={t("pages.noData")} />
          ) : (
            <Table
              headers={[t("adminExtras.colStaff"), t("pages.colBranch"), t("adminExtras.colPost"), t("pages.colStatus")]}
            >
              {staff.map((s) => (
                <tr key={s.id} className="hover:bg-surface-hover/70">
                  <Td>{`${s.user.firstName} ${s.user.lastName}`.trim() || s.user.username}</Td>
                  <Td>{s.branch?.name ?? "—"}</Td>
                  <Td>{t(`roles.${s.user.role}`)}</Td>
                  <Td>{statusBadge(s.status)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title={t("adminReports.managerLogins")} />
          {managerLogins.length === 0 ? (
            <EmptyState title={t("pages.noData")} />
          ) : (
            <Table headers={[t("adminExtras.colStaff"), t("pages.colBranch"), t("pages.colDate")]}>
              {managerLogins.map((l) => (
                <tr key={l.id} className="hover:bg-surface-hover/70">
                  <Td>{`${l.manager.firstName} ${l.manager.lastName}`.trim() || l.manager.username}</Td>
                  <Td>{l.branch?.name ?? "—"}</Td>
                  <Td><span className="text-xs text-fg-muted">{fmt.dateTime(l.timestamp.toISOString())}</span></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <p className="text-xs text-fg-subtle">{t("mgmtReports.dhakaDayNote")}</p>
    </DashboardPage>
  );
}
