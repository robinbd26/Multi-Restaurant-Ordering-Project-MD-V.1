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
 * /branch-manager/coupons — PHASE 5. The same coupon system marketing uses,
 * scoped by the API to this manager's own branch: they see, create and end only
 * coupons valid at their branch.
 */
export default async function BranchManagerCouponsPage() {
  const { t } = await getT();
  await requireRole("branch_manager");
  const data = await getJSON<Paginated<CouponRowT>>("/marketing/coupons/");

  return (
    <>
      <PageHeader
        title={t("pages.couponsTitle")}
        subtitle={t("marketingX.branchCouponsSub")}
        action={
          <ButtonLink href="/branch-manager/coupons/create" data-testid="bm-coupon-create">
            <Icon name="plus" className="size-4" /> {t("marketingX.newCoupon")}
          </ButtonLink>
        }
      />
      <Card>
        {data.results.length === 0 ? (
          <EmptyState
            title={t("marketingX.noCoupons")}
            description={t("marketingX.noCouponsDesc")}
            action={
              <ButtonLink href="/branch-manager/coupons/create" size="sm">
                {t("marketingX.newCoupon")}
              </ButtonLink>
            }
          />
        ) : (
          <CouponTable coupons={data.results} editBase="/branch-manager/coupons" showScope={false} />
        )}
      </Card>
    </>
  );
}
