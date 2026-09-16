import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CouponForm } from "@/components/marketing/coupon-form";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { couponBranchOptions } from "@/lib/services/marketing";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("marketingX.newCoupon") };
}

/** /admin/coupons/create — a platform-wide or branch-scoped coupon. */
export default async function AdminCreateCouponPage() {
  const { t } = await getT();
  await requireRole("super_admin");
  const branches = await couponBranchOptions();

  return (
    <>
      <PageHeader
        title={t("marketingX.newCoupon")}
        subtitle={t("marketingX.couponsSub")}
        breadcrumbs={[
          { label: t("marketingX.couponsTitle"), href: "/admin/coupons" },
          { label: t("marketingX.newCoupon") },
        ]}
      />
      <Card className="max-w-2xl">
        <CardContent>
          <CouponForm initial={null} branches={branches} listPath="/admin/coupons" />
        </CardContent>
      </Card>
    </>
  );
}
