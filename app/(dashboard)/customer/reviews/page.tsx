import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ReviewForm } from "@/components/customer/review-form";
import { ProductReviewForm, type MyReview } from "@/components/reviews/product-review-form";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { serializePublicReview } from "@/lib/services/product-reviews";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("reviews.title") };
}

/**
 * /customer/reviews — every dish the customer can review (anything from a
 * Delivered / Collected order), with their existing review ready to edit, plus
 * the per-order rider ratings as before.
 */
export default async function CustomerReviewsPage() {
  const { t, fmt } = await getT();
  const me = await requireRole("customer");
  const userId = Number(me.id);

  const [orders, riderReviews, myReviews] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: userId, status: "delivered" },
      include: { items: { include: { product: { select: { name: true } } } }, rider: true, riderReview: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.riderReview.findMany({
      where: { customerId: userId },
      include: { rider: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.foodReview.findMany({
      where: { customerId: userId },
      include: { customer: { select: { firstName: true, username: true, profilePhoto: true, updatedAt: true } } },
    }),
  ]);

  // Distinct products, most recently ordered first; reviewed ones keep their review.
  const reviewByProduct = new Map<number, MyReview>(
    myReviews.map((r) => [r.productId, { ...serializePublicReview(r), is_hidden: r.isHidden }]),
  );
  const products = new Map<number, string>();
  for (const order of orders) {
    for (const item of order.items) {
      if (!products.has(item.productId)) products.set(item.productId, item.product?.name || item.productName || "");
    }
  }
  const toRate = [...products.entries()].filter(([id]) => !reviewByProduct.has(id));
  const rated = [...products.entries()].filter(([id]) => reviewByProduct.has(id));
  const ridersPending = orders.filter((o) => o.riderId && o.rider && !o.riderReview);

  return (
    <>
      <PageHeader title={t("reviews.title")} subtitle={t("reviews.subtitle")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card testId="reviews-to-rate">
          <CardHeader title={t("reviews.pendingTitle")} subtitle={t("reviews.pendingSub")} />
          <CardContent className="space-y-3">
            {toRate.length === 0 && ridersPending.length === 0 ? (
              <EmptyState title={t("reviews.nonePending")} description={t("reviews.nonePendingDesc")} />
            ) : null}
            {toRate.map(([productId, name]) => (
              <ProductReviewForm key={productId} productId={productId} productName={name} />
            ))}
            {ridersPending.map((order) => (
              <ReviewForm
                key={`rider-${order.id}`}
                orderId={order.id}
                type="rider"
                targetLabel={t("reviews.riderLabel", {
                  name: `${order.rider!.firstName} ${order.rider!.lastName}`.trim() || order.rider!.username,
                })}
              />
            ))}
          </CardContent>
        </Card>

        <Card testId="reviews-given">
          <CardHeader title={t("reviews.givenTitle")} />
          <CardContent className="space-y-3">
            {rated.length === 0 && riderReviews.length === 0 ? (
              <EmptyState title={t("reviews.noneGiven")} description={t("reviews.noneGivenDesc")} />
            ) : null}
            {rated.map(([productId, name]) => (
              <ProductReviewForm key={productId} productId={productId} productName={name} initial={reviewByProduct.get(productId)!} />
            ))}
            {riderReviews.map((r) => (
              <div key={`r${r.id}`} className="rounded-xl border border-border-base p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-fg-base">
                    {t("reviews.riderLabel", { name: `${r.rider.firstName} ${r.rider.lastName}`.trim() || r.rider.username })}
                  </p>
                  <span className="shrink-0 text-amber-400">
                    {"★".repeat(r.rating)}
                    <span className="text-slate-300 dark:text-white/20">{"★".repeat(5 - r.rating)}</span>
                  </span>
                </div>
                {r.comment ? <p className="mt-0.5 text-sm text-fg-muted">{r.comment}</p> : null}
                <p className="mt-1 text-xs text-fg-subtle">{fmt.dateTime(r.createdAt.toISOString())}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
