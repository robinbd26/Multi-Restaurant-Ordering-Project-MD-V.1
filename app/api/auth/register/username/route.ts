import { clientIpFromHeaders } from "@/lib/auth/request-info";
import { rateLimit } from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { LIMITS } from "@/lib/validation/limits";
import { deriveUsernameBase, randomHandle, usernameCandidates } from "@/lib/validation/username";

/**
 * How many suggestions one IP may ask for per window. The form debounces and
 * only asks while the customer is still typing their name, so a real
 * registration costs a handful; anything past this is scripted.
 */
const SUGGEST_LIMIT = 20;
const SUGGEST_WINDOW_MS = 60_000;

/**
 * POST /api/auth/register/username — PUBLIC. Suggests a FREE username derived
 * from a first + last name, for the registration form's auto-fill.
 *
 * WHAT THIS DELIBERATELY IS NOT: an "is <string> taken?" endpoint. It never
 * accepts a username, so it cannot be pointed at an arbitrary handle and asked
 * whether it exists — the probe space is name pairs, and each probe costs a
 * derivation plus a slot in the rate-limit window above. What it does leak is
 * one bit per call ("the handle these two names derive to is in use", implied
 * when the answer comes back with a numeric suffix). That is strictly LESS than
 * the public registration POST next door already returns (`usernameTaken`, for
 * any username the caller chooses), so it adds no new class of oracle — it just
 * must not become a cheaper one, hence the limiter.
 *
 * Uniqueness here is a SUGGESTION, never the authority: two customers can be
 * offered the same free handle a second apart. The register route's own
 * uniqueness check at submit time is the boundary and stays unchanged.
 */
export const POST = handle(async (req: Request) => {
  const limit = rateLimit(
    `username-suggest:${clientIpFromHeaders(req.headers) || "unknown"}`,
    SUGGEST_LIMIT,
    SUGGEST_WINDOW_MS,
  );
  // No detail, no field error: the form silently keeps the name it derived
  // locally, so a limited caller sees a working field and learns nothing.
  if (!limit.ok) return json({ username: null }, 429);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const read = (key: string) => {
    const value = body[key];
    // Sliced before trimming so a megabyte of whitespace cannot be handed to
    // the derivation as "one long name".
    return typeof value === "string" ? value.slice(0, LIMITS.nameMax).trim() : "";
  };
  const firstName = read("first_name");
  const lastName = read("last_name");
  if (!firstName && !lastName) return json({ username: null });

  // Same derivation the browser ran, so the answer either confirms what the
  // customer already sees or replaces it with the next free variant.
  // An empty base means the names carry nothing romanisable (see
  // deriveUsernameBase) — a generated handle is offered instead of a reject.
  const base = deriveUsernameBase(firstName, lastName) || randomHandle();

  const candidates = usernameCandidates(base);
  // ONE query for every candidate: a probe per suffix would turn a debounced
  // keystroke into a dozen round trips on a 3G connection.
  const taken = await prisma.user.findMany({
    where: { username: { in: candidates } },
    select: { username: true },
  });
  const used = new Set(taken.map((row) => row.username));
  const free = candidates.find((candidate) => !used.has(candidate));

  // `null` when even the random variants collided (practically unreachable):
  // the form keeps its local suggestion and submit-time validation decides.
  return json({ username: free ?? null });
});
