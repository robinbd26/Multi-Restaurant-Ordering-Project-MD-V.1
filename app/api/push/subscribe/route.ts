import { requireApiUser } from "@/lib/auth/current-user";
import { badRequest, handle, sk } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { saveSubscription } from "@/lib/services/push";

/** Browser-supplied subscription, shaped exactly as `PushSubscription.toJSON()`. */
interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

// A push endpoint is a long URL owned by the browser vendor's push service
// (FCM, Mozilla, WNS). Cap it so a malformed client cannot write unbounded rows.
const MAX_ENDPOINT = 1000;
const MAX_KEY = 255;

function text(value: unknown, max: number): string {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value.trim() : "";
}

// POST /api/push/subscribe  { endpoint, keys: { p256dh, auth } }
//
// Registers this browser for the SIGNED-IN caller. Safe to call on every page
// load — it upserts on `endpoint`, so a re-subscribe refreshes the row instead
// of duplicating it (see saveSubscription).
export const POST = handle(async (req: Request) => {
  const me = await requireApiUser();
  const body = (await req.json().catch(() => ({}))) as SubscribeBody;

  const endpoint = text(body.endpoint, MAX_ENDPOINT);
  const p256dh = text(body.keys?.p256dh, MAX_KEY);
  const auth = text(body.keys?.auth, MAX_KEY);
  // Only real push-service endpoints, and both encryption keys or nothing —
  // a half-stored subscription would fail on every send and get pruned anyway.
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    throw badRequest(sk("errors.push.invalidSubscription"));
  }

  await saveSubscription(me.id, {
    endpoint,
    p256dh,
    auth,
    // Kept for support ("which of my devices is this?"), truncated because a
    // UA string is attacker-controlled free text.
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 255),
  });
  return json({ ok: true });
});
