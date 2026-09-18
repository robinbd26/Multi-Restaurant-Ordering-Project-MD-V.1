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
 * Distinct from /admin/delivery-areas, which is per-branch COVERAGE: this page
 * says which places exist and what they are called, and that page says which
 * branch delivers to them, on which shift, for what charge. Keeping the naming in
 * one place is what lets a saved address be matched to coverage without a map pin.
 */
export default async function AdminDeliveryZonesPage() {
  const { t, fmt } = await getT();
  await requireRole("super_admin");
  const zones = await zonesForAdmin();

  const activeZones = zones.filter((zone) => zone.isActive).length;
  const localities = zones.flatMap((zone) => zone.localities);
  const activeLocalities = localities.filter((locality) => locality.isActive).length;

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
          title={t("deliveryZone.localitiesCount")}
          value={fmt.num(localities.length)}
          icon={<Icon name="list" />}
          accent="info"
        />
        <SummaryCard
          title={t("deliveryZone.inactiveLabel")}
          value={fmt.num(localities.length - activeLocalities)}
          icon={<Icon name="x" />}
          accent="neutral"
        />
      </SummaryCardGrid>

      <ZoneMasterManager zones={zones} />
    </>
  );
}
