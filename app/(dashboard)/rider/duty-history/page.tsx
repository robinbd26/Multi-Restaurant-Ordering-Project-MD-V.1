import type { Metadata } from "next";

import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { dutyDayLogs, dutySessionLog, workedMinutes } from "@/lib/services/rider-duty";
import { dhakaDayKey, endOfToday, startOfToday, weekBounds } from "@/lib/utils/dates";

export const metadata: Metadata = { title: "Duty History" };

/**
 * /rider/duty-history — the rider's last 30 days of duty.
 *
 * WS-5.5 — both tables come from the unified duty service: the day rollups
 * (one row per Dhaka day, first clock-in → last clock-out) and the full duty
 * log beneath them (every branch session). Worked hours are summed from the
 * sessions, so a break between two sessions is not counted as time on duty.
 */
export default async function RiderDutyHistoryPage() {
  const me = await requireRole("rider");
  const { t, fmt } = await getT();
  const riderId = Number(me.id);
  const week = weekBounds();

  const [days, sessions, todayMinutes, weekMinutes] = await Promise.all([
    dutyDayLogs(riderId, 30),
    dutySessionLog(riderId, 30),
    workedMinutes(riderId, startOfToday(), endOfToday()),
    workedMinutes(riderId, week.start, week.end),
  ]);

  const hm = (minutes: number) =>
    t("rider.durationHm", {
      h: fmt.num(Math.floor(minutes / 60)),
      m: fmt.num(minutes % 60),
    });

  // Exact time on duty per day, summed from the sessions of that day.
  const minutesByDay = new Map<string, number>();
  for (const s of sessions) minutesByDay.set(s.dayKey, (minutesByDay.get(s.dayKey) ?? 0) + s.minutes);

  return (
    <>
      <PageHeader title={t("pages.dutyHistoryTitle")} subtitle={t("pages.dutyHistorySub")} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("rider.hoursToday")} value={hm(todayMinutes)} icon={<Icon name="clock" />} accent="brand" />
        <StatCard label={t("rider.hoursWeek")} value={hm(weekMinutes)} icon={<Icon name="chart" />} accent="blue" />
        <StatCard label={t("riderLoc.dutyDays")} value={fmt.num(days.length)} icon={<Icon name="history" />} accent="green" />
      </div>

      <Card className="mt-6">
        <CardHeader title={t("rider.dutyHistory")} />
        {days.length === 0 ? (
          <EmptyState title={t("rider.noDutyRecords")} description={t("rider.noDutyRecordsDesc")} />
        ) : (
          <Table
            headers={[
              t("pages.colDate"),
              t("pages.colBranch"),
              t("pages.colClockIn"),
              t("pages.colClockOut"),
              t("pages.colDuration"),
              t("common.status"),
            ]}
          >
            {days.map((day) => {
              const dayKey = dhakaDayKey(day.date);
              // Legacy rows written before the sessions existed still show
              // their recorded span rather than nothing.
              const minutes =
                minutesByDay.get(dayKey) ??
                (day.clockOut
                  ? Math.max(0, Math.floor((day.clockOut.getTime() - day.clockIn.getTime()) / 60000))
                  : null);
              return (
                <tr key={dayKey} className="hover:bg-surface-hover/70">
                  <Td><span className="font-medium text-fg-base">{fmt.date(day.date.toISOString())}</span></Td>
                  <Td>{day.branch?.name ?? "—"}</Td>
                  <Td>{fmt.time(day.clockIn.toISOString())}</Td>
                  <Td>{day.clockOut ? fmt.time(day.clockOut.toISOString()) : "—"}</Td>
                  <Td>{minutes === null ? t("rider.onDutyNow") : hm(minutes)}</Td>
                  <Td>
                    {day.clockOut === null ? (
                      <Badge tone="green">{t("pages.onDuty")}</Badge>
                    ) : (
                      <Badge tone="slate">{t("common.inactive")}</Badge>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title={t("rider.dutySessions")} />
        {sessions.length === 0 ? (
          <EmptyState title={t("rider.noDutyRecords")} description={t("rider.noDutyRecordsDesc")} />
        ) : (
          <Table
            headers={[
              t("pages.colDate"),
              t("pages.colBranch"),
              t("pages.colClockIn"),
              t("pages.colClockOut"),
              t("pages.colDuration"),
              t("common.status"),
            ]}
          >
            {sessions.map((s) => (
              <tr key={s.id} className="hover:bg-surface-hover/70">
                <Td><span className="text-sm text-fg-muted">{fmt.date(s.startedAt.toISOString())}</span></Td>
                <Td>{s.branchName || "—"}</Td>
                <Td>{fmt.time(s.startedAt.toISOString())}</Td>
                <Td>{s.endedAt ? fmt.time(s.endedAt.toISOString()) : "—"}</Td>
                <Td>{hm(s.minutes)}</Td>
                <Td>
                  {s.isActive ? (
                    <Badge tone="green">{t("pages.onDuty")}</Badge>
                  ) : (
                    <Badge tone="slate">{t("common.inactive")}</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
