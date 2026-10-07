import type { Metadata } from "next";

import { BrandsManager, type BrandRow } from "@/components/brands/brands-manager";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { allBrands, brandUsage } from "@/lib/services/brands";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("brandsAdmin.title") };
}

/**
 * /admin/brands — the brands sold on the platform, managed by the super admin.
 * Everything that shows a brand (homepage cards and tabs, branch and product
 * forms, filters, badges) reads this list, so adding a brand here is the whole
 * job: no code change.
 */
export default async function AdminBrandsPage() {
  const { t } = await getT();
  await requireRole("super_admin");
  const brands = await allBrands();
  const rows: BrandRow[] = await Promise.all(brands.map(async (b) => ({ ...b, usage: await brandUsage(b.id) })));
  return (
    <>
      <PageHeader title={t("brandsAdmin.title")} subtitle={t("brandsAdmin.subtitle")} />
      <BrandsManager brands={rows} />
    </>
  );
}
