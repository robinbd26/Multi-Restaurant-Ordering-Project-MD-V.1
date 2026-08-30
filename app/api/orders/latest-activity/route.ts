import { requireApproved } from "@/lib/auth/current-user";
import { forbidden, handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { ordersWhereForUser } from "@/lib/selectors";

// Change fingerprint for the caller's whole order list. Mirrored by the local
// interface in components/customer/live-order-refresh.tsx — keep the two in
// step (route files must only export HTTP methods).
interface OrdersActivitySnapshot {
  count: number;
  latest: string | null;
}

// GET /api/orders/latest-activity — WS-5.8.
// The orders-LIST poll companion to /api/orders/[id]/status: two numbers that
// together change whenever anything in the caller's order scope changes (a new
// order appears → count moves; any existing order is written → its updatedAt
// becomes the new max). The list page compares consecutive snapshots and
// re-renders only on a real change, so the steady-state cost of keeping the
// list live is ~60 bytes per tick instead of the full paginated order payload.
export const GET = handle(async () => {
  const me = await requireApproved();
  const scope = await ordersWhereForUser(me);
  if (scope === null) throw forbidden();

  const [count, latest] = await Promise.all([
    prisma.order.count({ where: scope }),
    prisma.order.aggregate({ where: scope, _max: { updatedAt: true } }),
  ]);
  const snapshot: OrdersActivitySnapshot = {
    count,
    latest: latest._max.updatedAt ? latest._max.updatedAt.toISOString() : null,
  };
  return json(snapshot);
});
