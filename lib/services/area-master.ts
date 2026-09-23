import type { PrismaClient } from "@prisma/client";

import { AREA_MASTER, normalizeMasterName } from "@/lib/constants/area-master-seed";
import { prisma as defaultPrisma } from "@/lib/db";

/**
 * The master ZONE list — the areas of the city, named once for the platform.
 *
 * A zone is a GROUPING TAG on a branch (required, used for filtering and
 * reports). It decides nothing about delivery: coverage is a customer's pin
 * inside a shape a branch drew (lib/coverage). The finer locality level that
 * used to hang off each zone is gone; it existed only for name matching.
 *
 * Deliberately NOT marked "server-only": prisma/seed.ts is a plain tsx script
 * and imports syncAreaMaster from here, so the seed and the application share
 * one definition instead of drifting apart. Nothing here is reachable from a
 * client bundle anyway — every export takes a Prisma client.
 */

export interface ZoneOption {
  id: number;
  name: string;
}

/**
 * Bring the zone list up to date with the seed content, idempotently.
 *
 * ADDITIVE ON PURPOSE. It creates what is missing but never renames or deletes:
 * once a super admin edits a zone, the database is the authority and a later
 * seed run must not undo that.
 */
export async function syncAreaMaster(
  client: Pick<PrismaClient, "deliveryZone">,
): Promise<{ zones: number; created: number }> {
  let created = 0;

  for (const [index, zone] of AREA_MASTER.entries()) {
    const normalizedName = normalizeMasterName(zone.name);
    const existing = await client.deliveryZone.findUnique({ where: { normalizedName } });
    if (!existing) {
      await client.deliveryZone.create({
        data: { name: zone.name, normalizedName, sortOrder: index },
      });
      created += 1;
    }
  }

  return { zones: AREA_MASTER.length, created };
}

/** Active zones, in operations' own display order — for the branch form picker. */
export async function activeZones(
  client: Pick<PrismaClient, "deliveryZone"> = defaultPrisma,
): Promise<ZoneOption[]> {
  return client.deliveryZone.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}
