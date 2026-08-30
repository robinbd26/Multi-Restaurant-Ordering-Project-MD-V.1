import "server-only";
import { Prisma } from "@prisma/client";
import { dhakaDayKey } from "@/lib/utils/dates";

/**
 * Unique, human-readable order numbers (req #15): ORD-YYYYMMDD-000001.
 *
 * The date segment is the DHAKA calendar day — the business day every report,
 * settlement and attendance boundary uses (lib/utils/dates.ts, APP_TIME_ZONE).
 * It used to be the UTC day, which stamped orders placed 00:00–06:00 Dhaka
 * with the PREVIOUS day's date relative to the settlement that contains them.
 * The 6-wide sequence resets per day and is never reused.
 *
 * COLLISION SAFETY of the UTC→Dhaka switch (order numbers are immutable and
 * unique, so this must not re-issue a historical number): Dhaka is UTC+6, so
 * at any instant the Dhaka key is >= the UTC key. At the moment of the switch
 * the derivation therefore either continues the SAME key (after 06:00 Dhaka
 * both schemes agree) or jumps to a key at most one day AHEAD (in the
 * 00:00–06:00 Dhaka window) — never backwards onto a day whose sequence was
 * already handed out under the old scheme. Both schemes share the one atomic
 * OrderNumberCounter row per key, so even a same-key overlap just continues
 * the existing sequence, and the unique index on Order.orderNumber is the
 * final backstop.
 */

/** Dhaka date key "YYYYMMDD" backing the per-day counter + number prefix. */
export function orderDateKey(d: Date = new Date()): string {
  // dhakaDayKey is the app-wide "YYYY-MM-DD" business-day key; the order
  // number's compact segment is the same day with the dashes removed.
  return dhakaDayKey(d).replaceAll("-", "");
}

/** Format a reserved (dateKey, seq) into the customer-facing order number. */
export function formatOrderNumber(dateKey: string, seq: number): string {
  return `ORD-${dateKey}-${String(seq).padStart(6, "0")}`;
}

/**
 * Reserve the next unique order number for `date`'s Dhaka business day
 * (default now) with an
 * atomic upsert+increment on OrderNumberCounter. The counter row is locked for
 * the increment (row-lock on Postgres, write-serialized on SQLite), so two
 * orders created concurrently can never receive the same sequence. Must run
 * inside the same transaction that creates the order, so a rolled-back order
 * releases its sequence instead of leaving the row half-written. The unique
 * index on Order.orderNumber is the final backstop.
 *
 * A gap (from a rolled-back transaction) is acceptable — the guarantee is
 * uniqueness + no reuse, not contiguity.
 */
export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  date: Date = new Date(),
): Promise<string> {
  const dateKey = orderDateKey(date);
  const row = await tx.orderNumberCounter.upsert({
    where: { dateKey },
    create: { dateKey, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  return formatOrderNumber(dateKey, row.seq);
}
