import Image from "next/image";

import { OrderStatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/dictionaries";
import { mediaUrl } from "@/lib/utils";
import type { Order, OrderStatus } from "@/types";

const FLOW: OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "on_the_way",
  "delivered",
];

/**
 * ITEM 6 — a pickup order has no rider and no "on the way": the 7-step
 * delivery flow was built for a rail this order never travels. Five steps
 * instead, ending at "Picked Up (Done)" — the exact moment the customer walks
 * out with the food, which is what "delivered" already means for a pickup
 * order server-side (lib/services/orders.ts allows ready → delivered directly
 * for fulfillmentType "pickup", so a pickup order never actually sits at
 * "picked_up"/"on_the_way" going forward; PICKUP_STATUS_MAP only exists so an
 * order that reached one of those values before this change still renders
 * sensibly, at the final step).
 */
const PICKUP_FLOW: OrderStatus[] = ["pending", "accepted", "preparing", "ready", "delivered"];
const PICKUP_LABEL_KEY: Partial<Record<OrderStatus, string>> = {
  ready: "orderStatus.readyForPickup",
  delivered: "orderStatus.pickedUpDone",
};
const PICKUP_STATUS_MAP: Partial<Record<OrderStatus, OrderStatus>> = {
  picked_up: "delivered",
  on_the_way: "delivered",
  delayed: "delivered",
};

function StatusTimeline({
  status,
  pickup,
  t,
  fmt,
}: {
  status: OrderStatus;
  /** ITEM 6 — order.fulfillment_type === "pickup". Picks which flow renders. */
  pickup: boolean;
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
  const flow = pickup ? PICKUP_FLOW : FLOW;
  // WS-5.2 — a delayed order has not gone backwards: it is still on its way,
  // just later than promised. The timeline holds at the on-the-way step and an
  // amber notice above it explains the hold-up. (Pickup orders never reach
  // "delayed" — there is no rider to report one — but PICKUP_STATUS_MAP covers
  // it defensively all the same.)
  const effective: OrderStatus = pickup
    ? (PICKUP_STATUS_MAP[status] ?? status)
    : status === "delayed"
      ? "on_the_way"
      : status;
  const currentIndex = flow.indexOf(effective);
  return (
    <>
      {!pickup && status === "delayed" ? (
        <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25">
          {t("orders.orderDelayedNotice")}
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
              {t(pickup ? (PICKUP_LABEL_KEY[step] ?? `orderStatus.${step}`) : `orderStatus.${step}`)}
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
              <OrderStatusBadge status={order.status} />
            </span>
          }
          subtitle={`${order.branch_name} • ${fmt.dateTime(order.created_at)}`}
          action={children}
        />
        <CardContent>
          <StatusTimeline status={order.status} pickup={order.fulfillment_type === "pickup"} t={t} fmt={fmt} />
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
