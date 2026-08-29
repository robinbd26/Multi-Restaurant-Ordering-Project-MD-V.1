"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import type { ActionState } from "@/lib/api/action-state";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

/** One legacy (System 1) booking, as `serializeLegacyBooking` returns it. */
export interface LegacyBookingRow {
  id: number;
  branch_name: string;
  customer_name: string;
  guest_name: string;
  guest_phone: string;
  party_size: number;
  booking_date: string;
  status: string;
  table_name: string;
  physical_table: number | null;
}

const TONE: Record<string, "amber" | "red" | "slate"> = { booked: "amber", cancelled: "red" };

/**
 * WS-9.3 — read-only view of bookings made through the RETIRED Ramadan system
 * (RamadanTable + RamadanBooking), rendered alongside the canonical list so the
 * branch still sees every table it has to hold and the customer still sees the
 * booking they made. Nothing here creates a legacy row; the single action is
 * RELEASING a hold, which is the only way to free a table whose guest cancelled
 * now that the legacy create path is closed.
 *
 * The section disappears on its own once the legacy rows have been migrated.
 */
export function LegacyRamadanBookings({
  rows,
  canRelease,
  showCustomer = false,
}: {
  rows: LegacyBookingRow[];
  canRelease: boolean;
  showCustomer?: boolean;
}) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function release(id: number): Promise<ActionState> {
    setError(null);
    const res = await fetch(`/api/ramadan/bookings/${id}/cancel`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const { formError } = parseFieldErrors(data, t("errors.generic"));
      setError(formError);
      return { error: formError };
    }
    router.refresh();
    return { error: null };
  }

  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border border-border-strong p-4" data-testid="ramadan-legacy-bookings">
      <h3 className="font-semibold text-fg-base">{t("ramadan.legacyTitle")}</h3>
      <p className="mb-3 mt-1 text-xs text-fg-muted">{t("ramadan.legacyHint")}</p>
      <Alert tone="error" message={error} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-muted">
            <tr>
              <th className="px-2 py-1">{t("ramadan.bookingDate")}</th>
              <th className="px-2 py-1">{t("ramadan.selectTable")}</th>
              <th className="px-2 py-1">{showCustomer ? t("ramadan.guests") : t("bmExtras.guestName")}</th>
              <th className="px-2 py-1">{t("common.status")}</th>
              {canRelease ? <th className="px-2 py-1 text-right">{t("common.actions")}</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-base">
            {rows.map((r) => (
              <tr key={r.id} data-testid="ramadan-legacy-row">
                <td className="px-2 py-1">{r.booking_date}</td>
                <td className="px-2 py-1">
                  {r.table_name}
                  {/* A legacy table with no namesake in the real layout holds no
                      physical seat — staff need to see that, not guess it. */}
                  {r.physical_table == null ? (
                    <span className="ml-2 text-xs text-amber-600">{t("ramadan.legacyUnlinked")}</span>
                  ) : null}
                </td>
                <td className="px-2 py-1">
                  {showCustomer ? `${r.guest_name} (${fmt.num(r.party_size)})` : `${r.guest_name} · ${r.guest_phone}`}
                </td>
                <td className="px-2 py-1">
                  <Badge tone={TONE[r.status] ?? "slate"}>{t(`ramadanStatus.${r.status}`)}</Badge>
                </td>
                {canRelease ? (
                  <td className="px-2 py-1 text-right">
                    {r.status === "booked" ? (
                      <ConfirmModal
                        trigger={
                          <button type="button" className="text-red-600 hover:underline">
                            {t("ramadan.legacyRelease")}
                          </button>
                        }
                        title={t("ramadan.legacyReleaseTitle")}
                        description={t("ramadan.legacyReleaseDesc", { table: r.table_name, date: r.booking_date })}
                        confirmLabel={t("ramadan.legacyRelease")}
                        action={() => release(r.id)}
                      />
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
