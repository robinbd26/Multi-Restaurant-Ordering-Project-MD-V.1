import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { OrderDetailCard } from "@/components/orders/order-detail-card";
import { DeliveryChatPanel } from "@/components/orders/delivery-chat-panel";
import { OrderStatusActions } from "@/components/orders/order-status-actions";
import { PaymentStatusCard, type OrderWithPayment } from "@/components/orders/payment-status-card";
import { LiveOrderRefresher } from "@/components/customer/live-order-refresh";
import { ReorderButton } from "@/components/customer/reorder-button";
import { LiveMap } from "@/components/rider/live-map";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ApiError, getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("customer.orderDetailTitle") };
}

export default async function CustomerOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const me = await requireRole("customer");
  const { t, fmt } = await getT();
  const { id } = await params;
  const { placed } = await searchParams;

  let order: OrderWithPayment;
  try {
    order = await getJSON<OrderWithPayment>(`/orders/${id}/`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  // WS-1.2 — an unpaid or rejected manual bKash payment is the most urgent
  // thing on this page: the food does not move until the branch sees the money,
  // so the panel goes ABOVE the order. Once nothing is owed it drops below,
  // where it stays purely as a record of where the payment stands.
  const paymentNeedsAction =
    order.payment_method === "bkash" &&
    (order.payment_status === "unpaid" || order.payment_status === "rejected");

  // WS-5.8 — "track order status in real time" must not mean "reload the page".
  // While the order can still change (in flight, or a bKash submission waiting
  // on the branch), a lean status poll re-renders this server page the moment
  // the timeline, rider, delay notice or payment verdict moves. A settled order
  // (delivered/cancelled with nothing pending) is history — no poll at all.
  const settled =
    (order.status === "delivered" || order.status === "cancelled") &&
    order.payment_status !== "pending_verification";

  return (
    <>
      {!settled ? (
        <LiveOrderRefresher
          orderId={order.id}
          initial={{
            status: order.status,
            payment_status: order.payment_status,
            rider: order.rider,
            updated_at: order.updated_at,
          }}
        />
      ) : null}
      <PageHeader
        title={t("customer.orderNumber", { id: fmt.num(order.id) })}
        subtitle={t("customer.trackOrder")}
        breadcrumbs={[
          { label: t("customer.ordersTitle"), href: "/customer/orders" },
          { label: order.order_number || `#${order.id}` },
        ]}
        action={
          order.status === "delivered" ? (
            <span className="flex items-center gap-2">
              <ButtonLink href="/customer/reviews" variant="outline" size="sm">
                {t("reviews.leaveReview")}
              </ButtonLink>
              <ReorderButton orderId={order.id} />
            </span>
          ) : undefined
        }
      />
      {placed === "1" ? (
        <Alert
          tone="success"
          className="mb-5"
          message={t("customer.orderPlacedSuccess")}
        />
      ) : null}
      {paymentNeedsAction ? (
        <div className="mb-6">
          <PaymentStatusCard order={order} />
        </div>
      ) : null}

      <OrderDetailCard order={order}>
        {/* Customer may cancel only while the order is still pending. */}
        <OrderStatusActions
          orderId={order.id}
          nextStatuses={order.status === "pending" ? ["cancelled"] : []}
        />
      </OrderDetailCard>

      {!paymentNeedsAction ? (
        <div className="mt-6">
          <PaymentStatusCard order={order} />
        </div>
      ) : null}

      {order.rider && order.status !== "delivered" && order.status !== "cancelled" ? (
        <Card className="mt-6">
          <CardHeader title={t("riderLoc.trackRider")} subtitle={order.rider_name ?? ""} />
          <CardContent>
            <LiveMap riderId={order.rider} mapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null} />
          </CardContent>
        </Card>
      ) : null}

      {order.rider ? (
        <Card className="mt-6">
          <CardHeader title={t("rider.deliveryChat")} subtitle={order.rider_name ?? ""} />
          <CardContent>
            <DeliveryChatPanel orderId={order.id} viewerId={Number(me.id)} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
