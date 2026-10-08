import { requireApiRole } from "@/lib/auth/current-user";
import { handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { branchOptionsForPoint } from "@/lib/services/coverage";
import { coordinateOrNaN, isValidLatLng } from "@/lib/services/geo";

// POST /api/delivery/point-coverage { lat, lng }
//
// "Does ANY branch deliver to this pin?" — the check the My Addresses form runs
// before a customer saves an address, so an address outside every branch's
// area is called out up front instead of at checkout. Per-branch checks (the
// cart's own branch) stay on /api/delivery/address-coverage.
//
// Display only: the quote and the order re-run coverage and enforce it.
export const POST = handle(async (req: Request) => {
  await requireApiRole("customer");
  const body = (await req.json().catch(() => ({}))) as { lat?: unknown; lng?: unknown };
  const lat = coordinateOrNaN(body.lat);
  const lng = coordinateOrNaN(body.lng);
  if (!isValidLatLng(lat, lng)) throw validationError({ lat: sk("errors.ops.invalidCoordinates") });

  const ranked = await branchOptionsForPoint({ lat, lng });
  const delivering = ranked.filter((b) => b.covered);
  const pickupOnly = ranked.filter((b) => b.pickupOnly);
  return json({
    // Best first: the branch a cart would default to.
    covered: delivering.length > 0,
    pickup_only: delivering.length === 0 && pickupOnly.length > 0,
    branches: delivering.map((b) => ({ id: b.branchId, name: b.branchName })),
  });
});
