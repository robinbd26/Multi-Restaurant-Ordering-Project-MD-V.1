import { Prisma } from "@prisma/client";

import { requireApiRole } from "@/lib/auth/current-user";
import { handle, sk, validationError } from "@/lib/http/errors";
import { created, paginated } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { isValidLatLng } from "@/lib/services/geo";
import { serializeAddress } from "@/lib/services/addresses";
import { LIMITS } from "@/lib/validation/limits";
import { validateRequired } from "@/lib/validation/server";

// GET /api/customer/addresses — own saved addresses (active first, default first).
export const GET = handle(async (req: Request) => {
  const me = await requireApiRole("customer");
  const url = new URL(req.url);
  const activeOnly = url.searchParams.get("active") === "1";
  const items = await prisma.customerAddress.findMany({
    where: { userId: me.id, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: [{ isActive: "desc" }, { isDefault: "desc" }, { createdAt: "asc" }],
  });
  return paginated(items.map(serializeAddress));
});

// POST /api/customer/addresses — add an address (req #17). Exactly one active
// default is maintained transactionally; the first active address is the default.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("customer");
  const body = (await req.json().catch(() => ({}))) as {
    label?: string;
    custom_label?: string;
    address?: string;
    area?: string;
    city?: string;
    postal_code?: string;
    country?: string;
    instructions?: string;
    latitude?: number;
    longitude?: number;
    is_default?: boolean;
    main_area?: string;
    sub_area?: string;
    custom_area?: string;
    road_lane?: string;
    custom_road?: string;
    house_plot?: string;
    flat_number?: string;
    landmark?: string;
    map_address?: string;
    place_id?: string;
  };
  if (!body.label?.trim()) throw validationError({ label: sk("errors.ops.addressLabelRequired") });
  if (!body.address?.trim()) throw validationError({ address: sk("errors.ops.addressRequired") });
  // Same length caps the customer form enforces before sending.
  const label = validateRequired(body.label, "label", { max: 40 });
  const addressText = validateRequired(body.address, "address", { max: LIMITS.longTextMax });
  if (body.custom_label) validateRequired(body.custom_label, "custom_label", { max: 40 });
  if (body.area) validateRequired(body.area, "area", { max: 80 });
  if (body.city) validateRequired(body.city, "city", { max: 80 });
  if (body.postal_code) validateRequired(body.postal_code, "postal_code", { max: 20 });
  if (body.country) validateRequired(body.country, "country", { max: 80 });
  if (body.instructions) validateRequired(body.instructions, "instructions", { max: 200 });
  if (body.main_area) validateRequired(body.main_area, "main_area", { max: 80 });
  if (body.sub_area) validateRequired(body.sub_area, "sub_area", { max: 80 });
  if (body.custom_area) validateRequired(body.custom_area, "custom_area", { max: 80 });
  if (body.road_lane) validateRequired(body.road_lane, "road_lane", { max: 80 });
  if (body.custom_road) validateRequired(body.custom_road, "custom_road", { max: 80 });
  if (body.house_plot) validateRequired(body.house_plot, "house_plot", { max: 80 });
  if (body.flat_number) validateRequired(body.flat_number, "flat_number", { max: 80 });
  if (body.landmark) validateRequired(body.landmark, "landmark", { max: 200 });
  if (body.map_address) validateRequired(body.map_address, "map_address", { max: LIMITS.longTextMax });
  if (body.place_id) validateRequired(body.place_id, "place_id", { max: 255 });
  // THE PIN IS MANDATORY. Coverage is decided from these coordinates and from
  // nothing else, so an address saved without them could never be delivered to —
  // which is precisely the trap the old name-matching flow let customers fall
  // into. The form always sends a pin; this is the server-side guarantee.
  if (body.latitude == null || body.longitude == null) {
    throw validationError({ latitude: sk("errors.ops.mapPinRequired") });
  }
  if (!isValidLatLng(body.latitude, body.longitude)) {
    throw validationError({ latitude: sk("errors.orders.invalidCoordinates") });
  }
  const latitude = new Prisma.Decimal(Number(body.latitude).toFixed(7));
  const longitude = new Prisma.Decimal(Number(body.longitude).toFixed(7));

  const activeCount = await prisma.customerAddress.count({ where: { userId: me.id, isActive: true } });
  // Task 3 — hard cap: a customer account saves at most LIMITS.maxSavedAddresses
  // delivery addresses. Deleting one (soft delete → isActive=false) frees the
  // slot again, so the cap never counts tombstoned rows.
  if (activeCount >= LIMITS.maxSavedAddresses) {
    throw validationError({ address: sk("errors.ops.maxAddressesReached") });
  }
  const makeDefault = Boolean(body.is_default) || activeCount === 0;

  const address = await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.customerAddress.updateMany({ where: { userId: me.id }, data: { isDefault: false } });
    }
    return tx.customerAddress.create({
      data: {
        userId: me.id,
        label,
        customLabel: body.custom_label?.trim() ?? "",
        address: addressText,
        area: body.area?.trim() ?? "",
        city: body.city?.trim() ?? "",
        postalCode: body.postal_code?.trim() ?? "",
        country: body.country?.trim() ?? "",
        instructions: body.instructions?.trim() ?? "",
        latitude,
        longitude,
        mainArea: body.main_area?.trim() ?? "",
        subArea: body.sub_area?.trim() ?? "",
        customArea: body.custom_area?.trim() ?? "",
        roadLane: body.road_lane?.trim() ?? "",
        customRoad: body.custom_road?.trim() ?? "",
        housePlot: body.house_plot?.trim() ?? "",
        flatNumber: body.flat_number?.trim() ?? "",
        landmark: body.landmark?.trim() ?? "",
        mapAddress: body.map_address?.trim() ?? "",
        placeId: body.place_id?.trim() ?? "",
        isDefault: makeDefault,
        isActive: true,
      },
    });
  });
  return created(serializeAddress(address));
});
