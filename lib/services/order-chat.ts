import "server-only";
import { readFile } from "node:fs/promises";

import type { OrderChat, OrderChatMessage, Prisma, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { conflict, forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { saveUpload } from "@/lib/http/upload";
import {
  CHAT_PHOTO_MAX_MB,
  RIDER_QUICK_REPLIES,
  chatAccessFor,
  chatReadOnlyAt,
  deliveryContactActive,
  isChatReadOnly,
  isRiderQuickReply,
  isTerminalStatus,
  type ChatAccess,
  type ChatRole,
} from "@/lib/order-chat/policy";
import { createNotification } from "@/lib/services/notifications";
import { pushToUsers } from "@/lib/services/push";
import { contentTypeFor, resolveUploadPath } from "@/lib/upload/paths";
import { uploadVariantKey } from "@/lib/upload/variants";
import { LIMITS } from "@/lib/validation/limits";

/**
 * Per-order chat (docs/order-chat-plan.md).
 *
 * One chat per order. Who is in it is decided by `chatAccessFor`
 * (lib/order-chat/policy.ts) from the order itself — the customer, the manager
 * of the order's branch, and on a delivery order whoever `order.riderId` names
 * right now — so a replaced rider loses access the moment the order moves on,
 * with no member list to keep in sync. The super admin reads, never posts.
 *
 * Every route goes through `chatContext()`, which loads the order, applies that
 * rule and throws 403 before anything else happens.
 */

/** Storage folder for chat photos. Private: /api/uploads refuses it outright. */
export const CHAT_PHOTO_SUBDIR = "chat_photos";
const CHAT_PHOTO_MAX_BYTES = CHAT_PHOTO_MAX_MB * 1024 * 1024;
/** The small copy saveUpload() writes for chat photos (lib/upload/variants.ts). */
export const CHAT_PHOTO_THUMB_WIDTH = 320;

/** A participant polled this recently is looking at the chat: no notification, no push. */
const PRESENCE_WINDOW_MS = 15_000;
/** Polls come every few seconds; the "seen" stamp only needs rewriting this often. */
const SEEN_WRITE_EVERY_MS = 5_000;
/** First load returns the latest N messages; later polls only what is newer. */
const INITIAL_PAGE = 200;
/** Notification/push preview length (the push layer clamps again). */
const PREVIEW_MAX = 140;

const PERSON = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  phone: true,
  profilePhoto: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type Person = Prisma.UserGetPayload<{ select: typeof PERSON }>;

const ORDER_FOR_CHAT = {
  customer: { select: PERSON },
  rider: { select: PERSON },
  branch: {
    select: { id: true, name: true, phone: true, pickupPhone: true, managerId: true, manager: { select: PERSON } },
  },
  // The latest offer decides whether the delivery is "active" for phone numbers.
  assignments: { orderBy: { createdAt: "desc" as const }, take: 1, select: { riderId: true, status: true } },
  chat: true,
} satisfies Prisma.OrderInclude;

type ChatOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_FOR_CHAT }>;

export interface ChatContext {
  order: ChatOrder;
  access: ChatAccess;
  chat: OrderChat;
}

function fullName(p: Pick<Person, "firstName" | "lastName" | "username">): string {
  return `${p.firstName} ${p.lastName}`.trim() || p.username;
}

/**
 * A param value starting with "@:" is resolved as a dictionary key when a
 * notification is rendered (lib/services/notifications.ts). A person's name is
 * user-controlled, so it must never be able to smuggle one in.
 */
function safeParam(value: string): string {
  return value.replace(/^(?:@:)+/, "");
}

/**
 * Load the order and decide the viewer's place in its chat. Throws 404 for a
 * missing order and 403 for anyone who is not a participant or the super admin.
 * The chat row is created on first access for orders placed before chats
 * existed, and an old order's end time is filled in once.
 */
export async function chatContext(user: Pick<User, "id" | "role">, orderId: number): Promise<ChatContext> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw notFound(sk("errors.orders.orderNotFound"));
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: ORDER_FOR_CHAT });
  if (!order) throw notFound(sk("errors.orders.orderNotFound"));
  const access = chatAccessFor(user, {
    customerId: order.customerId,
    riderId: order.riderId,
    fulfillmentType: order.fulfillmentType,
    branchManagerId: order.branch.managerId,
  });
  if (!access) throw forbidden(sk("errors.orderChat.noAccess"));
  return { order, access, chat: await ensureChat(order) };
}

