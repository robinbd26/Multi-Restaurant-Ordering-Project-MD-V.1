import "server-only";
import { after } from "next/server";
import { sendNotification, setVapidDetails, type RequestOptions } from "web-push";

import { prisma } from "@/lib/db";
import type { NotificationType } from "@/lib/constants/enums";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

/**
 * WS-6.1 — Web Push transport.
 *
 * This module is the ONLY place that talks to a push service. It is driven
 * exclusively from lib/services/notifications.ts: every in-app notification the
 * app already writes is mirrored to the recipient's registered browsers, so
 * there is one notification surface, not two. Nothing here decides WHO gets a
 * message — the notification service has already applied the `isOptional()` /
 * `notificationsEnabled` rule by the time we are called, which is exactly why
 * push inherits it for free (a disabled toggle still receives order, payment,
 * withdrawal, complaint and account pushes; only marketing is dropped).
 *
 * Demo-fallback rule (house requirement): with VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY / VAPID_SUBJECT unset, push is silently OFF and every entry
 * point below becomes a no-op. The in-app notification rows and the bell keep
 * working exactly as before. A HALF-filled block is refused with a loud
 * server-side warning rather than half working — same shape as the SMS driver
 * in lib/auth/sms.ts and the bKash block in lib/services/payments.ts.
 *
 * A push failure must NEVER surface to the caller: the notification write has
 * already happened and is the source of truth. Everything below swallows and
 * logs instead of throwing.
 */

// ── Tuning for prepaid 3G/4G handsets in Bangladesh ──────────────────────
// Payload text is clamped hard: a lock-screen notification shows roughly this
// much anyway, the whole message rides one encrypted push frame, and the tap
// target (`url`) opens the full record in the app.
const MAX_TITLE = 80;
const MAX_BODY = 160;
/** A food-delivery alert is worthless a day later — do not hoard it. */
const PUSH_TTL_SECONDS = 3600;
/** Consecutive transient failures tolerated before an endpoint is dropped. */
const MAX_FAILURES = 5;
/** `lastSeenAt` is a liveness hint, not an audit trail — refresh it at most this often. */
const LAST_SEEN_REFRESH_MS = 12 * 60 * 60 * 1000;
/** Recipients per subscription lookup (a marketing blast can target thousands). */
const USER_CHUNK = 200;
/** Simultaneous push-service requests — bounded so a blast cannot starve the VPS. */
const SEND_CONCURRENCY = 20;

/**
 * The notification fields push needs. Deliberately a LOCAL shape rather than an
 * import from lib/services/notifications.ts: that module imports this one, and
 * the dependency has to stay one-way.
 */
export interface PushMessage {
  type?: NotificationType;
  title?: string;
  body?: string;
  titleKey?: string | null;
  bodyKey?: string | null;
  params?: Record<string, string | number> | null;
  link?: string | null;
}

interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

// `undefined` = not resolved yet, `null` = resolved and push is OFF. Resolving
// once keeps the half-configured warning to a single line per process instead of
// one per notification.
let vapidConfig: VapidConfig | null | undefined;

/**
 * Resolve the VAPID credentials for this process. Never throws, never prompts a
 * caller to handle a missing key — an unconfigured deployment simply has no push.
 */
function vapid(): VapidConfig | null {
  if (vapidConfig !== undefined) return vapidConfig;

  const publicKey = (process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || "").trim();
  const subject = (process.env.VAPID_SUBJECT || "").trim();

  // Nothing configured at all — the documented default. Stay quiet.
  if (!publicKey && !privateKey && !subject) return (vapidConfig = null);

  if (!publicKey || !privateKey || !subject) {
    console.warn(
      "[push] VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required together — " +
        "web push stays OFF and in-app notifications continue as normal.",
    );
    return (vapidConfig = null);
  }

  try {
    // Validates the key pair and the subject; throws on a malformed value.
    // Global to the web-push module, so it is set exactly once.
    setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    console.warn(`[push] VAPID credentials were rejected (${String(err)}) — web push stays OFF.`);
    return (vapidConfig = null);
  }

  return (vapidConfig = { subject, publicKey, privateKey });
}

