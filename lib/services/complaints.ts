import "server-only";
import type { Prisma, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_RECIPIENTS,
  COMPLAINT_STATUSES,
} from "@/lib/constants/enums";
import { branchForManager } from "@/lib/selectors";
import { createNotification, notifyUsers } from "@/lib/services/notifications";
import { activeDutySession } from "@/lib/services/rider-duty";
import type { Role } from "@/types";

export const COMPLAINT_INCLUDE = {
  complainant: true,
  branch: true,
  assignedTo: true,
  _count: { select: { messages: true } },
} satisfies Prisma.ComplaintInclude;

export const COMPLAINT_DETAIL_INCLUDE = {
  complainant: true,
  branch: true,
  assignedTo: true,
  messages: { include: { sender: true }, orderBy: { createdAt: "asc" } },
  _count: { select: { messages: true } },
} satisfies Prisma.ComplaintInclude;

/** Which complaints a user may list/read. */
export async function complaintsWhereForUser(user: User): Promise<Prisma.ComplaintWhereInput> {
  switch (user.role) {
    case "super_admin":
      return {}; // sees everything
    case "management":
      // WS-8.6 — Management oversees EVERY complaint with its resolution
      // status (customer, rider, branch manager, staff), not only the ones
      // addressed to them: the previous clause whitelisted customer- and
      // branch-manager-filed complaints, which silently hid every rider
      // complaint addressed to a branch manager. Read scope only — replying
      // and status changes stay gated by `isComplaintHandler`.
      return {};
    case "marketing":
      // Oversight role (roles spec / features note 12): in addition to
      // complaints addressed to them, marketing can see all customer- and
      // branch-manager-filed complaints.
      return {
        OR: [
          { recipientRole: user.role },
          { complainantId: user.id },
          { complainant: { role: { in: ["customer", "branch_manager"] } } },
        ],
      };
    case "accounts":
      return { OR: [{ recipientRole: user.role }, { complainantId: user.id }] };
    case "branch_manager": {
      const branch = await branchForManager(user.id);
      const addressedToMe: Prisma.ComplaintWhereInput[] = [
        // WS-5.4 — a complaint whose branch could not be resolved (the
        // complainant has no order, duty session or branch of their own) is
        // still addressed to "branch manager", so every manager sees it.
        // Previously it matched branchId `-1` and therefore reached nobody.
        { recipientRole: "branch_manager", branchId: null },
      ];
      if (branch) addressedToMe.push({ recipientRole: "branch_manager", branchId: branch.id });
      return { OR: [...addressedToMe, { complainantId: user.id }] };
    }
    default: // rider, customer — only their own
      return { complainantId: user.id };
  }
}

/** True if a user is allowed to change status / reply as the recipient side. */
export async function isComplaintHandler(
  user: User,
  complaint: { recipientRole: string; branchId: number | null },
): Promise<boolean> {
  if (user.role === "super_admin") return true;
  if (user.role !== complaint.recipientRole) return false;
  if (user.role === "branch_manager") {
    // Mirror of the read scope above: an unrouted (branch-less) complaint is
    // handled by whichever manager picks it up, never by nobody.
    if (complaint.branchId === null) return true;
    const branch = await branchForManager(user.id);
    return branch?.id === complaint.branchId;
  }
  return true;
}

