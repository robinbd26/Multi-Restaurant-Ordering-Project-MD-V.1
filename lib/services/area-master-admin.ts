import "server-only";

import type { User } from "@prisma/client";

import { normalizeMasterName } from "@/lib/constants/area-master-seed";
import { prisma } from "@/lib/db";
import { forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { LIMITS } from "@/lib/validation/limits";

/**
 * Super-admin editing of the MASTER ZONE list.
 *
 * Deliberately separate from lib/services/area-master.ts: that module is imported
 * by prisma/seed.ts, which runs outside Next, so it must not pull in the HTTP
 * error helpers. This one is server-only and speaks the app's validation errors.
 *
 * The database is the authority once a human has edited it — syncAreaMaster only
 * ever adds — so retiring a zone is a DEACTIVATION here, never a delete: a zone
 * is a REQUIRED tag on every branch, and deleting one out from under a branch is
 * refused by the schema (onDelete: Restrict). Deactivating only stops the zone
 * being offered for new branches.
 *
 * A zone groups branches. It grants no delivery coverage — that is a pin inside
 * a drawn shape (lib/coverage) — so nothing here can widen or narrow where the
 * platform delivers.
 */

function assertSuperAdmin(user: User): void {
  if (user.role !== "super_admin") throw forbidden(sk("errors.deliveryZone.forbidden"));
}

function validatedName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name) throw validationError({ name: sk("errors.deliveryZone.nameRequired") });
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) {
    throw validationError({
      name: sk("errors.deliveryZone.invalidNameLength", {
        min: LIMITS.nameMin,
        max: LIMITS.nameMax,
      }),
    });
  }
  return name;
}

function parseActive(value: unknown): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw validationError({ is_active: sk("errors.deliveryZone.invalidActive") });
}

export interface ZoneAdminRow {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
  /** Branches tagged with this zone — what a deactivation would strand. */
  branchCount: number;
}

/** Every zone, including inactive ones, for the admin screen. */
export async function zonesForAdmin(): Promise<ZoneAdminRow[]> {
  const zones = await prisma.deliveryZone.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      isActive: true,
      sortOrder: true,
      _count: { select: { branches: true } },
    },
  });
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    isActive: zone.isActive,
    sortOrder: zone.sortOrder,
    branchCount: zone._count.branches,
  }));
}

export async function createZone(user: User, name: unknown) {
  assertSuperAdmin(user);
  const zoneName = validatedName(name);
  const normalizedName = normalizeMasterName(zoneName);
  const clash = await prisma.deliveryZone.findUnique({ where: { normalizedName } });
  if (clash) throw validationError({ name: sk("errors.deliveryZone.duplicate") });
  // New zones sort after everything seeded, until someone reorders them.
  const last = await prisma.deliveryZone.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return prisma.deliveryZone.create({
    data: { name: zoneName, normalizedName, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
}

export async function updateZone(
  user: User,
  zoneId: number,
  input: { name?: unknown; isActive?: unknown },
) {
  assertSuperAdmin(user);
  const zone = await prisma.deliveryZone.findUnique({ where: { id: zoneId } });
  if (!zone) throw notFound(sk("errors.deliveryZone.notFound"));

  const data: { name?: string; normalizedName?: string; isActive?: boolean } = {};
  if (input.name !== undefined) {
    const zoneName = validatedName(input.name);
    const normalizedName = normalizeMasterName(zoneName);
    const clash = await prisma.deliveryZone.findFirst({
      where: { normalizedName, id: { not: zoneId } },
    });
    if (clash) throw validationError({ name: sk("errors.deliveryZone.duplicate") });
    data.name = zoneName;
    data.normalizedName = normalizedName;
  }
  if (input.isActive !== undefined) data.isActive = parseActive(input.isActive);
  return prisma.deliveryZone.update({ where: { id: zoneId }, data });
}
