import { getSessionUser } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { latestUnread, unreadCount } from "@/lib/services/notifications";

// GET /api/notifications/unread-count — { count, latest }. Returns 0 for
// anonymous so the topbar bell can poll without erroring during sign-out.
// `latest` ({ id, type, link } of the newest unread notification, or null) lets
// the bell play a sound when something new arrives (lib/sound).
export const GET = handle(async () => {
  const me = await getSessionUser();
  if (!me) return json({ count: 0, latest: null });
  const [count, latest] = await Promise.all([unreadCount(me.id), latestUnread(me.id)]);
  return json({ count, latest });
});
