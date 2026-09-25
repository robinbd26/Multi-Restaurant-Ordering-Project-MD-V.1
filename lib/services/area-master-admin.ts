import "server-only";

import { Prisma, type User } from "@prisma/client";

import { normalizeMasterName } from "@/lib/constants/area-master-seed";
import { prisma } from "@/lib/db";
import { conflict, forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { logAdminAction } from "@/lib/services/audit";
import { LIMITS } from "@/lib/validation/limits";

/**
 * Super-admin editing of the MASTER ZONE list.
 *
 * Deliberately separate from lib/services/area-master.ts: that module is imported
 * by prisma/seed.ts, which runs outside Next, so it must not pull in the HTTP
 * error helpers. This one is server-only and speaks the app's validation errors.
 *
 * Retiring a zone is a DEACTIVATION (it stops being offered for new branches).
 * A zone no branch uses can also be DELETED: it is pure setup data, and orders
 * and addresses copy area names as text rather than pointing at this row. A
 * zone still in use cannot be deleted (the schema refuses: onDelete Restrict),
 * so the refusal names the branches to reassign first. Note that the seed's
 * syncAreaMaster re-adds any SEEDED zone that is missing, so deleting one of
 * those only lasts until the next `npm run seed`; deactivating does not.
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
  /** Their names: the ones to reassign before the zone can be deleted. */
  branchNames: string[];
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
      branches: { select: { name: true }, orderBy: { name: "asc" } },
    },
  });
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    isActive: zone.isActive,
    sortOrder: zone.sortOrder,
    branchCount: zone.branches.length,
    branchNames: zone.branches.map((b) => b.name),
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
  const updated = await prisma.deliveryZone.update({ where: { id: zoneId }, data });
  // Deactivating is this list's archive; it and reactivation are logged.
  if (data.isActive !== undefined && data.isActive !== zone.isActive) {
    await logAdminAction(
      user.id,
      data.isActive ? "action" : "archive",
      `${data.isActive ? "Reactivated" : "Deactivated (archived)"} delivery zone "${zone.name}" (#${zone.id})`,
    );
  }
  return updated;
}

/** The refusal for a zone still in use: which branches to reassign first. */
async function zoneInUse(zoneId: number, zoneName: string): Promise<never> {
  const branches = await prisma.branch.findMany({
    where: { zoneId },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  throw conflict(
    sk("errors.deliveryZone.inUse", {
      name: zoneName,
      count: branches.length,
      branches: branches.map((b) => b.name).join(", "),
    }),
  );
}

/**
 * Permanently delete a zone that no branch uses. A zone in use is refused with
 * the list of branches to move to another zone first, rather than the
 * database's generic foreign-key error. Logged.
 */
export async function deleteZone(user: User, zoneId: number): Promise<void> {
  assertSuperAdmin(user);
  const zone = await prisma.deliveryZone.findUnique({ where: { id: zoneId } });
  if (!zone) throw notFound(sk("errors.deliveryZone.notFound"));
  if ((await prisma.branch.count({ where: { zoneId } })) > 0) await zoneInUse(zoneId, zone.name);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.deliveryZone.delete({ where: { id: zoneId } });
      await logAdminAction(user.id, "delete", `Permanently deleted delivery zone "${zone.name}" (#${zone.id}); no branch used it`, {
        tx,
      });
    });
  } catch (err) {
    // A branch was tagged with it between the check and the delete: the
    // schema's Restrict fired. Same answer as above, with the current names.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") await zoneInUse(zoneId, zone.name);
    throw err;
  }
}
