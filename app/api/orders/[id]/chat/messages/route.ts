import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { parseBody } from "@/lib/http/form";
import { created } from "@/lib/http/respond";
import { sendChatMessage } from "@/lib/services/order-chat";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/chat/messages
//   JSON      { body }            — a text message
//   JSON      { quick: "<key>" }  — a rider quick reply (e.g. "arrived")
//   multipart image (+ body)      — a photo with an optional caption
//
// Participants only, and only until the chat goes read-only (2 hours after the
// order is delivered or cancelled → 409). The super admin observes: 403.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const { fields, file } = await parseBody(req);
  const message = await sendChatMessage(me, Number(id), {
    text: fields.body,
    quick: fields.quick,
    image: file("image"),
  });
  return created(message);
});
