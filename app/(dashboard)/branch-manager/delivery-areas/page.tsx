import type { Metadata } from "next";

import { DeliveryAreaForm } from "@/components/delivery/delivery-area-form";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { requireRole } from "@/lib/auth/session";
import { getSessionUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";
import { branchGeometryForAreas } from "@/lib/services/area-geometry";
import { AREA_INCLUDE, serializeArea } from "@/lib/services/delivery-areas";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("deliveryArea.titleOne") };
}

/**
 * /branch-manager/delivery-areas — THE delivery area of the manager's own
 * branch, drawn and edited right here (one area per branch, so there is no
 * list to go through). The server only ever lets a manager touch their own.
 */
export default async function BranchManagerDeliveryAreaPage() {
  const { t } = await getT();
  await requireRole("branch_manager");
  const me = (await getSessionUser())!;
  const branch = await branchForManager(me.id);
  if (!branch) {
    return (
      <>
        <PageHeader title={t("deliveryArea.titleOne")} />
        <Alert tone="warning" message={t("errors.catalog.noBranchAssigned")} />
      </>
    );
  }
  const [geometry, area] = await Promise.all([
    branchGeometryForAreas(branch.id),
    prisma.branchDeliveryArea.findUnique({ where: { branchId: branch.id }, include: AREA_INCLUDE }),
  ]);
  return <DeliveryAreaForm geometry={geometry!} initial={area ? serializeArea(area) : null} isSuperAdmin={false} />;
}
