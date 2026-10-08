"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/layout/icons";
import { MapPicker, type PickedPoint } from "@/components/maps/map-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, Input } from "@/components/ui/input";
import {
  deleteAddressAction,
  saveAddressAction,
  setDefaultAddressAction,
} from "@/lib/api/actions";
import {
  labelForNickname,
  nicknameDisplay,
  nicknameFromLabel,
  type NicknameKind,
} from "@/lib/addresses/nickname";
import { useTranslation } from "@/lib/i18n/use-translation";
import { LIMITS } from "@/lib/validation/limits";
import { cn } from "@/lib/utils";

function coord(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? value.toFixed(6) : "";
}

export interface AddressT {
  id: number;
  label: string;
  custom_label?: string;
  display_label?: string;
  address: string;
  area?: string;
  main_area?: string;
  sub_area?: string;
  custom_area?: string;
  road_lane?: string;
  custom_road?: string;
  house_plot?: string;
  flat_number?: string;
  landmark?: string;
  map_address?: string;
  place_id?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  instructions?: string;
  latitude?: number | null;
  longitude?: number | null;
  is_default: boolean;
  is_active?: boolean;
}

function iconForLabel(rawLabel: string): string {
  const { kind } = nicknameFromLabel(rawLabel);
  if (kind === "office") return "briefcase";
  if (kind === "home") return "home";
  return "pin";
}

/** "Flat 3A, House 25, Road 11, Banani, Dhaka" from the typed parts. */
function manualAddressLine(parts: { extra: string; house: string; road: string; area: string }): string {
  return [parts.extra, parts.house, parts.road, parts.area, parts.area ? "Dhaka" : ""]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(", ");
}

type Mode = "map" | "manual";
type Coverage =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "covered"; branch: string }
  | { state: "pickup_only" }
  | { state: "outside" }
  | { state: "error" };

/**
 * My Addresses: the customer's saved-address book, and nothing else (live
 * location lives under "Choose your current location" on the storefront).
 *
 * Adding an address has TWO SEPARATE MODES, never mixed:
 *
 *   · Pick on map (default) — "Use my current location" first, or search, or
 *     drag the pin. The address fills itself from the pin (reverse geocoding);
 *     the customer only picks a label and may add one line for the flat, floor
 *     or landmark (the map cannot know the flat number, and riders need it).
 *     "Confirm location" saves.
 *   · Enter manually — the fallback: area, road, house, flat. The pin is still
 *     required (coverage is decided from it and nothing else, and the server
 *     refuses an address without one), so "Find on map" places it from the
 *     typed address and the customer can nudge it.
 *
 * The old form showed every manual field in map mode and hid the map — and
 * with it the only way to set the pin — in manual mode, so a manual address
 * could never actually be saved. That was the "vanishing map".
 *
 * Before saving, the pin is checked against EVERY branch's area, so an address
 * nobody delivers to is called out here rather than at checkout.
 */
