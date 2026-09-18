import type { PrismaClient } from "@prisma/client";

import { AREA_MASTER, normalizeMasterName } from "@/lib/constants/area-master-seed";
import { prisma as defaultPrisma } from "@/lib/db";

/**
 * The MASTER zone / locality list — the places that exist, named once for the
 * whole platform.
 *
 * Deliberately NOT marked "server-only": prisma/seed.ts is a plain tsx script and
 * imports syncAreaMaster from here, so the seed and the application share one
 * definition of the list instead of drifting apart. Nothing in this module is
 * reachable from a client bundle anyway — every export takes a Prisma client.
 *
 * Coverage is not decided here. This answers "which places exist and what are
 * they called"; each branch then ticks the ones it delivers to, per time window
 * (BranchDeliveryArea.localityId + coverageWindow).
 */

export interface ZoneWithLocalities {
  id: number;
  name: string;
  localities: { id: number; name: string }[];
}

/**
 * Bring the master list up to date with the seed content, idempotently.
 *
 * ADDITIVE ON PURPOSE. It creates what is missing and reactivates what was
 * previously seeded, but never renames or deletes: once a super admin edits a
 * zone or retires a locality, the database is the authority and a later seed run
 * must not undo that. Anything operations wants removed is deactivated through
 * the admin UI, not by editing the seed file.
 */
export async function syncAreaMaster(
  client: Pick<PrismaClient, "deliveryZone" | "deliveryLocality">,
): Promise<{ zones: number; localities: number; created: number }> {
  let created = 0;
  let zoneCount = 0;
  let localityCount = 0;

  for (const [zoneIndex, zone] of AREA_MASTER.entries()) {
    const normalizedName = normalizeMasterName(zone.name);
    const existingZone = await client.deliveryZone.findUnique({ where: { normalizedName } });
    const zoneRow = existingZone
      ? existingZone
      : await client.deliveryZone.create({
          data: { name: zone.name, normalizedName, sortOrder: zoneIndex },
        });
    if (!existingZone) created += 1;
    zoneCount += 1;

    for (const [localityIndex, locality] of zone.localities.entries()) {
      const localityKey = normalizeMasterName(locality);
      const existing = await client.deliveryLocality.findUnique({
        where: { zoneId_normalizedName: { zoneId: zoneRow.id, normalizedName: localityKey } },
      });
      if (!existing) {
        await client.deliveryLocality.create({
          data: {
            zoneId: zoneRow.id,
            name: locality,
            normalizedName: localityKey,
            sortOrder: localityIndex,
          },
        });
        created += 1;
      }
      localityCount += 1;
    }
  }

  return { zones: zoneCount, localities: localityCount, created };
}

/**
 * The list the customer address form renders: active zones, each with its active
 * localities, in operations' own display order.
 */
export async function activeZonesWithLocalities(
  client: Pick<PrismaClient, "deliveryZone"> = defaultPrisma,
): Promise<ZoneWithLocalities[]> {
  const zones = await client.deliveryZone.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      localities: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      },
    },
  });
  return zones;
}

/**
 * Resolve a saved address's free-text zone/locality pair onto the master list.
 *
 * Saved addresses store NAMES, not ids — they predate this table and a customer
 * may type their own locality ("+ Add your own"), which by policy is covered by
 * nobody until a branch manager adds it. Matching is case- and space-insensitive
 * so "mirpur-10" and "Mirpur-10" are the same place.
 *
 * Returns null when the pair names nothing on the master list, which the caller
 * must treat as "not covered", never as "covered by default".
 */
export async function findLocality(
  zoneName: string | null | undefined,
  localityName: string | null | undefined,
  client: Pick<PrismaClient, "deliveryLocality"> = defaultPrisma,
): Promise<{ id: number; name: string; zoneId: number; zoneName: string } | null> {
  const localityKey = normalizeMasterName(localityName ?? "");
  if (!localityKey) return null;
  const zoneKey = normalizeMasterName(zoneName ?? "");

  const row = await client.deliveryLocality.findFirst({
    where: {
      normalizedName: localityKey,
      isActive: true,
      zone: { isActive: true, ...(zoneKey ? { normalizedName: zoneKey } : {}) },
    },
    select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
  });
  return row ? { id: row.id, name: row.name, zoneId: row.zoneId, zoneName: row.zone.name } : null;
}
