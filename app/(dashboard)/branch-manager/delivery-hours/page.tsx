import type { Metadata } from "next";

import { HoursEditor } from "@/components/branch/hours-editor";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";
import { branchSchedule } from "@/lib/services/branch-schedule";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("bmExtras.hoursTitle") };
}

/**
 * /branch-manager/delivery-hours — this branch's ordering hours per brand
 * (slots with Delivery / Pickup boxes, every day or per weekday) and its
 * display-only dine-in hours. These schedules decide, on the Asia/Dhaka clock,
 * whether each brand takes delivery or pickup orders right now.
 */
export default async function DeliveryHoursPage() {
  const { t } = await getT();
  const me = await requireRole("branch_manager");
  const branch = await branchForManager(Number(me.id));
  if (!branch) {
    return (
      <>
        <PageHeader title={t("bmExtras.hoursTitle")} subtitle={t("hours.pageSub")} />
        <EmptyState title={t("errors.ops.noBranchAssigned")} />
      </>
    );
  }
  // The service checks, server-side, that this manager manages this branch.
  const view = await branchSchedule((await getSessionUser())!, branch.id);
  return (
    <>
      <PageHeader title={t("bmExtras.hoursTitle")} subtitle={t("hours.pageSub")} />
      <HoursEditor
        branchId={view.branch.id}
        branchName={view.branch.name}
        businessType={view.branch.business_type}
        brands={view.brands}
        dineIn={view.dine_in}
      />
    </>
  );
}
