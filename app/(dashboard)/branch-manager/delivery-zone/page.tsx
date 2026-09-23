import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DeliveryPauseControl } from "@/components/branch/delivery-pause-control";
import { DeliverySettingsPanel } from "@/components/branch/delivery-settings-panel";
import { isDeliveryPaused } from "@/lib/coverage/pause";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";
import { prisma } from "@/lib/db";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("bmExtras.zoneTitle") };
}

/**
 * /branch-manager/delivery-zone — the branch's delivery SETTINGS: preparation
 * time, the pickup point, and the short-term "pause delivery" brake.
 *
 * WHERE the branch delivers is not set here — that is the shapes drawn on
 * /branch-manager/delivery-areas. This page used to also manage a parallel set
 * of coverage circles; they were migrated into delivery areas and removed, so
 * there is now exactly one answer to "where do we deliver?".
 */
export default async function DeliveryZonePage() {
  const { t } = await getT();
  await requireRole("branch_manager");
  const me = (await getSessionUser())!;
  const branch = (await branchForManager(me.id))!;
  const drawnAreaCount = await prisma.branchDeliveryArea.count({
    where: { branchId: branch.id, isActive: true, shape: { not: null } },
  });

  const settings = {
    branch_id: branch.id,
    branch_name: branch.name,
    latitude: branch.latitude?.toString() ?? null,
    longitude: branch.longitude?.toString() ?? null,
    delivery_radius_km: branch.deliveryRadiusKm.toString(),
    prep_time_minutes: branch.prepTimeMinutes,
    pickup_enabled: branch.pickupEnabled,
    pickup_address: branch.pickupAddress,
    pickup_phone: branch.pickupPhone,
    drawn_area_count: drawnAreaCount,
  };

  return (
    <>
      <PageHeader title={t("bmExtras.zoneTitle")} subtitle={t("bmExtras.zoneSub")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <DeliveryPauseControl
          initial={{
            paused: isDeliveryPaused(branch),
            mode: branch.deliveryPauseMode,
            until: branch.deliveryPausedUntil?.toISOString() ?? null,
          }}
        />
        <Card className="lg:col-span-2">
          <CardHeader title={t("bmExtras.zoneSettings")} />
          <CardContent>
            <DeliverySettingsPanel settings={settings} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
