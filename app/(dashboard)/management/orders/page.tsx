import type { Metadata } from "next";

import { OrdersExplorer } from "@/components/orders/orders-explorer";
import { requireApiUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import type { RawSearchParams } from "@/lib/http/list-params";

export const metadata: Metadata = { title: "Orders" };

/** /management/orders — management read-only operational view of all orders. */
export default async function ManagementOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireRole("management");
  const me = await requireApiUser();
  const sp = await searchParams;

  return (
    <OrdersExplorer
      user={me}
      basePath="/management/orders"
      dashboardHref="/management/dashboard"
      hrefBase={null}
      searchParams={sp}
    />
  );
}
