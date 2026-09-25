"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/layout/icons";
import { MapPicker, type PickedPoint } from "@/components/maps/map-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import {
  deleteAddressAction,
  saveAddressAction,
  setDefaultAddressAction,
} from "@/lib/api/actions";
import { accuracyKm, isApproximateFix } from "@/lib/constants/location";
import { useTranslation } from "@/lib/i18n/use-translation";
import { Field, Input, Select } from "@/components/ui/input";
import type { FieldErrors } from "@/lib/validation/contract";
import { maxLength, required } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";
import {
  labelForNickname,
  nicknameDisplay,
  nicknameFromLabel,
  type NicknameKind,
} from "@/lib/addresses/nickname";

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
  const norm = rawLabel.trim().toLowerCase();
  if (norm === "office") return "briefcase";
  if (
    norm === "home" ||
    norm === "home-2" ||
    norm === "home2" ||
    norm === "home 2" ||
    norm === "home-3" ||
    norm === "home3" ||
    norm === "home 3" ||
    norm === "parents' house" ||
    norm === "baba's house" ||
    norm === "father's house"
  )
    return "home";
  return "pin";
}

/**
 * One labelled preview row (§UI clarity): a small muted label above a stronger,
 * readable value. Empty values render NOTHING — never "N/A", "-", or a bare
 * label with a blank value (req #6).
 */
function PreviewRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const text = value.trim();
  if (!text) return null;
  return (
    <div data-testid={testId}>
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="text-sm font-medium text-fg-base">{text}</p>
    </div>
  );
}

