"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { Table, Td } from "@/components/ui/table";
import type { ActionState } from "@/lib/api/action-state";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

export interface ZoneMasterZone {
  id: number;
  name: string;
  isActive: boolean;
  /** Branches tagged with this zone — what a deactivation would strand. */
  branchCount: number;
  /** Their names: the branches to reassign before the zone can be deleted. */
  branchNames: string[];
}

/**
 * The master ZONE list, edited by a super admin.
 *
 * A zone (Banani, Gulshan, Dhanmondi …) is the grouping tag every branch
 * carries, for filtering and reports. IT IS NOT COVERAGE: where a branch
 * delivers is the shapes its manager draws on the Delivery Areas page, and
 * nothing on this screen can widen or narrow that.
 *
 * A zone that is retired is DEACTIVATED. A zone no branch uses can also be
 * DELETED (it is pure setup data); one still in use cannot (a zone is a required
 * field on every branch), so its delete dialog lists the branches to move to
 * another zone first and offers no button. Each row shows how many branches
 * point at it, so the effect is visible before it is confirmed.
 *
 * The finer locality level this screen used to manage (Sector-5, Nikonjo-1 …) is
 * gone. It existed only so a customer's typed area name could be matched against
 * branch coverage, which is the system the map shapes replaced.
 */
