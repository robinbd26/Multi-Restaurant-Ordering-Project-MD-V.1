import { requireApiRole } from "@/lib/auth/current-user";
import { forbidden, handle, notFound } from "@/lib/http/errors";
import { noContent } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/services/audit";
import { requireManagerBranch } from "@/lib/services/branch-ops";

type Ctx = { params: Promise<{ id: string }> };

function slotId(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw notFound();
  return parsed;
}

// DELETE /api/branch-manager/time-slots/[id]
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApiRole("branch_manager");
  const branch = await requireManagerBranch(me);
  const { id } = await ctx.params;
  const slot = await prisma.deliveryTimeSlot.findUnique({
    where: { id: slotId(id) },
  });
  if (!slot) throw notFound();
  if (slot.branchId !== branch.id) throw forbidden();
  await prisma.deliveryTimeSlot.delete({ where: { id: slot.id } });
  await logAdminAction(
    me.id,
    "delete",
    `Deleted delivery time slot "${slot.label || `${slot.startTime}–${slot.endTime}`}" (#${slot.id})`,
    { branchId: slot.branchId },
  );
  return noContent();
});
