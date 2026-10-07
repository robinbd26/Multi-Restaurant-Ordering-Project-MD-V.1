import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HoursEditor } from "@/components/branch/hours-editor";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { ApiError } from "@/lib/http/errors";
import { getT } from "@/lib/i18n/server";
import { branchSchedule } from "@/lib/services/branch-schedule";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("bmExtras.hoursTitle") };
}

/** /admin/branches/[id]/hours — the super admin edits any branch's hours. */
export default async function AdminBranchHoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  await requireRole("super_admin");
  const { id } = await params;
  let view;
  try {
    view = await branchSchedule((await getSessionUser())!, Number(id));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return (
    <>
      <PageHeader
        title={t("bmExtras.hoursTitle")}
        subtitle={view.branch.name}
        breadcrumbs={[
          { label: t("pages.branchesTitle"), href: "/admin/branches" },
          { label: view.branch.name, href: `/admin/branches/${view.branch.id}` },
          { label: t("bmExtras.hoursTitle") },
        ]}
      />
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
