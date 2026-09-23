import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { SummaryCard, SummaryCardGrid } from "@/components/dashboard/summary-card";
import { Icon } from "@/components/layout/icons";
import { ZoneMasterManager } from "@/components/delivery/zone-master-manager";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { zonesForAdmin } from "@/lib/services/area-master-admin";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("deliveryZone.title") };
}

/**
 * /admin/delivery-zones — the MASTER list of zones and the localities inside
 * them, owned by the super admin.
 *
 * A zone is a GROUPING TAG on a branch, used for filtering and reports. It is
 * NOT coverage: /admin/delivery-areas is where a branch's actual delivery
 * SHAPES are drawn, and a customer is deliverable when their pin falls inside
 * one of those. Nothing on this page can change where the platform delivers.
 */
export default async function AdminDeliveryZonesPage() {
  const { t, fmt } = await getT();
  await requireRole("super_admin");
  const zones = await zonesForAdmin();

  const activeZones = zones.filter((zone) => zone.isActive).length;
  const taggedBranches = zones.reduce((n, zone) => n + zone.branchCount, 0);

  return (
    <>
      <PageHeader title={t("deliveryZone.title")} subtitle={t("deliveryZone.subtitle")} />

      <SummaryCardGrid className="mb-5">
        <SummaryCard
          title={t("deliveryZone.zonesCount")}
          value={fmt.num(zones.length)}
          icon={<Icon name="pin" />}
        />
        <SummaryCard
          title={t("deliveryZone.activeLabel")}
          value={fmt.num(activeZones)}
          icon={<Icon name="check" />}
          accent="success"
        />
        <SummaryCard
          title={t("deliveryZone.branchesUsing")}
          value={fmt.num(taggedBranches)}
          icon={<Icon name="list" />}
          accent="info"
        />
        <SummaryCard
          title={t("deliveryZone.inactiveLabel")}
          value={fmt.num(zones.length - activeZones)}
          icon={<Icon name="x" />}
          accent="neutral"
        />
      </SummaryCardGrid>

      <ZoneMasterManager zones={zones} />
    </>
  );
}
