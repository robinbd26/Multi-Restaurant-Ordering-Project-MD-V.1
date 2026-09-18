import type { Metadata } from "next";

import { BranchForm } from "@/components/branches/branch-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { activeZonesWithLocalities } from "@/lib/services/area-master";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("branches.createTitle") };
}

export default async function BranchCreatePage() {
  await requireRole("super_admin");
  const { t } = await getT();
  // ITEM 7 — the master zone list, for the branch's location-tag field.
  const zones = await activeZonesWithLocalities();

  return (
    <>
      <PageHeader
        title={t("branches.createTitle")}
        subtitle={t("branches.createSubtitle")}
        breadcrumbs={[
          { label: t("pages.branchesTitle"), href: "/admin/branches" },
          { label: t("branches.createTitle") },
        ]}
      />
      <Card className="max-w-3xl">
        <CardContent className="py-6">
          <BranchForm zones={zones.map((z) => ({ id: z.id, name: z.name }))} />
        </CardContent>
      </Card>
    </>
  );
}
