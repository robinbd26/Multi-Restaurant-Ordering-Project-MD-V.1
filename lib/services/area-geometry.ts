import "server-only";

import { prisma } from "@/lib/db";
import type { DeliveryAreaBranchGeometry } from "@/components/delivery/delivery-area-form";

/**
 * Everything the drawing editor needs about the branch an area belongs to: the
 * pin every shape is measured from, the maximum radius nothing may cross, and
 * the branch's OTHER areas so overlaps are visible while drawing.
 *
 * `excludeAreaId` keeps the area being edited out of its own backdrop.
 */
export async function branchGeometryForAreas(
  branchId: number,
  excludeAreaId?: number,
): Promise<DeliveryAreaBranchGeometry | null> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, latitude: true, longitude: true, deliveryRadiusKm: true },
  });
  if (!branch) return null;
  const siblings = await prisma.branchDeliveryArea.findMany({
    where: {
      branchId,
      shape: { not: null },
      ...(excludeAreaId ? { id: { not: excludeAreaId } } : {}),
    },
    select: { id: true, name: true, shape: true },
    orderBy: { name: "asc" },
  });
  return {
    id: branch.id,
    name: branch.name,
    lat: branch.latitude != null ? Number(branch.latitude) : null,
    lng: branch.longitude != null ? Number(branch.longitude) : null,
    maxRadiusKm: Number(branch.deliveryRadiusKm),
    siblings,
  };
}
