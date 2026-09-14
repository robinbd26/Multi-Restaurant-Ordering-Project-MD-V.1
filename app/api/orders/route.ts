import type { Prisma } from "@prisma/client";

import { requireApproved } from "@/lib/auth/current-user";
import { forbidden, handle, sk, validationError } from "@/lib/http/errors";
import { created, pageParams, paginated } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { ORDER_INCLUDE, ordersWhereForUser } from "@/lib/selectors";
import { serializeOrder } from "@/lib/serializers";
import { createOrder } from "@/lib/services/orders";
import type { OrderItemInput } from "@/lib/services/orders";

// GET /api/orders — role-scoped list (?status=&branch=).
export const GET = handle(async (req: Request) => {
  const me = await requireApproved();
  const scope = await ordersWhereForUser(me);
  const url = new URL(req.url);
  const { skip, take, page, pageSize } = pageParams(url);

  if (scope === null) return paginated([], { page, pageSize, count: 0 });

  const where: Prisma.OrderWhereInput = { ...scope };
  const status = url.searchParams.get("status");
  const branchParam = url.searchParams.get("branch");
  const branch = branchParam ? Number(branchParam) : null;
  if (status) where.status = status;
  if (branch !== null && Number.isSafeInteger(branch) && branch > 0) {
    where.branchId = branch;
  }

  const [count, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return paginated(orders.map(serializeOrder), { page, pageSize, count });
});

// POST /api/orders — customers only. Checkout payload; prices come from the DB.
export const POST = handle(async (req: Request) => {
  const me = await requireApproved();
  if (me.role !== "customer") throw forbidden(sk("errors.orders.onlyCustomerCanOrder"));
  const body = (await req.json().catch(() => ({}))) as {
    branch_id?: number;
    payment_method?: string;
    delivery_address?: string;
    food_notes?: string;
    coupon_code?: string;
    // WS-7.1 — a reward voucher code. Only the CODE is accepted; the Taka value
    // and the customer it belongs to are read from the voucher row server-side.
    reward_code?: string;
    items?: OrderItemInput[];
    fulfillment_type?: string;
    // Self Pickup — the customer's requested pickup time (ISO string).
    pickup_time?: string;
    lat?: number;
    lng?: number;
    // WS-4.2 — a saved address the customer chose. The SERVER reads that row's
    // coordinates; lat/lng below are only used when no address was picked.
    customer_address_id?: number;
    // WS-4.2 — where the picker says the coordinate came from. Passed on as a
    // HINT: the service re-derives the provenance and can only downgrade it.
    coord_source?: string;
    delivery_area_id?: number;
    idempotency_key?: string;
  };

  if (!body.branch_id) throw validationError({ branch_id: sk("errors.orders.selectBranch") });
  if (!body.payment_method) throw validationError({ payment_method: sk("errors.orders.selectPaymentMethod") });
  if (!body.delivery_address) throw validationError({ delivery_address: sk("errors.orders.provideDeliveryAddress") });
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw validationError({ items: sk("errors.orders.addAtLeastOneProduct") });
  }

  const order = await createOrder({
    customerId: me.id,
    branchId: body.branch_id,
    items: body.items,
    paymentMethod: body.payment_method,
    deliveryAddress: body.delivery_address,
    foodNotes: body.food_notes ?? "",
    couponCode: body.coupon_code,
    rewardCode: body.reward_code ?? null,
    fulfillmentType: body.fulfillment_type,
    pickupTime: body.pickup_time ?? null,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    customerAddressId: body.customer_address_id ?? null,
    coordSourceHint: body.coord_source ?? null,
    deliveryAreaId: body.delivery_area_id ?? null,
    // PHASE R — optional per-attempt key; a retry with the same key returns
    // the order that already exists instead of creating a duplicate.
    idempotencyKey: body.idempotency_key ?? null,
  });
  const full = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
  return created(serializeOrder(full));
});
