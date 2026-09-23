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
    latitude: Number(a.latitude),
    longitude: Number(a.longitude),
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
 *
 * REQUIRES A PIN. Registration collects an address as TEXT, and a saved address
 * without coordinates cannot be delivered to (coverage is the pin, and only the
 * pin), so a row is written only when the form also carried a map location.
 * Without one the text is kept on the User record alone and the customer picks
 * their pin the first time they add an address — which is honest, rather than
 * saving a row that every checkout would then refuse.
 */
export async function ensureRegistrationAddress(
  tx: Prisma.TransactionClient,
  userId: number,
  address: string,
  point?: { lat: number; lng: number } | null,
): Promise<void> {
  const trimmed = address.trim();
  if (!trimmed) return;
  if (!point || !isValidLatLng(point.lat, point.lng)) return;
  const existing = await tx.customerAddress.findFirst({ where: { userId } });
  if (existing) return;
  await tx.customerAddress.create({
    data: {
      userId,
      label: "Home",
      address: trimmed,
      latitude: new Prisma.Decimal(point.lat.toFixed(7)),
      longitude: new Prisma.Decimal(point.lng.toFixed(7)),
      isDefault: true,
      isActive: true,
    },
  });
}

/** One row of the storefront deliver-to picker. */
export interface SavedAddressOption {
  id: number;
  label: string;
  address: string;
  isDefault: boolean;
  /**
   * Whether the row can be delivered to at all. Every saved address carries a
   * pin now, so this is only false for a row whose stored coordinates are
   * somehow unreadable — it is kept so the picker degrades visibly instead of
   * silently offering a destination checkout would refuse.
   */
  isSelectable: boolean;
}

/**
 * The customer's active addresses, reduced to what the homepage picker
 * draws. Deliberately NOT serializeAddress(): the bar needs a handful of
 * fields and renders on every homepage load for every signed-in customer, so
 * it should not carry twenty-five columns of address detail through the RSC
 * payload.
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
    isSelectable: isValidLatLng(Number(a.latitude), Number(a.longitude)),
  }));
}
