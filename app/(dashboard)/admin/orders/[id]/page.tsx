import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderChatPanel } from "@/components/orders/order-chat-panel";
import { OrderDetailCard } from "@/components/orders/order-detail-card";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/ui/button";
import { ApiError, getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import type { Order } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("pages.orderDetailTitle") };
}

/** /admin/orders/[id] — super admin read-only order detail (sees every order). */
export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const me = await requireRole("super_admin");
  const { id } = await params;

  let order: Order;
  try {
    order = await getJSON<Order>(`/orders/${id}/`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <PageHeader
        title={t("pages.orderDetailTitle")}
        subtitle={order.branch_name}
        breadcrumbs={[
          { label: t("pages.ordersTitle"), href: "/admin/orders" },
          { label: order.order_number || `#${order.id}` },
        ]}
        action={
          <ButtonLink href="/admin/orders" variant="outline">
            {t("pages.backToOrders")}
          </ButtonLink>
        }
      />
      <OrderDetailCard order={order} />
      {/* Read-only: the super admin can read any order's chat (disputes) but
          is not a participant — the server refuses posts and sends no alerts. */}
      <div className="mt-6">
        <OrderChatPanel orderId={order.id} viewerId={Number(me.id)} />
      </div>
    </>
  );
}
