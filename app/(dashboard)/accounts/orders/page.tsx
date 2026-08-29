import type { Metadata } from "next";

import { OrdersExplorer } from "@/components/orders/orders-explorer";
import { requireApiUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import type { RawSearchParams } from "@/lib/http/list-params";

export const metadata: Metadata = { title: "Orders" };

/** /accounts/orders — finance read-only view of all orders (transactions). */
export default async function AccountsOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireRole("accounts");
  const me = await requireApiUser();
  const sp = await searchParams;

  return (
    <OrdersExplorer
      user={me}
      basePath="/accounts/orders"
      dashboardHref="/accounts/dashboard"
      hrefBase={null}
      searchParams={sp}
    />
  );
}