export async function createComplaint(input: {
  complainantId: number;
  recipientRole: string;
  branchId?: number | null;
  orderId?: number | null;
  category: string;
  subject: string;
  message: string;
}) {
  if (!COMPLAINT_RECIPIENTS.includes(input.recipientRole as Role)) {
    throw validationError({ recipient_role: sk("errors.ops.recipientInvalid") });
  }
  if (!COMPLAINT_CATEGORIES.includes(input.category as (typeof COMPLAINT_CATEGORIES)[number])) {
    throw validationError({ category: sk("errors.ops.categoryInvalid") });
  }
  if (!input.subject.trim()) throw validationError({ subject: sk("errors.ops.subjectRequired") });
  if (!input.message.trim()) throw validationError({ message: sk("errors.ops.complaintMessageRequired") });

  const complainant = await prisma.user.findUnique({ where: { id: input.complainantId } });
  if (!complainant) throw notFound();

  // WS-5.4 — the branch is resolved SERVER-SIDE from the complainant's own
  // context for every recipient role (not only branch_manager, and never from
  // the client's copy of it), so a complaint always lands on a real desk.
  const order = await complaintOrderFor(complainant, input.orderId ?? null);
  const branchId = await resolveComplaintBranchId(complainant, order, input.branchId ?? null);

  const complaint = await prisma.complaint.create({
    data: {
      complainantId: input.complainantId,
      recipientRole: input.recipientRole,
      branchId,
      orderId: order?.id ?? null,
      category: input.category,
      subject: input.subject.trim(),
      message: input.message.trim(),
    },
    include: COMPLAINT_INCLUDE,
  });

  // Notify the recipient side + Super Admin (who oversees all complaints).
  const handlers = await recipientUserIds(input.recipientRole, branchId);
  await notifyUsers(handlers, {
    type: "complaint",
    titleKey: "notifications.complaint.new.title",
    body: complaint.subject, // user-written subject — kept as typed
    link: complaintLink(complaint.id),
  });
  return complaint;
}

/** The minimal order shape a complaint routes on. */
type ComplaintOrder = { id: number; branchId: number };

/**
 * The order a complaint may reference. A client-supplied order id is only
 * honoured when the complainant actually took part in it (or already sees
 * every order, exactly like `ordersWhereForUser`); anything else answers
 * "order not found" rather than confirming another customer's order exists.
 */
async function complaintOrderFor(user: User, orderId: number | null): Promise<ComplaintOrder | null> {
  if (!orderId) return null;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, branchId: true, customerId: true, riderId: true },
  });
  if (!order) throw validationError({ order_id: sk("errors.ops.orderNotFound") });

  const oversees = user.role === "super_admin" || user.role === "management" || user.role === "accounts";
  if (oversees || order.customerId === user.id || order.riderId === user.id) {
    return { id: order.id, branchId: order.branchId };
  }
  if (user.role === "branch_manager") {
    const branch = await branchForManager(user.id);
    if (branch?.id === order.branchId) return { id: order.id, branchId: order.branchId };
  }
  throw validationError({ order_id: sk("errors.ops.orderNotFound") });
}

/**
 * The branch a complaint belongs to (WS-5.4). Routing by role alone left
 * `branchId` null for everyone except a branch manager complaining about their
 * own branch, and a null branch was invisible to every manager's scope — the
 * complaint reached nobody.
 *
 * Resolution order, most specific first:
 *   1. the related order's branch (server-read, never the client's copy);
 *   2. the branch this user manages;
 *   3. a rider's live duty branch, then their assigned home branch;
 *   4. the branch of their HR record (staff logins bridged to BranchEmployee);
 *   5. the branch of their latest order (customer or rider);
 *   6. a client hint, only if it names a real branch.
 * Null only when the complainant has no branch context at all — such a
 * complaint is broadcast to every branch manager instead of being orphaned.
 */
async function resolveComplaintBranchId(
  user: User,
  order: ComplaintOrder | null,
  hintedBranchId: number | null,
): Promise<number | null> {
  if (order) return order.branchId;

  const managed = await branchForManager(user.id);
  if (managed) return managed.id;

  if (user.role === "rider") {
    // The rider's own duty context is the single source of truth for "which
    // branch is this rider working for right now" (WS-5.5).
    const active = await activeDutySession(user.id);
    if (active) return active.branchId;
    const profile = await prisma.riderProfile.findUnique({
      where: { userId: user.id },
      select: { assignedBranchId: true },
    });
    if (profile?.assignedBranchId) return profile.assignedBranchId;
  }

  if (user.role !== "customer") {
    const employee = await prisma.branchEmployee.findUnique({
      where: { userId: user.id },
      select: { branchId: true },
    });
    if (employee) return employee.branchId;
  }

  if (user.role === "rider" || user.role === "customer") {
    const lastOrder = await prisma.order.findFirst({
      where: user.role === "rider" ? { riderId: user.id } : { customerId: user.id },
      orderBy: { createdAt: "desc" },
      select: { branchId: true },
    });
    if (lastOrder) return lastOrder.branchId;
  }

  if (hintedBranchId) {
    const branch = await prisma.branch.findUnique({ where: { id: hintedBranchId }, select: { id: true } });
    if (branch) return branch.id;
  }
  return null;
}

