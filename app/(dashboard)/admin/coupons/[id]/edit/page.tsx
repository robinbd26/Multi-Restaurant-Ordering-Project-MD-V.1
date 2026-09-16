import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CouponForm, type CouponInitial } from "@/components/marketing/coupon-form";
import { ApiError, getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { couponBranchOptions } from "@/lib/services/marketing";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("marketingX.editCoupon") };
}

type Params = { params: Promise<{ id: string }> };

/** /admin/coupons/[id]/edit — dedicated edit page. */
export default async function AdminEditCouponPage({ params }: Params) {
  const { t } = await getT();
  await requireRole("super_admin");
  const { id } = await params;

  let coupon: CouponInitial;
  try {
    coupon = await getJSON<CouponInitial>(`/marketing/coupons/${id}/`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const branches = await couponBranchOptions();

  return (
    <>
      <PageHeader
        title={t("marketingX.editCoupon")}
        subtitle={coupon.code}
        breadcrumbs={[
          { label: t("marketingX.couponsTitle"), href: "/admin/coupons" },
          { label: coupon.code },
          { label: t("common.edit") },
        ]}
      />
      <Card className="max-w-2xl">
        <CardContent>
          <CouponForm initial={coupon} branches={branches} listPath="/admin/coupons" />
        </CardContent>
      </Card>
    </>
  );
}
