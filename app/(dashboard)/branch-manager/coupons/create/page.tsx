import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { CouponForm } from "@/components/marketing/coupon-form";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("marketingX.newCoupon") };
}

/** /branch-manager/coupons/create — a coupon valid at this manager's branch only. */
export default async function BranchManagerCreateCouponPage() {
  const { t } = await getT();
  await requireRole("branch_manager");
  const me = (await getSessionUser())!;
  const branch = await branchForManager(me.id);

  return (
    <>
      <PageHeader
        title={t("marketingX.newCoupon")}
        subtitle={t("marketingX.branchCouponsSub")}
        breadcrumbs={[
          { label: t("pages.couponsTitle"), href: "/branch-manager/coupons" },
          { label: t("marketingX.newCoupon") },
        ]}
      />
      <Card className="max-w-2xl">
        <CardContent>
          {branch ? (
            <CouponForm
              initial={null}
              lockedBranch={{ id: branch.id, name: branch.name }}
              listPath="/branch-manager/coupons"
            />
          ) : (
            <EmptyState title={t("common.notAssigned")} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
