import type { Metadata } from "next";
import Link from "next/link";

import { ComplaintStatusBadge } from "@/components/complaints/complaint-status-badge";
import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { complaintsWhereForUser } from "@/lib/services/complaints";
import { getT } from "@/lib/i18n/server";
import type { ComplaintStatus } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("marketingX.feedbackTitle") };
}

/**
 * /marketing/feedback — the customer/rider feedback marketing monitors.
 *
 * WS-7.6 — the "rider feedback" panel was actually CUSTOMERS RATING RIDERS,
 * mislabeled, and feedback riders themselves file (complaints addressed to
 * marketing) was absent from this page entirely. The ratings panel is now
 * labelled truthfully, and rider-FILED complaints are listed alongside it,
 * scoped through the complaints service's own visibility helper so this page
 * can never show marketing a complaint the complaints module would hide.
 */
export default async function MarketingFeedbackPage() {
  const { t, fmt } = await getT();
  await requireRole("marketing", "super_admin");
  // The full DB user (same pattern as ComplaintsView): the scope helper needs
  // more than the session projection carries.
  const me = await requireApiUser();

  // The service scope helper is the single authority on what marketing may see;
  // this page only narrows it to complaints a RIDER filed.
  const complaintScope = await complaintsWhereForUser(me);

  const [foodReviews, riderReviews, riderComplaints, foodAgg, riderAgg] = await Promise.all([
    prisma.foodReview.findMany({ include: { product: true, customer: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.riderReview.findMany({ include: { rider: true, customer: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.complaint.findMany({
      where: { AND: [complaintScope, { complainant: { role: "rider" } }] },
      include: { complainant: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.foodReview.aggregate({ _avg: { rating: true }, _count: true }),
    prisma.riderReview.aggregate({ _avg: { rating: true }, _count: true }),
  ]);

  const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
  const personName = (p: { firstName: string; lastName: string; username: string }) =>
    `${p.firstName} ${p.lastName}`.trim() || p.username;

  return (
    <>
      <PageHeader title={t("marketingX.feedbackTitle")} subtitle={t("marketingX.feedbackSub")} />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label={t("marketingX.avgFoodRating")} value={foodAgg._avg.rating ? foodAgg._avg.rating.toFixed(1) : "—"} icon={<Icon name="grid" />} accent="amber" />
        <StatCard label={t("marketingX.foodReviews")} value={fmt.num(foodAgg._count)} icon={<Icon name="list" />} accent="brand" />
        <StatCard label={t("marketingX.avgRiderRating")} value={riderAgg._avg.rating ? riderAgg._avg.rating.toFixed(1) : "—"} icon={<Icon name="bike" />} accent="green" />
        <StatCard label={t("marketingX.riderReviews")} value={fmt.num(riderAgg._count)} icon={<Icon name="users" />} accent="violet" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("marketingX.foodFeedback")} />
          {foodReviews.length === 0 ? (
            <EmptyState title={t("marketingX.noFeedback")} />
          ) : (
            <Table headers={[t("adminExtras.colProduct"), t("marketingX.rating"), t("marketingX.comment")]}>
              {foodReviews.map((r) => (
                <tr key={r.id} className="hover:bg-surface-hover/70">
                  <Td><span className="font-medium text-fg-base">{r.product?.name ?? "—"}</span></Td>
                  <Td><span className="text-amber-400">{stars(r.rating)}</span></Td>
                  <Td><span className="text-sm text-fg-muted">{r.comment || "—"}</span></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {/* Truthful label: these are customers rating riders, not rider feedback. */}
        <Card>
          <CardHeader title={t("marketingX.riderRatingsFromCustomers")} />
          {riderReviews.length === 0 ? (
            <EmptyState title={t("marketingX.noFeedback")} />
          ) : (
            <Table headers={[t("wallet.colRider"), t("marketingX.rating"), t("marketingX.comment")]}>
              {riderReviews.map((r) => (
                <tr key={r.id} className="hover:bg-surface-hover/70">
                  <Td>{personName(r.rider)}</Td>
                  <Td><span className="text-amber-400">{stars(r.rating)}</span></Td>
                  <Td><span className="text-sm text-fg-muted">{r.comment || "—"}</span></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {/* Feedback riders FILE — complaints addressed to marketing. */}
        <Card className="lg:col-span-2">
          <CardHeader
            title={t("marketingX.riderComplaints")}
            subtitle={t("marketingX.riderComplaintsSub")}
          />
          {riderComplaints.length === 0 ? (
            <EmptyState title={t("marketingX.noFeedback")} />
          ) : (
            <Table headers={[t("wallet.colRider"), t("complaints.subject"), t("common.status"), t("mgmtReports.col.date")]}>
              {riderComplaints.map((c) => (
                <tr key={c.id} className="hover:bg-surface-hover/70">
                  <Td>{personName(c.complainant)}</Td>
                  <Td>
                    <Link href={`/complaints/${c.id}`} className="font-medium text-fg-base hover:underline">
                      {c.subject}
                    </Link>
                  </Td>
                  <Td><ComplaintStatusBadge status={c.status as ComplaintStatus} /></Td>
                  <Td><span className="text-sm text-fg-muted">{fmt.date(c.createdAt.toISOString())}</span></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
