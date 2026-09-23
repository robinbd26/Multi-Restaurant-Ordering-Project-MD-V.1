import type { Metadata } from "next";

import { DeliveryAreaForm } from "@/components/delivery/delivery-area-form";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";
import { branchGeometryForAreas } from "@/lib/services/area-geometry";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("deliveryArea.addTitle") };
}

export default async function BranchManagerNewDeliveryAreaPage() {
  await requireRole("branch_manager");
  const me = (await getSessionUser())!;
  const branch = await branchForManager(me.id);
  // The branch pin, the radius ceiling and the branch's other shapes — what the
  // manager draws against.
  const geometry = branch ? await branchGeometryForAreas(branch.id) : null;

  return (
    <DeliveryAreaForm
      mode="create"
      geometry={geometry}
      listPath="/branch-manager/delivery-areas"
      isSuperAdmin={false}
      assignedBranch={branch ? { id: branch.id, name: branch.name } : null}
    />
  );
}
