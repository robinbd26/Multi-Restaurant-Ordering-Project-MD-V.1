import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DeliveryAreaForm } from "@/components/delivery/delivery-area-form";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { branchGeometryForAreas } from "@/lib/services/area-geometry";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("deliveryArea.addTitle") };
}

/**
 * /admin/delivery-areas/new?branch=ID — draw a branch's area for the first
 * time. A branch has one area, so if it already has it this goes straight to
 * editing that one; without a valid branch it returns to the list, which is
 * where a branch is chosen.
 */
export default async function AdminNewDeliveryAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  await requireRole("super_admin");
  const branchId = Number((await searchParams).branch);
  const branch = Number.isSafeInteger(branchId)
    ? await prisma.branch.findFirst({
        where: { id: branchId, isActive: true, isArchived: false },
        select: { id: true, deliveryAreas: { select: { id: true } } },
      })
    : null;
  if (!branch) redirect("/admin/delivery-areas");
  if (branch.deliveryAreas[0]) redirect(`/admin/delivery-areas/${branch.deliveryAreas[0].id}/edit`);
  const geometry = (await branchGeometryForAreas(branch.id))!;
  return <DeliveryAreaForm geometry={geometry} isSuperAdmin backHref="/admin/delivery-areas" />;
}