export function ZoneMasterManager({ zones }: { zones: ZoneMasterZone[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newZone, setNewZone] = useState("");
  const [editingZoneId, setEditingZoneId] = useState<number | null>(null);
  const [zoneDraft, setZoneDraft] = useState("");

  /**
   * One fetch path for every mutation, returning the app's ActionState so the
   * confirm dialogs can show a failure in place instead of closing over it.
   */
  async function mutate(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<ActionState> {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const parsed = parseFieldErrors(payload, t("common.error"));
      return {
        error: parsed.formError ?? Object.values(parsed.fieldErrors)[0] ?? t("common.error"),
        fieldErrors: parsed.fieldErrors,
      };
    }
    return { error: null };
  }

  /** The inline (non-dialog) buttons: run it, surface failures above the list. */
  function send(url: string, method: "POST" | "PATCH", body: unknown, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const state = await mutate(url, method, body);
      if (state.error) {
        setError(state.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  /** The dialog form: do the work, refresh, hand the result back to the modal. */
  async function confirmed(url: string, body: unknown): Promise<ActionState> {
    const state = await mutate(url, "PATCH", body);
    if (!state.error) router.refresh();
    return state;
  }

  const activeZones = zones.filter((zone) => zone.isActive).length;

  return (
    <div className="grid gap-5">
      <Alert tone="error" message={error} />

      <Card>
        <CardHeader title={t("deliveryZone.addZone")} subtitle={t("deliveryZone.masterHint")} />
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newZone.trim()) return;
              send("/api/area-zones", "POST", { name: newZone.trim() }, () => setNewZone(""));
            }}
          >
            <Field label={t("deliveryZone.nameLabel")} name="zone_name" className="min-w-56 flex-1">
              <Input
                name="zone_name"
                value={newZone}
                onChange={(event) => setNewZone(event.target.value)}
                placeholder={t("deliveryZone.zoneName")}
                data-testid="zone-new-name"
              />
            </Field>
            <Button type="submit" disabled={pending || !newZone.trim()} data-testid="zone-create">
              {t("deliveryZone.addZone")}
            </Button>
          </form>
          <p className="mt-3 text-sm text-fg-muted">
            {t("deliveryZone.zonesCount")}: <strong>{activeZones}</strong>
          </p>
        </CardContent>
      </Card>

      {zones.length === 0 ? (
        <EmptyState title={t("deliveryZone.noZones")} description={t("deliveryZone.noZonesDesc")} />
      ) : (
        <Card>
          <CardHeader title={t("deliveryZone.title")} subtitle={t("deliveryZone.notCoverageHint")} />
          <CardContent>
            <Table
              headers={[t("deliveryZone.nameLabel"), t("deliveryZone.branchesUsing"), t("common.status"), ""]}
            >
              {zones.map((zone) => (
                <tr key={zone.id} data-testid={`zone-row-${zone.id}`}>
                  <Td>
                    {editingZoneId === zone.id ? (
                      <form
                        className="flex flex-wrap items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const value = zoneDraft.trim();
                          if (!value) return;
                          send(`/api/area-zones/${zone.id}`, "PATCH", { name: value }, () =>
                            setEditingZoneId(null),
                          );
                        }}
                      >
                        <Input
                          name={`zone_edit_${zone.id}`}
                          value={zoneDraft}
                          onChange={(event) => setZoneDraft(event.target.value)}
                          autoFocus
                          className="h-9 max-w-56 text-sm"
                          data-testid={`zone-edit-name-${zone.id}`}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={pending || !zoneDraft.trim()}
                          data-testid={`zone-edit-save-${zone.id}`}
                        >
                          {t("common.save")}
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditingZoneId(null)}>
                          {t("common.cancel")}
                        </Button>
                      </form>
                    ) : (
                      <span className="font-medium text-fg-base">{zone.name}</span>
                    )}
                  </Td>
                  <Td mono>{zone.branchCount}</Td>
                  <Td>
                    <Badge dot tone={zone.isActive ? "green" : "slate"}>
                      {zone.isActive ? t("deliveryZone.activeLabel") : t("deliveryZone.inactiveLabel")}
                    </Badge>
                  </Td>
                  <Td>
                    {editingZoneId === zone.id ? null : (
                      <span className="flex flex-wrap items-center justify-end gap-3">
                        <button
                          type="button"
                          className="text-sm text-fg-muted hover:underline"
                          data-testid={`zone-edit-${zone.id}`}
                          onClick={() => {
                            setEditingZoneId(zone.id);
                            setZoneDraft(zone.name);
                          }}
                        >
                          {t("common.edit")}
                        </button>
                        {zone.isActive ? (
                          <ConfirmModal
                            trigger={
                              <button
                                type="button"
                                className="text-sm text-fg-muted hover:underline"
                                data-testid={`zone-deactivate-${zone.id}`}
                              >
                                {t("deliveryZone.deactivate")}
                              </button>
                            }
                            title={t("deliveryZone.confirmDeactivateZone", { name: zone.name })}
                            description={
                              zone.branchCount > 0
                                ? t("deliveryZone.deactivateZoneInUse", { count: zone.branchCount })
                                : t("deliveryZone.deactivateZoneDescription")
                            }
                            confirmLabel={t("deliveryZone.deactivate")}
                            action={() => confirmed(`/api/area-zones/${zone.id}`, { is_active: false })}
                          />
                        ) : (
                          <button
                            type="button"
                            className="text-sm text-fg-muted hover:underline"
                            data-testid={`zone-activate-${zone.id}`}
                            onClick={() => send(`/api/area-zones/${zone.id}`, "PATCH", { is_active: true })}
                          >
                            {t("deliveryZone.activate")}
                          </button>
                        )}
                        <ConfirmModal
                          trigger={
                            <button
                              type="button"
                              className="text-sm text-red-600 hover:underline"
                              data-testid={`zone-delete-${zone.id}`}
                            >
                              {t("deliveryZone.deleteZone")}
                            </button>
                          }
                          title={t("deliveryZone.confirmDeleteZone", { name: zone.name })}
                          description={
                            zone.branchCount > 0
                              ? t("deliveryZone.deleteZoneInUse", { count: zone.branchCount })
                              : t("deliveryZone.deleteZoneDescription")
                          }
                          details={
                            zone.branchCount > 0 ? (
                              <ul className="list-disc pl-5 text-sm text-fg-base" data-testid={`zone-delete-branches-${zone.id}`}>
                                {zone.branchNames.map((name) => (
                                  <li key={name}>{name}</li>
                                ))}
                              </ul>
                            ) : undefined
                          }
                          confirmDisabled={zone.branchCount > 0}
                          confirmLabel={t("deliveryZone.deleteZoneConfirm")}
                          action={async () => {
                            const state = await mutate(`/api/area-zones/${zone.id}`, "DELETE");
                            if (!state.error) router.refresh();
                            return state;
                          }}
                        />
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
