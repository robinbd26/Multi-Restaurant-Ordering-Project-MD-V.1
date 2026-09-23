import { requireApproved } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/auth/rate-limit";
import { ApiError, handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { getLocale } from "@/lib/i18n/server";
import { geocodeAddress, geocodingAvailable } from "@/lib/services/geocoding";

// POST /api/geo/search  { query } — WS-4.1 address → coordinates.
//
// POST, not GET: the body carries where a customer lives, which has no business
// sitting in a URL (or in a proxy/access log). The Barikoi key stays in this
// process — the browser only ever sees the resolved suggestions.
//
// `available: false` means no BARIKOI_API_KEY is configured (or it is empty), so
// search returns nothing and the UI falls back to dropping a pin and typing the
// address by hand. Coverage never depends on this endpoint.
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
  return json({ results, available: geocodingAvailable() });
});
