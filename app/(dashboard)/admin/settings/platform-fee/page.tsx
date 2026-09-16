import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PlatformFeeManager, type PlatformFeePayload } from "@/components/wallet/platform-fee-manager";
import { getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("platformFee.title") };
}

/**
 * /admin/settings/platform-fee — PHASE 4. The flat fee every order pays, set
 * platform-wide with optional per-branch overrides. Loaded through the same API
 * route the form writes to, so the page and the API cannot disagree on shape.
 */
export default async function PlatformFeePage() {
  const { t } = await getT();
  await requireRole("super_admin");
  const initial = await getJSON<PlatformFeePayload>("/admin/settings/platform-fee/");

  return (
    <>
      <PageHeader title={t("platformFee.title")} subtitle={t("platformFee.subtitle")} />
      <PlatformFeeManager initial={initial} />
    </>
  );
}
