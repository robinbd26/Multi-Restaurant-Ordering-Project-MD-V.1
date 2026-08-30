import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import type { ActivityLog, ManagerAssignment, Paginated } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("branchManager.dutyHistoryTitle") };
}

export default async function BMDutyHistoryPage() {
  const { t, fmt } = await getT();
  const me = await requireRole("branch_manager");
  // WS-5.11 — sign-ins come from LoginHistory (written on every sign-in, with
  // IP + user agent). ManagerActivityLog only ever records "action" rows, so
  // the old login/logout badges here were backed by rows that never exist.
  const [assignments, logs, signIns] = await Promise.all([
    getJSON<Paginated<ManagerAssignment>>("/manager-assignments/"),
    getJSON<Paginated<ActivityLog>>("/activity-logs/"),
    prisma.loginHistory.findMany({
      where: { userId: Number(me.id) },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <>
      <PageHeader title={t("branchManager.dutyHistoryTitle")} subtitle={t("branchManager.dutyHistorySubtitle")} />

      <Card>
        <CardHeader title={t("branchManager.branchAssignments")} />
        {assignments.results.length === 0 ? (
          <EmptyState title={t("branchManager.noAssignments")} />
        ) : (
          <Table
            headers={[
              t("branchManager.colBranch"),
              t("branchManager.colStart"),
              t("branchManager.colEnd"),
              t("branchManager.colDuration"),
              t("common.status"),
            ]}
          >
            {assignments.results.map((a) => (
              <tr key={a.id} className="hover:bg-surface-hover/70">
                <Td><span className="font-medium text-fg-base">{a.branch_name}</span></Td>
                <Td><span className="text-xs text-fg-muted">{fmt.dateTime(a.assigned_at)}</span></Td>
                <Td>
                  <span className="text-xs text-fg-muted">
                    {a.relieved_at ? fmt.dateTime(a.relieved_at) : t("branchManager.ongoing")}
                  </span>
                </Td>
                <Td>{t("branchManager.days", { count: fmt.num(a.duration_days) })}</Td>
                <Td>
                  {a.is_active ? (
                    <Badge tone="green">{t("common.active")}</Badge>
                  ) : (
                    <Badge tone="slate">{t("branchManager.completed")}</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* WS-5.11 — ManagerActivityLog only ever contains "action" rows, so the
          former login/logout badges (and the Type column of identical "action"
          chips) rendered states that are never written; the sign-in card below
          is the truthful source for those. */}
      <Card className="mt-6">
        <CardHeader title={t("branchManager.activityLog")} subtitle={t("branchManager.activityLogSubActions")} />
        {logs.results.length === 0 ? (
          <EmptyState title={t("branchManager.noLogs")} />
        ) : (
          <Table headers={[t("branchManager.colTime"), t("branchManager.colDescription"), "IP"]}>
            {logs.results.map((log) => (
              <tr key={log.id} className="hover:bg-surface-hover/70">
                <Td><span className="whitespace-nowrap text-xs text-fg-muted">{fmt.dateTime(log.timestamp)}</span></Td>
                <Td><span className="text-sm text-fg-base">{log.description}</span></Td>
                <Td><span className="font-mono text-xs text-fg-subtle">{log.ip_address || "—"}</span></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* WS-5.11 — real sign-ins from LoginHistory (time, IP, device). */}
      <Card className="mt-6">
        <CardHeader title={t("branchManager.signInHistory")} subtitle={t("branchManager.signInHistorySub")} />
        {signIns.length === 0 ? (
          <EmptyState title={t("branchManager.noSignIns")} />
        ) : (
          <Table headers={[t("branchManager.colTime"), "IP", t("branchManager.colDevice")]}>
            {signIns.map((l) => (
              <tr key={l.id} className="hover:bg-surface-hover/70">
                <Td><span className="whitespace-nowrap text-xs text-fg-muted">{fmt.dateTime(l.createdAt.toISOString())}</span></Td>
                <Td><span className="font-mono text-xs text-fg-subtle">{l.ipAddress || "—"}</span></Td>
                <Td>
                  <span className="block max-w-80 truncate text-xs text-fg-muted" title={l.userAgent || undefined}>
                    {l.userAgent || "—"}
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
