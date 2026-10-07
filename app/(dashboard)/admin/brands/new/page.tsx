import type { Metadata } from "next";

import { BrandForm } from "@/components/brands/brand-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("brandsAdmin.newBrand") };
}

/** /admin/brands/new — add a brand. */
export default async function NewBrandPage() {
  const { t } = await getT();
  await requireRole("super_admin");
  return (
    <>
      <PageHeader
        title={t("brandsAdmin.newBrand")}
        subtitle={t("brandsAdmin.newBrandSub")}
        breadcrumbs={[{ label: t("brandsAdmin.title"), href: "/admin/brands" }, { label: t("brandsAdmin.newBrand") }]}
      />
      <Card className="max-w-3xl">
        <CardContent>
          <BrandForm />
        </CardContent>
      </Card>
    </>
  );
}
