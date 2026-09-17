import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { CouponTable, type CouponRowT } from "@/components/marketing/coupon-table";
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
 * /branch-manager/coupons — ITEM 3: READ-ONLY. A branch manager sees which
 * coupons apply to their branch, but creating, editing, ending and deleting a
 * coupon is now super admin / marketing only (app/api/marketing/coupons/**).
 * No "+ New Coupon" action, no Edit/Delete column — there is nothing here for
 * a manager to act on, only to check.
 */
export default async function BranchManagerCouponsPage() {
  const { t } = await getT();
  await requireRole("branch_manager");
  const data = await getJSON<Paginated<CouponRowT>>("/marketing/coupons/");

  return (
    <>
      <PageHeader title={t("pages.couponsTitle")} subtitle={t("marketingX.branchCouponsSub")} />
      <Card>
        {data.results.length === 0 ? (
          <EmptyState title={t("marketingX.noCoupons")} description={t("marketingX.noCouponsReadOnlyDesc")} />
        ) : (
          <CouponTable coupons={data.results} editBase="/branch-manager/coupons" showScope={false} readOnly />
        )}
      </Card>
    </>
  );
}
