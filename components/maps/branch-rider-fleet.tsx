"use client";

import { useMemo, useState } from "react";

import { UserAvatar } from "@/components/common/user-avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { useLiveData } from "@/lib/hooks/use-live-data";
import { useTranslation } from "@/lib/i18n/use-translation";
import { directionsUrl } from "@/lib/services/geo";
import { cn } from "@/lib/utils";

import { RiderFleetMap, type FleetPin } from "./rider-fleet-map";

/**
 * WS-4.3 — the branch manager's rider board. Until now this page was a static
 * name/phone/vehicle/branch table: there was no way to tell who was actually
 * working, let alone where they were. It now shows duty state and a live pin per
 * on-duty rider, from the SAME `/api/riders/branch` payload the roster is drawn
 * from, so the map and the table can never contradict each other.
 *
 * REFRESH TRANSPORT — this runs on Bangladeshi mobile data, usually prepaid, so
 * the transport is a deliberately unhurried poll rather than a socket or a tight
 * loop. `useLiveData` gives us exactly the properties that matters:
 *   · one request every 20 s — a delivery rider does not move meaningfully
 *     faster than that, and it is ~180 requests an hour instead of 3,600;
 *   · polling STOPS while the tab is hidden and fires once on return, so a
 *     backgrounded dashboard costs the branch nothing;
 *   · overlapping requests are impossible, so a slow link cannot queue stale
 *     responses;
 *   · a failed tick keeps the last good snapshot on screen — a blip must not
 *     blank the board mid-shift.
 * The server-rendered roster is handed in as `initialRiders`, so the first paint
 * is complete before the first poll even starts.
 */

/** `/api/riders/branch` row — the WS-3.4 payload, positions included only for on-duty riders. */
export interface BranchRider {
  id: number;
  user: number;
  rider_name: string;
  rider_username: string;
  rider_phone: string;
  vehicle_type: string;
  assigned_branch_name: string | null;
  is_online: boolean;
  on_duty_branch: number | null;
  on_duty_since: string | null;
  last_ping_at: string | null;
  latitude: number | null;
  longitude: number | null;
}

const REFRESH_MS = 20_000;

/** "Open in Google Maps" navigation link — a plain URL, no API key, no SDK. */
function directionsHref(lat: number, lng: number): string {
  return directionsUrl({ lat, lng });
}

export function BranchRiderFleet({
  initialRiders,
  branchLat,
  branchLng,
}: {
  initialRiders: BranchRider[];
  branchLat: number | null;
  branchLng: number | null;
}) {
  const { t, fmt } = useTranslation();
  const { data, error, updatedAt } = useLiveData<BranchRider[]>("/api/riders/branch", REFRESH_MS, initialRiders);
  const [focused, setFocused] = useState<number | null>(null);

  const riders = useMemo(() => (Array.isArray(data) ? data : initialRiders), [data, initialRiders]);
  const onDuty = useMemo(() => riders.filter((r) => r.is_online), [riders]);
  // A rider can be on duty and not yet have pinged (app just opened, GPS still
  // acquiring) — that is a real state and gets its own row, not a missing pin.
  const pins = useMemo<FleetPin[]>(
    () =>
      onDuty
        .filter((r) => r.latitude != null && r.longitude != null)
        .map((r) => ({
          riderId: r.user,
          name: r.rider_name || r.rider_username,
          lat: r.latitude as number,
          lng: r.longitude as number,
        })),
    [onDuty],
  );

  const center = branchLat != null && branchLng != null ? { lat: branchLat, lng: branchLng } : null;

  return (
    <div className="space-y-4" data-testid="branch-rider-fleet">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="green" dot>
          {t("bmRiders.onDutyCount", { n: fmt.num(onDuty.length) })}
        </Badge>
        <Badge tone="slate">{t("bmRiders.offlineCount", { n: fmt.num(riders.length - onDuty.length) })}</Badge>
        {updatedAt ? (
          <span className="text-fg-subtle" data-testid="fleet-updated-at">
            {t("bmRiders.refreshedAt", { time: fmt.time(new Date(updatedAt).toISOString()) })}
          </span>
        ) : null}
        {error ? (
          <span className="text-amber-600 dark:text-amber-400" role="status">
            {t("bmRiders.refreshError")}
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RiderFleetMap pins={pins} center={center} focusRiderId={focused} onSelect={setFocused} />

        <div className="min-w-0" data-testid="fleet-on-duty-list">
          {onDuty.length === 0 ? (
            <p className="rounded-xl border border-border-base bg-surface-muted px-3 py-4 text-sm text-fg-muted">
              {t("bmRiders.noOnDuty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {onDuty.map((r) => {
                const located = r.latitude != null && r.longitude != null;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setFocused(r.user)}
                      disabled={!located}
                      data-testid="fleet-on-duty-rider"
                      className={cn(
                        "flex min-h-11 w-full flex-col gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors",
                        focused === r.user
                          ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                          : "border-border-strong hover:bg-surface-hover",
                        located ? "" : "opacity-70",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                        <span className="truncate text-sm font-medium text-fg-base">
                          {r.rider_name || r.rider_username}
                        </span>
                      </span>
                      <span className="text-xs text-fg-subtle">
                        {r.on_duty_since ? t("bmRiders.onDutySince", { time: fmt.time(r.on_duty_since) }) : ""}
                      </span>
                      <span className="text-xs text-fg-subtle">
                        {located
                          ? t("bmRiders.lastPing", { time: fmt.time(r.last_ping_at) })
                          : t("bmRiders.awaitingPing")}
                      </span>
                    </button>
                    {located ? (
                      <a
                        className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline"
                        href={directionsHref(r.latitude as number, r.longitude as number)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("bmRiders.directions")}
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-fg-subtle">{t("bmRiders.privacyNote")}</p>
        </div>
      </div>

      {riders.length === 0 ? (
        <EmptyState title={t("pages.noRiders")} />
      ) : (
        <Table
          headers={[
            t("pages.colRider"),
            t("bmRiders.colStatus"),
            t("common.phone"),
            t("pages.colVehicle"),
            t("pages.colBranch"),
          ]}
        >
          {riders.map((r) => (
            <tr key={r.id} className="hover:bg-surface-hover/70">
              <Td>
                <span className="flex items-center gap-2.5">
                  <UserAvatar name={r.rider_name || r.rider_username} photo={null} className="size-8 text-xs" />
                  <span className="font-medium text-fg-base">{r.rider_name || r.rider_username}</span>
                </span>
              </Td>
              <Td>
                {r.is_online ? (
                  <Badge tone="green" dot>
                    {t("riderLoc.online")}
                  </Badge>
                ) : (
                  <Badge tone="slate">{t("riderLoc.offline")}</Badge>
                )}
              </Td>
              <Td>{r.rider_phone || "—"}</Td>
              <Td>{r.vehicle_type || "—"}</Td>
              <Td>{r.assigned_branch_name ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
