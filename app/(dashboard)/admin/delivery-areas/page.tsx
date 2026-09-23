import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { DeliveryAreaExplorer } from "@/components/delivery/delivery-area-explorer";
import { BranchCoverageMap } from "@/components/delivery/branch-coverage-map";
import { Icon } from "@/components/layout/icons";
import { ButtonLink } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import {
  deliveryAreaQueryParams,
  parseDeliveryAreaQuery,
} from "@/lib/delivery-areas/query";
import { requireRole } from "@/lib/auth/session";
import { getSessionUser } from "@/lib/auth/current-user";
import { getT } from "@/lib/i18n/server";
import { areaShapesForBranches } from "@/lib/services/coverage";
import { deliveryAreaListForUser } from "@/lib/services/delivery-areas";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("deliveryArea.title") };
}

/** /admin/delivery-areas — super admin manages every branch's delivery areas. */
export default async function AdminDeliveryAreasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getT();
  await requireRole("super_admin");
  const me = (await getSessionUser())!;
  const query = parseDeliveryAreaQuery(await searchParams);
  const [initial, branches] = await Promise.all([
    deliveryAreaListForUser(me, query),
    prisma.branch.findMany({
      where: { isActive: true, isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, latitude: true, longitude: true },
    }),
  ]);
  // THE overview map: every branch and every shape on one canvas, which is the
  // only way to see overlaps between branches and gaps between them.
  const shapes = await areaShapesForBranches();
  const initialQuery = deliveryAreaQueryParams({
    ...query,
    page: initial.page,
    pageSize: initial.pageSize,
  }).toString();
  return (
    <>
      <PageHeader
        title={t("deliveryArea.title")}
        subtitle={t("deliveryArea.subtitleAdmin")}
        action={
          <ButtonLink
            href={query.branchId ? `/admin/delivery-areas/new?branch=${query.branchId}` : "/admin/delivery-areas/new"}
            className="w-full sm:w-auto"
          >
            <Icon name="plus" className="size-4" />
            {t("deliveryArea.addDeliveryArea")}
          </ButtonLink>
        }
      />
      <BranchCoverageMap
        title={t("deliveryArea.overviewMapTitle")}
        shapes={shapes}
        branches={branches.map((b) => ({
          id: b.id,
          name: b.name,
          lat: b.latitude != null ? Number(b.latitude) : null,
          lng: b.longitude != null ? Number(b.longitude) : null,
        }))}
      />
      <div className="mt-6" />
      <DeliveryAreaExplorer
        initial={initial}
        initialQuery={initialQuery}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        isSuperAdmin
        listPath="/admin/delivery-areas"
      />
    </>
  );
}
