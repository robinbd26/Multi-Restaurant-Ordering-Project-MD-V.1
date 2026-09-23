import { requireApiRole } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { coverageForAddress } from "@/lib/services/address-coverage";
import { coordinateOrNaN, isValidLatLng } from "@/lib/services/geo";

// POST /api/delivery/address-coverage
//   { branch_id, customer_address_id }  — a saved address (its own pin wins)
//   { branch_id, lat, lng }             — a pin the customer just dropped,
//                                         for a one-time checkout address
//
// The LIVE check the address form and the checkout drawer run while a
// destination is being chosen: can the cart's branch deliver to this PIN, on
// the shift running now?  Computed on every request, never cached on the
// address — the same pin can be covered by one branch and not another, and by
// day and not by night.
//
// Display only. The quote and the order re-run the identical decision
// (coverageForAddress) and enforce it, so this endpoint cannot be used to talk
// the server into a delivery it would refuse.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("customer");
  const body = (await req.json().catch(() => ({}))) as {
    branch_id?: unknown;
    customer_address_id?: unknown;
    lat?: unknown;
    lng?: unknown;
  };
  const branchId = Number(body.branch_id);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) {
    throw validationError({ branch_id: sk("errors.orders.selectBranch") });
  }
  const addressId = Number(body.customer_address_id);
  const hasAddressId = Number.isSafeInteger(addressId) && addressId > 0;
  const lat = coordinateOrNaN(body.lat);
  const lng = coordinateOrNaN(body.lng);
  const hasPoint = isValidLatLng(lat, lng);
  if (!hasAddressId && !hasPoint) {
    throw validationError({ customer_address_id: sk("errors.orders.provideDeliveryAddress") });
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true, isArchived: false },
  });
  if (!branch) throw validationError({ branch_id: sk("errors.orders.branchNotFoundOrClosed") });

  const coverage = await coverageForAddress(branch, {
    customerId: me.id,
    ...(hasAddressId ? { customerAddressId: addressId } : { lat, lng }),
  });

  return json({
    covered: coverage.covered,
    // Covered, held (pickup only) or out of area — the three states the form
    // shows before the customer saves or checks out.
    status: coverage.coverage?.status ?? "not_covered",
    reason: coverage.reason,
    window: coverage.window,
    // Only quote a fee for a delivery that can actually happen.
    delivery_fee: coverage.covered ? Number(coverage.coverage!.charge.toFixed(2)) : null,
    estimated_minutes: coverage.coverage?.estimatedMinutes ?? null,
    area_name: (coverage.coverage?.area ?? coverage.coverage?.blockedArea)?.name ?? null,
    held: coverage.pickupOnly,
    hold_reason: coverage.coverage?.blockedArea?.holdReason ?? "",
    pickup_enabled: branch.pickupEnabled,
    branch: { id: branch.id, name: branch.name },
  });
});
