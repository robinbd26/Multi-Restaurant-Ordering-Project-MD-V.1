import { Prisma } from "@prisma/client";

import { requireApiRole } from "@/lib/auth/current-user";
import { isDeliveryPaused } from "@/lib/coverage/pause";
import { handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { requireManagerBranch } from "@/lib/services/branch-ops";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// GET /api/branch-manager/delivery-settings — own branch prep time, pickup
// config and hours, plus the read-only coverage facts the manager needs.
//
// WHAT A MANAGER MAY NOT SET HERE: the branch PIN and the maximum delivery
// RADIUS. Both belong to the super admin — the pin anchors every delivery area
// and the radius is the ceiling a manager may draw inside — so they are
// returned for reference and changed only from the admin branch form. Coverage
// itself is drawn on /branch-manager/delivery-areas.
export const GET = handle(async () => {
  const me = await requireApiRole("branch_manager");
  const branch = await requireManagerBranch(me);
  const areaCount = await prisma.branchDeliveryArea.count({
    where: { branchId: branch.id, isActive: true, shape: { not: null } },
  });
  return json({
    branch_id: branch.id,
    branch_name: branch.name,
    latitude: branch.latitude?.toString() ?? null,
    longitude: branch.longitude?.toString() ?? null,
    delivery_radius_km: branch.deliveryRadiusKm.toString(),
    prep_time_minutes: branch.prepTimeMinutes,
    pickup_enabled: branch.pickupEnabled,
    pickup_address: branch.pickupAddress,
    pickup_phone: branch.pickupPhone,
    opening_time: branch.openingTime,
    closing_time: branch.closingTime,
    /** How many drawn areas actually cover anything — 0 means no delivery. */
    drawn_area_count: areaCount,
    delivery_paused: isDeliveryPaused(branch),
    delivery_pause_mode: branch.deliveryPauseMode,
    delivery_paused_until: branch.deliveryPausedUntil?.toISOString() ?? null,
  });
});

// PATCH /api/branch-manager/delivery-settings — prep time, pickup point, hours.
export const PATCH = handle(async (req: Request) => {
  const me = await requireApiRole("branch_manager");
  const branch = await requireManagerBranch(me);
  const body = (await req.json().catch(() => ({}))) as {
    prep_time_minutes?: number | string;
    pickup_enabled?: boolean;
    pickup_address?: string;
    pickup_phone?: string;
    opening_time?: string;
    closing_time?: string;
  };
  const data: Prisma.BranchUpdateInput = {};

  if (body.prep_time_minutes !== undefined) {
    const p = Number(body.prep_time_minutes);
    if (!Number.isFinite(p) || p <= 0) throw validationError({ prep_time_minutes: sk("errors.ops.invalidPrepTime") });
    data.prepTimeMinutes = Math.round(p);
  }
  if (body.pickup_enabled !== undefined) data.pickupEnabled = Boolean(body.pickup_enabled);
  if (body.pickup_address !== undefined) data.pickupAddress = String(body.pickup_address);
  if (body.pickup_phone !== undefined) data.pickupPhone = String(body.pickup_phone);
  for (const [key, field] of [["opening_time", "openingTime"], ["closing_time", "closingTime"]] as const) {
    const v = body[key];
    if (v !== undefined) {
      if (v && !TIME_RE.test(v)) throw validationError({ [key]: sk("errors.money.enterValidTime") });
      (data as Record<string, unknown>)[field] = v || null;
    }
  }

  await prisma.branch.update({ where: { id: branch.id }, data });
  return json({ ok: true });
});
