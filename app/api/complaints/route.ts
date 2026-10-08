import type { Prisma } from "@prisma/client";

import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { created, pageParams, paginated } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { serializeComplaint } from "@/lib/serializers";
import { COMPLAINT_INCLUDE, complaintsWhereForUser, createComplaint } from "@/lib/services/complaints";

// GET /api/complaints — role-scoped list (?status=&box=inbox|sent).
export const GET = handle(async (req: Request) => {
  const me = await requireApproved();
  const url = new URL(req.url);
  const { skip, take, page, pageSize } = pageParams(url);

  const scope = await complaintsWhereForUser(me);
  const where: Prisma.ComplaintWhereInput = { ...scope };
  const status = url.searchParams.get("status");
  const box = url.searchParams.get("box");
  if (status) where.status = status;
  // "sent" = complaints I filed; "inbox" = complaints addressed to my role.
  if (box === "sent") where.complainantId = me.id;
  if (box === "inbox") {
    if (me.role === "super_admin") {
      where.recipientRole = "super_admin";
    } else {
      where.complainantId = { not: me.id };
    }
  }

  const [count, items] = await Promise.all([
    prisma.complaint.count({ where }),
    prisma.complaint.findMany({ where, include: COMPLAINT_INCLUDE, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return paginated(items.map(serializeComplaint), { page, pageSize, count });
});

// POST /api/complaints — any approved user may file a complaint. JSON, or
// multipart (the customer form, which can attach up to 5 photos as "photos").
// For customers the recipient is decided on the server from the order.
export const POST = handle(async (req: Request) => {
  const me = await requireApproved();
  let body: {
    recipient_role?: string;
    branch_id?: number | null;
    order_id?: number | null;
    category?: string;
    subject?: string;
    message?: string;
  };
  let photos: File[] = [];
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const text = (key: string) => {
      const v = form.get(key);
      return typeof v === "string" ? v : undefined;
    };
    const num = (key: string) => {
      const v = Number(text(key));
      return Number.isSafeInteger(v) && v > 0 ? v : null;
    };
    body = {
      recipient_role: text("recipient_role"),
      branch_id: num("branch_id"),
      order_id: num("order_id"),
      category: text("category"),
      subject: text("subject"),
      message: text("message"),
    };
    photos = form.getAll("photos").filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
  } else {
    body = (await req.json().catch(() => ({}))) as typeof body;
  }

  const complaint = await createComplaint({
    complainantId: me.id,
    recipientRole: String(body.recipient_role ?? ""),
    branchId: body.branch_id ?? null,
    orderId: body.order_id ?? null,
    category: String(body.category ?? "other"),
    subject: String(body.subject ?? ""),
    message: String(body.message ?? ""),
    photos,
  });
  return created(serializeComplaint(complaint));
});
