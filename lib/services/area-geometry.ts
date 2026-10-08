import "server-only";

import { prisma } from "@/lib/db";
import type { DeliveryAreaBranchGeometry } from "@/components/delivery/delivery-area-form";

/**
 * Everything the drawing editor needs about the branch an area belongs to: the
 * pin every shape is measured from, the maximum radius nothing may cross, and
 * the OTHER branches' areas, drawn faintly so overlaps between branches are
 * visible while drawing (a branch has only one area of its own).
 */
export async function branchGeometryForAreas(branchId: number): Promise<DeliveryAreaBranchGeometry | null> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, latitude: true, longitude: true, deliveryRadiusKm: true },
  });
  if (!branch) return null;
  const siblings = await prisma.branchDeliveryArea.findMany({
    where: {
      branchId: { not: branchId },
      shape: { not: null },
      isActive: true,
      branch: { isActive: true, isArchived: false },
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
