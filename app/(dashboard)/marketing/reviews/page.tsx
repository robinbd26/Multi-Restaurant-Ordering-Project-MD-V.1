import type { Metadata } from "next";

import { ReviewsAdminPage } from "@/components/reviews/reviews-admin-page";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("reviews.adminTitle") };
}

/** /marketing/reviews — product reviews (scope and actions decided by role in the service). */
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("marketing", "super_admin");
  const me = (await getSessionUser())!;
  return <ReviewsAdminPage user={me} search={await searchParams} basePath="/marketing/reviews" />;
}