/** True when a real push transport is configured — drives the "can we deliver?" checks. */
export function isPushConfigured(): boolean {
  return vapid() !== null;
}

/**
 * The VAPID application server key the browser needs to build a subscription.
 * Public by definition (it is shipped to every client), null when push is off.
 */
export function pushPublicKey(): string | null {
  return vapid()?.publicKey ?? null;
}

// ── Subscription lifecycle ──────────────────────────────────────────────

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
}

/**
 * Register (or refresh) one browser's endpoint for a user.
 *
 * Keyed on `endpoint`, which is unique per browser install, so re-subscribing —
 * which every page load does — updates the existing row instead of piling up
 * duplicates. `userId` is re-pointed on update on purpose: a shared handset
 * where a second account signs in must move the endpoint to its new owner, not
 * keep pushing that person's orders to the previous account.
 */
export async function saveSubscription(userId: number, input: SubscriptionInput): Promise<void> {
  const seenAt = new Date();
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      lastSeenAt: seenAt,
    },
    update: {
      userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      lastSeenAt: seenAt,
      // A browser that can subscribe again is alive; forget the old failures.
      failureCount: 0,
    },
  });
}

/** Drop one of the caller's OWN endpoints (scoped by userId, never by endpoint alone). */
export async function removeSubscription(userId: number, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
}

// ── Send path ───────────────────────────────────────────────────────────

/**
 * Mirror one in-app notification to every browser the given users registered.
 *
 * Returns immediately: the fan-out is scheduled with `after()` so an order
 * status write never waits on a round trip to FCM. Outside a request scope
 * (scripts, seeds) `after()` throws, and the work simply runs detached instead.
 */
export function pushToUsers(userIds: number[], message: PushMessage): void {
  if (userIds.length === 0) return;
  if (!vapid()) return; // push not configured — in-app notifications carry on alone
  const ids = [...new Set(userIds)];
  schedule(async () => {
    await fanOut(ids, message);
  });
}

/** Run `work` off the response path, with every failure logged and swallowed. */
function schedule(work: () => Promise<void>): void {
  const guarded = () =>
    work().catch((err) => {
      console.error("[push] fan-out failed:", err);
    });
  try {
    after(guarded);
  } catch {
    // `after` was called outside a request scope (a script or a background job).
    // Nothing to defer to — just start it and let the guard above absorb errors.
    void guarded();
  }
}

async function fanOut(userIds: number[], message: PushMessage): Promise<void> {
  const payload = payloadFor(message);
  const options: RequestOptions = {
    TTL: PUSH_TTL_SECONDS,
    // Marketing may wait for the handset to wake on its own; anything
    // transactional (a new delivery, a payment, an announcement) may not.
    urgency: message.type === "marketing" ? "low" : "high",
  };

  for (let i = 0; i < userIds.length; i += USER_CHUNK) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds.slice(i, i + USER_CHUNK) } },
    });
    for (let j = 0; j < subscriptions.length; j += SEND_CONCURRENCY) {
      await Promise.all(
        subscriptions.slice(j, j + SEND_CONCURRENCY).map((sub) => deliver(sub, payload, options)),
      );
    }
  }
}

type StoredSubscription = Awaited<ReturnType<typeof prisma.pushSubscription.findMany>>[number];

/** Deliver to one endpoint. Never rejects — the outcome is recorded on the row. */
async function deliver(
  sub: StoredSubscription,
  payload: string,
  options: RequestOptions,
): Promise<void> {
  try {
    await sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      options,
    );
    await markDelivered(sub);
  } catch (err) {
    await markFailed(sub, err);
  }
}

/**
 * web-push rejects with a WebPushError carrying the push service's status code.
 * Read it structurally rather than with `instanceof`: the class identity travels
 * through a CJS/ESM interop boundary here, the status code does not.
 */
function statusOf(err: unknown): number | null {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === "number" ? code : null;
}

async function markDelivered(sub: StoredSubscription): Promise<void> {
  const stale = !sub.lastSeenAt || Date.now() - sub.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS;
  // Skip the write in the common case — one UPDATE per push per device would
  // dominate the cost of a campaign that is otherwise pure network.
  if (!stale && sub.failureCount === 0) return;
  await touch(prisma.pushSubscription.updateMany({
    where: { id: sub.id },
    data: { lastSeenAt: new Date(), failureCount: 0 },
  }));
}

