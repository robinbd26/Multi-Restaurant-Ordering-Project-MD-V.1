import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BrandForm } from "@/components/brands/brand-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { allBrands } from "@/lib/services/brands";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("brandsAdmin.editBrand") };
}

/** /admin/brands/[id]/edit — edit a brand (its slug stays fixed). */
export default async function EditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  await requireRole("super_admin");
  const { id } = await params;
  const brand = (await allBrands()).find((b) => b.id === Number(id));
  if (!brand || brand.is_archived) notFound();
  return (
    <>
      <PageHeader
        title={t("brandsAdmin.editBrand")}
        subtitle={brand.name}
        breadcrumbs={[{ label: t("brandsAdmin.title"), href: "/admin/brands" }, { label: brand.name }]}
      />
      <Card className="max-w-3xl">
        <CardContent>
          <BrandForm brand={brand} />
        </CardContent>
      </Card>
    </>
  );
}