function buildAddress(parts: {
  housePlot?: string;
  flatNumber?: string;
  roadLane?: string;
  subArea?: string;
  customArea?: string;
  mainArea?: string;
  customMainArea?: string;
}): string {
  const lines: string[] = [];
  // Human-readable line labels (req #10): "8, b10" alone is unreadable — the
  // customer cannot tell a house number from a road number. Only the parts
  // actually present are labelled and joined, so no empty commas appear.
  const dwelling = [
    parts.housePlot?.trim() ? `House/Plot ${parts.housePlot.trim()}` : "",
    parts.flatNumber?.trim() ? `Flat ${parts.flatNumber.trim()}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (dwelling) lines.push(dwelling);
  const road = parts.roadLane?.trim();
  if (road) lines.push(`Road/Lane ${road}`);
  const area = parts.customArea?.trim() || parts.subArea?.trim();
  if (area) lines.push(area);
  const main = parts.customMainArea?.trim() || parts.mainArea?.trim();
  if (main) lines.push(main);
  // City is handled automatically (never asked on the form); only include it
  // once real address parts exist so an empty form renders no bare "Dhaka".
  if (lines.length > 0) lines.push("Dhaka");
  return lines.join("\n");
}

const RULES: FieldRules = {
  nickname: [required],
  location_name: [maxLength(40)],
  main_area: [maxLength(80)],
  custom_main_area: [maxLength(80)],
  sub_area: [maxLength(80)],
  custom_area: [maxLength(80)],
  // Road/Lane and House/Plot are OPTIONAL free-text fields.
  road_lane: [maxLength(80)],
  house_plot: [maxLength(40)],
  flat_number: [maxLength(40)],
  landmark: [maxLength(80)],
  instructions: [maxLength(200)],
};

export function AddressManager({ addresses }: { addresses: AddressT[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  // The master list from the database wins; the bundled constant is the
  const formRef = useRef<HTMLFormElement>(null);

  const [editing, setEditing] = useState<AddressT | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Foodpanda-style entry: map-first pin picking, with "Add Manually" as a
  // first-class alternative that never requires coordinates.
  const [entryMode, setEntryMode] = useState<"map" | "manual">("map");
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  // Home / Office / Custom. locationName holds the typed name for Custom only.
  const [nickname, setNickname] = useState<NicknameKind>("home");
  const [locationName, setLocationName] = useState("");
  // What the preview shows for the nickname being edited.
  const nicknameText =
    nickname === "custom"
      ? locationName.trim()
      : nickname === "office"
        ? t("addresses.nicknameOffice")
        : t("addresses.nicknameHome");
  const [mainArea, setMainArea] = useState("");
  const [customMainArea, setCustomMainArea] = useState("");
  const [subArea, setSubArea] = useState("");
  const [customArea, setCustomArea] = useState("");
  const [roadLane, setRoadLane] = useState("");
  const [housePlot, setHousePlot] = useState("");
  const [flatNumber, setFlatNumber] = useState("");
  const [landmark, setLandmark] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [addressText, setAddressText] = useState("");
  // The reverse-geocoded text of the CURRENTLY SELECTED PIN.
  // Dedicated state so a map pick is never overwritten or dropped by the
  // manual fields: it is re-set on every pick and saved as `map_address`.
  const [mapAddress, setMapAddress] = useState("");
  // The provider's place code for the selected pin ("" when the
  // geocoder did not supply one, or when typing a manual address). Kept with
  // the other map data in the MAIN form state, saved as `place_id`.
  const [placeId, setPlaceId] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);

  const crossValidate = useCallback(
    (values: Record<string, string>): FieldErrors => {
      const errors: FieldErrors = {};
      // A Custom nickname needs the name itself; Home and Office do not.
      if (values.nickname === "custom" && !values.location_name?.trim()) {
        errors.location_name = t("validation.required");
      }
      // THE PIN is the one thing an address cannot be saved without: coverage
      // is decided from it and from nothing else. The area/road text below is
      // for the rider to find the door and is never matched against anything.
      if (!values.latitude?.trim() || !values.longitude?.trim()) {
        errors.latitude = t("addresses.pinRequired");
      }
      return errors;
    },
    [t],
  );

  const resolvedMainArea = mainArea.trim() || customMainArea.trim();
  const resolvedSubArea = subArea.trim() || customArea.trim();
  const resolvedRoadLane = roadLane.trim();

  // Map-mode data quality: a picked pin must be explicitly confirmed before the
  // address can be saved. Manual mode never blocks on coordinates.
  const coordsPicked = lat.trim() !== "" && lng.trim() !== "";
  const saveBlocked = entryMode === "map" && coordsPicked && !locationConfirmed;

  const previewAddress = buildAddress({
    housePlot: housePlot.trim(),
    flatNumber: flatNumber.trim(),
    roadLane: resolvedRoadLane,
    subArea: resolvedSubArea,
    customArea: "",
    mainArea: resolvedMainArea,
    customMainArea: "",
  });

  function openCreate() {
    setEditing(null);
    setMainArea("");
    setCustomMainArea("");
    setSubArea("");
    setCustomArea("");
    setRoadLane("");
    setHousePlot("");
    setFlatNumber("");
    setLandmark("");
    setLat("");
    setLng("");
    setAccuracy(null);
    setAddressText("");
    setMapAddress("");
    setPlaceId("");
    setArea("");
    setCity("");
    setPostalCode("");
    setCountry("");
    setInstructions("");
    setIsDefault(addresses.length === 0);
    setNickname("home");
    setLocationName("");
    setError(null);
    setServerErrors({});
    resetErrors();
    setLocationConfirmed(false);
    setEntryMode("map");
    setShowForm(true);
  }

  function openEdit(a: AddressT) {
    setEditing(a);

    // Free text both ways now, so a saved row round-trips exactly. The legacy
    // custom_* columns are folded into the plain fields — they only ever existed
    // because the visible ones were dropdowns.
    setMainArea(a.main_area ?? "");
    setCustomMainArea("");
    setSubArea(a.sub_area || a.custom_area || "");
    setCustomArea("");

    // Road/Lane is a free-text field; a legacy custom road value becomes the text.
    setRoadLane(a.road_lane ?? a.custom_road ?? "");

    setHousePlot(a.house_plot ?? "");
    setFlatNumber(a.flat_number ?? "");
    setLandmark(a.landmark ?? "");
    setLat(coord(a.latitude));
    setLng(coord(a.longitude));
    setAccuracy(null);
    setAddressText(a.address);
    setMapAddress(a.map_address ?? "");
    setPlaceId(a.place_id ?? "");
    setArea(a.area ?? "");
    setCity(a.city ?? "");
    setPostalCode(a.postal_code ?? "");
    setCountry(a.country ?? "");
    setInstructions(a.instructions ?? "");
    setIsDefault(a.is_default);

    // Legacy rows may hold the Bangla words themselves; they still read as
    // Home / Office rather than as an unexplained custom name.
    const nick = nicknameFromLabel(a.label, a.custom_label);
    setNickname(nick.kind);
    setLocationName(nick.custom);

    setError(null);
    setServerErrors({});
    resetErrors();
    // An address with stored coordinates reopens in map mode (already trusted);
    // a manual-only address reopens in manual mode with no map required.
    const hasSavedCoords = a.latitude != null && a.longitude != null;
    setEntryMode(hasSavedCoords ? "map" : "manual");
    setLocationConfirmed(hasSavedCoords);
    setShowForm(true);
  }

  const handlePick = useCallback((point: PickedPoint) => {
    setLat(point.lat);
    setLng(point.lng);
    setAccuracy(typeof point.accuracy === "number" && Number.isFinite(point.accuracy) ? point.accuracy : null);
    // A moved/re-selected pin must be re-confirmed before it can be saved.
    setLocationConfirmed(false);
    // ALWAYS overwrite the map text with THIS pin's reverse-geocoded address —
    // a second pick must never leave the previous location's text behind
    // (the "addressText only if empty" behaviour below stays only as a
    // legacy fallback for the `address` column).
    setMapAddress(point.address);
    // Same for the place id: every pick carries ITS OWN place_id (or ""),
    // so the saved record always points at the location the customer last chose.
    setPlaceId(point.placeId);
    if (point.address) setAddressText((current) => (current.trim() === "" ? point.address : current));
    if (point.area) setArea(point.area);
    if (point.city) setCity(point.city);
    if (point.postalCode) setPostalCode(point.postalCode);
    if (point.country) setCountry(point.country);
  }, []);

  const handleFormValid = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const hasCoords =
      lat.trim() !== "" && lng.trim() !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

    const fullAddress = buildAddress({
      housePlot: housePlot.trim(),
      flatNumber: flatNumber.trim(),
      roadLane: resolvedRoadLane,
      subArea: resolvedSubArea,
      customArea: "",
      mainArea: resolvedMainArea,
      customMainArea: "",
    });

    start(async () => {
      const res = await saveAddressAction(editing?.id ?? null, {
        label: labelForNickname(nickname),
        custom_label: nickname === "custom" ? locationName.trim() : "",
        address: fullAddress || mapAddress.trim() || addressText.trim(),
        area: area.trim(),
        city: city.trim() || "Dhaka",
        country: country.trim() || "Bangladesh",
        postal_code: postalCode.trim(),
        instructions: instructions.trim(),
        latitude: hasCoords ? Number(lat) : null,
        longitude: hasCoords ? Number(lng) : null,
        is_default: isDefault,
        main_area: resolvedMainArea,
        sub_area: resolvedSubArea,
        custom_area: "",
        road_lane: roadLane.trim(),
        custom_road: "",
        house_plot: housePlot.trim(),
        flat_number: flatNumber.trim(),
        landmark: landmark.trim(),
        map_address: mapAddress.trim(),
        place_id: placeId,
      });

      setSubmissionId((n) => n + 1);
      setServerErrors(res.fieldErrors ?? {});
      if (res.error || Object.keys(res.fieldErrors ?? {}).length > 0) {
        setError(res.error);
        return;
      }
      setShowForm(false);
      router.refresh();
    });
  }, [
    nickname, locationName, editing, lat, lng, housePlot, flatNumber,
    resolvedRoadLane, resolvedSubArea, resolvedMainArea,
    roadLane, area, city, postalCode, country, instructions, addressText,
    isDefault, router, landmark, mapAddress, placeId,
  ]);

  const { errors, formProps, reset: resetErrors } = useFormValidation(RULES, {
    onSubmitValid: handleFormValid,
    serverErrors,
    submissionId,
    pending,
    validate: crossValidate,
  });

  return (
    <div className="space-y-4">
      {!showForm ? (
        <>
          <div className="flex items-center justify-end gap-3">
            <Button onClick={openCreate} data-testid="add-address">
              <Icon name="plus" className="size-4" /> {t("addresses.add")}
            </Button>
          </div>

          {addresses.length === 0 ? (
            <Card>
              <EmptyState
                title={t("addresses.emptyTitle")}
                description={t("addresses.emptyDesc")}
                action={
                  <Button size="sm" onClick={openCreate}>
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
                        <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                          <Icon name={iconForLabel(a.label)} className="size-4" />
                        </span>
                        <span className="font-semibold text-fg-base">
                          {nicknameDisplay(a, t)}
                        </span>
                        {a.is_default ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 ring-1 ring-emerald-200" data-testid="addr-default-badge">
                            {t("addresses.default")}
                          </span>
                        ) : null}
                      </div>
                      {/* Same labelled clarity as the live preview (req #13):
                          no raw value lists. Legacy records without structured
                          fields still fall back to the saved address string. */}
                      {a.main_area || a.sub_area || a.custom_area || a.road_lane || a.house_plot || a.flat_number || a.landmark ? (
                        <div className="mt-2 space-y-2" data-testid={`saved-address-details-${a.id}`}>
                          <PreviewRow label={t("addresses.previewArea")} value={a.main_area || a.area || ""} />
                          <PreviewRow label={t("addresses.previewSubArea")} value={a.sub_area || a.custom_area || ""} />
                          <PreviewRow label={t("addresses.previewRoadLane")} value={a.road_lane || a.custom_road || ""} />
                          <PreviewRow label={t("addresses.previewHousePlot")} value={a.house_plot || ""} />
                          <PreviewRow label={t("addresses.previewFlat")} value={a.flat_number || ""} />
                          <PreviewRow label={t("addresses.landmark")} value={a.landmark || ""} />
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-fg-muted line-clamp-2">{a.address || a.area}</p>
                      )}
                      {a.latitude != null && a.longitude != null ? (
                        <p className="mt-1 text-xs text-fg-subtle">
                          🗺️ {t("addresses.mapLocation")}: {t("addresses.locationConfirmed")} ({coord(a.latitude)}, {coord(a.longitude)})
                        </p>
                      ) : null}
                      {a.map_address ? (
                        <p className="mt-1 text-xs text-fg-subtle line-clamp-2" data-testid="saved-map-address">
                          🗺️ {t("addresses.mapLocation")}: {a.map_address}
                        </p>
                      ) : null}
                      {a.latitude != null && a.longitude != null ? (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline"
                        >
                          📍 {t("addresses.viewOnMap")}
                        </a>
                      ) : null}
                      <div className="mt-auto pt-3 flex items-center gap-3 text-sm">
                        <button type="button" onClick={() => openEdit(a)} className="font-medium text-fg-muted hover:text-brand-600 hover:underline">
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
        </>
      ) : (
        <form ref={formRef} {...formProps} className="grid gap-4 lg:grid-cols-[360px_1fr]" data-testid="address-form">
          <Card>
            <CardContent className="space-y-2 pt-3">
              <Alert tone="error" message={error} />

              {/* Method chooser — map-first, but "Add Manually" is a first-class
                  path: the customer is never forced to use the map. */}
              <div className="rounded-xl border border-border-strong p-3" data-testid="entry-mode">
                <h3 className="text-sm font-semibold text-fg-base">{t("addresses.addDeliveryAddress")}</h3>
                <p className="mt-0.5 text-xs text-fg-subtle">{t("addresses.chooseMethodHint")}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEntryMode("map")}
                    className={cn(
                      "flex min-h-11 flex-col items-center justify-center rounded-lg border p-2 text-center text-xs font-medium transition-colors",
                      entryMode === "map"
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-border-strong text-fg-muted hover:border-brand-300",
                    )}
                    data-testid="mode-map"
                  >
                    <span aria-hidden="true">🗺️</span> {t("addresses.pickOnMap")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryMode("manual")}
                    className={cn(
                      "flex min-h-11 flex-col items-center justify-center rounded-lg border p-2 text-center text-xs font-medium transition-colors",
                      entryMode === "manual"
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-border-strong text-fg-muted hover:border-brand-300",
                    )}
                    data-testid="mode-manual"
                  >
                    <span aria-hidden="true">📝</span> {t("addresses.addManually")}
                  </button>
                </div>
              </div>

              <Field label={t("addresses.nicknameField")} name="nickname" required error={errors.nickname}>
                <Select
                  name="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value as NicknameKind)}
                  data-testid="addr-nickname"
                >
                  <option value="home">{t("addresses.nicknameHome")}</option>
                  <option value="office">{t("addresses.nicknameOffice")}</option>
                  <option value="custom">{t("addresses.nicknameCustom")}</option>
                </Select>
              </Field>
              {nickname === "custom" ? (
                <Field label={t("addresses.nicknameCustomField")} name="location_name" required error={errors.location_name}>
                  <Input
                    name="location_name"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    maxLength={40}
                    placeholder={t("addresses.nicknameCustomPlaceholder")}
                    data-testid="addr-location-name"
                  />
                </Field>
              ) : null}

              {/* AREA IS TEXT, NOT A GATE. These used to be dropdowns fed by a
                  master locality list, and the pair was matched against branch
                  coverage — which is why a customer whose block was missing from
                  the list was refused. They are prefilled from the pin and freely
                  editable now; coverage is decided by the pin alone. */}
              <Field label={t("addresses.areaField")} name="main_area" error={errors.main_area}>
                <Input
                  name="main_area"
                  value={mainArea}
                  onChange={(e) => setMainArea(e.target.value)}
                  maxLength={80}
                  placeholder={t("addresses.areaPlaceholder")}
                  data-testid="addr-main-area"
                />
              </Field>

              <Field label={t("addresses.subAreaField")} name="sub_area" error={errors.sub_area}>
                <Input
                  name="sub_area"
                  value={subArea}
                  onChange={(e) => setSubArea(e.target.value)}
                  maxLength={80}
                  placeholder={t("addresses.subAreaPlaceholder")}
                  data-testid="addr-sub-area"
                />
              </Field>

              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={t("addresses.selectRoadLane")} name="road_lane" error={errors.road_lane}>
                  <Input
                    name="road_lane"
                    value={roadLane}
                    onChange={(e) => setRoadLane(e.target.value)}
                    maxLength={80}
                    placeholder={t("addresses.roadLanePlaceholder")}
                    data-testid="addr-road-lane"
                  />
                </Field>
                <Field label={t("addresses.housePlot")} name="house_plot" error={errors.house_plot}>
                  <Input
                    name="house_plot"
                    value={housePlot}
                    onChange={(e) => setHousePlot(e.target.value)}
                    maxLength={40}
                    placeholder={t("addresses.housePlotPlaceholder")}
                    data-testid="addr-house-plot"
                  />
                </Field>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={t("addresses.flatNumber")} name="flat_number" error={errors.flat_number}>
                  <Input
                    name="flat_number"
                    value={flatNumber}
                    onChange={(e) => setFlatNumber(e.target.value)}
                    maxLength={40}
                    placeholder={t("addresses.flatNumberPlaceholder")}
                    data-testid="addr-flat-number"
                  />
                </Field>
                <Field label={t("addresses.landmark")} name="landmark" error={errors.landmark}>
                  <Input
                    name="landmark"
                    value={landmark}
                    onChange={(e) => setLandmark(e.target.value)}
                    maxLength={80}
                    placeholder={t("addresses.landmarkPlaceholder")}
                    data-testid="addr-landmark"
                  />
                </Field>
              </div>

              {entryMode === "map" ? (
                <div className="space-y-2" data-testid="map-mode-section">
                  {/* Selected Location — the pin the customer is confirming:
                      reverse-geocoded text when resolved, lat/lng always. */}
                  <div className="rounded-lg bg-surface-muted px-3 py-2" data-testid="selected-location">
                    <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                      {t("addresses.selectedLocation")}
                    </p>
                    {coordsPicked ? (
                      <>
                        <p className="mt-1 text-sm font-medium text-fg-base">
                          {mapAddress.trim() || addressText.trim() || t("mapPicker.selected")}
                        </p>
                        <p className="text-xs text-fg-subtle">{t("mapPicker.coordinates", { lat, lng })}</p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-fg-muted">{t("mapPicker.noneSelected")}</p>
                    )}
                    <div className="mt-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!coordsPicked || locationConfirmed}
                        onClick={() => setLocationConfirmed(true)}
                        data-testid="confirm-location"
                      >
                        {locationConfirmed ? `✓ ${t("addresses.locationConfirmed")}` : t("addresses.confirmLocation")}
                      </Button>
                    </div>
                  </div>
                  <MapPicker
                    label={t("mapPicker.addressTitle")}
                    hint={t("mapPicker.addressHint")}
                    lat={lat}
                    lng={lng}
                    onChange={handlePick}
                    latName="latitude"
                    lngName="longitude"
                    latTestId="addr-lat"
                    lngTestId="addr-lng"
                    testId="addr-map"
                    defaultOpen
                    gpsLabel={t("addresses.useCurrentLocation")}
                    searchPlaceholder={t("addresses.mapSearchPlaceholder")}
                  />
                </div>
              ) : (
                <p className="text-xs text-fg-subtle" data-testid="manual-mode-hint">
                  {t("addresses.manualModeHint")}
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="bg-surface-muted/50">
              <CardContent className="pt-3">
                <h3 className="mb-3 text-sm font-semibold text-fg-base">{t("addresses.addressPreview")}</h3>
                <div className="space-y-3" data-testid="address-preview">
                  {nicknameText ? (
                    <p className="font-semibold text-fg-base">{nicknameText}</p>
                  ) : null}
                  {/* Address Details — every value carries its field label, so
                      "76" is never mistaken for a house number (req #1/#2).
                      Empty fields render no row at all (req #6). */}
                  <PreviewRow label={t("addresses.previewArea")} value={resolvedMainArea} testId="preview-area" />
                  <PreviewRow label={t("addresses.previewSubArea")} value={resolvedSubArea} testId="preview-sub-area" />
                  <PreviewRow label={t("addresses.previewRoadLane")} value={resolvedRoadLane} testId="preview-road-lane" />
                  <PreviewRow label={t("addresses.previewHousePlot")} value={housePlot} testId="preview-house-plot" />
                  <PreviewRow label={t("addresses.previewFlat")} value={flatNumber} testId="preview-flat" />
                  <PreviewRow label={t("addresses.landmark")} value={landmark} testId="preview-landmark" />
                  {!resolvedMainArea &&
                  !resolvedSubArea &&
                  !resolvedRoadLane &&
                  !housePlot.trim() &&
                  !flatNumber.trim() &&
                  !landmark.trim() &&
                  !coordsPicked ? (
                    <p className="text-sm text-fg-subtle">{t("addresses.fillFormToPreview")}</p>
                  ) : null}

                  {/* Map Location — a SEPARATE section from the postal address:
                      GPS/map data never mixes with Road/House/Flat (req #4).
                      Manual mode with no pin shows nothing here (req #5). */}
                  {coordsPicked ? (
                    <div className="rounded-lg border border-border-strong bg-surface-muted/60 p-3" data-testid="preview-map">
                      <p className="text-xs font-semibold text-fg-base">🗺️ {t("addresses.mapLocation")}</p>
                      <div className="mt-2 space-y-2">
                        {mapAddress.trim() || addressText.trim() ? (
                          <PreviewRow label={t("addresses.previewSelectedLocation")} value={mapAddress.trim() || addressText} testId="preview-selected-location" />
                        ) : null}
                        <PreviewRow label={t("addresses.previewLatitude")} value={lat ?? ""} testId="preview-lat" />
                        <PreviewRow label={t("addresses.previewLongitude")} value={lng ?? ""} testId="preview-lng" />
                        {isApproximateFix(accuracy) ? (
                          // A network guess: the picker above already asks for the pin to be moved.
                          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            {t("location.approximateAccuracy", { km: accuracyKm(accuracy!) })}
                          </p>
                        ) : typeof accuracy === "number" && Number.isFinite(accuracy) ? (
                          <p className="text-xs text-fg-subtle">
                            {t("location.accuracy", { m: Math.round(accuracy) })}
                          </p>
                        ) : null}
                        {saveBlocked ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400">⚠ {t("addresses.confirmLocationHint")}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 border-t border-border-strong pt-3">
                  <p className="text-xs font-medium text-fg-base">{t("addresses.fullAddressPreview")}</p>
                  <p className="mt-1 whitespace-pre-line text-xs text-fg-muted">
                    {previewAddress || t("addresses.fillFormToPreview")}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border-strong pt-3">
                  <label className="flex items-center gap-2 text-sm text-fg-muted">
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                      className="size-4 rounded border-border-strong text-brand-500"
                      data-testid="addr-default-checkbox"
                    />
                    {t("addresses.setAsDefault")}
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowForm(false)}
                      data-testid="cancel-address"
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={pending || saveBlocked}
                      onClick={() => formRef.current?.requestSubmit()}
                      data-testid="save-address"
                    >
                      {pending ? t("common.saving") : t("addresses.saveAddress")}
                    </Button>
                  </div>
                </div>
                {saveBlocked ? (
                  <p className="mt-2 text-right text-xs text-amber-600 dark:text-amber-400" data-testid="save-blocked-hint">
                    {t("addresses.confirmLocationHint")}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {addresses.length > 0 ? (
              <div className="space-y-2" data-testid="saved-addresses">
                <h3 className="text-sm font-semibold text-fg-base">{t("addresses.savedAddresses")}</h3>
                {addresses.map((a) => (
                  <Card key={a.id} className="bg-surface-muted/30" testId={`saved-address-${a.id}`}>
                    <CardContent className="py-3">
                      <div className="flex items-center gap-2">
                        <Icon name={iconForLabel(a.label)} className="size-4 text-brand-600" />
                        <span className="text-sm font-medium text-fg-base">
                          {nicknameDisplay(a, t)}
                        </span>
                        {a.is_default ? (
                          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                            {t("addresses.default")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{a.address || a.area}</p>
                      {a.map_address ? (
                        <p className="mt-1 text-xs text-fg-subtle line-clamp-2">🗺️ {t("addresses.mapLocation")}: {a.map_address}</p>
                      ) : null}
                      {a.latitude != null && a.longitude != null ? (
                        <p className="mt-1 text-xs text-fg-subtle">🗺️ {coord(a.latitude)}, {coord(a.longitude)}</p>
                      ) : null}
                      {a.latitude != null && a.longitude != null ? (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline"
                        >
                          📍 {t("addresses.viewOnMap")}
                        </a>
                      ) : null}
                      <div className="mt-2 flex items-center gap-3 text-xs">
                        <button type="button" onClick={() => openEdit(a)} className="font-medium text-fg-muted hover:text-brand-600">
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
                            className="font-medium text-fg-muted hover:text-brand-600"
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
                ))}
              </div>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
