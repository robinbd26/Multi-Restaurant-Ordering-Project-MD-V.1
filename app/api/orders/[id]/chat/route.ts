import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { readChat } from "@/lib/services/order-chat";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/orders/[id]/chat?after=<messageId>
//
// The order's chat: state (read-only or not, the viewer's role), participants,
// the numbers the viewer may call, and messages newer than `after` (the latest
// page when omitted). An open chat polls this every few seconds. Participants
// and the super admin (read-only) only; everyone else gets 403. See
// lib/services/order-chat.ts.
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  return json(await readChat(me, Number(id), after));
});
