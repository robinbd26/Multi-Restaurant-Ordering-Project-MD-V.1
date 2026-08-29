import type { Metadata } from "next";

import { OrdersExplorer } from "@/components/orders/orders-explorer";
import { requireApiUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import type { RawSearchParams } from "@/lib/http/list-params";

export const metadata: Metadata = { title: "Orders" };

/**
 * /admin/orders — super admin read-only view of every order across all branches.
 * Shared explorer pages/search/filters on the server; RBAC via ordersWhereForUser.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireRole("super_admin");
  const me = await requireApiUser();
  const sp = await searchParams;

  return (
    <OrdersExplorer
      user={me}
      basePath="/admin/orders"
      dashboardHref="/admin/dashboard"
      hrefBase="/admin/orders"
      searchParams={sp}
    />
  );
}
