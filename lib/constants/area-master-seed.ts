/**
 * MAD Delivery — the SEED for the master ZONE list.
 *
 * A zone (Banani, Gulshan, Dhanmondi …) is the grouping tag every branch
 * carries, used for filtering and reports. It is NOT coverage: whether an
 * address can be delivered to is decided entirely by whether the customer's pin
 * falls inside a shape a branch drew (lib/coverage).
 *
 * This file is only the STARTING content for the table: it is read by the
 * seeder, never by the UI. Once a row exists in the database the database wins —
 * editing this file does not rename or delete anything a super admin has since
 * changed.
 *
 * PROVENANCE: AshMd's operational day and night sheets. The night sheet pairs
 * zones per shift (Banani+Gulshan, and so on), which is a STAFFING arrangement
 * rather than a different set of places, so each zone appears once here.
 *
 * HISTORY: this list used to carry a second level — the localities inside each
 * zone (Sector-5, Nikonjo-1 …) — because coverage was decided by matching a
 * customer's typed area name against it. That could never be complete for
 * Dhaka: a customer standing outside the Banani branch was refused delivery
 * because their block was not on the list. Coverage moved to drawn map shapes
 * and the locality level was retired with it.
 */

export interface AreaMasterZone {
  /** Zone name as operations says it. */
  name: string;
}

export const AREA_MASTER: AreaMasterZone[] = [
  { name: "Banani" },
  { name: "Gulshan" },
  { name: "Dhanmondi" },
  { name: "Mohammodpur" },
  { name: "Khilgaon" },
  { name: "Bailey Road" },
  { name: "Mirpur" },
  { name: "Uttara" },
  { name: "Basundhara" },
];

/** Case/space-insensitive key for zone lookups. */
export function normalizeMasterName(name: string): string {
  return name.trim().toLowerCase();
}
