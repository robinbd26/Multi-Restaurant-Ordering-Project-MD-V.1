import { getSessionUser } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { isPushConfigured, pushPublicKey } from "@/lib/services/push";

// GET /api/push — what the browser needs before it can subscribe.
//
// `enabled` is false whenever the VAPID block is unset, which is the documented
// demo default: the client then registers nothing and the in-app bell carries
// the whole notification experience, exactly as before. Anonymous callers get a
// well-formed answer rather than a 401 — the registrar runs from the app shell,
// which also renders public pages, and must not treat "signed out" as an error.
//
// The application server key is public by definition (every subscriber receives
// it), so returning it unauthenticated leaks nothing.
export const GET = handle(async () => {
  const me = await getSessionUser();
  return json({
    enabled: isPushConfigured(),
    public_key: pushPublicKey(),
    signed_in: Boolean(me),
  });
});
