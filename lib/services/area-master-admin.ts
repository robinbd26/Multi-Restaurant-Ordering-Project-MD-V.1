import "server-only";

import type { User } from "@prisma/client";

import { normalizeMasterName } from "@/lib/constants/area-master-seed";
import { prisma } from "@/lib/db";
import { forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { LIMITS } from "@/lib/validation/limits";

/**
 * Super-admin editing of the MASTER zone / locality list.
 *
 * Deliberately separate from lib/services/area-master.ts: that module is imported
 * by prisma/seed.ts, which runs outside Next, so it must not pull in the HTTP
 * error helpers. This one is server-only and speaks the app's validation errors.
 *
 * The database is the authority once a human has edited it — syncAreaMaster only
 * ever adds — so retiring a place is a DEACTIVATION here, never a delete. Saved
 * addresses and placed orders keep their own text either way; deactivating only
 * stops the name being offered and stops branches covering it.
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

export interface ZoneAdminLocality {
  id: number;
  name: string;
  isActive: boolean;
  /** How many branch coverage rows point at this locality. */
  coverageCount: number;
}

export interface ZoneAdminRow {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
  localities: ZoneAdminLocality[];
}

/** The whole master list, including inactive rows, for the admin screen. */
export async function zonesForAdmin(): Promise<ZoneAdminRow[]> {
  const zones = await prisma.deliveryZone.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      isActive: true,
      sortOrder: true,
      localities: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          isActive: true,
          _count: { select: { coverage: true } },
        },
      },
    },
  });
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    isActive: zone.isActive,
    sortOrder: zone.sortOrder,
    localities: zone.localities.map((locality) => ({
      id: locality.id,
      name: locality.name,
      isActive: locality.isActive,
      coverageCount: locality._count.coverage,
    })),
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

export async function createLocality(user: User, zoneId: number, name: unknown) {
  assertSuperAdmin(user);
  const zone = await prisma.deliveryZone.findUnique({ where: { id: zoneId }, select: { id: true } });
  if (!zone) throw validationError({ zone_id: sk("errors.deliveryZone.notFound") });
  const localityName = validatedName(name);
  const normalizedName = normalizeMasterName(localityName);
  const clash = await prisma.deliveryLocality.findUnique({
    where: { zoneId_normalizedName: { zoneId, normalizedName } },
  });
  if (clash) throw validationError({ name: sk("errors.deliveryZone.duplicate") });
  const last = await prisma.deliveryLocality.findFirst({
    where: { zoneId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return prisma.deliveryLocality.create({
    data: { zoneId, name: localityName, normalizedName, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
}

export async function updateLocality(
  user: User,
  localityId: number,
  input: { name?: unknown; isActive?: unknown },
) {
  assertSuperAdmin(user);
  const locality = await prisma.deliveryLocality.findUnique({ where: { id: localityId } });
  if (!locality) throw notFound(sk("errors.deliveryZone.notFound"));

  const data: { name?: string; normalizedName?: string; isActive?: boolean } = {};
  if (input.name !== undefined) {
    const localityName = validatedName(input.name);
    const normalizedName = normalizeMasterName(localityName);
    const clash = await prisma.deliveryLocality.findFirst({
      where: { zoneId: locality.zoneId, normalizedName, id: { not: localityId } },
    });
    if (clash) throw validationError({ name: sk("errors.deliveryZone.duplicate") });
    data.name = localityName;
    data.normalizedName = normalizedName;
  }
  if (input.isActive !== undefined) data.isActive = parseActive(input.isActive);
  return prisma.deliveryLocality.update({ where: { id: localityId }, data });
}
