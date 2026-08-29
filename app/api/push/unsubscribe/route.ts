import { requireApiUser } from "@/lib/auth/current-user";
import { badRequest, handle, sk } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { removeSubscription } from "@/lib/services/push";

// POST /api/push/unsubscribe  { endpoint }
//
// Forgets ONE browser. Scoped to the caller's own rows inside
// removeSubscription, so knowing another person's endpoint is not enough to
// switch their notifications off. Idempotent: unsubscribing twice is a no-op.
export const POST = handle(async (req: Request) => {
  const me = await requireApiUser();
  const body = (await req.json().catch(() => ({}))) as { endpoint?: unknown };

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) throw badRequest(sk("errors.push.invalidSubscription"));

  await removeSubscription(me.id, endpoint);
  return json({ ok: true });
});
