"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { MapPicker, type PickedPoint, type PickerSource } from "@/components/maps/map-picker";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Field, FieldGroup, Input, Select, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { placeOrderAction } from "@/lib/api/actions";
import { useCart } from "@/lib/hooks/use-cart";
import { useTranslation } from "@/lib/i18n/use-translation";
import { CUSTOMER_PAYMENT_METHODS, paymentMethodDef, PAYMENT_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { FieldErrors } from "@/lib/validation/contract";
import { LIMITS } from "@/lib/validation/limits";
import { maxLength, number, oneOf, range, required } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";
import type { PaymentMethod } from "@/types";

const PAYMENT_METHODS = Object.keys(PAYMENT_LABELS);

const RULES: FieldRules = {
  delivery_address: [required, maxLength(LIMITS.longTextMax)],
  payment_method: [required, oneOf(PAYMENT_METHODS)],
  lat: [number, range(LIMITS.latMin, LIMITS.latMax)],
  lng: [number, range(LIMITS.lngMin, LIMITS.lngMax)],
  food_notes: [maxLength(LIMITS.longTextMax)],
  coupon_code: [maxLength(LIMITS.shortTextMax)],
};

interface CoverageResult {
  covered: boolean;
  distance_km: number | null;
  delivery_fee: number;
  nearest_pickup: {
    branch_name: string;
    address: string;
    phone: string;
    distance_km: number | null;
    opening_time: string | null;
    closing_time: string | null;
    directions_url: string | null;
  } | null;
}

/** WS-4.10 — a saved address the customer can deliver to without retyping it. */
interface SavedAddress {
  id: number;
  display_label?: string;
  label: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  is_default: boolean;
}

/** WS-7.1 — a reward voucher the customer minted by burning coins. */
interface RewardVoucher {
  id: number;
  code: string;
  coins: number;
  tk_value: string;
  expires_at: string | null;
}

interface AreaOption {
  id: number;
  name: string;
  is_held: boolean;
  hold_reason: string;
  delivery_charge: string;
  estimated_delivery_minutes: number;
}

interface Quote {
  branch: { id: number; name: string };
  area: { id: number; name: string; delivery_charge: number; estimated_delivery_minutes: number } | null;
  subtotal: number;
  delivery_charge: number;
  prep_time_minutes: number | null;
  delivery_estimate_minutes: number | null;
  overall_estimate_minutes: number | null;
  total: number;
}

/** Checkout: address + delivery area + payment → server-priced order (req #6). */
/** A per-checkout-attempt key. Random is fine: it only needs to be unique. */
function newAttemptKey(): string {
  return `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The field errors this form has somewhere to PUT — every name it reads back as
 * `errors.<name>` below and renders under the matching control.
 *
 * The order API also rejects a checkout on inputs that are NOT controls here:
 * the branch is derived server-side (`branch_id`), the cart lives in the cart
 * store (`items`), and the fulfilment rail is a pair of tabs rather than a
 * validated field (`fulfillment_type`). A message keyed to one of those would
 * be merged into `serverErrors`, matched against no input, and displayed
 * NOWHERE — the customer would tap "Place order" and watch nothing happen.
 * That is reachable in normal use: a branch manager can put their branch on
 * hold (`errors.orders.branchOnHold`) or a branch can fall outside its opening
 * hours (`errors.orders.branchClosed`) while a full cart sits at checkout.
 * `orphanFieldError` below routes anything unrenderable to the form-level
 * Alert instead, so the server's own sentence is always the one shown.
 */
const RENDERED_FIELD_ERRORS = [
  "lat",
  "lng",
  "delivery_area_id",
  "delivery_address",
  "payment_method",
  "food_notes",
  "coupon_code",
  "reward_code",
] as const;

/** The first server message that no control on this form would display. */
function orphanFieldError(fieldErrors: FieldErrors | null | undefined): string | null {
  const rendered = new Set<string>(RENDERED_FIELD_ERRORS);
  for (const [field, message] of Object.entries(fieldErrors ?? {})) {
    if (!rendered.has(field) && message) return message;
  }
  return null;
}

function coordString(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? String(value) : "";
}

export function CheckoutForm({
  defaultAddress,
  defaultLat = null,
  defaultLng = null,
}: {
  defaultAddress: string;
  /** Trusted GPS fix already stored on the customer — pre-fills coverage. */
  defaultLat?: number | null;
  defaultLng?: number | null;
}) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  const { cart, total, clearCart } = useCart();
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [address, setAddress] = useState(defaultAddress);
  const [notes, setNotes] = useState("");
  const [coupon, setCoupon] = useState("");
  // WS-7.1 — the reward voucher being spent ("" = none). Only the CODE is sent;
  // the server re-reads the voucher's Taka value from its own row.
  const [rewardCode, setRewardCode] = useState("");
  const [vouchers, setVouchers] = useState<RewardVoucher[]>([]);
  const [error, setError] = useState<string | null>(null);
  // PHASE R — stable per-attempt idempotency key (see submit()).
  const attemptKey = useRef(newAttemptKey());
  const [pending, startTransition] = useTransition();
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);

  // B1 (coverage/pickup) + B2 (prep estimate)
  const [lat, setLat] = useState(() => coordString(defaultLat));
  const [lng, setLng] = useState(() => coordString(defaultLng));
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [prepMinutes, setPrepMinutes] = useState<number | null>(null);
  const autoCoverageDone = useRef(false);

  // WS-4.1/4.2/4.10 — saved addresses + coordinate provenance. `addressId` is
  // "" while the customer is delivering somewhere other than a saved address;
  // `coordSource` is what the picker CLAIMS, and the server re-derives it.
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressId, setAddressId] = useState("");
  const [coordSource, setCoordSource] = useState<PickerSource | "">("");

  // #1/#6 — delivery-area selector + server-derived summary quote.
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [areaId, setAreaId] = useState<string>("");
  const [quote, setQuote] = useState<Quote | null>(null);

  const branchId = cart.branchId;

  useEffect(() => {
    if (branchId == null) return;
    let active = true;
    fetch(`/api/branches/${branchId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (active && b) setPrepMinutes(b.prep_time_minutes ?? null); })
      .catch(() => {});
    return () => { active = false; };
  }, [branchId]);

  // WS-4.10 — the customer's own saved addresses, so Home/Office can be chosen
  // instead of re-pinning a location that is already on file. The DEFAULT
  // address is preselected (req #7); the customer can switch to any other.
  useEffect(() => {
    let active = true;
    fetch("/api/customer/addresses?active=1")
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((d) => {
        if (!active) return;
        const list: SavedAddress[] = d.results ?? [];
        setSavedAddresses(list);
        const preferred = list.find((a) => a.is_default) ?? list[0];
        if (preferred) selectSavedAddress(String(preferred.id));
      })
      .catch(() => { if (active) setSavedAddresses([]); });
    return () => { active = false; };
    // Runs once on mount; selectSavedAddress only touches state on the first pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WS-7.1 — the customer's spendable reward vouchers. ?vouchers=1 is the light
  // read (no ledger, no daily-login award) so checkout stays cheap on 3G.
  useEffect(() => {
    let active = true;
    fetch("/api/customer/rewards?vouchers=1")
      .then((r) => (r.ok ? r.json() : { redemptions: [] }))
      .then((d) => { if (active) setVouchers(d.redemptions ?? []); })
      .catch(() => { if (active) setVouchers([]); });
    return () => { active = false; };
  }, []);

  // Load the branch's active delivery areas for the selector.
  useEffect(() => {
    if (branchId == null) return;
    let active = true;
    fetch(`/api/branches/${branchId}/delivery-areas`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((d) => { if (active) setAreas(d.results ?? []); })
      .catch(() => { if (active) setAreas([]); });
    return () => { active = false; };
  }, [branchId]);

  const selectedArea = areas.find((a) => String(a.id) === areaId) ?? null;

  // Server-derived quote (subtotal / charge / estimates / total). Recomputed when
  // coverage, area, coordinates or fulfillment change. Delivery needs confirmed
  // coverage + coordinates; pickup can be quoted immediately.
  const refreshQuote = useCallback(async () => {
    if (branchId == null || cart.items.length === 0) { setQuote(null); return; }
    const ready = fulfillment === "pickup" || (coverage?.covered && !!lat && !!lng);
    if (!ready) { setQuote(null); return; }
    try {
      const res = await fetch("/api/delivery/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch_id: branchId,
          fulfillment_type: fulfillment,
          ...(lat && lng ? { lat: Number(lat), lng: Number(lng) } : {}),
          delivery_area_id: fulfillment === "delivery" && areaId ? Number(areaId) : null,
          items: cart.items.map((i) => ({
            product_id: i.productId,
            variation_id: i.variationId ?? undefined,
            variation_type: i.variationType,
            quantity: i.quantity,
          })),
        }),
      });
      if (!res.ok) { setQuote(null); return; }
      setQuote((await res.json()) as Quote);
    } catch {
      setQuote(null);
    }
  }, [branchId, cart.items, fulfillment, coverage, lat, lng, areaId]);

  // Syncs the server-derived quote (an external system) into state whenever the
  // priced inputs change — the canonical use for an effect. The synchronous
  // setQuote(null) clears a stale quote when inputs become invalid.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshQuote(); }, [refreshQuote]);

  const runCoverageCheck = useCallback(async (nextLat: string, nextLng: string) => {
    setError(null);
    if (!nextLat || !nextLng) {
      setCoverageError(t("b1.enterLocation"));
      return;
    }
    if (cart.branchId == null) {
      setCoverageError(t("b1.coverageError"));
      return;
    }
    setCoverageError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/delivery/coverage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: cart.branchId, lat: Number(nextLat), lng: Number(nextLng) }),
      });
      const data = await res.json();
      if (!res.ok) { setCoverageError(t("b1.coverageError")); return; }
      setCoverage(data);
      setFulfillment(data.covered ? "delivery" : "pickup");
    } catch { setCoverageError(t("b1.coverageError")); } finally { setChecking(false); }
  }, [cart.branchId, t]);

  function checkCoverage() {
    void runCoverageCheck(lat, lng);
  }

  /**
   * WS-4.1 — a place chosen on the map. Coverage is re-checked immediately, so
   * the fee and the "we deliver here" verdict follow the pin instead of waiting
   * for a button nobody presses. Choosing a point by map also detaches any saved
   * address: the order must not claim to be going somewhere it is not.
   */
  const handlePick = useCallback(
    (point: PickedPoint) => {
      setLat(point.lat);
      setLng(point.lng);
      setCoordSource(point.source);
      setAddressId("");
      // Only fill the address box when the customer has not written their own.
      if (point.address) setAddress((current) => (current.trim() === "" ? point.address : current));
      // "unverified" means hand-typed coordinates (the no-map fallback): every
      // keystroke would otherwise fire a coverage request on a metered
      // connection, so those keep the explicit "check coverage" button.
      if (point.source !== "unverified" && point.lat && point.lng) {
        void runCoverageCheck(point.lat, point.lng);
      }
    },
    [runCoverageCheck],
  );

  /** WS-4.10 — deliver to a saved address; the SERVER reads its coordinates. */
  function selectSavedAddress(value: string) {
    setAddressId(value);
    const chosen = savedAddresses.find((a) => String(a.id) === value) ?? null;
    if (!chosen) {
      setCoordSource("");
      return;
    }
    setAddress(chosen.address);
    if (chosen.latitude != null && chosen.longitude != null) {
      const nextLat = String(chosen.latitude);
      const nextLng = String(chosen.longitude);
      setLat(nextLat);
      setLng(nextLng);
      setCoordSource("saved_address");
      void runCoverageCheck(nextLat, nextLng);
    }
  }

  // Pre-fill from the customer's trusted GPS and auto-check once the cart
  // branch is known — customers should not re-type coordinates every checkout.
  useEffect(() => {
    if (autoCoverageDone.current) return;
    if (!lat || !lng || cart.branchId == null) return;
    autoCoverageDone.current = true;
    // External coverage API sync — same pattern as refreshQuote.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-shot auto-check
    void runCoverageCheck(lat, lng);
  }, [cart.branchId, lat, lng, runCoverageCheck]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await placeOrderAction({
        branch_id: cart.branchId!,
        // PHASE R — one key per checkout attempt. A double-tap or a retry after
        // a slow response reuses it, and the server returns the order it
        // already created instead of placing a second one.
        idempotency_key: attemptKey.current,
        payment_method: payment,
        delivery_address: address,
        food_notes: notes,
        coupon_code: coupon.trim() || undefined,
        // WS-7.1 — the voucher CODE only. The discount is recomputed server-side
        // from the voucher row and capped there; nothing here is trusted.
        reward_code: rewardCode || undefined,
        items: cart.items.map((i) => ({
          product_id: i.productId,
          variation_id: i.variationId ?? undefined,
          // req #4 — chosen crust; re-validated server-side against the product.
          variation_type: i.variationType,
          quantity: i.quantity,
          food_note: i.foodNote,
        })),
        fulfillment_type: fulfillment,
        ...(fulfillment === "delivery" && areaId ? { delivery_area_id: Number(areaId) } : {}),
        ...(lat && lng ? { lat: Number(lat), lng: Number(lng) } : {}),
        // WS-4.2 — provenance. With a saved address the server reads that row's
        // coordinates and ignores the pair above; the source is only a hint.
        ...(fulfillment === "delivery" && addressId ? { customer_address_id: Number(addressId) } : {}),
        ...(coordSource ? { coord_source: coordSource } : {}),
      });
      setSubmissionId((n) => n + 1);
      setServerErrors(result.fieldErrors ?? {});
      if (result.error || Object.keys(result.fieldErrors ?? {}).length > 0) {
        // A failed order must leave the cart, address, area and payment choice
        // intact so the customer can fix one field and retry. A NEW key is
        // issued for the retry, because the previous attempt did not produce an
        // order to return.
        attemptKey.current = newAttemptKey();
        // A form-level error wins; otherwise fall back to the first field
        // message this form cannot render, so a refusal is never silent.
        setError(result.error ?? orphanFieldError(result.fieldErrors));
        return;
      }
      // Cart is cleared ONLY after a confirmed, successful order.
      clearCart();
      router.push(`/customer/orders/${result.orderId}?placed=1`);
    });
  }

  /**
   * Cross-field rules the string rules cannot express. Each message is attached
   * to the control the customer would actually change.
   */
  const validateCheckout = useCallback((): FieldErrors => {
    const found: FieldErrors = {};
    if (fulfillment === "delivery") {
      // req #8/#28 — a delivery order MUST ride on one of the customer's saved
      // addresses. There is no "continue without an address" path.
      if (!addressId) found.customer_address_id = t("checkout.addressRequired");
      if (!lat || !lng) found.lat = t("b1.deliveryLocationRequired");
      else if (coverage && !coverage.covered) found.lat = t("b1.deliveryUnavailable");
      const area = areas.find((a) => String(a.id) === areaId);
      if (area?.is_held) found.delivery_area_id = t("checkout.areaHeldNote");
    }
    return found;
  }, [addressId, areaId, areas, coverage, fulfillment, lat, lng, t]);

  const { errors, formProps } = useFormValidation(RULES, {
    validate: validateCheckout,
    onSubmitValid: submit,
    serverErrors,
    submissionId,
    pending,
  });

  // Placed AFTER every hook so the hook order never changes between renders.
  if (cart.items.length === 0) {
    return (
      <EmptyState
        title={t("orders.cartEmpty")}
        description={t("orders.cartEmptyCheckoutDesc")}
        action={<ButtonLink href="/customer/branches">{t("orders.viewRestaurants")}</ButtonLink>}
      />
    );
  }

  // req #5/#6/#28 — NO SAVED ADDRESS = NO NEXT STEP. Delivery checkout stops
  // here: no order information, no payment, no submit — the customer must save
  // an address first. The cart is untouched (localStorage), so returning from
  // the address page restores this exact checkout with every item intact.
  // There is deliberately no "continue without address" button; pickup, which
  // needs no delivery address, remains available as the existing alternative.
  if (fulfillment === "delivery" && savedAddresses.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4" data-testid="checkout-address-blocked">
        <Alert tone="warning" message={t("checkout.noSavedAddressTitle")} />
        <p className="text-sm text-fg-muted">{t("checkout.noSavedAddressDesc")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/customer/addresses" data-testid="go-add-address">
            {t("checkout.addDeliveryAddress")}
          </ButtonLink>
          <Button type="button" variant="outline" onClick={() => setFulfillment("pickup")}>
            {t("checkout.pickupInstead")}
          </Button>
        </div>
        {/* The cart stays visible so the customer can see nothing was lost. */}
        <div className="rounded-2xl border border-border-base/80 bg-surface-card p-5">
          <h3 className="font-semibold text-fg-base">{t("checkout.summaryTitle")}</h3>
          <p className="mt-2 text-xs text-fg-subtle">
            {t("checkout.totalItems", { n: fmt.num(cart.items.reduce((s, i) => s + i.quantity, 0)) })}
          </p>
          <ul className="mt-3 space-y-2 border-t border-border-base pt-3 text-sm">
            {cart.items.map((item) => (
              <li key={`${item.productId}:${item.variationId ?? 0}`} className="flex justify-between gap-3">
                <span className="text-fg-muted">
                  {item.name}{item.variationName ? ` · ${item.variationName}` : ""} × {fmt.num(item.quantity)}
                </span>
                <span className="font-medium text-fg-base">
                  {fmt.money(item.unitPrice * item.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-border-base pt-3">
            <span className="font-semibold text-fg-base">{t("checkout.summarySubtotal")}</span>
            <span className="font-bold text-brand-600">{fmt.money(total)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Prefer the server quote; fall back to the client subtotal before a quote exists.
  const subtotal = quote?.subtotal ?? total;
  const deliveryCharge = quote?.delivery_charge ?? 0;
  // WS-7.1 — preview of what the chosen voucher takes off. Mirrors the SERVER
  // policy (coins pay for food only, capped at the subtotal) so the customer is
  // not shown a number the server will refuse to honour. Display only.
  const selectedVoucher = vouchers.find((v) => v.code === rewardCode) ?? null;
  const coinDiscount = selectedVoucher
    ? Math.min(Number(selectedVoucher.tk_value) || 0, subtotal)
    : 0;
  const grandTotal = Math.max(0, (quote?.total ?? total) - coinDiscount);
  const minutes = (n: number | null | undefined) => (n != null ? t("checkout.minutes", { n: fmt.num(n) }) : "—");

  return (
    <form {...formProps} className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Alert tone="error" message={error} />

        {prepMinutes != null ? (
          <p className="rounded-xl bg-brand-50 px-4 py-2.5 text-sm text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" data-testid="prep-estimate">
            ⏱ {t("b2.estimateBeforeOrder", { minutes: prepMinutes })}
          </p>
        ) : null}

        {/* B1 — delivery coverage check + nearest pickup */}
        <div className="rounded-xl border border-border-strong p-4" data-testid="coverage-panel">
          <p className="mb-2 text-sm font-medium text-fg-base">{t("b1.checkCoverageTitle")}</p>

          {/* WS-4.10 — deliver to an address already on file, or pick a new
              place on the map below. No coordinate is ever typed by hand. */}
          {savedAddresses.length > 0 ? (
            <Field label={t("checkout.deliverTo")} name="customer_address_id" className="mb-3">
              <Select
                name="customer_address_id"
                value={addressId}
                onChange={(e) => selectSavedAddress(e.target.value)}
                data-testid="saved-address-select"
              >
                {/* req #8/#28 — every delivery order rides on a SAVED address.
                    The old "Other location" escape hatch is gone: a map pick
                    without saving an address can no longer be submitted. */}
                {savedAddresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.display_label || a.label) + " — " + a.address}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {/* WS-4.1 — the map picker replaces the two decimal-degree boxes. */}
          <MapPicker
            label={t("mapPicker.deliveryTitle")}
            hint={t("mapPicker.deliveryHint")}
            lat={lat}
            lng={lng}
            onChange={handlePick}
            latName="lat"
            lngName="lng"
            latTestId="cov-lat"
            lngTestId="cov-lng"
            latError={errors.lat}
            lngError={errors.lng}
            persistGps
            testId="cov-map"
          />

          <div className="mt-3">
            <Button type="button" variant="outline" size="sm" onClick={checkCoverage} disabled={checking} data-testid="cov-check">
              {checking ? t("common.saving") : t("b1.checkCoverage")}
            </Button>
          </div>
          {/* The coverage check's own message, below the controls it belongs to. */}
          <FieldError id="coverage-error" message={coverageError} />
          {coverage ? (
            coverage.covered ? (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" data-testid="cov-covered">
                ✓ {t("b1.deliveryAvailable")} {coverage.delivery_fee > 0 ? `· ${t("b1.deliveryFee", { fee: coverage.delivery_fee })}` : ""}
              </p>
            ) : (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" data-testid="cov-pickup">
                <p className="font-medium">{t("b1.deliveryUnavailable")}</p>
                {coverage.nearest_pickup ? (
                  <div className="mt-2 space-y-0.5">
                    <p>{t("b1.nearestPickup", { branch: coverage.nearest_pickup.branch_name })}</p>
                    <p className="text-xs">{coverage.nearest_pickup.address}</p>
                    {coverage.nearest_pickup.distance_km != null ? <p className="text-xs">{t("b1.distance", { km: coverage.nearest_pickup.distance_km })}</p> : null}
                    {coverage.nearest_pickup.phone ? <p className="text-xs">📞 {coverage.nearest_pickup.phone}</p> : null}
                    {coverage.nearest_pickup.directions_url ? (
                      <a className="text-xs text-brand-600 underline" href={coverage.nearest_pickup.directions_url} target="_blank" rel="noreferrer">{t("b1.directions")}</a>
                    ) : null}
                    <label className="mt-1 flex items-center gap-2 text-xs font-medium">
                      <input type="checkbox" checked={fulfillment === "pickup"} onChange={(e) => setFulfillment(e.target.checked ? "pickup" : "delivery")} data-testid="cov-pickup-opt" />
                      {t("b1.orderForPickup")}
                    </label>
                  </div>
                ) : null}
              </div>
            )
          ) : null}
        </div>

        {/* #1/#6 — delivery-area selector (delivery only). Held areas disabled. */}
        {fulfillment === "delivery" ? (
          <Field
            label={t("checkout.deliveryArea")}
            name="delivery_area_id"
            hint={t("checkout.deliveryAreaHint")}
            error={errors.delivery_area_id}
          >
            <Select
              name="delivery_area_id"
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              data-testid="area-select"
            >
              <option value="">{t("checkout.selectArea")}</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id} disabled={a.is_held} data-testid={`area-option-${a.id}`}>
                  {a.is_held ? t("checkout.areaPaused", { name: a.name }) : a.name}
                </option>
              ))}
            </Select>
            {selectedArea?.is_held ? (
              <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400" data-testid="area-held-note">
                {t("checkout.areaHeldNote")}
              </p>
            ) : null}
          </Field>
        ) : null}

        <Field label={t("orders.deliveryAddress")} name="delivery_address" required error={errors.delivery_address}>
          <Textarea
            name="delivery_address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={3}
            placeholder={t("orders.addressPlaceholder")}
          />
        </Field>

        {/* One accessible group label + one message for the whole option set —
            never the same error repeated on every payment card. */}
        <FieldGroup
          label={t("orders.paymentMethod")}
          name="payment_method"
          required
          error={errors.payment_method}
        >
          <input type="hidden" name="payment_method" value={payment} />
          <div className="grid gap-3 sm:grid-cols-2">
            {/* req #10 — exactly three customer-facing methods: Cash on
                Delivery, bKash, Bank Transfer (cats:Nagad/Rocket only historical). */}
            {CUSTOMER_PAYMENT_METHODS.map((method) => {
              const def = paymentMethodDef(method)!;
              return (
                <button
                  key={method}
                  type="button"
                  aria-pressed={payment === method}
                  onClick={() => setPayment(method)}
                  className={cn(
                    "rounded-2xl border-2 p-4 text-left transition-colors",
                    payment === method
                      ? "border-brand-500 bg-brand-50"
                      : "border-border-base bg-surface-card hover:border-border-strong",
                  )}
                >
                  <span className="text-xl">{def.icon}</span>
                  <p className="mt-1 font-semibold text-fg-base">{t(def.labelKey)}</p>
                  <p className="text-xs text-fg-muted">{t(def.hintKey)}</p>
                </button>
              );
            })}
          </div>
        </FieldGroup>

        <Field label={t("orders.orderNote")} name="food_notes" error={errors.food_notes}>
          <Textarea
            name="food_notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={t("orders.orderNotePlaceholder")}
          />
        </Field>

        <Field label={t("orders.couponCode")} name="coupon_code" error={errors.coupon_code}>
          <Input
            name="coupon_code"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            placeholder={t("orders.couponPlaceholder")}
            className="uppercase"
          />
        </Field>

        {/* WS-7.1 — spend a reward voucher. Only shown when the customer owns
            one; the value below is a PREVIEW, the server recomputes it from the
            voucher row and caps it at the food subtotal. */}
        {vouchers.length > 0 ? (
          <Field
            label={t("checkout.rewardVoucher")}
            name="reward_code"
            hint={t("checkout.rewardVoucherHint")}
            error={errors.reward_code}
          >
            <Select
              name="reward_code"
              value={rewardCode}
              onChange={(e) => setRewardCode(e.target.value)}
              data-testid="reward-voucher-select"
            >
              <option value="">{t("checkout.noRewardVoucher")}</option>
              {vouchers.map((v) => (
                <option key={v.id} value={v.code}>
                  {`${v.code} · ${fmt.money(Number(v.tk_value))}`}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      {/* Order summary — every money/time value below is server-derived (req #6). */}
      <div className="h-fit rounded-2xl border border-border-base/80 bg-surface-card p-5 shadow-card" data-testid="order-summary">
        <h3 className="font-semibold text-fg-base">{t("checkout.summaryTitle")}</h3>

        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">{t("checkout.summaryBranch")}</dt>
            <dd className="text-right font-medium text-fg-base" data-testid="summary-branch">{quote?.branch.name ?? cart.branchName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">{t("checkout.summaryAddress")}</dt>
            <dd className="max-w-[60%] truncate text-right text-fg-base" data-testid="summary-address" title={address}>{address || "—"}</dd>
          </div>
          {fulfillment === "delivery" ? (
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t("checkout.summaryArea")}</dt>
              <dd className="text-right text-fg-base" data-testid="summary-area">{quote?.area?.name ?? selectedArea?.name ?? "—"}</dd>
            </div>
          ) : null}
        </dl>

        <ul className="mt-3 space-y-2 border-t border-border-base pt-3 text-sm">
          {cart.items.map((item) => (
            <li key={`${item.productId}:${item.variationId ?? 0}`} className="flex justify-between gap-3">
              <span className="text-fg-muted">
                {item.name}{item.variationName ? ` · ${item.variationName}` : ""} × {fmt.num(item.quantity)}
              </span>
              <span className="font-medium text-fg-base">
                {fmt.money(item.unitPrice * item.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1.5 border-t border-border-base pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">{t("checkout.summarySubtotal")}</dt>
            <dd className="font-medium text-fg-base" data-testid="summary-subtotal">{fmt.money(subtotal)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">{t("checkout.summaryDeliveryCharge")}</dt>
            <dd className="font-medium text-fg-base" data-testid="summary-delivery-charge">
              {fulfillment === "pickup" ? t("checkout.pickupNoCharge") : fmt.money(deliveryCharge)}
            </dd>
          </div>
          {coinDiscount > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t("checkout.summaryCoinDiscount")}</dt>
              <dd className="font-medium text-emerald-600 dark:text-emerald-400" data-testid="summary-coin-discount">
                −{fmt.money(coinDiscount)}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">{t("checkout.summaryPrepTime")}</dt>
            <dd className="text-fg-base" data-testid="summary-prep">{minutes(quote?.prep_time_minutes ?? prepMinutes)}</dd>
          </div>
          {fulfillment === "delivery" ? (
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t("checkout.summaryDeliveryTime")}</dt>
              <dd className="text-fg-base" data-testid="summary-delivery-estimate">{minutes(quote?.delivery_estimate_minutes)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">{t("checkout.summaryOverall")}</dt>
            <dd className="text-fg-base" data-testid="summary-overall-estimate">{minutes(quote?.overall_estimate_minutes ?? prepMinutes)}</dd>
          </div>
        </dl>

        <div className="mt-4 flex justify-between border-t border-border-base pt-3">
          <span className="font-semibold text-fg-base">{t("checkout.summaryTotal")}</span>
          <span className="text-lg font-bold text-brand-600" data-testid="summary-total">{fmt.money(grandTotal)}</span>
        </div>
        {!quote ? (
          <p className="mt-2 text-xs text-fg-subtle" data-testid="quote-hint">{t("checkout.quoteHint")}</p>
        ) : null}
        <Button size="lg" type="submit" className="mt-4 w-full" disabled={pending} data-testid="place-order">
          {pending ? <Spinner className="size-4 border-white/40 border-t-white" /> : null}
          {t("orders.confirmOrder")}
        </Button>
        {/* req #15/#29 — the SAME servicing branch the quote (and therefore the
            server-side order create) resolves. Never a random or customer-chosen
            branch: the server re-derives it from the delivery point. */}
        {fulfillment === "delivery" && quote ? (
          <div className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm dark:bg-brand-500/10" data-testid="nearest-branch">
            <p className="font-semibold text-brand-700 dark:text-brand-300">{t("checkout.nearestBranchTitle")}</p>
            <p className="mt-1 font-medium text-fg-base">{quote.branch.name}</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {t("checkout.nearestBranchNote", { branch: quote.branch.name })}
            </p>
          </div>
        ) : null}
      </div>
    </form>
  );
}
