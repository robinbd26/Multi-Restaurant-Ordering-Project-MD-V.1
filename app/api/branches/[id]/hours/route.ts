import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { branchSchedule, saveBranchSchedule, type ScheduleInput } from "@/lib/services/branch-schedule";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/branches/[id]/hours — the branch's per-brand ordering schedules and
// its display-only dine-in hours. Branch manager (own branch) or super admin.
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  return json(await branchSchedule(me, Number(id)));
});

// PUT /api/branches/[id]/hours — { brands: { <slug>: BrandHours | null }, dine_in?: DineInHours | null }.
// Only the brands sent are changed. Permission is enforced in the service.
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as ScheduleInput;
  return json(await saveBranchSchedule(me, Number(id), body));
});
