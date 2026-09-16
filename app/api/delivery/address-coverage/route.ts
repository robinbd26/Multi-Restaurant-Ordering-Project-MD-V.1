import { requireApiRole } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { coverageForAddress } from "@/lib/services/address-coverage";
import { resolveEffectiveDelivery } from "@/lib/services/delivery";

// POST /api/delivery/address-coverage  { branch_id, customer_address_id }
//
// The LIVE check the checkout drawer runs while an address is being chosen:
// can the cart's branch deliver to this saved address, on the shift running
// now? Computed on every request, never cached on the address — the same
// address can be covered by one branch and not another, or by day and not
// by night.
//
// Display only. The quote and the order re-run the identical decision
// (coverageForAddress) and enforce it, so this endpoint cannot be used to
// talk the server into a delivery it would refuse.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("customer");
  const body = (await req.json().catch(() => ({}))) as {
    branch_id?: unknown;
    customer_address_id?: unknown;
  };
  const branchId = Number(body.branch_id);
  const addressId = Number(body.customer_address_id);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) {
    throw validationError({ branch_id: sk("errors.orders.selectBranch") });
  }
  if (!Number.isSafeInteger(addressId) || addressId <= 0) {
    throw validationError({ customer_address_id: sk("errors.orders.provideDeliveryAddress") });
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true, isArchived: false },
  });
  if (!branch) throw validationError({ branch_id: sk("errors.orders.branchNotFoundOrClosed") });

  const coverage = await coverageForAddress(branch, {
    customerId: me.id,
    customerAddressId: addressId,
  });

  // The fee the quote will charge: a name-granted coverage row carries its own
  // price; geometric coverage is priced by the shared resolver at that point.
  let deliveryFee: number | null = null;
  if (coverage.via === "locality" && coverage.localityRow) {
    deliveryFee = coverage.localityRow.charge;
  } else if (coverage.via === "geometry" && coverage.point) {
    const effective = await resolveEffectiveDelivery(branch.id, coverage.point);
    deliveryFee = effective ? Number(effective.charge.toFixed(2)) : null;
  }

  return json({
    covered: coverage.covered,
    via: coverage.via,
    reason: coverage.reason,
    window: coverage.window,
    locality_name: coverage.localityName,
    delivery_fee: deliveryFee,
    held: coverage.localityRow?.isHeld ?? false,
    pickup_enabled: branch.pickupEnabled,
    branch: { id: branch.id, name: branch.name },
  });
});
