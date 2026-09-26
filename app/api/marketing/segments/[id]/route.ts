import { requireApiRole } from "@/lib/auth/current-user";
import { handle, notFound } from "@/lib/http/errors";
import { noContent } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/services/audit";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/marketing/segments/[id]
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  // A segment is saved filter criteria (setup data): nothing references it,
  // so it is truly deleted, and the delete is logged.
  const me = await requireApiRole("marketing", "super_admin");
  const { id } = await ctx.params;
  const existing = await prisma.audienceSegment.findUnique({ where: { id: Number(id) } });
  if (!existing) throw notFound();
  await prisma.audienceSegment.delete({ where: { id: existing.id } });
  await logAdminAction(me.id, "delete", `Permanently deleted audience segment "${existing.name}" (#${existing.id})`);
  return noContent();
});