async function markFailed(sub: StoredSubscription, err: unknown): Promise<void> {
  const status = statusOf(err);

  // 404 / 410 — the push service has permanently forgotten this endpoint
  // (browser uninstalled, permission revoked, subscription rotated). It will
  // never work again, so prune it now rather than retrying it forever.
  if (status === 404 || status === 410) {
    await touch(prisma.pushSubscription.deleteMany({ where: { id: sub.id } }));
    return;
  }

  // Anything else (429, 5xx, a dropped socket on a flaky uplink) may well be
  // transient, so it costs a strike instead of the row. `failureCount` is reset
  // by the next success or by the browser re-subscribing.
  const failures = sub.failureCount + 1;
  if (failures >= MAX_FAILURES) {
    console.warn(
      `[push] dropping a subscription for user ${sub.userId} after ${failures} consecutive failures ` +
        `(last status: ${status ?? "network error"}).`,
    );
    await touch(prisma.pushSubscription.deleteMany({ where: { id: sub.id } }));
    return;
  }
  await touch(prisma.pushSubscription.updateMany({
    where: { id: sub.id },
    data: { failureCount: failures },
  }));
}

/**
 * Bookkeeping writes are best-effort. `updateMany`/`deleteMany` already tolerate
 * a row that vanished mid-flight; this absorbs the rest (a locked SQLite file,
 * a dropped connection) so it can never take down the fan-out.
 */
async function touch(op: Promise<unknown>): Promise<void> {
  try {
    await op;
  } catch (err) {
    console.warn("[push] could not record a subscription outcome:", err);
  }
}

// ── Payload ─────────────────────────────────────────────────────────────

/**
 * Render the notification into the compact JSON public/sw.js expects.
 *
 * Notification rows are locale-agnostic (titleKey/bodyKey are translated at
 * RENDER time to whatever the viewer picked), but a service worker has no
 * dictionary and the schema has nowhere to record a per-device language. So the
 * push copy is rendered here in the app's DEFAULT locale — Bangla — which is
 * what the overwhelming majority of riders and customers read. Opening the
 * notification lands on the in-app record, which is translated properly.
 *
 * `body` and `url` are omitted when they are empty / "/" — the service worker
 * applies the same defaults, and every byte saved is a byte off a prepaid
 * handset's 3G bill.
 */
function payloadFor(message: PushMessage): string {
  const dict = getDictionary(DEFAULT_LOCALE);
  const vars = resolveParams(message.params);

  const title =
    clamp(message.titleKey ? translate(dict, message.titleKey, vars) : message.title ?? "", MAX_TITLE) ||
    "MAD DELIVERY HQ";
  const body = clamp(message.bodyKey ? translate(dict, message.bodyKey, vars) : message.body ?? "", MAX_BODY);
  // Only same-origin app paths are ever pushed — the service worker refuses
  // anything else, so a stored link can never be turned into an off-site jump.
  const url = message.link && message.link.startsWith("/") ? message.link : "/";

  const payload: { title: string; body?: string; url?: string; tag: string } = {
    title,
    // Group by destination so a burst of updates about ONE order replaces itself
    // on the lock screen instead of stacking; unrelated categories stay apart.
    tag: url !== "/" ? url : message.type ?? "system",
  };
  if (body) payload.body = body;
  if (url !== "/") payload.url = url;
  return JSON.stringify(payload);
}

/**
 * Resolve interpolation vars in the push locale, translating any value tagged
 * "@:<key>" (e.g. an order-status label like "@:orderStatus.preparing") first —
 * the same contract components/notifications/notification-list.tsx applies on
 * the client and lib/http/errors.ts applies to server messages.
 */
function resolveParams(params: PushMessage["params"]): Record<string, string | number> {
  const dict = getDictionary(DEFAULT_LOCALE);
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    out[key] = typeof value === "string" && value.startsWith("@:") ? translate(dict, value.slice(2)) : value;
  }
  return out;
}

function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
