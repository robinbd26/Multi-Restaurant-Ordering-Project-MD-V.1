import type { Metadata } from "next";

import { DeliveryAreaForm } from "@/components/delivery/delivery-area-form";
import { activeZonesWithLocalities } from "@/lib/services/area-master";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("deliveryArea.addTitle") };
}

export default async function BranchManagerNewDeliveryAreaPage() {
  await requireRole("branch_manager");
  const me = (await getSessionUser())!;
  const branch = await branchForManager(me.id);

  // The master list the branch ticks its coverage from.
  const zones = await activeZonesWithLocalities();

  return (
    <DeliveryAreaForm
      mode="create"
      zones={zones}
      listPath="/branch-manager/delivery-areas"
      isSuperAdmin={false}
      assignedBranch={branch ? { id: branch.id, name: branch.name } : null}
    />
  );
}
