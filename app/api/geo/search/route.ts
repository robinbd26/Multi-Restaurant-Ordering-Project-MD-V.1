import { requireApproved } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/auth/rate-limit";
import { ApiError, handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { getLocale } from "@/lib/i18n/server";
import { geocodeAddress, geocodingAvailable } from "@/lib/services/geo";

// POST /api/geo/search  { query } — WS-4.1 address → coordinates.
//
// POST, not GET: the body carries where a customer lives, which has no business
// sitting in a URL (or in a proxy/access log). The Google key stays in this
// process — the browser only ever sees the resolved suggestions.
//
// `demo: true` means no geocoding key is configured and the results came from
// the offline locality table, so the UI can label them as approximate instead of
// pretending they are a real geocode.
export const POST = handle(async (req: Request) => {
  const me = await requireApproved();
  const body = (await req.json().catch(() => ({}))) as { query?: string; limit?: number };
  const query = String(body.query ?? "").trim();
  if (!query) throw validationError({ query: sk("errors.location.searchQueryRequired") });

  // Geocoding is billed per call, so it is capped PER USER (never per IP — a
  // whole office behind one NAT address would share the bucket).
  const limited = rateLimit(`geo:search:${me.id}`, 40, 60_000);
  if (!limited.ok) {
    throw new ApiError(429, { detail: sk("errors.location.geoRateLimited", { n: limited.retryAfter }) });
  }

  const locale = await getLocale();
  const results = await geocodeAddress(query, { locale, limit: body.limit ?? 5 });
  return json({ results, demo: !geocodingAvailable() });
});
