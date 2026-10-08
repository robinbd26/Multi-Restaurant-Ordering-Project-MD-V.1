import { ProductReviewForm, type MyReview } from "@/components/reviews/product-review-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { serializePublicReview } from "@/lib/services/product-reviews";

/**
 * "Rate your items" on a Delivered / Collected order: one form per distinct
 * product in the order, pre-filled when the customer already reviewed it (one
 * review per product, so ordering again means editing, not duplicating).
 */
export async function RateOrderItems({ orderId, customerId }: { orderId: number; customerId: number }) {
  const { t } = await getT();
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { productId: true, productName: true, product: { select: { name: true } } },
  });
  const products = new Map<number, string>();
  for (const item of items) {
    if (!products.has(item.productId)) products.set(item.productId, item.product?.name || item.productName || "");
  }
  if (products.size === 0) return null;
  const reviews = await prisma.foodReview.findMany({
    where: { customerId, productId: { in: [...products.keys()] } },
    include: { customer: { select: { firstName: true, username: true, profilePhoto: true, updatedAt: true } } },
  });
  const byProduct = new Map<number, MyReview>(
    reviews.map((r) => [r.productId, { ...serializePublicReview(r), is_hidden: r.isHidden }]),
  );
  return (
    <Card className="mt-6" testId="rate-items">
      <div id="rate-items" className="scroll-mt-24" />
      <CardHeader title={t("reviews.rateItemsTitle")} subtitle={t("reviews.rateItemsSub")} />
      <CardContent className="space-y-3">
        {[...products.entries()].map(([productId, name]) => (
          <ProductReviewForm key={productId} productId={productId} productName={name} initial={byProduct.get(productId) ?? null} />
        ))}
      </CardContent>
    </Card>
  );
}
