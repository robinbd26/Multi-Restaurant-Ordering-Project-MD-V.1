import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";

// GET /api/customer/settings — own preferences.
export const GET = handle(async () => {
  const me = await requireApiRole("customer");
  return json({ notifications_enabled: me.notificationsEnabled });
});

// PATCH /api/customer/settings  { notifications_enabled }
// Customer-only (matches every sibling /api/customer route): since WS-6.2 the
// toggle also mutes routine order/delivery PUSH, so a staff/rider user must not
// be able to flip it here and silence their own dispatch alerts.
export const PATCH = handle(async (req: Request) => {
  const me = await requireApiRole("customer");
  const body = (await req.json().catch(() => ({}))) as { notifications_enabled?: boolean };
  const updated = await prisma.user.update({
    where: { id: me.id },
    data: { notificationsEnabled: Boolean(body.notifications_enabled) },
  });
  return json({ notifications_enabled: updated.notificationsEnabled });
});
