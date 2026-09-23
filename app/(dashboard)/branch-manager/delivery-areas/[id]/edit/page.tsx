import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeliveryAreaForm } from "@/components/delivery/delivery-area-form";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { ApiError } from "@/lib/http/errors";
import { branchGeometryForAreas } from "@/lib/services/area-geometry";
import { areaForManage, serializeArea } from "@/lib/services/delivery-areas";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("deliveryArea.editTitle") };
}

export default async function BranchManagerEditDeliveryAreaPage({
  params,
  searchParams,
}: PageProps<"/branch-manager/delivery-areas/[id]/edit">) {
  await requireRole("branch_manager");
  const me = (await getSessionUser())!;
  const { id } = await params;
  const query = await searchParams;
  const areaId = Number(id);
  if (!Number.isSafeInteger(areaId) || areaId < 1) notFound();
  let area: Awaited<ReturnType<typeof areaForManage>>;
  try {
    area = await areaForManage(me, areaId);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      notFound();
    }
    throw error;
  }

  // This area is excluded from its own backdrop — it is the one being drawn.
  const geometry = await branchGeometryForAreas(area.branchId, area.id);

  return (
    <DeliveryAreaForm
      mode="edit"
      geometry={geometry}
      listPath="/branch-manager/delivery-areas"
      isSuperAdmin={false}
      initial={serializeArea(area)}
      assignedBranch={{ id: area.branchId, name: area.branch.name }}
      returnTo={typeof query.returnTo === "string" ? query.returnTo : undefined}
    />
  );
}
