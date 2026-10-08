import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { BranchCoverageMap } from "@/components/delivery/branch-coverage-map";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { parseShape } from "@/lib/coverage/shape";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { areaShapesForBranches, exclusionActive } from "@/lib/services/coverage";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("deliveryArea.title") };
}

/**
 * /admin/delivery-areas — every branch and its ONE delivery area.
 *
 * One row per live branch (not per area), because a branch has exactly one
 * area: either it is drawn, or the branch delivers nowhere yet. The overview
 * map above shows every area at once, which is how overlaps between branches
 * are seen.
 */
export default async function AdminDeliveryAreasPage() {
  const { t, fmt } = await getT();
  await requireRole("super_admin");
  const [branches, shapes] = await Promise.all([
    prisma.branch.findMany({
      where: { isActive: true, isArchived: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        deliveryAreas: { include: { exclusions: { select: { endsAt: true } } } },
      },
    }),
    areaShapesForBranches(),
  ]);

  return (
    <>
      <PageHeader title={t("deliveryArea.title")} subtitle={t("deliveryArea.subtitleAdmin")} />
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
      <Card className="mt-6 overflow-hidden">
        <ul className="divide-y divide-border-base" data-testid="area-branch-list">
          {branches.map((b) => {
            const area = b.deliveryAreas[0] ?? null;
            const shape = area ? parseShape(area.shape) : null;
            const blocks = area ? area.exclusions.filter((e) => exclusionActive(e)).length : 0;
            const pinless = b.latitude == null || b.longitude == null;
            return (
              <li
                key={b.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`area-branch-${b.id}`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-fg-base">{b.name}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    {pinless ? (
                      <Badge tone="amber">{t("deliveryArea.noBranchPin")}</Badge>
                    ) : !shape ? (
                      <Badge tone="amber">{t("deliveryArea.notDrawn")}</Badge>
                    ) : (
                      <span>
                        {shape.type === "Circle"
                          ? t("deliveryArea.circleOf", { km: fmt.num(shape.radiusKm.toFixed(1)) })
                          : t("deliveryArea.customShape")}
                      </span>
                    )}
                    {area ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>{fmt.money(area.deliveryCharge.toString())}</span>
                        <span aria-hidden>·</span>
                        <span>{t("deliveryArea.minutesN", { n: fmt.num(area.estimatedDeliveryMinutes) })}</span>
                        {!area.isActive ? <Badge tone="slate">{t("deliveryArea.inactiveBadge")}</Badge> : null}
                        {area.isHeld ? <Badge tone="red">{t("deliveryArea.onHold")}</Badge> : null}
                        {blocks > 0 ? <Badge tone="amber">{t("deliveryArea.blocksN", { n: fmt.num(blocks) })}</Badge> : null}
                      </>
                    ) : null}
                  </div>
                </div>
                <ButtonLink
                  href={area ? `/admin/delivery-areas/${area.id}/edit` : `/admin/delivery-areas/new?branch=${b.id}`}
                  variant={area ? "outline" : "primary"}
                  size="sm"
                  className="w-full sm:w-auto"
                >
                  {area ? t("deliveryArea.editArea") : t("deliveryArea.drawArea")}
                </ButtonLink>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
