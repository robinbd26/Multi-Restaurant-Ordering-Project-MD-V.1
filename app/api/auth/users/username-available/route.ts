import { requireApiRole } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { usernameCandidates } from "@/lib/validation/username";

/**
 * GET /api/auth/users/username-available?username=… — SUPER ADMIN only.
 *
 * The live "is this taken?" check behind the Create New User form. Unlike the
 * public suggestion endpoint next door (which deliberately never accepts a
 * handle, so it cannot be used to probe for existing accounts), this one takes
 * an arbitrary username — which is exactly why it sits behind the super-admin
 * role instead of being public.
 *
 * Advisory only: `POST /api/auth/users` re-checks uniqueness at submit time and
 * the column is @unique, so a race between two admins is still caught there.
 * When the name is taken, the first free numbered variant is returned so the
 * form can offer it.
 */
export const GET = handle(async (req: Request) => {
  await requireApiRole("super_admin");
  const username = (new URL(req.url).searchParams.get("username") ?? "").trim().slice(0, 60);
  if (!username) return json({ available: false, suggestion: null });

  // Same comparison the create route uses, so the two can never disagree.
  const existing = await prisma.user.findFirst({ where: { username: { equals: username } }, select: { id: true } });
  if (!existing) return json({ available: true, suggestion: null });

  const candidates = usernameCandidates(username).filter((c) => c !== username);
  const taken = await prisma.user.findMany({
    where: { username: { in: candidates } },
    select: { username: true },
  });
  const used = new Set(taken.map((row) => row.username));
  return json({ available: false, suggestion: candidates.find((c) => !used.has(c)) ?? null });
});
