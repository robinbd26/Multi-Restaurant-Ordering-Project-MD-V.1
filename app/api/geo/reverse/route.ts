import { requireApproved } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/auth/rate-limit";
import { ApiError, handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { getLocale } from "@/lib/i18n/server";
import { coordinateOrNaN, isValidLatLng } from "@/lib/services/geo";
import { geocodingAvailable, reverseGeocode } from "@/lib/services/geocoding";

// POST /api/geo/reverse  { lat, lng } — WS-4.1 dropped pin → readable address.
//
// The answer is TEXT ONLY. The coordinates come back exactly as they were sent,
// so this endpoint can never move a customer's pin, and nothing here decides
// coverage or a delivery fee — those stay server-side in the order pipeline.
export const POST = handle(async (req: Request) => {
  const me = await requireApproved();
  const body = (await req.json().catch(() => ({}))) as { lat?: number | string; lng?: number | string };
  const lat = coordinateOrNaN(body.lat);
  const lng = coordinateOrNaN(body.lng);
  if (!isValidLatLng(lat, lng)) throw validationError({ lat: sk("errors.orders.invalidCoordinates") });

  const limited = rateLimit(`geo:reverse:${me.id}`, 60, 60_000);
  if (!limited.ok) {
    throw new ApiError(429, { detail: sk("errors.location.geoRateLimited", { n: limited.retryAfter }) });
  }

  const locale = await getLocale();
  const place = await reverseGeocode({ lat, lng }, { locale });
  return json({ result: place, available: geocodingAvailable() });
});
