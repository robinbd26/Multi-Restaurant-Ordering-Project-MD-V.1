import { requireApiRole } from "@/lib/auth/current-user";
import { handle, notFound } from "@/lib/http/errors";
import { noContent } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/services/audit";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/notices/[id] — super admin removes a notice.
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  // A notice is content: every user it reached keeps their own notification
  // (Notification.notice is SetNull), so deleting it rewrites nothing. Logged.
  const me = await requireApiRole("super_admin");
  const { id } = await ctx.params;
  const notice = await prisma.notice.findUnique({ where: { id: Number(id) } });
  if (!notice) throw notFound();
  await prisma.notice.delete({ where: { id: notice.id } });
  await logAdminAction(me.id, "delete", `Deleted notice "${notice.title}" (#${notice.id})`);
  return noContent();
});
