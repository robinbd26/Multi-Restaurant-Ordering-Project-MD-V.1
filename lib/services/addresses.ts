import "server-only";
import { Prisma } from "@prisma/client";
import type { CustomerAddress } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isValidLatLng } from "@/lib/services/geo";


/** Serialize a customer address (req #17). */
export function serializeAddress(a: CustomerAddress) {
  return {
    id: a.id,
    label: a.label,
    custom_label: a.customLabel,
    display_label: a.label === "Others" && a.customLabel ? a.customLabel : a.label,
    address: a.address,
    area: a.area,
    city: a.city,
    postal_code: a.postalCode,
    country: a.country,
    instructions: a.instructions,
    latitude: a.latitude != null ? Number(a.latitude) : null,
    longitude: a.longitude != null ? Number(a.longitude) : null,
    main_area: a.mainArea,
    sub_area: a.subArea,
    custom_area: a.customArea,
    road_lane: a.roadLane,
    custom_road: a.customRoad,
    house_plot: a.housePlot,
    flat_number: a.flatNumber,
    landmark: a.landmark,
    map_address: a.mapAddress,
    place_id: a.placeId,
    is_default: a.isDefault,
    is_active: a.isActive,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

/**
 * Create the customer's default address at registration (req #17). Idempotent:
 * if the customer already has an address (e.g. a registration retry), it does
 * nothing so the same registration address is never duplicated.
 */
export async function ensureRegistrationAddress(
  tx: Prisma.TransactionClient,
  userId: number,
  address: string,
): Promise<void> {
  const trimmed = address.trim();
  if (!trimmed) return;
  const existing = await tx.customerAddress.findFirst({ where: { userId } });
  if (existing) return;
  await tx.customerAddress.create({
    data: { userId, label: "Home", address: trimmed, isDefault: true, isActive: true },
  });
}

/** One row of the storefront deliver-to picker. */
export interface SavedAddressOption {
  id: number;
  label: string;
  address: string;
  isDefault: boolean;
  /** False when the row has no usable map pin, so it cannot resolve a branch. */
  hasCoordinates: boolean;
}

/**
 * The customer's active addresses, reduced to what the homepage picker
 * draws. Deliberately NOT serializeAddress(): the bar needs four fields and
 * renders on every homepage load for every signed-in customer, so it should not
 * carry twenty-five columns of address detail through the RSC payload.
 *
 * Ordered the way the address book orders them — default first, then oldest —
 * so the list reads the same in both places.
 */
export async function savedAddressOptions(userId: number): Promise<SavedAddressOption[]> {
  const rows = await prisma.customerAddress.findMany({
    where: { userId, isActive: true },
    select: {
      id: true,
      label: true,
      customLabel: true,
      address: true,
      isDefault: true,
      latitude: true,
      longitude: true,
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((a) => ({
    id: a.id,
    label: a.label === "Others" && a.customLabel ? a.customLabel : a.label,
    address: a.address,
    isDefault: a.isDefault,
    hasCoordinates:
      a.latitude != null && a.longitude != null && isValidLatLng(Number(a.latitude), Number(a.longitude)),
  }));
}