export function AddressManager({ addresses }: { addresses: AddressT[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AddressT | null>(null);
  const [mode, setMode] = useState<Mode>("map");
  const [nickname, setNickname] = useState<NicknameKind>("home");
  const [otherName, setOtherName] = useState("");
  // The one optional line for what the map cannot know.
  const [extra, setExtra] = useState("");
  // Manual mode fields.
  const [area, setArea] = useState("");
  const [road, setRoad] = useState("");
  const [house, setHouse] = useState("");
  // The pin and what reverse geocoding said about it.
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [mapAddress, setMapAddress] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [pinArea, setPinArea] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [locating, setLocating] = useState(false);
  const [locateMessage, setLocateMessage] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Coverage>({ state: "idle" });

  const hasPin = lat.trim() !== "" && lng.trim() !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  // The server caps ACTIVE addresses; deactivated rows do not take a slot.
  const activeCount = addresses.filter((a) => a.is_active !== false).length;
  const atCap = !editing && activeCount >= LIMITS.maxSavedAddresses;

  function resetForm(next: AddressT | null) {
    setEditing(next);
    const nick = next ? nicknameFromLabel(next.label, next.custom_label) : { kind: "home" as NicknameKind, custom: "" };
    setNickname(nick.kind);
    setOtherName(nick.custom);
    setExtra(next ? next.flat_number || next.landmark || "" : "");
    setArea(next ? next.main_area || next.area || "" : "");
    setRoad(next ? next.road_lane || next.custom_road || "" : "");
    setHouse(next ? next.house_plot || "" : "");
    setLat(next ? coord(next.latitude) : "");
    setLng(next ? coord(next.longitude) : "");
    setMapAddress(next?.map_address ?? "");
    setPlaceId(next?.place_id ?? "");
    setPinArea(next?.area ?? "");
    setCity(next?.city ?? "");
    setPostalCode(next?.postal_code ?? "");
    setCountry(next?.country ?? "");
    setIsDefault(next ? next.is_default : addresses.length === 0);
    // An address typed by hand (structured parts, no map text) reopens in the
    // manual mode it was made in; everything else opens on the map.
    const typed = next && !next.map_address && (next.road_lane || next.house_plot || next.main_area);
    setMode(typed ? "manual" : "map");
    setError(null);
    setFieldErrors({});
    setLocateMessage(null);
    setCoverage({ state: "idle" });
    setShowForm(true);
  }

  const handlePick = useCallback((point: PickedPoint) => {
    setLat(point.lat);
    setLng(point.lng);
    setMapAddress(point.address);
    setPlaceId(point.placeId);
    setPinArea(point.area);
    if (point.city) setCity(point.city);
    if (point.postalCode) setPostalCode(point.postalCode);
    if (point.country) setCountry(point.country);
    setFieldErrors((e) => ({ ...e, pin: "" }));
  }, []);

  // Coverage across EVERY branch, re-checked whenever the pin settles.
  useEffect(() => {
    if (!showForm || !hasPin) return;
    let alive = true;
    const timer = setTimeout(async () => {
      setCoverage({ state: "checking" });
      try {
        const res = await fetch("/api/delivery/point-coverage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: Number(lat), lng: Number(lng) }),
        });
        if (!alive) return;
        if (!res.ok) return setCoverage({ state: "error" });
        const data = (await res.json()) as { covered: boolean; pickup_only: boolean; branches: { name: string }[] };
        if (!alive) return;
        if (data.covered) setCoverage({ state: "covered", branch: data.branches[0]?.name ?? "" });
        else if (data.pickup_only) setCoverage({ state: "pickup_only" });
        else setCoverage({ state: "outside" });
      } catch {
        if (alive) setCoverage({ state: "error" });
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [showForm, hasPin, lat, lng]);

  /** Manual mode: place the pin from the typed address (server geocoder). */
  async function findOnMap() {
    setLocateMessage(null);
    if (!area.trim()) {
      setFieldErrors((e) => ({ ...e, area: t("validation.required") }));
      return;
    }
    setLocating(true);
    try {
      const query = [house, road, area, "Dhaka"].map((p) => p.trim()).filter(Boolean).join(", ");
      const res = await fetch("/api/geo/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 1 }),
      });
      const data = res.ok
        ? ((await res.json()) as { results: { lat: number; lng: number; address: string; area: string; placeId: string }[] })
        : { results: [] };
      const hit = data.results?.[0];
      if (!hit) {
        setLocateMessage(t("addresses.locateNotFound"));
        return;
      }
      setLat(hit.lat.toFixed(6));
      setLng(hit.lng.toFixed(6));
      setMapAddress(hit.address);
      setPlaceId(hit.placeId);
      setPinArea(hit.area);
      setLocateMessage(t("addresses.locateFound"));
      setFieldErrors((e) => ({ ...e, pin: "" }));
    } catch {
      setLocateMessage(t("addresses.locateNotFound"));
    } finally {
      setLocating(false);
    }
  }

  function save() {
    const errors: Record<string, string> = {};
    if (mode === "manual" && !area.trim()) errors.area = t("validation.required");
    if (!hasPin) errors.pin = mode === "map" ? t("addresses.pinRequiredMap") : t("addresses.pinRequiredManual");
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    setError(null);

    const extraText = extra.trim();
    const typedLine = manualAddressLine({ extra: extraText, house, road, area });
    const mapLine = [extraText, mapAddress.trim()].filter(Boolean).join(", ");
    const address =
      mode === "manual"
        ? typedLine
        : mapLine || [extraText, pinArea.trim(), city.trim()].filter(Boolean).join(", ") || t("addresses.pinnedLocation");

    start(async () => {
      const res = await saveAddressAction(editing?.id ?? null, {
        label: labelForNickname(nickname),
        custom_label: nickname === "custom" ? otherName.trim() : "",
        address,
        area: (mode === "manual" ? area : pinArea).trim(),
        city: city.trim() || "Dhaka",
        country: country.trim() || "Bangladesh",
        postal_code: postalCode.trim(),
        latitude: Number(lat),
        longitude: Number(lng),
        is_default: isDefault,
        // The map mode's address comes from the pin; the typed parts belong to
        // manual mode only, so a re-picked pin never keeps a stale road.
        main_area: mode === "manual" ? area.trim() : pinArea.trim(),
        sub_area: "",
        custom_area: "",
        road_lane: mode === "manual" ? road.trim() : "",
        custom_road: "",
        house_plot: mode === "manual" ? house.trim() : "",
        flat_number: extraText,
        landmark: "",
        map_address: mapAddress.trim(),
        place_id: placeId,
      });
      if (res.error || Object.keys(res.fieldErrors ?? {}).length > 0) {
        setError(res.error ?? Object.values(res.fieldErrors ?? {})[0] ?? t("common.error"));
        return;
      }
      setShowForm(false);
      router.refresh();
    });
  }

  const labelChoices: { kind: NicknameKind; text: string; icon: string }[] = [
    { kind: "home", text: t("addresses.nicknameHome"), icon: "home" },
    { kind: "office", text: t("addresses.nicknameOffice"), icon: "briefcase" },
    { kind: "custom", text: t("addresses.nicknameCustom"), icon: "pin" },
  ];

  if (!showForm) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg-muted" data-testid="address-count">
            {t("addresses.countOfMax", { n: activeCount, max: LIMITS.maxSavedAddresses })}
          </p>
          <Button onClick={() => resetForm(null)} disabled={atCap} data-testid="add-address">
            <Icon name="plus" className="size-4" /> {t("addresses.add")}
          </Button>
        </div>
        {atCap ? <Alert tone="info" message={t("addresses.capReached", { max: LIMITS.maxSavedAddresses })} /> : null}

        {addresses.length === 0 ? (
          <Card>
            <EmptyState
              title={t("addresses.emptyTitle")}
              description={t("addresses.emptyDesc")}
              action={
                <Button size="sm" onClick={() => resetForm(null)}>
                  {t("addresses.add")}
                </Button>
              }
            />
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {addresses.map((a) => (
              <li key={a.id}>
                <Card className="h-full" testId={`saved-address-${a.id}`}>
                  <CardContent className="flex h-full flex-col p-4">
                    <div className="flex items-center gap-2">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                        <Icon name={iconForLabel(a.label)} className="size-4" />
                      </span>
                      <span className="font-semibold text-fg-base">{nicknameDisplay(a, t)}</span>
                      {a.is_default ? (
                        <span
                          className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25"
                          data-testid="addr-default-badge"
                        >
                          {t("addresses.default")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-fg-base line-clamp-3" data-testid="saved-address-text">
                      {a.address || a.map_address || a.area}
                    </p>
                    {a.latitude != null && a.longitude != null ? (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline"
                      >
                        {t("addresses.viewOnMap")}
                      </a>
                    ) : null}
                    <div className="mt-auto flex items-center gap-3 pt-3 text-sm">
                      <button type="button" onClick={() => resetForm(a)} className="font-medium text-fg-muted hover:text-brand-600 hover:underline">
                        {t("common.edit")}
                      </button>
                      {!a.is_default ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              await setDefaultAddressAction(a.id);
                              router.refresh();
                            })
                          }
                          className="font-medium text-fg-muted hover:text-brand-600 hover:underline"
                        >
                          {t("addresses.setDefault")}
                        </button>
                      ) : null}
                      <ConfirmModal
                        trigger={
                          <button type="button" className="font-medium text-red-600 hover:underline">
                            {t("common.delete")}
                          </button>
                        }
                        title={t("addresses.deleteTitle")}
                        description={t("addresses.deleteDesc")}
                        confirmLabel={t("common.delete")}
                        action={async () => {
                          const res = await deleteAddressAction(a.id);
                          router.refresh();
                          return res;
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form
      className="mx-auto w-full max-w-4xl"
      data-testid="address-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Card>
        <CardContent className="space-y-5 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-bold text-fg-base">
                {editing ? t("addresses.editDeliveryAddress") : t("addresses.addDeliveryAddress")}
              </h2>
              <p className="mt-0.5 text-sm text-fg-subtle">{t("addresses.chooseMethodHint")}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)} data-testid="cancel-address">
              {t("common.cancel")}
            </Button>
          </div>

          <Alert tone="error" message={error} />

          {/* Two clean modes. Switching never hides a control the active mode needs. */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-muted p-1" role="tablist" data-testid="entry-mode">
            {(["map", "manual"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setFieldErrors({});
                  setLocateMessage(null);
                }}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                  mode === m ? "bg-surface-card text-fg-base shadow-sm ring-1 ring-border-base" : "text-fg-muted hover:text-fg-base",
                )}
                data-testid={m === "map" ? "mode-map" : "mode-manual"}
              >
                <Icon name={m === "map" ? "pin" : "edit"} className="size-4" />
                {m === "map" ? t("addresses.pickOnMap") : t("addresses.enterManually")}
              </button>
            ))}
          </div>

          {mode === "map" ? (
            <div className="space-y-2" data-testid="map-mode-section">
              <MapPicker
                label={t("mapPicker.addressTitle")}
                hint={t("addresses.mapModeHint")}
                lat={lat}
                lng={lng}
                onChange={handlePick}
                latName="latitude"
                lngName="longitude"
                latTestId="addr-lat"
                lngTestId="addr-lng"
                testId="addr-map"
                alwaysOpen
                coordinateEntry={false}
                prominentGps
                persistGps
                gpsLabel={t("addresses.useMyCurrentLocation")}
                searchPlaceholder={t("addresses.mapSearchPlaceholder")}
                latError={fieldErrors.pin || undefined}
              />
            </div>
          ) : (
            <div className="space-y-4" data-testid="manual-mode-section">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("addresses.areaField")} name="main_area" required error={fieldErrors.area || undefined}>
                  <Input
                    name="main_area"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    maxLength={80}
                    placeholder={t("addresses.areaPlaceholder")}
                    data-testid="addr-main-area"
                  />
                </Field>
                <Field label={t("addresses.roadOptional")} name="road_lane">
                  <Input
                    name="road_lane"
                    value={road}
                    onChange={(e) => setRoad(e.target.value)}
                    maxLength={80}
                    placeholder={t("addresses.roadLanePlaceholder")}
                    data-testid="addr-road-lane"
                  />
                </Field>
                <Field label={t("addresses.houseOptional")} name="house_plot">
                  <Input
                    name="house_plot"
                    value={house}
                    onChange={(e) => setHouse(e.target.value)}
                    maxLength={80}
                    placeholder={t("addresses.housePlotPlaceholder")}
                    data-testid="addr-house-plot"
                  />
                </Field>
              </div>
              <div className="space-y-2 rounded-xl border border-border-base p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-fg-muted">{t("addresses.manualPinHint")}</p>
                  <Button type="button" variant="outline" size="sm" onClick={findOnMap} disabled={locating} data-testid="addr-find-on-map">
                    {locating ? t("mapPicker.searching") : t("addresses.findOnMap")}
                  </Button>
                </div>
                {locateMessage ? <p className="text-xs text-fg-subtle" data-testid="addr-locate-message">{locateMessage}</p> : null}
                <MapPicker
                  label={t("addresses.pinForRider")}
                  lat={lat}
                  lng={lng}
                  onChange={handlePick}
                  latName="latitude"
                  lngName="longitude"
                  latTestId="addr-lat"
                  lngTestId="addr-lng"
                  testId="addr-manual-map"
                  alwaysOpen
                  coordinateEntry={false}
                  latError={fieldErrors.pin || undefined}
                />
              </div>
            </div>
          )}

          {/* What the map cannot know: one optional line, both modes. */}
          <Field label={t("addresses.extraField")} name="flat_number" hint={t("addresses.extraHint")}>
            <Input
              name="flat_number"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              maxLength={80}
              placeholder={t("addresses.extraPlaceholder")}
              data-testid="addr-flat-number"
            />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-fg-base">{t("addresses.nicknameField")}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" data-testid="addr-nickname">
              {labelChoices.map((choice) => (
                <button
                  key={choice.kind}
                  type="button"
                  role="radio"
                  aria-checked={nickname === choice.kind}
                  onClick={() => setNickname(choice.kind)}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                    nickname === choice.kind
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
                      : "border-border-strong text-fg-muted hover:border-brand-300",
                  )}
                  data-testid={`addr-nickname-${choice.kind}`}
                >
                  <Icon name={choice.icon} className="size-4" />
                  {choice.text}
                </button>
              ))}
            </div>
            {nickname === "custom" ? (
              <div className="mt-3 max-w-sm">
                <Input
                  name="location_name"
                  value={otherName}
                  onChange={(e) => setOtherName(e.target.value)}
                  maxLength={40}
                  placeholder={t("addresses.otherNamePlaceholder")}
                  aria-label={t("addresses.otherNameLabel")}
                  data-testid="addr-location-name"
                />
              </div>
            ) : null}
          </div>

          {hasPin ? (
            <div
              className={cn(
                "rounded-xl px-4 py-3 text-sm ring-1",
                coverage.state === "covered" && "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/25",
                (coverage.state === "outside" || coverage.state === "pickup_only") &&
                  "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25",
                (coverage.state === "checking" || coverage.state === "idle" || coverage.state === "error") &&
                  "bg-surface-muted text-fg-muted ring-border-base",
              )}
              role="status"
              aria-live="polite"
              data-testid="addr-coverage"
              data-state={coverage.state}
            >
              {coverage.state === "covered"
                ? t("addresses.coverageCovered", { branch: coverage.branch })
                : coverage.state === "pickup_only"
                  ? t("addresses.coverageAnyPickupOnly")
                  : coverage.state === "outside"
                    ? t("addresses.coverageOutsideAll")
                    : coverage.state === "error"
                      ? t("addresses.coverageUnknown")
                      : t("addresses.coverageChecking")}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border-base pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Checkbox
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              label={t("addresses.setAsDefault")}
              data-testid="addr-default-checkbox"
            />
            <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto" data-testid="save-address">
              {pending ? t("common.saving") : mode === "map" ? t("addresses.confirmLocation") : t("addresses.saveAddress")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
