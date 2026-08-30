import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { midnight } from "@/lib/utils/dates";
import { activeDutySession } from "@/lib/services/rider-duty";
import { riderTravelDistanceKm } from "@/lib/services/rider-location";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("riderLoc.locationHistoryTitle") };
}

/** /rider/location-history — online toggle + recent visited locations. */
export default async function RiderLocationHistoryPage() {
  const { t, fmt } = await getT();
  const me = await requireRole("rider");
  const userId = Number(me.id);

  // WS-5.7 — duty status comes from the active duty session (authoritative),
  // never the RiderProfile.isOnline flag, which can go stale after a crash.
  const [session, points, totalKm, todayKm] = await Promise.all([
    activeDutySession(userId),
    prisma.riderRoutePoint.findMany({ where: { riderId: userId }, orderBy: { recordedAt: "desc" }, take: 100 }),
    riderTravelDistanceKm(userId),
    riderTravelDistanceKm(userId, midnight()),
  ]);
  const online = session !== null;

  return (
    <>
      <PageHeader title={t("riderLoc.locationHistoryTitle")} subtitle={t("riderLoc.locationHistorySub")} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title={t("riderLoc.dutyStatus")} />
          <CardContent className="space-y-4">
            {/* WS-5.7 — read-only status. The old second online/offline toggle
                here called an endpoint that rejects going online without a duty
                session and swallowed the error, so the button just looked dead.
                Going online requires picking a branch — that flow lives in the
                dashboard duty panel, and is linked rather than duplicated. */}
            <div className="flex flex-col items-start gap-2">
              <Badge tone={online ? "green" : "slate"}>
                {online ? t("riderLoc.online") : t("riderLoc.offline")}
              </Badge>
              <Link href="/rider/dashboard" className="text-xs text-fg-subtle underline-offset-2 hover:underline">
                {t("riderLoc.manageDutyHint")}
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label={t("riderLoc.todayDistance")} value={`${fmt.num(todayKm)} km`} icon={<Icon name="pin" />} accent="brand" />
              <StatCard label={t("riderLoc.totalDistance")} value={`${fmt.num(totalKm)} km`} icon={<Icon name="bike" />} accent="green" />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t("riderLoc.visitedLocations")} />
          {points.length === 0 ? (
            <EmptyState title={t("riderLoc.noPoints")} description={t("riderLoc.noPointsDesc")} />
          ) : (
            <Table headers={[t("pages.colDate"), t("riderLoc.latitude"), t("riderLoc.longitude")]}>
              {points.map((p) => (
                <tr key={p.id} className="hover:bg-surface-hover/70">
                  <Td><span className="text-xs text-fg-muted">{fmt.dateTime(p.recordedAt.toISOString())}</span></Td>
                  <Td>{fmt.num(Number(p.lat).toFixed(5))}</Td>
                  <Td>{fmt.num(Number(p.lng).toFixed(5))}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
