import type { Metadata } from "next";

import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { CouponTable, type CouponRowT } from "@/components/marketing/coupon-table";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import type { Paginated } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("pages.couponsTitle") };
}

/**
 * /admin/coupons — PHASE 5. The super admin's own entry to the SAME coupon
 * system marketing uses (same API, form and table): every coupon on the
 * platform, platform-wide and branch-scoped alike, with its scope and state.
 */
export default async function AdminCouponsPage() {
  const { t } = await getT();
  await requireRole("super_admin");
  const data = await getJSON<Paginated<CouponRowT>>("/marketing/coupons/");

  return (
    <>
      <PageHeader
        title={t("pages.couponsTitle")}
        subtitle={t("marketingX.couponsSub")}
        action={
          <ButtonLink href="/admin/coupons/create">
            <Icon name="plus" className="size-4" /> {t("marketingX.newCoupon")}
          </ButtonLink>
        }
      />
      <Card>
        {data.results.length === 0 ? (
          <EmptyState
            title={t("marketingX.noCoupons")}
            description={t("marketingX.noCouponsDesc")}
            action={<ButtonLink href="/admin/coupons/create" size="sm">{t("marketingX.newCoupon")}</ButtonLink>}
          />
        ) : (
          <CouponTable coupons={data.results} editBase="/admin/coupons" showScope />
        )}
      </Card>
    </>
  );
}
