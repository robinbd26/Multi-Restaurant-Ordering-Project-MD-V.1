import Image from "next/image";

import { OrderLocationMap } from "@/components/maps/order-location-map";
import { OrderStatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/dictionaries";
import { mediaUrl } from "@/lib/utils";
import type { Order, OrderStatus } from "@/types";

import { flowFor, orderStatusLabelKey } from "@/lib/constants/orders";
/**
 * The latest delay a rider announced on this order, if any: delays are events
 * on the status trail (from == to, reason "+30m · note"), not a status.
 */
function latestDelay(order: Order): { minutes: number; note: string } | null {
  const events = (order as Order & { status_events?: { from_status: string; to_status: string; reason: string }[] }).status_events ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const m = /^\+(\d+)m(?: · (.*))?$/.exec(ev.reason);
    if (ev.from_status === ev.to_status && m) return { minutes: Number(m[1]), note: m[2] ?? "" };
  }
  return null;
}

/**
 * The status timeline for the order's own channel: delivery runs Pending →
 * Accepted → Preparing → Ready for rider → Picked up → On the way → Delivered;
 * pickup runs Pending → Accepted → Preparing → Ready for collection → Collected
 * (lib/constants/orders.ts flowFor / orderStatusLabelKey).
 */
function StatusTimeline({
  status,
  pickup,
  delay,
  t,
  fmt,
}: {
  status: OrderStatus;
  /** order.fulfillment_type === "pickup". Picks which flow renders. */
  pickup: boolean;
  delay: { minutes: number; note: string } | null;
  t: TranslateFn;
  fmt: Formatters;
}) {
  if (status === "cancelled") {
    return (
      <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
        {t("orders.orderCancelledNotice")}
      </p>
    );
  }
  const flow = flowFor(pickup ? "pickup" : "delivery");
  // A legacy "delayed" status (before delays became announcements) reads as
  // its closest step; the migration moved those orders to on_the_way anyway.
  const effective: OrderStatus = status === "delayed" ? "on_the_way" : status;
  const currentIndex = flow.indexOf(effective);
  return (
    <>
      {!pickup && delay && (effective === "picked_up" || effective === "on_the_way") ? (
        <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25" data-testid="order-delay-notice">
          {t("orders.orderDelayedBy", { minutes: fmt.num(delay.minutes) })}
          {delay.note ? ` — ${delay.note}` : ""}
        </p>
      ) : null}
      <ol className="flex flex-wrap items-center gap-y-3" data-testid="order-status-timeline">
        {flow.map((step, i) => (
          <li key={step} className="flex items-center">
            <span
              className={
                i <= currentIndex
                  ? "flex size-7 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white"
                  : "flex size-7 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-fg-subtle"
              }
            >
              {fmt.num(i + 1)}
            </span>
            <span
              className={
                i <= currentIndex
                  ? "mx-2 text-xs font-medium text-fg-base"
                  : "mx-2 text-xs text-fg-subtle"
              }
            >
              {t(orderStatusLabelKey(step, pickup ? "pickup" : "delivery"))}
            </span>
            {i < flow.length - 1 ? (
              <span
                className={i < currentIndex ? "mr-2 h-0.5 w-5 bg-brand-400" : "mr-2 h-0.5 w-5 bg-slate-200"}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </>
  );
}

/** Full order details: timeline, items, addresses, totals. */
export async function OrderDetailCard({ order, children }: { order: Order; children?: React.ReactNode }) {
  const { t, fmt } = await getT();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-3">
              <span data-testid="order-number">
                {order.order_number ?? t("orders.orderNumber", { id: fmt.num(order.id) })}
              </span>
              <OrderStatusBadge status={order.status} fulfillment={order.fulfillment_type} />
            </span>
          }
          subtitle={`${order.branch_name} • ${fmt.dateTime(order.created_at)}`}
          action={children}
        />
        <CardContent>
          <StatusTimeline
            status={order.status}
            pickup={order.fulfillment_type === "pickup"}
            delay={latestDelay(order)}
            t={t}
            fmt={fmt}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("orders.orderItems")} />
          <CardContent className="divide-y divide-border-base p-0">
            {order.items.map((item) => {
              const img = mediaUrl(item.product_image);
              return (
                <div key={item.id} className="flex items-center gap-4 px-5 py-3.5">
                  {img ? (
                    <Image
                      src={img}
                      alt={item.product_name}
                      width={48}
                      height={48}
                      className="size-12 rounded-xl object-cover"
                    />
                  ) : (
                    <span className="flex size-12 items-center justify-center rounded-xl bg-surface-muted text-xl">
                      🍛
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg-base">{item.product_name}</p>
                    <p className="text-xs text-fg-muted">
                      {fmt.money(item.unit_price)} × {fmt.num(item.quantity)}
                      {item.food_note ? ` • ${item.food_note}` : ""}
                    </p>
                  </div>
                  <p className="font-semibold text-fg-base">{fmt.money(item.subtotal)}</p>
                </div>
              );
            })}
            <div className="flex items-center justify-between px-5 py-4">
              <p className="font-semibold text-fg-base">{t("orders.grandTotal")}</p>
              <p className="text-lg font-bold text-brand-600">{fmt.money(order.total_amount)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title={t("orders.deliveryInfo")} />
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("orders.customer")}</p>
              <p className="mt-1 font-medium text-fg-base">{order.customer_name || "—"}</p>
              <p className="text-fg-muted">{order.customer_phone || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("common.address")}</p>
              <p className="mt-1 text-fg-base">{order.delivery_address}</p>
              {/* Where it is actually going. The typed address can be vague;
                  the pin is what the order was priced and admitted from, and
                  the link hands it straight to a navigation app. Renders
                  nothing for pickup orders and for rows saved before pins. */}
              <OrderLocationMap
                className="mt-2"
                lat={order.delivery_lat}
                lng={order.delivery_lng}
                testId="order-delivery-map"
              />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("orders.payment")}</p>
              <p className="mt-1 text-fg-base">{t(`payment.${order.payment_method}`)}</p>
            </div>
            {order.prep_time_snapshot != null ? (
              <div data-testid="order-prep-estimate">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("b2.prepTimeLabel")}</p>
                <p className="mt-1 text-fg-base">{t("b2.estimateBeforeOrder", { minutes: order.prep_time_snapshot })}</p>
              </div>
            ) : null}
            {order.food_notes ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("orders.specialInstructions")}</p>
                <p className="mt-1 text-fg-base">{order.food_notes}</p>
              </div>
            ) : null}
            {/* ITEM 6 — a pickup order has no rider at all; "Not assigned yet"
                read as a promise one was coming. */}
            {order.fulfillment_type !== "pickup" ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("orders.rider")}</p>
                <p className="mt-1 text-fg-base">
                  {order.rider_name || t("orders.notAssignedYet")}
                  {order.rider_phone ? ` • ${order.rider_phone}` : ""}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