/**
 * Users who should act on a complaint of this recipientRole. A branch-scoped
 * complaint goes to that branch's managers; a branch-less one (nothing to
 * route on) goes to every manager, matching the read scope above.
 */
async function recipientUserIds(recipientRole: string, branchId: number | null): Promise<number[]> {
  const where: Prisma.UserWhereInput = { role: recipientRole, status: "approved", isActive: true };
  if (recipientRole === "branch_manager" && branchId) {
    where.managedBranches = { some: { id: branchId } };
  }
  const recipients = await prisma.user.findMany({ where, select: { id: true } });
  const superAdmins = await prisma.user.findMany({
    where: { role: "super_admin", isActive: true },
    select: { id: true },
  });
  return [...recipients.map((u) => u.id), ...superAdmins.map((u) => u.id)];
}

/** Every role opens complaint detail through the canonical shared route. */
function complaintLink(id: number): string {
  return `/complaints/${id}`;
}

export async function addComplaintMessage(complaintId: number, sender: User, body: string) {
  if (!body.trim()) throw validationError({ body: sk("errors.ops.messageRequired") });
  const complaint = await prisma.complaint.findUnique({ where: { id: complaintId } });
  if (!complaint) throw notFound();

  const isComplainant = complaint.complainantId === sender.id;
  const isHandler = await isComplaintHandler(sender, complaint);
  if (!isComplainant && !isHandler) throw forbidden();

  const msg = await prisma.complaintMessage.create({
    data: { complaintId, senderId: sender.id, body: body.trim() },
    include: { sender: true },
  });
  await prisma.complaint.update({ where: { id: complaintId }, data: { updatedAt: new Date() } });

  // Notify the other party.
  if (isComplainant) {
    const handlers = await recipientUserIds(complaint.recipientRole, complaint.branchId);
    await notifyUsers(handlers, {
      type: "complaint",
      titleKey: "notifications.complaint.newMessage.title",
      body: complaint.subject, // user-written subject — kept as typed
      link: complaintLink(complaint.id),
    });
  } else {
    await createNotification(complaint.complainantId, {
      type: "complaint",
      titleKey: "notifications.complaint.reply.title",
      body: complaint.subject, // user-written subject — kept as typed
      link: `/complaints/${complaint.id}`,
    });
  }
  return msg;
}

export async function changeComplaintStatus(complaintId: number, status: string, actor: User) {
  if (!COMPLAINT_STATUSES.includes(status as (typeof COMPLAINT_STATUSES)[number])) {
    throw validationError({ status: sk("errors.ops.statusInvalid") });
  }
  const complaint = await prisma.complaint.findUnique({ where: { id: complaintId } });
  if (!complaint) throw notFound();
  if (!(await isComplaintHandler(actor, complaint))) throw forbidden();

  const updated = await prisma.complaint.update({
    where: { id: complaintId },
    data: {
      status,
      assignedToId: complaint.assignedToId ?? actor.id,
    },
    include: COMPLAINT_INCLUDE,
  });
  await createNotification(complaint.complainantId, {
    type: "complaint",
    titleKey: "notifications.complaint.statusChanged.title",
    body: complaint.subject, // user-written subject — kept as typed
    link: `/complaints/${complaint.id}`,
  });
  return updated;
}
