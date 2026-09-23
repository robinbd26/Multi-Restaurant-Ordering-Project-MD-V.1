import type { Metadata } from "next";

import { DeliveryAreaForm } from "@/components/delivery/delivery-area-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { branchGeometryForAreas } from "@/lib/services/area-geometry";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("deliveryArea.addTitle") };
}

/**
 * /admin/delivery-areas/new — the super admin draws an area for ANY branch.
 *
 * The branch is chosen BEFORE the form, not inside it: an area is a shape drawn
 * around a specific branch pin and bounded by that branch's radius, so there is
 * nothing to draw on until we know which branch. The list's "Add" button
 * carries the branch it is filtered by, so the common path skips this step.
 */
export default async function AdminNewDeliveryAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const { t } = await getT();
  await requireRole("super_admin");
  const branches = await prisma.branch.findMany({
    where: { isActive: true, isArchived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, latitude: true, longitude: true },
  });

  const requested = Number((await searchParams).branch);
  const branchId = branches.some((b) => b.id === requested) ? requested : null;
  const geometry = branchId ? await branchGeometryForAreas(branchId) : null;

  if (!geometry) {
    return (
      <>
        <PageHeader title={t("deliveryArea.addTitle")} subtitle={t("deliveryArea.pickBranchFirst")} />
        <Card className="max-w-3xl">
          <CardHeader title={t("deliveryArea.branch")} />
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {branches.map((branch) => (
              <ButtonLink
                key={branch.id}
                href={`/admin/delivery-areas/new?branch=${branch.id}`}
                variant="outline"
                className="justify-between"
                data-testid={`pick-branch-${branch.id}`}
              >
                <span>{branch.name}</span>
                {/* A branch with no pin cannot anchor a shape; say so here
                    rather than letting the admin reach a dead editor. */}
                {branch.latitude == null || branch.longitude == null ? (
                  <span className="text-xs text-amber-600">{t("deliveryArea.noBranchPin")}</span>
                ) : null}
              </ButtonLink>
            ))}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <DeliveryAreaForm
      mode="create"
      geometry={geometry}
      listPath="/admin/delivery-areas"
      isSuperAdmin
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      assignedBranch={{ id: geometry.id, name: geometry.name }}
    />
  );
}
