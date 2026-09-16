import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { CouponForm, type CouponInitial } from "@/components/marketing/coupon-form";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, getJSON } from "@/lib/api/client";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("marketingX.editCoupon") };
}

type Params = { params: Promise<{ id: string }> };

/**
 * /branch-manager/coupons/[id]/edit — the API scopes the read to this manager's
 * branch, so another branch's coupon id is simply not found here.
 */
export default async function BranchManagerEditCouponPage({ params }: Params) {
  const { t } = await getT();
  await requireRole("branch_manager");
  const me = (await getSessionUser())!;
  const { id } = await params;
  const branch = await branchForManager(me.id);

  let coupon: CouponInitial;
  try {
    coupon = await getJSON<CouponInitial>(`/marketing/coupons/${id}/`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <PageHeader
        title={t("marketingX.editCoupon")}
        subtitle={coupon.code}
        breadcrumbs={[
          { label: t("pages.couponsTitle"), href: "/branch-manager/coupons" },
          { label: coupon.code },
          { label: t("common.edit") },
        ]}
      />
      <Card className="max-w-2xl">
        <CardContent>
          <CouponForm
            initial={coupon}
            lockedBranch={branch ? { id: branch.id, name: branch.name } : null}
            listPath="/branch-manager/coupons"
          />
        </CardContent>
      </Card>
    </>
  );
}
