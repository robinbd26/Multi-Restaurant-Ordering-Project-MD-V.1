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
import type { ActionState } from "@/lib/api/action-state";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

export interface ZoneMasterLocality {
  id: number;
  name: string;
  isActive: boolean;
  coverageCount: number;
}

export interface ZoneMasterZone {
  id: number;
  name: string;
  isActive: boolean;
  localities: ZoneMasterLocality[];
}

/**
 * The master zone / locality list, edited by a super admin.
 *
 * Nothing here deletes. A place that is retired is DEACTIVATED: saved customer
 * addresses and placed orders store these names as text, and branches point
 * coverage rows at them, so removing a row would quietly rewrite history.
 * Deactivating stops it being offered and stops it counting as covered, which is
 * the outcome operations actually wants.
 *
 * Each locality shows how many branch coverage rows point at it, so the effect of
 * deactivating one is visible before it is confirmed rather than after.
 *
 * ITEM 4 — renaming an existing zone or locality (the PATCH already supported
 * `name`; only the UI to reach it was missing). Inline, not a separate page:
 * "Edit" swaps the row's name for a text field with Save/Cancel, matching how
 * activate/deactivate already work in place.
 */
export function ZoneMasterManager({ zones }: { zones: ZoneMasterZone[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newZone, setNewZone] = useState("");
  const [newLocality, setNewLocality] = useState<Record<number, string>>({});
  const [editingZoneId, setEditingZoneId] = useState<number | null>(null);
  const [zoneDraft, setZoneDraft] = useState("");
  const [editingLocalityId, setEditingLocalityId] = useState<number | null>(null);
  const [localityDraft, setLocalityDraft] = useState("");

  /**
   * One fetch path for every mutation, returning the app's ActionState so the
   * confirm dialogs can show a failure in place instead of closing over it.
   */
  async function mutate(url: string, method: "POST" | "PATCH", body: unknown): Promise<ActionState> {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
  const totalLocalities = zones.reduce((n, zone) => n + zone.localities.length, 0);

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
            {t("deliveryZone.zonesCount")}: <strong>{activeZones}</strong> ·{" "}
            {t("deliveryZone.localitiesCount")}: <strong>{totalLocalities}</strong>
          </p>
        </CardContent>
      </Card>

      {zones.length === 0 ? (
        <EmptyState title={t("deliveryZone.noZones")} description={t("deliveryZone.noZonesDesc")} />
      ) : (
        zones.map((zone) => (
          <Card key={zone.id} testId={`zone-card-${zone.id}`}>
            <CardHeader
              title={
                editingZoneId === zone.id ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = zoneDraft.trim();
                      if (!value) return;
                      send(`/api/area-zones/${zone.id}`, "PATCH", { name: value }, () => setEditingZoneId(null));
                    }}
                  >
                    <Input
                      name={`zone_edit_${zone.id}`}
                      value={zoneDraft}
                      onChange={(event) => setZoneDraft(event.target.value)}
                      autoFocus
                      className="h-9 max-w-64 text-sm"
                      data-testid={`zone-edit-name-${zone.id}`}
                    />
                    <Button type="submit" size="sm" disabled={pending || !zoneDraft.trim()} data-testid={`zone-edit-save-${zone.id}`}>
                      {t("common.save")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditingZoneId(null)}>
                      {t("common.cancel")}
                    </Button>
                  </form>
                ) : (
                  zone.name
                )
              }
              subtitle={editingZoneId === zone.id ? undefined : t("deliveryZone.localitiesIn", { zone: zone.name })}
              action={
                editingZoneId === zone.id ? null : (
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge dot tone={zone.isActive ? "green" : "slate"}>
                      {zone.isActive ? t("deliveryZone.activeLabel") : t("deliveryZone.inactiveLabel")}
                    </Badge>
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
                        title={t("deliveryZone.deactivateTitle", { name: zone.name })}
                        description={t("deliveryZone.deactivateBody")}
                        confirmLabel={t("deliveryZone.deactivate")}
                        action={async () => confirmed(`/api/area-zones/${zone.id}`, { is_active: false })}
                      />
                    ) : (
                      <Button
                        size="sm"
                        variant="success"
                        disabled={pending}
                        onClick={() => send(`/api/area-zones/${zone.id}`, "PATCH", { is_active: true })}
                        data-testid={`zone-activate-${zone.id}`}
                      >
                        {t("deliveryZone.reactivate")}
                      </Button>
                    )}
                  </span>
                )
              }
            />
            <CardContent className="space-y-4">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = (newLocality[zone.id] ?? "").trim();
                  if (!value) return;
                  send("/api/area-localities", "POST", { zone_id: zone.id, name: value }, () =>
                    setNewLocality((current) => ({ ...current, [zone.id]: "" })),
                  );
                }}
              >
                <Field
                  label={t("deliveryZone.localityName")}
                  name={`locality_name_${zone.id}`}
                  className="min-w-56 flex-1"
                >
                  <Input
                    name={`locality_name_${zone.id}`}
                    value={newLocality[zone.id] ?? ""}
                    onChange={(event) =>
                      setNewLocality((current) => ({ ...current, [zone.id]: event.target.value }))
                    }
                    placeholder={t("deliveryZone.namePlaceholder")}
                    data-testid={`locality-new-name-${zone.id}`}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={pending || !(newLocality[zone.id] ?? "").trim()}
                  data-testid={`locality-create-${zone.id}`}
                >
                  {t("deliveryZone.addLocality")}
                </Button>
              </form>

              {zone.localities.length === 0 ? (
                <p className="text-sm text-fg-muted">{t("deliveryZone.noLocalities")}</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {zone.localities.map((locality) =>
                    editingLocalityId === locality.id ? (
                      <li
                        key={locality.id}
                        className="flex items-center gap-2 rounded-xl border border-border-base px-3 py-2"
                        data-testid={`locality-row-${locality.id}`}
                      >
                        <form
                          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const value = localityDraft.trim();
                            if (!value) return;
                            send(`/api/area-localities/${locality.id}`, "PATCH", { name: value }, () =>
                              setEditingLocalityId(null),
                            );
                          }}
                        >
                          <Input
                            name={`locality_edit_${locality.id}`}
                            value={localityDraft}
                            onChange={(event) => setLocalityDraft(event.target.value)}
                            autoFocus
                            className="h-9 min-w-0 flex-1 text-sm"
                            data-testid={`locality-edit-name-${locality.id}`}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            disabled={pending || !localityDraft.trim()}
                            data-testid={`locality-edit-save-${locality.id}`}
                          >
                            {t("common.save")}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setEditingLocalityId(null)}>
                            {t("common.cancel")}
                          </Button>
                        </form>
                      </li>
                    ) : (
                      <li
                        key={locality.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border-base px-3 py-2"
                        data-testid={`locality-row-${locality.id}`}
                      >
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-sm font-medium ${
                              locality.isActive ? "text-fg-base" : "text-fg-subtle line-through"
                            }`}
                          >
                            {locality.name}
                          </span>
                          <span className="text-xs text-fg-subtle">
                            {t("deliveryZone.coveredByBranches")}: {locality.coverageCount}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            className="text-sm text-fg-muted hover:underline"
                            data-testid={`locality-edit-${locality.id}`}
                            onClick={() => {
                              setEditingLocalityId(locality.id);
                              setLocalityDraft(locality.name);
                            }}
                          >
                            {t("common.edit")}
                          </button>
                          {locality.isActive ? (
                            <ConfirmModal
                              trigger={
                                <button
                                  type="button"
                                  className="text-sm text-fg-muted hover:underline"
                                  data-testid={`locality-deactivate-${locality.id}`}
                                >
                                  {t("deliveryZone.deactivate")}
                                </button>
                              }
                              title={t("deliveryZone.deactivateTitle", { name: locality.name })}
                              description={t("deliveryZone.deactivateBody")}
                              confirmLabel={t("deliveryZone.deactivate")}
                              action={async () =>
                                confirmed(`/api/area-localities/${locality.id}`, { is_active: false })
                              }
                            />
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                send(`/api/area-localities/${locality.id}`, "PATCH", { is_active: true })
                              }
                              data-testid={`locality-activate-${locality.id}`}
                            >
                              {t("deliveryZone.reactivate")}
                            </Button>
                          )}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