async function ensureChat(order: ChatOrder): Promise<OrderChat> {
  // upsert on the unique orderId: two first readers racing both get the one row.
  let chat = order.chat ?? (await prisma.orderChat.upsert({ where: { orderId: order.id }, create: { orderId: order.id }, update: {} }));
  if (!chat.endedAt && isTerminalStatus(order.status)) {
    // An order that ended before chats existed (or through a path that did not
    // stamp it): its end is the terminal status event, else its last update.
    const event = await prisma.orderStatusEvent.findFirst({
      where: { orderId: order.id, toStatus: order.status },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    chat = await prisma.orderChat.update({ where: { id: chat.id }, data: { endedAt: event?.createdAt ?? order.updatedAt } });
  }
  return chat;
}

// ── Lifecycle hooks (called inside the order services' transactions) ────

/** A new order opens its chat (customer + the branch manager). */
export async function openChatInTx(tx: Prisma.TransactionClient, orderId: number): Promise<void> {
  await tx.orderChat.create({ data: { orderId } });
}

/** The order reached delivered/cancelled: the 2-hour read-only clock starts. */
export async function markChatEndedInTx(tx: Prisma.TransactionClient, orderId: number, endedAt: Date): Promise<void> {
  await tx.orderChat.upsert({ where: { orderId }, create: { orderId, endedAt }, update: { endedAt } });
}

/**
 * The order's rider changed: "X (Rider) left the chat" / "Y (Rider) joined the
 * chat". Access itself follows `order.riderId`, which the caller updates in
 * the same transaction; these rows are the visible record of it.
 */
export async function recordRiderChangeInTx(
  tx: Prisma.TransactionClient,
  orderId: number,
  previousRiderId: number | null,
  nextRiderId: number | null,
): Promise<void> {
  if (previousRiderId === nextRiderId) return;
  const chat = await tx.orderChat.upsert({ where: { orderId }, create: { orderId }, update: {} });
  const ids = [previousRiderId, nextRiderId].filter((id): id is number => id != null);
  const people = await tx.user.findMany({ where: { id: { in: ids } }, select: PERSON });
  const nameOf = (id: number) => {
    const p = people.find((u) => u.id === id);
    return p ? safeParam(fullName(p)) : "";
  };
  const system = (riderId: number, event: "rider_left" | "rider_joined") => ({
    chatId: chat.id,
    senderId: riderId,
    senderRole: "system",
    kind: "system",
    body: event,
    params: { name: nameOf(riderId) },
  });
  // Left before joined, so the history reads in the order it happened.
  if (previousRiderId != null) await tx.orderChatMessage.create({ data: system(previousRiderId, "rider_left") });
  if (nextRiderId != null) await tx.orderChatMessage.create({ data: system(nextRiderId, "rider_joined") });
}

// ── Reading ─────────────────────────────────────────────────────────────

type MessageWithSender = OrderChatMessage & { sender: Person | null };

function imageUrl(orderId: number, messageId: number, width?: number): string {
  const base = `/api/orders/${orderId}/chat/messages/${messageId}/image`;
  return width ? `${base}?w=${width}` : base;
}

function serializeMessage(orderId: number, m: MessageWithSender) {
  return {
    id: m.id,
    kind: m.kind,
    sender: m.senderId,
    sender_name: m.sender ? fullName(m.sender) : "",
    sender_role: m.senderRole,
    sender_photo: m.sender?.profilePhoto ?? null,
    sender_photo_version: m.sender ? m.sender.updatedAt.toISOString() : null,
    // User-written text kept exactly as typed; a quick reply or system event is a key.
    body: m.body,
    params: (m.params ?? null) as Record<string, string> | null,
    image: m.imageKey ? imageUrl(orderId, m.id) : null,
    image_thumb: m.imageKey ? imageUrl(orderId, m.id, CHAT_PHOTO_THUMB_WIDTH) : null,
    created_at: m.createdAt.toISOString(),
  };
}

export type SerializedChatMessage = ReturnType<typeof serializeMessage>;

function participant(role: ChatRole, p: Person) {
  return {
    user: p.id,
    role,
    name: fullName(p),
    photo: p.profilePhoto ?? null,
    photo_version: p.updatedAt.toISOString(),
  };
}

function participantsOf(order: ChatOrder) {
  const list = [participant("customer", order.customer)];
  if (order.branch.manager) list.push(participant("branch_manager", order.branch.manager));
  if (order.fulfillmentType === "delivery" && order.rider) list.push(participant("rider", order.rider));
  return list;
}

export interface ChatContact {
  kind: "branch" | "customer" | "rider";
  name: string;
  phone: string;
}

/**
 * Numbers the viewer may dial from the chat. The branch's number is public.
 * The customer and the rider get each other's real numbers only during an
 * active delivery (`deliveryContactActive`) — enforced here, so a number the
 * rule withholds never leaves the server. The manager already sees both on
 * the order page; the super admin observes and gets none.
 */
export function contactsFor(ctx: ChatContext): ChatContact[] {
  const { order, access } = ctx;
  const out: ChatContact[] = [];
  const branchPhone = order.branch.phone || order.branch.pickupPhone;
  const active = deliveryContactActive({
    fulfillmentType: order.fulfillmentType,
    status: order.status,
    riderId: order.riderId,
    latestAssignment: order.assignments[0] ?? null,
  });
  const riderShown = order.fulfillmentType === "delivery" && order.rider;

  if (access.role === "customer") {
    if (branchPhone) out.push({ kind: "branch", name: order.branch.name, phone: branchPhone });
    if (active && riderShown && order.rider?.phone) out.push({ kind: "rider", name: fullName(order.rider), phone: order.rider.phone });
  } else if (access.role === "rider") {
    if (active && order.customer.phone) out.push({ kind: "customer", name: fullName(order.customer), phone: order.customer.phone });
    if (branchPhone) out.push({ kind: "branch", name: order.branch.name, phone: branchPhone });
  } else if (access.role === "branch_manager") {
    if (order.customer.phone) out.push({ kind: "customer", name: fullName(order.customer), phone: order.customer.phone });
    if (riderShown && order.rider?.phone) out.push({ kind: "rider", name: fullName(order.rider), phone: order.rider.phone });
  }
  return out;
}

/** The in-app path each participant uses to open this chat. */
function chatLinkFor(role: ChatRole, orderId: number): string {
  const base = role === "customer" ? "/customer" : role === "rider" ? "/rider" : "/branch-manager";
  return `${base}/orders/${orderId}#order-chat`;
}

/**
 * Chat state plus messages newer than `afterId` (the latest page on first load).
 * Polled every few seconds by an open chat; also records that the viewer has
 * seen it, which keeps notifications quiet while they are looking.
 */
export async function readChat(user: Pick<User, "id" | "role">, orderId: number, afterId = 0) {
  const ctx = await chatContext(user, orderId);
  const { order, access, chat } = ctx;

  const after = Number.isSafeInteger(afterId) && afterId > 0 ? afterId : 0;
  const rows = after
    ? await prisma.orderChatMessage.findMany({
        where: { chatId: chat.id, id: { gt: after } },
        orderBy: { id: "asc" },
        take: INITIAL_PAGE,
        include: { sender: { select: PERSON } },
      })
    : (
        await prisma.orderChatMessage.findMany({
          where: { chatId: chat.id },
          orderBy: { id: "desc" },
          take: INITIAL_PAGE,
          include: { sender: { select: PERSON } },
        })
      ).reverse();

  if (access.role !== "observer") {
    await markSeen(chat.id, user.id, access.role, order.id, rows.at(-1)?.id ?? 0);
  }

  const readOnly = isChatReadOnly(chat.endedAt);
  return {
    chat: {
      id: chat.id,
      order: order.id,
      order_number: order.orderNumber ?? null,
      branch_name: order.branch.name,
      fulfillment_type: order.fulfillmentType,
      viewer_role: access.role,
      can_send: access.canWrite && !readOnly,
      read_only: readOnly,
      ended_at: chat.endedAt ? chat.endedAt.toISOString() : null,
      read_only_at: chatReadOnlyAt(chat.endedAt)?.toISOString() ?? null,
    },
    participants: participantsOf(order),
    contacts: contactsFor(ctx),
    quick_replies: access.role === "rider" && !readOnly ? [...RIDER_QUICK_REPLIES] : [],
    messages: rows.map((m) => serializeMessage(order.id, m)),
  };
}

/**
 * Stamp presence + read position (throttled: polls are frequent), and clear
 * this person's unread chat notification for the order — they are reading it.
 */
async function markSeen(chatId: number, userId: number, role: ChatRole, orderId: number, newestId: number): Promise<void> {
  const now = new Date();
  const row = await prisma.orderChatRead.findUnique({ where: { chatId_userId: { chatId, userId } } });
  const stale = !row || now.getTime() - row.lastSeenAt.getTime() >= SEEN_WRITE_EVERY_MS;
  const advanced = newestId > (row?.lastReadMessageId ?? 0);
  if (!stale && !advanced) return;
  await prisma.orderChatRead.upsert({
    where: { chatId_userId: { chatId, userId } },
    create: { chatId, userId, lastSeenAt: now, lastReadMessageId: newestId },
    update: { lastSeenAt: now, ...(advanced ? { lastReadMessageId: newestId } : {}) },
  });
  await prisma.notification.updateMany({
    where: { userId, type: "chat", link: chatLinkFor(role, orderId), isRead: false },
    data: { isRead: true, readAt: now },
  });
}

// ── Sending ─────────────────────────────────────────────────────────────

export interface SendInput {
  /** Text, or a photo's optional caption. */
  text?: string;
  /** A rider quick-reply key (lib/order-chat/policy.ts#RIDER_QUICK_REPLIES). */
  quick?: string;
  image?: File | null;
}

/** Post a text, photo or (riders) quick-reply message. */
export async function sendChatMessage(user: User, orderId: number, input: SendInput) {
  const ctx = await chatContext(user, orderId);
  const { access, chat, order } = ctx;
  if (!access.canWrite) throw forbidden(sk("errors.orderChat.observerReadOnly"));
  if (isChatReadOnly(chat.endedAt)) throw conflict(sk("errors.orderChat.closed"));

  const text = String(input.text ?? "").trim();
  if (text.length > LIMITS.longTextMax) {
    throw validationError({ body: sk("validation.maxLength", { n: LIMITS.longTextMax }) });
  }

  let data: Prisma.OrderChatMessageUncheckedCreateInput;
  if (input.image) {
    // Checked before sharp decodes anything; saveUpload() then validates the
    // type and re-encodes to WebP, exactly as for every other upload.
    if (input.image.size > CHAT_PHOTO_MAX_BYTES) {
      throw validationError({ image: sk("errors.orderChat.photoTooLarge", { mb: CHAT_PHOTO_MAX_MB }) });
    }
    const imageKey = await saveUpload(input.image, CHAT_PHOTO_SUBDIR, "image");
    data = { chatId: chat.id, senderId: user.id, senderRole: access.role, kind: "image", body: text, imageKey };
  } else if (input.quick !== undefined && input.quick !== "") {
    if (access.role !== "rider" || !isRiderQuickReply(input.quick)) {
      throw validationError({ quick: sk("errors.orderChat.quickReplyInvalid") });
    }
    data = { chatId: chat.id, senderId: user.id, senderRole: access.role, kind: "quick", body: input.quick };
  } else {
    if (!text) throw validationError({ body: sk("errors.orderChat.messageRequired") });
    data = { chatId: chat.id, senderId: user.id, senderRole: access.role, kind: "text", body: text };
  }

  const message = await prisma.orderChatMessage.create({ data, include: { sender: { select: PERSON } } });
  // Sending counts as reading: the sender has seen everything up to their own message.
  await markSeen(chat.id, user.id, access.role, order.id, message.id);
  await notifyRecipients(ctx, message, fullName(message.sender ?? { firstName: user.firstName, lastName: user.lastName, username: user.username }));
  return serializeMessage(order.id, message);
}

/**
 * Tell the other participants. Anyone polling the chat right now is skipped
 * (their open panel plays the sound instead). Everyone else gets ONE unread
 * inbox row per order chat; later messages only push, and share the push tag
 * (the link), so they replace each other on the lock screen instead of piling
 * up in the inbox. Chat is never muted by the customer's "order updates"
 * toggle: a rider's "I've arrived" is not a routine update.
 */
async function notifyRecipients(ctx: ChatContext, message: OrderChatMessage, senderName: string): Promise<void> {
  const { order, chat } = ctx;
  const recipients: { id: number; role: ChatRole }[] = [{ id: order.customerId, role: "customer" }];
  if (order.branch.managerId) recipients.push({ id: order.branch.managerId, role: "branch_manager" });
  if (order.fulfillmentType === "delivery" && order.riderId) recipients.push({ id: order.riderId, role: "rider" });
  const others = recipients.filter((r) => r.id !== message.senderId);
  if (others.length === 0) return;

  const since = new Date(Date.now() - PRESENCE_WINDOW_MS);
  const present = await prisma.orderChatRead.findMany({
    where: { chatId: chat.id, userId: { in: others.map((r) => r.id) }, lastSeenAt: { gte: since } },
    select: { userId: true },
  });
  const presentIds = new Set(present.map((p) => p.userId));

  const name = safeParam(senderName);
  const number = order.orderNumber ?? `#${order.id}`;
  const base = { type: "chat" as const, titleKey: "notifications.chat.newMessage.title" };
  const content: { body?: string; bodyKey?: string; params: Record<string, string> } =
    message.kind === "image"
      ? { bodyKey: "notifications.chat.newMessage.photo", params: { number, name } }
      : message.kind === "quick"
        ? { bodyKey: "notifications.chat.newMessage.quick", params: { number, name, reply: `@:orderChat.quick.${message.body}` } }
        : { body: `${name}: ${preview(message.body)}`, params: { number } };

  for (const r of others) {
    if (presentIds.has(r.id)) continue;
    const link = chatLinkFor(r.role, order.id);
    const input = { ...base, ...content, link };
    const unread = await prisma.notification.findFirst({
      where: { userId: r.id, type: "chat", link, isRead: false },
      select: { id: true },
    });
    if (unread) pushToUsers([r.id], input);
    else await createNotification(r.id, input);
  }
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= PREVIEW_MAX ? flat : `${flat.slice(0, PREVIEW_MAX - 1).trimEnd()}…`;
}

// ── Photos ──────────────────────────────────────────────────────────────

/**
 * The bytes of a chat photo, after the same read check as the chat itself. The
 * thumbnail falls back to the full image if its variant was never written.
 */
export async function chatImage(user: Pick<User, "id" | "role">, orderId: number, messageId: number, width: number | null) {
  const { chat } = await chatContext(user, orderId);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) throw notFound();
  const message = await prisma.orderChatMessage.findFirst({
    where: { id: messageId, chatId: chat.id, kind: "image" },
    select: { imageKey: true },
  });
  if (!message?.imageKey) throw notFound();

  const candidates = [
    width === CHAT_PHOTO_THUMB_WIDTH ? uploadVariantKey(message.imageKey, CHAT_PHOTO_THUMB_WIDTH) : null,
    message.imageKey,
  ].filter((k): k is string => Boolean(k));
  for (const key of candidates) {
    const abs = resolveUploadPath(key);
    if (!abs) continue;
    try {
      return { data: await readFile(abs), contentType: contentTypeFor(abs) };
    } catch {
      // Missing variant — try the next candidate.
    }
  }
  throw notFound();
}
