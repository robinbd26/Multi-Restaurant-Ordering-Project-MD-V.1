import { NextResponse } from "next/server";

import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { chatImage } from "@/lib/services/order-chat";

type Ctx = { params: Promise<{ id: string; messageId: string }> };

// GET /api/orders/[id]/chat/messages/[messageId]/image[?w=320]
//
// The only way a chat photo is served: after the same check as reading the
// chat, so a rider who has left the order cannot open its photos either. The
// generic /api/uploads route refuses the chat_photos folder outright.
export const GET = handle(async (req: Request, ctx: Ctx): Promise<Response> => {
  const me = await requireApproved();
  const { id, messageId } = await ctx.params;
  const w = Number(new URL(req.url).searchParams.get("w") ?? 0);
  const image = await chatImage(me, Number(id), Number(messageId), w > 0 ? w : null);
  return new NextResponse(new Uint8Array(image.data), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      // Private and short-lived: access can end (a replaced rider), so a
      // browser must come back and ask rather than keep it for a year.
      "Cache-Control": "private, max-age=300",
    },
  });
});
