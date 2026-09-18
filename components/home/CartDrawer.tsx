"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useHomeCart } from "@/components/home/home-cart-context";
import { MapPicker, type PickedPoint } from "@/components/maps/map-picker";
import { placeOrderAction } from "@/lib/api/actions";
import { CUSTOMER_PAYMENT_METHODS, paymentMethodDef } from "@/lib/constants";
import {
  CUSTOM_VALUE,
  MAIN_AREA_NAMES,
  subAreasFor,
} from "@/lib/constants/area-data";
import type { AddressZoneOption } from "@/components/customer/address-manager";
import {
  labelForNickname,
  nicknameDisplay,
  type NicknameKind,
} from "@/lib/addresses/nickname";
import { useTranslation } from "@/lib/i18n/use-translation";
import { LIMITS } from "@/lib/validation/limits";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/types";

/* Task 3 — the drawer's checkout state machine. Every step renders INSIDE this
   drawer; nothing navigates to /customer/checkout anymore. */
type CheckoutStep = "cart" | "pickup-confirm" | "address" | "payment" | "overview" | "success";

/** Preset pickup-time offsets (minutes from now); the smallest is the 30-minute
    floor the branch needs to prepare a pickup order. */
const PICKUP_TIME_OFFSETS = [30, 45, 60, 90, 120] as const;

/** Self Pickup — the cart's own branch, fetched once the customer confirms
    intent. A cart is locked to one branch's product catalog (see
    BranchSwitchDialog), so pickup is never a location CHOICE — it is a
    confirmation of the one branch that can actually fulfil this cart. */
interface DrawerPickupBranch {
  id: number;
  name: string;
  pickupEnabled: boolean;
  pickupAddress: string;
  pickupPhone: string;
}

/** Serialized CustomerAddress as returned by /api/customer/addresses. */
interface DrawerSavedAddress {
  id: number;
  display_label?: string;
  label: string;
  custom_label?: string;
  address: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  main_area?: string;
  sub_area?: string;
  road_lane?: string;
  house_plot?: string;
  flat_number?: string;
  landmark?: string;
  is_default: boolean;
}

/**
 * The LIVE delivery check for one saved address against the cart's branch, on
 * the shift running now. Never cached on the address: the same address can be
 * covered by one branch and not another, or by day and not by night.
 */
interface AddressCoverageState {
  status: "checking" | "covered" | "outside" | "error";
  pickupEnabled: boolean;
}

/** /api/delivery/quote response — the subset the drawer renders. */
interface DrawerQuote {
  branch: { id: number; name: string };
  subtotal: number;
  delivery_charge: number;
  /** PHASE 4 — the flat platform fee, on delivery and pickup alike. */
  platform_fee?: number;
  total: number;
}

/** The placed-order receipt rendered by the in-drawer success panel. */
interface DrawerOrderResult {
  orderId: number;
  branchName: string;
  paymentLabel: string;
  needsVerification: boolean;
  addressText: string;
  items: number;
  subtotal: number;
  deliveryFee: number;
  platformFee: number;
  grandTotal: number;
  fulfillmentType: "delivery" | "pickup";
  pickupTimeLabel?: string;
}

/** The card title for a saved address (preset label or the custom name). */
function addressCardLabel(a: DrawerSavedAddress, t: (key: string) => string): string {
  return nicknameDisplay(a, t);
}

/**
 * The order card (req #2/#3/#5/#6). The drawer lists the selected food items as
 * an SL-numbered order table (SL · image · name · qty · unit price · total),
 * shows Subtotal / Delivery fee / Grand Total, names the NEAREST eligible
 * branch (signed-in customers; the cart's own branch otherwise), and carries
 * ONE primary action:
 *
 *   • signed in  → checkout happens IN THIS DRAWER (no navigation): saved
 *                  address check/selection → server quote (delivery fee priced
 *                  at the saved-address coordinates) → payment method →
 *                  confirm via placeOrderAction → success receipt. The
 *                  customer never leaves the page and never re-picks an item.
 *   • signed out → the old "call for order" / "continue to order" buttons are
 *                  GONE; the customer is asked to create an account or log in
 *                  (req #6). The cart survives the login round-trip and the
 *                  SAME in-drawer checkout opens once they return signed in.
 *
 * `signedIn` decides which of the two paths renders.
 */
export function CartDrawer({
  signedIn = false,
  customerName = null,
  customerPhone = null,
  zones = [],
  platformClosed = false,
}: {
  signedIn?: boolean;
  customerName?: string | null;
  customerPhone?: string | null;
  /** The master zone list; the add-address form offers these names only. */
  zones?: AddressZoneOption[];
  /**
   * ITEM 5 — 04:00–11:00 Dhaka: the whole platform is closed, delivery and
   * pickup alike, at every branch. Computed server-side (app/page.tsx) once
   * per page load, so it reflects Dhaka time rather than the visitor's own
   * clock. Browsing and the cart itself stay open; this only blocks the two
   * buttons that would START checkout, which is what stops anything further.
   */
  platformClosed?: boolean;
}) {
  const { lines, count, total, isOpen, closeCart, setQty, remove, clear, cartBranchId, cartBranchName } =
    useHomeCart();
  const { t, fmt } = useTranslation();
  const [confirmClear, setConfirmClear] = useState(false);
  // Server-calculated nearest ELIGIBLE branch (req #5) — signed-in customers
  // only; guests see the cart's own branch instead.
  const [nearestBranch, setNearestBranch] = useState<string | null>(null);

  /* ── Task 3 — same-screen checkout state (everything renders in-drawer) ── */
  const [step, setStep] = useState<CheckoutStep>("cart");
  const [fulfillmentType, setFulfillmentType] = useState<"delivery" | "pickup">("delivery");
  const [pickupBranch, setPickupBranch] = useState<DrawerPickupBranch | null>(null);
  const [loadingPickupBranch, setLoadingPickupBranch] = useState(false);
  const [pickupBranchError, setPickupBranchError] = useState<string | null>(null);
  const [pickupTimeMinutes, setPickupTimeMinutes] = useState<number>(PICKUP_TIME_OFFSETS[0]);
  // Captured once when Self Pickup starts (an event handler, not render) so the
  // preset clock times shown to the customer stay stable across re-renders
  // instead of drifting with Date.now() on every paint (react-hooks/purity).
  const [pickupTimeBase, setPickupTimeBase] = useState<number>(0);
  const [addresses, setAddresses] = useState<DrawerSavedAddress[]>([]);
  const [addressId, setAddressId] = useState("");
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  // Compact add-address form — the same Area → sub-area model as the address book.
  const [nickname, setNickname] = useState<NicknameKind>("home");
  const [locationName, setLocationName] = useState("");
  // Live coverage per saved address, keyed by address id (see AddressCoverageState).
  const [coverage, setCoverage] = useState<Record<number, AddressCoverageState>>({});
  const [mainArea, setMainArea] = useState("");
  const [customMain, setCustomMain] = useState("");
  const [subArea, setSubArea] = useState("");
  const [customSubArea, setCustomSubArea] = useState("");
  const [road, setRoad] = useState("");
  const [house, setHouse] = useState("");
  const [flat, setFlat] = useState("");
  const [landmark, setLandmark] = useState("");
  // Map/current-location add-address ("USE MAP / CURRENT LOCATION"): the picked
  // point carries lat/lng + the reverse-geocoded address and Google place_id.
  const [showMapForm, setShowMapForm] = useState(false);
  const [mapPoint, setMapPoint] = useState<PickedPoint | null>(null);
  // ITEM 8 — a one-time address for THIS order only: coverage-checked exactly
  // like a saved address, but never sent to /api/customer/addresses, so it
  // never touches the 5-address cap and leaves no row behind. mainArea/subArea
  // are matched against the master list the same way a pinless saved address
  // is (lib/services/address-coverage.ts); `address` is the composed display
  // text sent as the order's own delivery_address.
  const [showOneTimeForm, setShowOneTimeForm] = useState(false);
  const [oneTimeAddress, setOneTimeAddress] = useState<{ mainArea: string; subArea: string; address: string } | null>(
    null,
  );
  const [oneTimeMainAreaInput, setOneTimeMainAreaInput] = useState("");
  const [oneTimeSubAreaInput, setOneTimeSubAreaInput] = useState("");
  const [oneTimeCustomSubInput, setOneTimeCustomSubInput] = useState("");
  const [oneTimeRoad, setOneTimeRoad] = useState("");
  const [oneTimeHouse, setOneTimeHouse] = useState("");
  const [oneTimeFlat, setOneTimeFlat] = useState("");
  const [oneTimeLandmark, setOneTimeLandmark] = useState("");
  // Keyed by the address it answers, so a stale "covered" from a PREVIOUS
  // one-time address is never shown while the new one is still in flight —
  // the same reasoning as the `coverage` map above, without setState-in-effect.
  const [oneTimeCoverageAnswer, setOneTimeCoverageAnswer] = useState<{ key: string; state: AddressCoverageState } | null>(
    null,
  );
  const [quote, setQuote] = useState<DrawerQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<DrawerOrderResult | null>(null);
  // PHASE R — per-attempt idempotency key; a retry after a failed attempt
  // rotates the key so a double-press can never duplicate the order. Generated
  // lazily in event handlers (never during render — react-hooks/purity).
  const attemptKeyRef = useRef("");

  /** Fresh idempotency key — called only from event handlers. */
  function rotateAttemptKey() {
    attemptKeyRef.current = `hd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  useEffect(() => {
    if (!isOpen || !signedIn) return;
    let alive = true;
    fetch("/api/customer/nearest-branch")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.has_location && d?.nearest?.name) setNearestBranch(String(d.nearest.name));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isOpen, signedIn]);

  // Which panel the drawer shows. An empty cart ALWAYS collapses back to the
  // plain cart view (the ordered-away success receipt is the one exception —
  // it survives on its own snapshot), so a branch switch or manual clear can
  // never strand the customer on a dead checkout step.
  const view: CheckoutStep =
    step === "success" && orderResult ? "success" : lines.length === 0 ? "cart" : step;

  const chosenAddress = useMemo(
    () => addresses.find((a) => String(a.id) === addressId) ?? null,
    [addresses, addressId],
  );

  // The master list from the database; the bundled constant only as a fallback.
  const mainAreaOptions = zones.length > 0 ? zones.map((z) => z.name) : MAIN_AREA_NAMES;
  const subAreaOptions = (main: string): string[] =>
    zones.length > 0
      ? (zones.find((z) => z.name === main)?.localities.map((l) => l.name) ?? [])
      : subAreasFor(main);

  // PHASE 3 — check every saved address against the cart's branch whenever the
  // address step is showing. Re-run on each visit and whenever the list or the
  // branch changes, so a stale answer from another shift is never shown.
  useEffect(() => {
    if (view !== "address" || cartBranchId == null || addresses.length === 0) return;
    let alive = true;
    for (const a of addresses) {
      fetch("/api/delivery/address-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: cartBranchId, customer_address_id: a.id }),
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as { covered?: boolean; pickup_enabled?: boolean };
          if (!alive) return;
          setCoverage((current) => ({
            ...current,
            [a.id]: res.ok
              ? { status: data.covered ? "covered" : "outside", pickupEnabled: Boolean(data.pickup_enabled) }
              : { status: "error", pickupEnabled: false },
          }));
        })
        .catch(() => {
          if (alive) setCoverage((current) => ({ ...current, [a.id]: { status: "error", pickupEnabled: false } }));
        });
    }
    return () => {
      alive = false;
    };
  }, [view, cartBranchId, addresses]);

  // ITEM 8 — the SAME live check, for the one-time address: matched by name
  // against the master list exactly like a pinless saved address, never by id.
  useEffect(() => {
    if (view !== "address" || cartBranchId == null || !oneTimeAddress) return;
    let alive = true;
    const key = `${oneTimeAddress.mainArea}|${oneTimeAddress.subArea}`;
    fetch("/api/delivery/address-coverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branch_id: cartBranchId,
        main_area: oneTimeAddress.mainArea,
        sub_area: oneTimeAddress.subArea,
      }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { covered?: boolean; pickup_enabled?: boolean };
        if (!alive) return;
        setOneTimeCoverageAnswer({
          key,
          state: res.ok
            ? { status: data.covered ? "covered" : "outside", pickupEnabled: Boolean(data.pickup_enabled) }
            : { status: "error", pickupEnabled: false },
        });
      })
      .catch(() => {
        if (alive) setOneTimeCoverageAnswer({ key, state: { status: "error", pickupEnabled: false } });
      });
    return () => {
      alive = false;
    };
  }, [view, cartBranchId, oneTimeAddress]);

  // No answer yet for THIS address (or a stale answer for a previous one) reads
  // as "checking" — mirrors `addressCoverage()`'s default just below.
  const oneTimeCoverage: AddressCoverageState | null = oneTimeAddress
    ? oneTimeAddress.mainArea + "|" + oneTimeAddress.subArea === oneTimeCoverageAnswer?.key
      ? oneTimeCoverageAnswer.state
      : { status: "checking", pickupEnabled: false }
    : null;

  const chosenCoverage = oneTimeAddress
    ? oneTimeCoverage
    : chosenAddress
      ? (coverage[chosenAddress.id] ?? null)
      : null;
  // ITEM 8 — the payment/overview recap reads from whichever destination is
  // active, saved or one-time, with one small computed pair instead of
  // repeating the branch at every render site.
  const effectiveAddressLabel = oneTimeAddress
    ? t("home.order.oneTimeAddressLabel")
    : chosenAddress
      ? addressCardLabel(chosenAddress, t)
      : null;
  const effectiveAddressText = oneTimeAddress ? oneTimeAddress.address : (chosenAddress?.address ?? null);
  // An address with no answer yet is still being checked. Derived here rather
  // than written from the effect, which would cascade a render per address.
  const addressCoverage = (id: number): AddressCoverageState =>
    coverage[id] ?? { status: "checking", pickupEnabled: false };

  /* ══════════════ Task 3 — same-screen checkout (NO navigation) ══════════════
     Every step below renders inside this drawer. The /customer/checkout route
     still exists for deep links, but this flow never routes to it. */

  /** Closes the drawer and rewinds to the cart view; checkout state is transient. */
  function handleClose() {
    closeCart();
    setStep("cart");
    setFulfillmentType("delivery");
    setPickupBranch(null);
    setPickupBranchError(null);
    setShowAddForm(false);
    setShowMapForm(false);
    setShowOneTimeForm(false);
    setMapPoint(null);
    setAddressError(null);
    setQuote(null);
    setQuoteError(null);
    setPlaceError(null);
    setPlacing(false);
    setOrderResult(null);
  }

  function goBackToCart() {
    setStep("cart");
    setFulfillmentType("delivery");
    setPickupBranch(null);
    setPickupBranchError(null);
    setShowAddForm(false);
    setShowMapForm(false);
    setMapPoint(null);
    setAddressError(null);
    setQuoteError(null);
  }

  async function loadAddresses(): Promise<{ list: DrawerSavedAddress[]; failed: boolean }> {
    setLoadingAddresses(true);
    try {
      // credentials: "include" is REQUIRED — the route calls requireApiRole("customer")
      // which reads the NextAuth session cookie via auth(). Without it the request is
      // unauthenticated (401), res.json() falls back to {} and the list stays empty,
      // which is exactly the "0/5 addresses saved → Add New Address" defect.
      const res = await fetch("/api/customer/addresses?active=1", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const data: unknown = await res.json().catch(() => ({}));

      // `handle()` always responds with a JSON body. The GET route returns
      // paginated({ addresses: [...] }) → { data, meta } OR a plain array, so
      // accept both shapes. Anything that isn't an array we recognise → empty list.
      let list: DrawerSavedAddress[] = [];
      if (Array.isArray(data)) {
        list = data as DrawerSavedAddress[];
      } else if (Array.isArray((data as { results?: DrawerSavedAddress[] })?.results)) {
        // /api/customer/addresses wraps the list in a paginated() envelope:
        // { count, next, previous, results: [...] } — this is the primary shape.
        list = (data as { results: DrawerSavedAddress[] }).results;
      } else if (Array.isArray((data as { addresses?: DrawerSavedAddress[] })?.addresses)) {
        list = (data as { addresses: DrawerSavedAddress[] }).addresses;
      } else if (Array.isArray((data as { data?: DrawerSavedAddress[] })?.data)) {
        list = (data as { data: DrawerSavedAddress[] }).data;
      }

      
      // Diagnose: if the API rejected us (401/403) the address panel must show the
      // failure, NOT silently open the "Add New Address" form as if the customer had
      // zero saved addresses. The caller (startCheckout) gates the add-form path on
      // !result.failed.
      const loadOk = res.ok;
      if (!loadOk) {
        setAddressError(
          (data as { message?: string; error?: string })?.message ??
            (data as { error?: string })?.error ??
            t("home.order.addressLoadError"),
        );
      } else {
        setAddressError(null);
        // Only commit the fetched list to state when the fetch actually succeeded.
        setAddresses(list);
      }
      return { list, failed: !loadOk } as const;
    } catch {
      setAddresses([]);
      setAddressError(t("home.order.addressLoadError"));
      return { list: [], failed: true } as const;
    } finally {
      setLoadingAddresses(false);
    }
  }

  /** Step 1 — saved-address check + selection (or the inline add form). */
  function startCheckout() {
    if (cartBranchId == null || lines.length === 0) return;
    rotateAttemptKey(); // one key per checkout attempt
    setPlaceError(null);
    setQuoteError(null);
    setAddressError(null);
    setShowAddForm(false);
    setShowMapForm(false);
    setMapPoint(null);
    setCoverage({});
    setStep("address");
    // loadAddresses returns { list, failed }. Only open the Add New Address form
    // when the fetch SUCCEEDED and the customer genuinely has zero saved addresses.
    void loadAddresses().then((result) => {
      if (result.failed) return; // error banner already rendered by loadAddresses
      const list = result.list;
      const preferred = list.find((a) => a.is_default) ?? list[0];
      if (preferred) {
        setAddressId(String(preferred.id));
        setShowAddForm(false);
      } else {
        setAddressId("");
        if (list.length < LIMITS.maxSavedAddresses) setShowAddForm(true);
      }
    });
  }

  /** Fetches the cart's own branch's pickup details — never a list, since a
      cart's products belong to exactly one branch (§ orderableProductWhere). */
  async function loadPickupBranch(branchId: number) {
    setLoadingPickupBranch(true);
    setPickupBranchError(null);
    try {
      const res = await fetch(`/api/branches/${branchId}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPickupBranch(null);
        setPickupBranchError(t("home.order.pickupBranchLoadError"));
        return;
      }
      const b = data as {
        id: number;
        name: string;
        pickup_enabled?: boolean;
        pickup_address?: string;
        pickup_phone?: string;
      };
      if (!b.pickup_enabled) {
        setPickupBranch(null);
        setPickupBranchError(t("home.order.pickupUnavailableAtBranch"));
        return;
      }
      setPickupBranch({
        id: b.id,
        name: b.name,
        pickupEnabled: true,
        pickupAddress: b.pickup_address ?? "",
        pickupPhone: b.pickup_phone ?? "",
      });
    } catch {
      setPickupBranch(null);
      setPickupBranchError(t("home.order.pickupBranchLoadError"));
    } finally {
      setLoadingPickupBranch(false);
    }
  }

  /** "Self Pickup" — goes straight to confirming the cart's own branch; there
      is never a location LIST (see DrawerPickupBranch doc comment). */
  function startPickupCheckout() {
    if (cartBranchId == null || lines.length === 0) return;
    rotateAttemptKey();
    setPlaceError(null);
    setQuoteError(null);
    setPickupBranchError(null);
    setPickupTimeMinutes(PICKUP_TIME_OFFSETS[0]);
    setPickupTimeBase(Date.now());
    setFulfillmentType("pickup");
    setStep("pickup-confirm");
    void loadPickupBranch(cartBranchId);
  }

  function goPickupPayment() {
    if (!pickupBranch) return;
    setPlaceError(null);
    setStep("payment");
  }

  /**
   * Compact add-address form → POST /api/customer/addresses. Same Area →
   * sub-area model as the address book: a custom main area ("+ Add your Own")
   * disables the sub-area select and stores custom_area instead; a custom
   * SUB-area ("+ Add your Own" within a real main area) stores its own text
   * the same way.
   */
  async function submitNewAddress() {
    const isCustomMain = mainArea === CUSTOM_VALUE;
    const isCustomSub = !isCustomMain && subArea === CUSTOM_VALUE;
    const areaName = isCustomMain ? customMain.trim() : mainArea.trim();
    if (!areaName) {
      setAddressError(isCustomMain ? t("home.order.errCustomAreaRequired") : t("home.order.errAreaRequired"));
      return;
    }
    if (isCustomSub && !customSubArea.trim()) {
      setAddressError(t("home.order.errCustomAreaRequired"));
      return;
    }
    if (nickname === "custom" && !locationName.trim()) {
      setAddressError(t("home.order.errCustomLabelRequired"));
      return;
    }
    if (addresses.length >= LIMITS.maxSavedAddresses) {
      // Frontend gate — the backend rejects a 6th address regardless.
      setAddressError(t("home.order.maxAddressesReached"));
      return;
    }
    setAddressError(null);
    setSavingAddress(true);
    try {
      const parts: string[] = [];
      if (house.trim()) parts.push(`House/Plot ${house.trim()}`);
      if (flat.trim()) parts.push(`Flat ${flat.trim()}`);
      if (road.trim()) parts.push(road.trim());
      if (isCustomSub && customSubArea.trim()) parts.push(customSubArea.trim());
      else if (!isCustomMain && subArea.trim()) parts.push(subArea.trim());
      parts.push(areaName, "Dhaka");
      const res = await fetch("/api/customer/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: labelForNickname(nickname),
          custom_label: nickname === "custom" ? locationName.trim() : "",
          address: parts.join(", "),
          main_area: areaName,
          ...(isCustomMain
            ? { custom_area: areaName }
            : isCustomSub
              ? { sub_area: "", custom_area: customSubArea.trim() }
              : { sub_area: subArea.trim() }),
          road_lane: road.trim(),
          house_plot: house.trim(),
          flat_number: flat.trim(),
          landmark: landmark.trim(),
          city: "Dhaka",
          country: "Bangladesh",
          is_default: addresses.length === 0,
        }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errors = (data as { errors?: Record<string, unknown> })?.errors;
        const first = errors ? Object.values(errors)[0] : null;
        setAddressError(typeof first === "string" ? first : t("home.order.addressSaveError"));
        return;
      }
      const created = data as { address?: DrawerSavedAddress; id?: number };
      const result = await loadAddresses();
      const newId = created.address?.id ?? created.id ?? result.list[result.list.length - 1]?.id;
      if (newId != null) setAddressId(String(newId));
      setShowAddForm(false);
    } catch {
      setAddressError(t("home.order.addressSaveError"));
    } finally {
      setSavingAddress(false);
    }
  }

  /**
   * Step 2 — the server quote: subtotal, delivery fee and the branch that will
   * fulfil the order, priced at the SAVED ADDRESS coordinates (Task 2 — never
   * fake/browser coords). The quote response's branch is what the confirm step
   * sends, so what the customer sees is what gets stored.
   */
  async function fetchQuote() {
    if (cartBranchId == null) return;
    if (fulfillmentType === "pickup") {
      if (!pickupBranch) return;
    } else if (!chosenAddress && !oneTimeAddress) {
      return;
    }
    setQuoteError(null);
    setQuoting(true);
    try {
      const body =
        fulfillmentType === "pickup"
          ? {
              branch_id: pickupBranch!.id,
              fulfillment_type: "pickup",
              items: lines.map((l) => ({ product_id: Number(l.itemId), quantity: l.qty })),
            }
          : oneTimeAddress
            ? // ITEM 8 — a one-time address for this order: matched by name, the
              // same way a pinless saved address is; nothing to save, nothing to
              // send an id for.
              {
                branch_id: cartBranchId,
                fulfillment_type: "delivery",
                main_area: oneTimeAddress.mainArea,
                sub_area: oneTimeAddress.subArea,
                items: lines.map((l) => ({ product_id: Number(l.itemId), quantity: l.qty })),
              }
            : (() => {
                const lat = chosenAddress!.latitude != null ? Number(chosenAddress!.latitude) : undefined;
                const lng = chosenAddress!.longitude != null ? Number(chosenAddress!.longitude) : undefined;
                const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
                return {
                  branch_id: cartBranchId,
                  fulfillment_type: "delivery",
                  ...(hasCoords ? { lat, lng } : {}),
                  customer_address_id: chosenAddress!.id,
                  items: lines.map((l) => ({ product_id: Number(l.itemId), quantity: l.qty })),
                };
              })();
      const res = await fetch("/api/delivery/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setQuote(null);
        setQuoteError(t("home.order.quoteError"));
        return;
      }
      setQuote(data as DrawerQuote);
    } catch {
      setQuote(null);
      setQuoteError(t("home.order.quoteError"));
    } finally {
      setQuoting(false);
    }
  }

  function goPayment() {
    if (!chosenAddress && !oneTimeAddress) {
      setAddressError(t("home.order.errAddressRequired"));
      return;
    }
    // Delivery is not offered to an address this branch does not cover; the
    // banner above offers pickup instead. The server enforces the same rule.
    if (chosenCoverage?.status === "outside") {
      setAddressError(t("home.order.outsideAreaTitle"));
      return;
    }
    setAddressError(null);
    setStep("payment");
  }

  function goBackToAddress() {
    setStep("address");
    setPlaceError(null);
    setShowAddForm(false);
    setShowMapForm(false);
    setShowOneTimeForm(false);
    setMapPoint(null);
  }

  function goBackToPayment() {
    setStep("payment");
    setPlaceError(null);
  }

  /** Payment step's "back" — returns to pickup confirmation for a pickup
      order, or the address step for a delivery order. */
  function goBackFromPayment() {
    if (fulfillmentType === "pickup") {
      setStep("pickup-confirm");
    } else {
      goBackToAddress();
    }
  }

  /** Overview entry — the quote is (re)fetched here so the final review always
      shows fresh server-priced totals right before the one order-creating tap. */
  function goOverview() {
    setQuote(null);
    setQuoteError(null);
    setPlaceError(null);
    setStep("overview");
    void fetchQuote();
  }

  /** Map/current-location pick from the existing MapPicker component. */
  function handleMapPick(point: PickedPoint) {
    setMapPoint(point);
    setAddressError(null);
  }

  /** Saves a map-picked address: coordinates + reverse-geocoded text + place_id
      (the same persistence contract as the address book's map flow, Task 2). */
  async function submitMapAddress() {
    if (addresses.length >= LIMITS.maxSavedAddresses) {
      setAddressError(t("home.order.maxAddressesReached"));
      return;
    }
    if (!mapPoint || !mapPoint.lat || !mapPoint.lng) {
      setAddressError(t("home.order.mapLocationRequired"));
      return;
    }
    if (!locationName.trim()) {
      setAddressError(t("home.order.errCustomLabelRequired"));
      return;
    }
    setAddressError(null);
    setSavingAddress(true);
    try {
      const res = await fetch("/api/customer/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: locationName.trim(),
          address: mapPoint.address || [mapPoint.area, mapPoint.city || "Dhaka"].filter(Boolean).join(", "),
          ...(mapPoint.area ? { area: mapPoint.area } : {}),
          city: mapPoint.city || "Dhaka",
          ...(mapPoint.postalCode ? { postal_code: mapPoint.postalCode } : {}),
          country: mapPoint.country || "Bangladesh",
          latitude: Number(mapPoint.lat),
          longitude: Number(mapPoint.lng),
          map_address: mapPoint.address || "",
          place_id: mapPoint.placeId || "",
          is_default: addresses.length === 0,
        }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errors = (data as { errors?: Record<string, unknown> })?.errors;
        const first = errors ? Object.values(errors)[0] : null;
        setAddressError(typeof first === "string" ? first : t("home.order.addressSaveError"));
        return;
      }
      const created = data as { address?: DrawerSavedAddress; id?: number };
      const result = await loadAddresses();
      const newId = created.address?.id ?? created.id ?? result.list[result.list.length - 1]?.id;
      if (newId != null) setAddressId(String(newId));
      setShowMapForm(false);
      setMapPoint(null);
    } catch {
      setAddressError(t("home.order.addressSaveError"));
    } finally {
      setSavingAddress(false);
    }
  }

  /**
   * Step 3 — confirm: placeOrderAction carries the saved address id, its
   * coordinates and coord_source="saved_address" (WS-4.2; the server re-derives
   * the truth). On success the cart empties and the receipt panel takes over.
   */
  async function confirmOrder() {
    if (!quote || placing) return;
    if (fulfillmentType === "pickup" ? !pickupBranch : !chosenAddress && !oneTimeAddress) return;
    if (!attemptKeyRef.current) rotateAttemptKey();
    setPlacing(true);
    setPlaceError(null);
    try {
      const payload =
        fulfillmentType === "pickup"
          ? {
              branch_id: quote.branch.id,
              idempotency_key: attemptKeyRef.current,
              payment_method: payment,
              delivery_address: pickupBranch!.pickupAddress || pickupBranch!.name,
              food_notes: "",
              fulfillment_type: "pickup" as const,
              pickup_time: new Date(pickupTimeBase + pickupTimeMinutes * 60000).toISOString(),
              items: lines.map((l) => ({ product_id: Number(l.itemId), quantity: l.qty, food_note: "" })),
            }
          : oneTimeAddress
            ? // ITEM 8 — never saved: no customer_address_id, just this order's
              // own typed area pair, matched by name like a pinless saved address.
              {
                branch_id: quote.branch.id,
                idempotency_key: attemptKeyRef.current,
                payment_method: payment,
                delivery_address: oneTimeAddress.address,
                food_notes: "",
                fulfillment_type: "delivery" as const,
                main_area: oneTimeAddress.mainArea,
                sub_area: oneTimeAddress.subArea,
                coord_source: "one_time_address",
                items: lines.map((l) => ({ product_id: Number(l.itemId), quantity: l.qty, food_note: "" })),
              }
            : (() => {
                const lat = chosenAddress!.latitude != null ? Number(chosenAddress!.latitude) : undefined;
                const lng = chosenAddress!.longitude != null ? Number(chosenAddress!.longitude) : undefined;
                const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
                return {
                  branch_id: quote.branch.id,
                  idempotency_key: attemptKeyRef.current,
                  payment_method: payment,
                  delivery_address: chosenAddress!.address,
                  food_notes: "",
                  fulfillment_type: "delivery" as const,
                  ...(hasCoords ? { lat, lng } : {}),
                  customer_address_id: chosenAddress!.id,
                  coord_source: "saved_address",
                  items: lines.map((l) => ({ product_id: Number(l.itemId), quantity: l.qty, food_note: "" })),
                };
              })();
      const result = await placeOrderAction(payload);
      if (result.error || result.orderId == null) {
        rotateAttemptKey();
        setPlaceError(result.error ?? t("home.order.orderFailed"));
        return;
      }
      const def = paymentMethodDef(payment);
      setOrderResult({
        orderId: result.orderId,
        branchName: quote.branch.name,
        paymentLabel: def ? t(def.labelKey) : payment,
        needsVerification: payment !== "cash",
        addressText:
          fulfillmentType === "pickup"
            ? `${pickupBranch!.pickupAddress || pickupBranch!.name}${pickupBranch!.pickupPhone ? ` · ${pickupBranch!.pickupPhone}` : ""}`
            : (oneTimeAddress?.address ?? chosenAddress!.address),
        items: count,
        subtotal: quote.subtotal,
        deliveryFee: quote.delivery_charge,
        platformFee: quote.platform_fee ?? 0,
        grandTotal: quote.total,
        fulfillmentType,
        pickupTimeLabel:
          fulfillmentType === "pickup"
            ? new Date(pickupTimeBase + pickupTimeMinutes * 60000).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })
            : undefined,
      });
      clear(); // ordered — the drawer cart empties (orderResult holds the receipt)
      // ITEM 8 — a one-time address is exactly that: it does not carry over to
      // the customer's NEXT order the way a saved-address choice deliberately does.
      setOneTimeAddress(null);
      setOneTimeCoverageAnswer(null);
      setStep("success");
    } catch {
      rotateAttemptKey();
      setPlaceError(t("home.order.orderFailed"));
    } finally {
      setPlacing(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={handleClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-100 flex-col border-l border-white/8 bg-[#111115] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <h2 className="text-[1.1rem] font-bold text-white">
            {t("home.cart.title")}{" "}
            {count > 0 ? <span className="text-brand-500">({fmt.num(count)})</span> : null}
          </h2>
          <div className="flex items-center gap-2">
            {lines.length > 0 ? (
              confirmClear ? (
                <span className="flex items-center gap-1.5">
                  <span className="whitespace-nowrap text-[0.75rem] text-[#a0a0b0]">{t("home.cart.clearConfirm")}</span>
                  <button
                    onClick={() => {
                      clear();
                      setConfirmClear(false);
                    }}
                    className="h-7 rounded-md bg-brand-500 px-2.5 text-[0.72rem] font-bold text-white"
                  >
                    {t("home.cart.yes")}
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="h-7 rounded-md border border-white/10 bg-surface-dark px-2.5 text-[0.72rem] font-bold text-white"
                  >
                    {t("home.cart.no")}
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 text-[0.72rem] font-bold uppercase tracking-wide text-brand-500 hover:bg-brand-500/20"
                >
                  🗑 {t("home.cart.clearCart")}
                </button>
              )
            ) : null}
            <button
              onClick={handleClose}
              data-testid="drawer-close"
              className="flex size-8 items-center justify-center rounded-lg border border-white/10 bg-surface-dark text-white hover:bg-[#23232e]"
              aria-label={t("home.cart.close")}
            >
              ✕
            </button>
          </div>
        </div>

        <div className="scrollbar-thin flex-1 space-y-2.5 overflow-y-auto p-4">
          {view === "success" && orderResult ? (
            /* Task 3 — the receipt renders IN THE DRAWER: order id, assigned
                branch, payment method, delivery address and the priced totals.
                "View Order" is the only way out (deep link to the order page);
                "Continue Shopping" closes and rewinds the drawer. */
            <div className="space-y-3 pb-2" data-testid="drawer-checkout-success">
              <div className="rounded-[10px] border border-brand-500/30 bg-brand-500/10 p-4 text-center">
                <span className="text-3xl">🎉</span>
                <p className="mt-1 text-[1rem] font-extrabold text-white">{t("home.order.thankYou")}</p>
                <p className="mt-0.5 text-[0.8rem] text-[#a0a0b0]">{t("home.order.placedDesc")}</p>
              </div>
              <div className="overflow-hidden rounded-[10px] border border-white/8 bg-surface-dark text-[0.82rem]">
                <div className="flex items-center justify-between border-b border-white/6 px-3.5 py-2.5">
                  <span className="text-[#a0a0b0]">{t("home.order.orderId")}</span>
                  <span className="font-extrabold text-brand-500">#{fmt.num(orderResult.orderId)}</span>
                </div>
                <div className="flex items-center justify-between border-b border-white/6 px-3.5 py-2.5">
                  <span className="text-[#a0a0b0]">{t("home.order.assignedBranch")}</span>
                  <span className="max-w-[60%] truncate font-semibold text-white">📍 {orderResult.branchName}</span>
                </div>
                <div className="flex items-center justify-between border-b border-white/6 px-3.5 py-2.5">
                  <span className="text-[#a0a0b0]">{t("home.order.paymentMethod")}</span>
                  <span className="font-semibold text-white">{orderResult.paymentLabel}</span>
                </div>
                <div className="flex items-center justify-between border-b border-white/6 px-3.5 py-2.5">
                  <span className="text-[#a0a0b0]">{t("home.order.orderStatusLabel")}</span>
                  <span className="font-semibold text-emerald-400" data-testid="drawer-order-status">
                    {t("home.order.statusReceived")}
                  </span>
                </div>
                <div className="border-b border-white/6 px-3.5 py-2.5">
                  <span className="text-[#a0a0b0]">
                    {orderResult.fulfillmentType === "pickup" ? t("home.order.pickupLocation") : t("home.order.deliveryAddress")}
                  </span>
                  <p className="mt-0.5 break-words text-white">{orderResult.addressText}</p>
                </div>
                {orderResult.fulfillmentType === "pickup" && orderResult.pickupTimeLabel ? (
                  <div className="flex items-center justify-between border-b border-white/6 px-3.5 py-2.5">
                    <span className="text-[#a0a0b0]">{t("home.order.pickupTime")}</span>
                    <span className="font-semibold text-white">{orderResult.pickupTimeLabel}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-b border-white/6 px-3.5 py-2.5">
                  <span className="text-[#a0a0b0]">{t("home.order.items")}</span>
                  <span className="font-semibold text-white">{fmt.num(orderResult.items)}</span>
                </div>
                <div className="space-y-1.5 px-3.5 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[#a0a0b0]">{t("home.order.subtotal")}</span>
                    <span className="text-white">{fmt.money(orderResult.subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#a0a0b0]">{t("home.order.deliveryFee")}</span>
                    <span className="text-white">
                      {orderResult.fulfillmentType === "pickup"
                        ? t("home.order.freePickup")
                        : orderResult.deliveryFee === 0
                          ? t("home.order.freeDelivery")
                          : fmt.money(orderResult.deliveryFee)}
                    </span>
                  </div>
                  {orderResult.platformFee > 0 ? (
                    <div className="flex items-center justify-between" data-testid="drawer-receipt-platform-fee">
                      <span className="text-[#a0a0b0]">{t("home.order.platformFee")}</span>
                      <span className="text-white">{fmt.money(orderResult.platformFee)}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between border-t border-white/8 pt-1.5">
                    <span className="font-bold text-white">{t("home.order.grandTotal")}</span>
                    <span className="font-display text-[1.1rem] font-extrabold text-brand-500">
                      {fmt.money(orderResult.grandTotal)}
                    </span>
                  </div>
                </div>
              </div>
              {/* req #18 — estimated delivery expectation. Worded as an
                  EXPECTATION, never a guaranteed exact time. Pickup orders
                  already show their own pickup time above, so this delivery-
                  specific block is skipped for them. */}
              {orderResult.fulfillmentType === "delivery" ? (
                <div className="rounded-[10px] border border-white/8 bg-surface-dark p-3" data-testid="drawer-delivery-estimate">
                  <p className="text-[0.68rem] font-bold uppercase tracking-wide text-[#606070]">
                    {t("home.order.deliveryTimeTitle")}
                  </p>
                  <p className="mt-1 text-[0.78rem] text-[#a0a0b0]">{t("home.order.receivedByBranch")}</p>
                  <p className="mt-1 text-[0.78rem] text-white">{t("home.order.deliveryTimeEstimate")}</p>
                </div>
              ) : null}
              {orderResult.needsVerification ? (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-[0.75rem] text-amber-300">
                  {t("home.order.paymentPendingNote")}
                </p>
              ) : null}
            </div>
          ) : lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[#606070]">
              <span className="text-4xl">🛒</span>
              <p>{t("home.cart.empty")}</p>
              <a href="#menu-section" onClick={closeCart} className="text-sm font-semibold text-brand-400 hover:underline">
                {t("home.cart.browseMenu")}
              </a>
            </div>
          ) : view === "pickup-confirm" ? (
            /* Self Pickup — there is never a location LIST (a cart's items
                belong to exactly one branch), only a confirmation of the
                branch that cart is already locked to. */
            <div className="space-y-3 pb-2" data-testid="drawer-pickup-confirm-step">
              {loadingPickupBranch ? (
                <p className="py-6 text-center text-[0.8rem] text-[#606070]">{t("common.loading")}</p>
              ) : pickupBranchError ? (
                <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 p-3 text-center" role="alert">
                  <p className="text-[0.82rem] font-bold text-red-300">{pickupBranchError}</p>
                  {cartBranchId != null ? (
                    <button
                      type="button"
                      onClick={() => void loadPickupBranch(cartBranchId)}
                      className="mt-2 text-[0.72rem] font-bold text-brand-400 hover:text-brand-300"
                    >
                      {t("home.order.retry")}
                    </button>
                  ) : null}
                </div>
              ) : pickupBranch ? (
                <div className="rounded-[10px] border border-brand-500/30 bg-brand-500/10 p-4 text-center">
                  <p className="text-[0.9rem] font-bold text-white">
                    {t("home.order.pickupConfirmQuestion", { branch: pickupBranch.name })}
                  </p>
                  {pickupBranch.pickupAddress ? (
                    <p className="mt-1.5 break-words text-[0.78rem] text-[#a0a0b0]">📍 {pickupBranch.pickupAddress}</p>
                  ) : null}
                  {pickupBranch.pickupPhone ? (
                    <p className="mt-0.5 text-[0.78rem] text-[#a0a0b0]">☎ {pickupBranch.pickupPhone}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : view === "address" ? (
            <div className="space-y-2.5 pb-2" data-testid="drawer-checkout-address-step">
              <div className="flex items-center justify-between">
                <p className="text-[0.9rem] font-bold text-white">{t("home.order.selectDeliveryAddress")}</p>
                <span
                  className="rounded-full bg-white/6 px-2 py-0.5 text-[0.65rem] font-bold text-[#a0a0b0]"
                  data-testid="drawer-address-count"
                >
                  {t("home.order.addressCount", { count: addresses.length })}
                </span>
              </div>
              {loadingAddresses ? (
                <p className="py-6 text-center text-[0.8rem] text-[#606070]">{t("common.loading")}</p>
              ) : null}
              {!loadingAddresses && addressError ? (
                <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 p-3 text-center" role="alert">
                  <p className="text-[0.82rem] font-bold text-red-300">{addressError}</p>
                  <button
                    type="button"
                    onClick={() => void loadAddresses()}
                    className="mt-2 text-[0.72rem] font-bold text-brand-400 hover:text-brand-300"
                  >
                    {t("home.order.retry")}
                  </button>
                </div>
              ) : null}
              {!loadingAddresses &&
              !addressError &&
              addresses.length === 0 &&
              !showAddForm &&
              !showOneTimeForm &&
              !oneTimeAddress ? (
                <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                  <p className="text-[0.85rem] font-bold text-amber-300">{t("home.order.noSavedAddress")}</p>
                  <p className="mt-0.5 text-[0.75rem] text-amber-200/70">{t("home.order.noSavedAddressDesc")}</p>
                </div>
              ) : null}
              {/* saved-address cards — the choice feeds BOTH the quote and the
                  order: its coordinates price the delivery (Task 2 contract) */}
              {addresses.length > 0 ? (
                <div className="space-y-2" role="radiogroup" aria-label={t("home.order.deliverTo")}>
                  {addresses.map((a) => {
                    const active = String(a.id) === addressId;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-testid="drawer-saved-address"
                        onClick={() => {
                          setAddressId(String(a.id));
                          // ITEM 8 — picking a saved address deselects any
                          // one-time one; only one destination is active.
                          setOneTimeAddress(null);
                          setAddressError(null);
                        }}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-[10px] border p-3 text-left transition-colors",
                          active
                            ? "border-brand-500 bg-brand-500/10"
                            : "border-white/10 bg-surface-dark hover:border-white/20",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                            active ? "border-brand-500" : "border-white/30",
                          )}
                        >
                          {active ? <span className="size-1.5 rounded-full bg-brand-500" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[0.82rem] font-bold text-white">
                            {addressCardLabel(a, t)}
                          </span>
                          {a.house_plot || a.road_lane || a.main_area || a.landmark ? (
                            /* structured card — House/Plot · Flat · Road · Area ·
                                Landmark, straight from the saved record fields */
                            <span className="mt-1 block space-y-0.5 text-[0.72rem] leading-snug text-[#a0a0b0]">
                              {a.house_plot ? (
                                <span className="block">{t("home.order.labelHousePlot")}: {a.house_plot}</span>
                              ) : null}
                              {a.flat_number ? (
                                <span className="block">{t("home.order.labelFlat")}: {a.flat_number}</span>
                              ) : null}
                              {a.road_lane ? (
                                <span className="block">{t("home.order.labelRoad")}: {a.road_lane}</span>
                              ) : null}
                              {a.sub_area || a.main_area ? (
                                <span className="block">
                                  {t("home.order.labelArea")}: {[a.sub_area, a.main_area].filter(Boolean).join(" — ")}
                                </span>
                              ) : null}
                              {a.landmark ? (
                                <span className="block">{t("home.order.labelLandmark")}: {a.landmark}</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="mt-0.5 block break-words text-[0.75rem] text-[#a0a0b0]">{a.address}</span>
                          )}
                          {addressCoverage(a.id) ? (
                            <span
                              data-testid={`drawer-address-coverage-${a.id}`}
                              data-coverage={addressCoverage(a.id).status}
                              className={cn(
                                "mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-bold",
                                addressCoverage(a.id).status === "covered" && "bg-emerald-500/15 text-emerald-300",
                                addressCoverage(a.id).status === "outside" && "bg-amber-500/15 text-amber-300",
                                (addressCoverage(a.id).status === "checking" || addressCoverage(a.id).status === "error") &&
                                  "bg-white/6 text-[#a0a0b0]",
                              )}
                            >
                              {addressCoverage(a.id).status === "covered"
                                ? t("home.order.deliversHereBadge")
                                : addressCoverage(a.id).status === "outside"
                                  ? t("home.order.pickupOnlyBadge")
                                  : addressCoverage(a.id).status === "checking"
                                    ? t("home.order.checkingCoverage")
                                    : t("home.order.coverageCheckFailed")}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {oneTimeAddress ? (
                /* ITEM 8 — the active one-time destination: styled like a
                    selected saved-address row (same radio-checked look), plus
                    its own live coverage badge and a way to drop it. */
                <div
                  className="flex items-start gap-2.5 rounded-[10px] border border-brand-500 bg-brand-500/10 p-3"
                  data-testid="drawer-one-time-address"
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-brand-500">
                    <span className="size-1.5 rounded-full bg-brand-500" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.82rem] font-bold text-white">
                      {t("home.order.oneTimeAddressLabel")}
                    </span>
                    <span className="mt-0.5 block break-words text-[0.75rem] text-[#a0a0b0]">
                      {oneTimeAddress.address}
                    </span>
                    {oneTimeCoverage ? (
                      <span
                        data-testid="drawer-one-time-coverage"
                        data-coverage={oneTimeCoverage.status}
                        className={cn(
                          "mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-bold",
                          oneTimeCoverage.status === "covered" && "bg-emerald-500/15 text-emerald-300",
                          oneTimeCoverage.status === "outside" && "bg-amber-500/15 text-amber-300",
                          (oneTimeCoverage.status === "checking" || oneTimeCoverage.status === "error") &&
                            "bg-white/6 text-[#a0a0b0]",
                        )}
                      >
                        {oneTimeCoverage.status === "covered"
                          ? t("home.order.deliversHereBadge")
                          : oneTimeCoverage.status === "outside"
                            ? t("home.order.pickupOnlyBadge")
                            : oneTimeCoverage.status === "checking"
                              ? t("home.order.checkingCoverage")
                              : t("home.order.coverageCheckFailed")}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setOneTimeAddress(null);
                      setOneTimeCoverageAnswer(null);
                    }}
                    data-testid="drawer-remove-one-time-address"
                    className="shrink-0 text-[0.7rem] font-bold text-[#a0a0b0] hover:text-white"
                  >
                    ✕ {t("common.remove")}
                  </button>
                </div>
              ) : null}
              {(chosenAddress || oneTimeAddress) && chosenCoverage?.status === "outside" ? (
                /* PHASE 3 — the same honest pattern the storefront bar uses: say
                    delivery is not possible from here, and offer what works. */
                <div
                  className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3"
                  data-testid="drawer-outside-area"
                  role="status"
                >
                  <p className="text-[0.82rem] font-bold text-amber-300">{t("home.order.outsideAreaTitle")}</p>
                  <p className="mt-0.5 text-[0.75rem] text-amber-200/80">
                    {t("home.order.outsideAreaBody", { branch: cartBranchName ?? "" })}
                  </p>
                  {chosenCoverage.pickupEnabled ? (
                    <button
                      type="button"
                      onClick={startPickupCheckout}
                      data-testid="drawer-switch-to-pickup"
                      className="mt-2 w-full rounded-lg border border-amber-400/40 py-2 text-[0.78rem] font-extrabold text-amber-200 hover:bg-amber-500/10"
                    >
                      🏬 {t("home.order.switchToPickup")}
                    </button>
                  ) : (
                    <p className="mt-1.5 text-[0.72rem] text-amber-200/70">{t("home.order.pickupNotOffered")}</p>
                  )}
                </div>
              ) : null}
              {showAddForm ? (
                /* compact add-address form — same Area → sub-area model as the
                    address book (a custom main area disables the sub-area select) */
                <div
                  className="space-y-2 rounded-[10px] border border-white/10 bg-surface-dark p-3"
                  data-testid="drawer-add-address-form"
                >
                  <p className="text-[0.8rem] font-bold text-white">{t("home.order.addNewAddress")}</p>
                  <select
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value as NicknameKind)}
                    className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                    aria-label={t("addresses.nicknameField")}
                    data-testid="drawer-address-nickname"
                  >
                    <option value="home">{t("addresses.nicknameHome")}</option>
                    <option value="office">{t("addresses.nicknameOffice")}</option>
                    <option value="custom">{t("addresses.nicknameCustom")}</option>
                  </select>
                  {nickname === "custom" ? (
                    <input
                      value={locationName}
                      onChange={(e) => setLocationName(e.target.value)}
                      placeholder={t("addresses.nicknameCustomPlaceholder")}
                      maxLength={40}
                      className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                      aria-label={t("addresses.nicknameCustomField")}
                    />
                  ) : null}
                  <select
                    value={mainArea}
                    onChange={(e) => {
                      setMainArea(e.target.value);
                      setSubArea("");
                      setCustomMain("");
                      setCustomSubArea("");
                    }}
                    className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                    aria-label={t("addresses.selectYourArea")}
                  >
                    <option value="">{t("addresses.selectYourArea")}</option>
                    {mainAreaOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {mainArea === CUSTOM_VALUE ? (
                    <input
                      value={customMain}
                      onChange={(e) => setCustomMain(e.target.value)}
                      placeholder={t("addresses.enterYourAreaNamePlaceholder")}
                      maxLength={80}
                      className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                      aria-label={t("addresses.enterYourAreaName")}
                    />
                  ) : mainArea ? (
                    <>
                      <select
                        value={subArea}
                        onChange={(e) => {
                          setSubArea(e.target.value);
                          setCustomSubArea("");
                        }}
                        className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                        aria-label={t("addresses.selectYourAreaName")}
                      >
                        <option value="">{t("addresses.selectYourAreaName")}</option>
                        {subAreaOptions(mainArea).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                        <option value={CUSTOM_VALUE}>{t("addresses.addYourOwn")}</option>
                      </select>
                      {subArea === CUSTOM_VALUE ? (
                        <input
                          value={customSubArea}
                          onChange={(e) => setCustomSubArea(e.target.value)}
                          placeholder={t("addresses.enterAreaName")}
                          maxLength={80}
                          className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                          aria-label={t("addresses.enterAreaName")}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={road}
                      onChange={(e) => setRoad(e.target.value)}
                      placeholder={t("addresses.roadLanePlaceholder")}
                      maxLength={80}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                      aria-label={t("addresses.enterRoadLane")}
                    />
                    <input
                      value={house}
                      onChange={(e) => setHouse(e.target.value)}
                      placeholder={t("addresses.housePlotField")}
                      maxLength={80}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                    />
                    <input
                      value={flat}
                      onChange={(e) => setFlat(e.target.value)}
                      placeholder={t("addresses.flatNumberField")}
                      maxLength={80}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                    />
                    <input
                      value={landmark}
                      onChange={(e) => setLandmark(e.target.value)}
                      placeholder={t("addresses.landmarkField")}
                      maxLength={200}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                    />
                  </div>
                  {addressError ? (
                    <p className="text-[0.72rem] font-semibold text-red-400" role="alert">
                      {addressError}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false);
                        setAddressError(null);
                      }}
                      className="h-9 rounded-lg border border-white/12 text-[0.78rem] font-bold text-white hover:border-brand-500"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitNewAddress()}
                      disabled={savingAddress}
                      className={cn(
                        "flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-500 text-[0.8rem] font-extrabold text-white hover:bg-brand-600",
                        savingAddress && "cursor-not-allowed opacity-60",
                      )}
                    >
                      {savingAddress ? (
                        <>
                          <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                          {t("home.order.savingAddress")}
                        </>
                      ) : (
                        t("common.save")
                      )}
                    </button>
                  </div>
                </div>
              ) : showOneTimeForm ? (
                /* ITEM 8 — the one-time address form: the SAME master-list
                    area/sub-area model as the saved-address form (no custom
                    main area — that is what coverage matches on), minus the
                    nickname field, since nothing here is ever saved. Confirm
                    sets local state only; no fetch, no address-book row, no
                    5-address cap. */
                <div
                  className="space-y-2 rounded-[10px] border border-white/10 bg-surface-dark p-3"
                  data-testid="drawer-one-time-address-form"
                >
                  <p className="text-[0.8rem] font-bold text-white">{t("home.order.useOneTimeAddress")}</p>
                  <p className="text-[0.7rem] text-[#a0a0b0]">{t("home.order.oneTimeAddressNotice")}</p>
                  <select
                    value={oneTimeMainAreaInput}
                    onChange={(e) => {
                      setOneTimeMainAreaInput(e.target.value);
                      setOneTimeSubAreaInput("");
                      setOneTimeCustomSubInput("");
                    }}
                    className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                    aria-label={t("addresses.selectYourArea")}
                    data-testid="drawer-one-time-main-area"
                  >
                    <option value="">{t("addresses.selectYourArea")}</option>
                    {mainAreaOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {oneTimeMainAreaInput ? (
                    <>
                      <select
                        value={oneTimeSubAreaInput}
                        onChange={(e) => {
                          setOneTimeSubAreaInput(e.target.value);
                          setOneTimeCustomSubInput("");
                        }}
                        className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                        aria-label={t("addresses.selectYourAreaName")}
                        data-testid="drawer-one-time-sub-area"
                      >
                        <option value="">{t("addresses.selectYourAreaName")}</option>
                        {subAreaOptions(oneTimeMainAreaInput).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                        <option value={CUSTOM_VALUE}>{t("addresses.addYourOwn")}</option>
                      </select>
                      {oneTimeSubAreaInput === CUSTOM_VALUE ? (
                        <input
                          value={oneTimeCustomSubInput}
                          onChange={(e) => setOneTimeCustomSubInput(e.target.value)}
                          placeholder={t("addresses.enterAreaName")}
                          maxLength={80}
                          className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                          aria-label={t("addresses.enterAreaName")}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={oneTimeRoad}
                      onChange={(e) => setOneTimeRoad(e.target.value)}
                      placeholder={t("addresses.roadLanePlaceholder")}
                      maxLength={80}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                      aria-label={t("addresses.enterRoadLane")}
                    />
                    <input
                      value={oneTimeHouse}
                      onChange={(e) => setOneTimeHouse(e.target.value)}
                      placeholder={t("addresses.housePlotField")}
                      maxLength={80}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                    />
                    <input
                      value={oneTimeFlat}
                      onChange={(e) => setOneTimeFlat(e.target.value)}
                      placeholder={t("addresses.flatNumberField")}
                      maxLength={80}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                    />
                    <input
                      value={oneTimeLandmark}
                      onChange={(e) => setOneTimeLandmark(e.target.value)}
                      placeholder={t("addresses.landmarkField")}
                      maxLength={200}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                    />
                  </div>
                  {addressError ? (
                    <p className="text-[0.72rem] font-semibold text-red-400" role="alert">
                      {addressError}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowOneTimeForm(false);
                        setAddressError(null);
                      }}
                      className="h-9 rounded-lg border border-white/12 text-[0.78rem] font-bold text-white hover:border-brand-500"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      data-testid="drawer-confirm-one-time-address"
                      onClick={() => {
                        const isCustomSub = oneTimeSubAreaInput === CUSTOM_VALUE;
                        if (!oneTimeMainAreaInput) {
                          setAddressError(t("home.order.errAreaRequired"));
                          return;
                        }
                        if (isCustomSub && !oneTimeCustomSubInput.trim()) {
                          setAddressError(t("home.order.errCustomAreaRequired"));
                          return;
                        }
                        const subAreaText = isCustomSub ? oneTimeCustomSubInput.trim() : oneTimeSubAreaInput.trim();
                        const parts: string[] = [];
                        if (oneTimeHouse.trim()) parts.push(`House/Plot ${oneTimeHouse.trim()}`);
                        if (oneTimeFlat.trim()) parts.push(`Flat ${oneTimeFlat.trim()}`);
                        if (oneTimeRoad.trim()) parts.push(oneTimeRoad.trim());
                        if (subAreaText) parts.push(subAreaText);
                        parts.push(oneTimeMainAreaInput, "Dhaka");
                        setOneTimeAddress({
                          mainArea: oneTimeMainAreaInput,
                          subArea: subAreaText,
                          address: parts.join(", "),
                        });
                        // ITEM 8 — the one-time address IS the selection now;
                        // a saved-address choice from before is superseded.
                        setAddressId("");
                        setAddressError(null);
                        setShowOneTimeForm(false);
                      }}
                      className="flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-500 text-[0.8rem] font-extrabold text-white hover:bg-brand-600"
                    >
                      {t("home.order.useOneTimeAddressConfirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {addresses.length >= LIMITS.maxSavedAddresses ? (
                    /* 5/5 — no way to add a 6th SAVED address from the UI (the
                        backend route rejects it independently); the one-time
                        address below is still offered, since it never counts
                        toward this cap. */
                    <p
                      className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-[0.75rem] font-semibold text-amber-300"
                      data-testid="drawer-max-addresses"
                    >
                      {t("home.order.maxAddressesReached")}
                    </p>
                  ) : showMapForm ? null : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddForm(true);
                          setShowMapForm(false);
                          setAddressError(null);
                        }}
                        data-testid="drawer-add-address"
                        className="rounded-lg border border-dashed border-white/15 py-2 text-[0.72rem] font-bold text-[#a0a0b0] hover:border-brand-500/50 hover:text-brand-400"
                      >
                        + {t("home.order.addNewAddress")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMapForm(true);
                          setShowAddForm(false);
                          setAddressError(null);
                        }}
                        data-testid="drawer-add-map-address"
                        className="rounded-lg border border-dashed border-white/15 py-2 text-[0.72rem] font-bold text-[#a0a0b0] hover:border-brand-500/50 hover:text-brand-400"
                      >
                        🗺 {t("home.order.useMapLocation")}
                      </button>
                    </div>
                  )}
                  {!showMapForm && !oneTimeAddress ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowOneTimeForm(true);
                        setShowAddForm(false);
                        setShowMapForm(false);
                        setAddressError(null);
                      }}
                      data-testid="drawer-use-one-time-address"
                      className="w-full rounded-lg border border-dashed border-white/15 py-2 text-[0.72rem] font-bold text-[#a0a0b0] hover:border-brand-500/50 hover:text-brand-400"
                    >
                      ⏱ {t("home.order.useOneTimeAddress")}
                    </button>
                  ) : null}
                </>
              )}
              {showMapForm ? (
                /* map/current-location address — the SAME MapPicker component the
                    address book uses (Google maps + device GPS, no new service) */
                <div
                  className="space-y-2 rounded-[10px] border border-white/10 bg-surface-dark p-3"
                  data-testid="drawer-add-map-address-form"
                >
                  <p className="text-[0.8rem] font-bold text-white">{t("home.order.useMapLocation")}</p>
                  <MapPicker
                    label={t("mapPicker.addressTitle")}
                    hint={t("mapPicker.addressHint")}
                    lat={mapPoint?.lat ?? ""}
                    lng={mapPoint?.lng ?? ""}
                    onChange={handleMapPick}
                    defaultOpen
                    gpsLabel={t("addresses.useCurrentLocation")}
                    searchPlaceholder={t("addresses.mapSearchPlaceholder")}
                    testId="drawer-map"
                  />
                  <input
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder={t("addresses.locationNamePlaceholder")}
                    maxLength={40}
                    className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                    aria-label={t("addresses.locationNameField")}
                  />
                  {mapPoint?.address ? (
                    <p className="break-words text-[0.72rem] text-[#a0a0b0]">📍 {mapPoint.address}</p>
                  ) : null}
                  {addressError ? (
                    <p className="text-[0.72rem] font-semibold text-red-400" role="alert">
                      {addressError}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMapForm(false);
                        setShowAddForm(false);
                        setMapPoint(null);
                        setAddressError(null);
                      }}
                      className="h-9 rounded-lg border border-white/12 text-[0.78rem] font-bold text-white hover:border-brand-500"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitMapAddress()}
                      disabled={savingAddress || !mapPoint?.address}
                      data-testid="drawer-save-map-address"
                      className={cn(
                        "flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-500 text-[0.78rem] font-extrabold text-white hover:bg-brand-600",
                        (savingAddress || !mapPoint?.address) && "cursor-not-allowed opacity-60",
                      )}
                    >
                      {savingAddress ? (
                        <>
                          <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                          {t("home.order.savingAddress")}
                        </>
                      ) : (
                        t("common.save")
                      )}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : view === "payment" ? (
            /* req #12 — the payment STEP: choosing a method NEVER places the
                order; it only feeds the overview, whose Confirm button creates it */
            <div className="space-y-2.5 pb-2" data-testid="drawer-checkout-payment-step">
              <p className="text-[0.9rem] font-bold text-white">{t("home.order.paymentMethod")}</p>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("home.order.paymentMethod")}>
                {CUSTOMER_PAYMENT_METHODS.map((method) => {
                  const def = paymentMethodDef(method);
                  if (!def) return null;
                  const active = payment === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid={`drawer-payment-${method}`}
                      onClick={() => setPayment(method)}
                      className={cn(
                        "flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors",
                        active ? "border-brand-500 bg-brand-500/10" : "border-white/10 bg-[#23232e] hover:border-white/20",
                      )}
                    >
                      <span className="text-base leading-none">{def.icon}</span>
                      <span className="min-w-0">
                        <span
                          className={cn("block truncate text-[0.78rem] font-bold", active ? "text-white" : "text-white/80")}
                        >
                          {t(def.labelKey)}
                        </span>
                        <span className="mt-0.5 block truncate text-[0.65rem] text-[#a0a0b0]">{t(def.hintKey)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {fulfillmentType === "pickup" ? (
                <div className="space-y-1.5 rounded-lg border border-white/10 bg-[#23232e] p-3">
                  <label htmlFor="drawer-pickup-time" className="block text-[0.78rem] font-bold text-white">
                    {t("home.order.pickupTime")}
                  </label>
                  <select
                    id="drawer-pickup-time"
                    value={pickupTimeMinutes}
                    onChange={(e) => setPickupTimeMinutes(Number(e.target.value))}
                    className="h-9 w-full rounded-lg border border-white/10 bg-[#17171d] px-2 text-[0.78rem] text-white"
                    data-testid="drawer-pickup-time"
                  >
                    {PICKUP_TIME_OFFSETS.map((minutes) => {
                      const at = new Date(pickupTimeBase + minutes * 60000);
                      const clock = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                      return (
                        <option key={minutes} value={minutes}>
                          {t("home.order.pickupTimeOptionLabel", { time: clock, minutes })}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-[0.68rem] text-[#a0a0b0]">{t("home.order.pickupTimeHint")}</p>
                </div>
              ) : null}
              <p className="rounded-lg bg-white/4 px-3 py-2 text-center text-[0.72rem] text-[#a0a0b0]">
                {fulfillmentType === "pickup"
                  ? `${t("home.order.pickupLocation")}: ${pickupBranch?.name ?? "—"}`
                  : `${t("home.order.deliverTo")}: ${effectiveAddressLabel ?? "—"}`}
              </p>
            </div>
          ) : view === "overview" ? (
            <div className="space-y-2.5 pb-2" data-testid="drawer-checkout-overview-step">
              {/* deliver-to / pickup-location recap */}
              {fulfillmentType === "pickup" ? (
                pickupBranch ? (
                  <div className="rounded-[10px] border border-white/8 bg-surface-dark px-3.5 py-2.5">
                    <p className="text-[0.68rem] font-bold uppercase tracking-wide text-[#606070]">
                      {t("home.order.pickupLocation")}
                    </p>
                    <p className="mt-0.5 truncate text-[0.82rem] font-bold text-white">📍 {pickupBranch.name}</p>
                    {pickupBranch.pickupAddress ? (
                      <p className="mt-0.5 break-words text-[0.75rem] text-[#a0a0b0]">{pickupBranch.pickupAddress}</p>
                    ) : null}
                    <p className="mt-1.5 text-[0.75rem] text-[#a0a0b0]">
                      {t("home.order.pickupTime")}:{" "}
                      {new Date(pickupTimeBase + pickupTimeMinutes * 60000).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                    <button
                      type="button"
                      onClick={() => setStep("payment")}
                      className="mt-1.5 text-[0.7rem] font-bold text-brand-400 hover:underline"
                    >
                      {t("common.edit")}
                    </button>
                  </div>
                ) : null
              ) : chosenAddress || oneTimeAddress ? (
                <div className="rounded-[10px] border border-white/8 bg-surface-dark px-3.5 py-2.5">
                  <p className="text-[0.68rem] font-bold uppercase tracking-wide text-[#606070]">
                    {t("home.order.deliverTo")}
                  </p>
                  <p className="mt-0.5 truncate text-[0.82rem] font-bold text-white">{effectiveAddressLabel}</p>
                  <p className="mt-0.5 break-words text-[0.75rem] text-[#a0a0b0]">{effectiveAddressText}</p>
                  <button
                    type="button"
                    onClick={() => setStep("address")}
                    className="mt-1.5 text-[0.7rem] font-bold text-brand-400 hover:underline"
                  >
                    {t("common.edit")}
                  </button>
                </div>
              ) : null}

              {/* CUSTOMER INFORMATION — read-only, from the session user (props) */}
              <div className="rounded-[10px] border border-white/8 bg-surface-dark px-3.5 py-2.5" data-testid="drawer-customer-info">
                <p className="text-[0.68rem] font-bold uppercase tracking-wide text-[#606070]">
                  {t("home.order.customerInfo")}
                </p>
                <div className="mt-1 space-y-0.5 text-[0.8rem]">
                  <p className="text-white">
                    <span className="text-[#a0a0b0]">{t("common.name")}: </span>
                    {customerName || "—"}
                  </p>
                  <p className="text-white">
                    <span className="text-[#a0a0b0]">{t("common.phone")}: </span>
                    {customerPhone || "—"}
                  </p>
                </div>
              </div>
              {/* branch + server-priced totals. The delivery fee comes from the
                  QUOTE API priced at the saved-address coordinates — the same
                  branch id the confirm step sends, so UI === DB. */}
              <div className="rounded-[10px] border border-white/8 bg-surface-dark px-3.5 py-2.5">
                <p
                  className="text-[0.68rem] font-bold uppercase tracking-wide text-[#606070]"
                  data-testid="drawer-quote-branch-label"
                >
                  {t("home.order.nearestBranch")}
                </p>
                <p className="mt-0.5 text-[0.82rem] font-semibold text-white" data-testid="drawer-quote-branch">
                  📍 {quote?.branch?.name ?? nearestBranch ?? cartBranchName ?? "—"}
                </p>
                <dl className="mt-2.5 space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-[0.85rem] text-[#a0a0b0]">{t("home.order.subtotal")}</dt>
                    <dd className="font-medium text-white">
                      {quote ? fmt.money(quote.subtotal) : fmt.money(total)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-[0.85rem] text-[#a0a0b0]">{t("home.order.deliveryFee")}</dt>
                    <dd className="text-[0.8rem] text-white">
                      {fulfillmentType === "pickup" ? (
                        t("home.order.freePickup")
                      ) : quote ? (
                        quote.delivery_charge === 0 ? (
                          t("home.order.freeDelivery")
                        ) : (
                          fmt.money(quote.delivery_charge)
                        )
                      ) : quoting ? (
                        <span className="inline-flex items-center gap-1.5 text-[#a0a0b0]">
                          <span className="size-3 animate-spin rounded-full border-2 border-white/20 border-t-brand-500" />
                          {t("home.order.calculatingFee")}
                        </span>
                      ) : (
                        <span className="text-[#a0a0b0]">{t("home.order.deliveryFeeNote")}</span>
                      )}
                    </dd>
                  </div>
                  {quote && (quote.platform_fee ?? 0) > 0 ? (
                    /* PHASE 4 — stated before the one order-creating tap, never folded
                        silently into the total. */
                    <div className="flex items-center justify-between" data-testid="drawer-quote-platform-fee">
                      <dt className="text-[0.85rem] text-[#a0a0b0]">{t("home.order.platformFee")}</dt>
                      <dd className="text-[0.8rem] text-white">{fmt.money(quote.platform_fee ?? 0)}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between border-t border-white/8 pt-2">
                    <dt className="text-[0.95rem] font-bold text-white">{t("home.order.grandTotal")}</dt>
                    <dd
                      className="font-display text-[1.4rem] font-extrabold text-brand-500"
                      data-testid="drawer-quote-grand-total"
                    >
                      {quote ? fmt.money(quote.total) : quoting ? "…" : fmt.money(total)}
                    </dd>
                  </div>
                </dl>
                {quoteError ? (
                  <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-red-500/10 px-3 py-2">
                    <p className="text-[0.75rem] font-semibold text-red-300" role="alert">
                      {quoteError}
                    </p>
                    <button
                      type="button"
                      onClick={() => void fetchQuote()}
                      className="shrink-0 rounded-md border border-red-400/40 px-2 py-1 text-[0.7rem] font-bold text-red-300 hover:bg-red-500/20"
                    >
                      {t("home.order.retry")}
                    </button>
                  </div>
                ) : null}
              </div>
              {/* ORDER ITEMS — SL · image · name · qty · unit price · total */}
              <div className="overflow-hidden rounded-[10px] border border-white/8 bg-surface-dark" data-testid="drawer-overview-items">
                <table className="w-full text-[0.72rem]">
                  <thead>
                    <tr className="border-b border-white/8 bg-white/3 text-left text-[0.6rem] uppercase tracking-wide text-[#606070]">
                      <th className="px-2 py-1.5 font-bold">SL</th>
                      <th className="py-1.5 font-bold">{t("home.order.items")}</th>
                      <th className="py-1.5 text-center font-bold">{t("home.order.quantity")}</th>
                      <th className="py-1.5 text-right font-bold">{t("home.order.unitPrice")}</th>
                      <th className="px-2 py-1.5 text-right font-bold">{t("home.cart.total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <tr
                        key={line.lineId}
                        className={cn("border-b border-white/6 last:border-b-0", index % 2 === 1 && "bg-white/2")}
                      >
                        <td className="px-2 py-2 align-top font-extrabold text-white/50">{index + 1}</td>
                        <td className="py-2 pr-2">
                          <span className="flex items-center gap-2">
                            {line.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={line.image}
                                alt={line.name}
                                width={64}
                                height={64}
                                loading="lazy"
                                decoding="async"
                                className="size-9 shrink-0 rounded-md bg-[#17171d] object-cover"
                              />
                            ) : (
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#17171d] text-sm">
                                {line.emoji ?? "🍽️"}
                              </span>
                            )}
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-white">{line.name}</span>
                              {line.variant ? (
                                <span className="block truncate text-[0.62rem] text-white/40">{line.variant}</span>
                              ) : null}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 text-center align-top font-semibold text-white">{fmt.num(line.qty)}</td>
                        <td className="py-2 text-right align-top text-[#a0a0b0]">{fmt.money(line.unitPrice)}</td>
                        <td className="px-2 py-2 text-right align-top font-bold text-brand-500">
                          {fmt.money(line.unitPrice * line.qty)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* selected payment method — a label here; the choice lives in the
                  previous step and ONLY "CONFIRM ORDER" creates the order */}
              <div
                className="flex items-center justify-between rounded-[10px] border border-white/8 bg-surface-dark px-3.5 py-2.5"
                data-testid="drawer-overview-payment"
              >
                <span className="text-[0.68rem] font-bold uppercase tracking-wide text-[#606070]">
                  {t("home.order.paymentMethod")}
                </span>
                <span className="flex items-center gap-1.5 text-[0.82rem] font-bold text-white">
                  <span>{paymentMethodDef(payment)?.icon ?? ""}</span>
                  {paymentMethodDef(payment) ? t(paymentMethodDef(payment)!.labelKey) : payment}
                </span>
              </div>

              {placeError ? (
                <p
                  className="rounded-lg bg-red-500/10 px-3 py-2 text-center text-[0.78rem] font-semibold text-red-300"
                  role="alert"
                >
                  {placeError}
                </p>
              ) : null}
            </div>
          ) : (
            /* req #2 — SL-numbered order rows: SL · image · name · unit price ·
               qty stepper · line total. The index+1 IS the SL number. */
            lines.map((line, index) => (
              <div key={line.lineId} className="overflow-hidden rounded-[10px] border border-white/8 bg-surface-dark">
                <div className="flex items-start">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center bg-white/6 text-[0.72rem] font-extrabold text-white/70"
                    data-testid="order-sl"
                  >
                    {index + 1}
                  </span>
                  {line.image ? (
                    // PHASE C — the explicit intrinsic size reserves the box before
                    // the bytes arrive, so the drawer does not jump as each line
                    // image loads.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={line.image}
                      alt={line.name}
                      width={96}
                      height={96}
                      loading="lazy"
                      decoding="async"
                      className="size-24 shrink-0 bg-[#17171d] object-cover"
                    />
                  ) : (
                    <span className="flex size-24 shrink-0 items-center justify-center bg-[#17171d] text-3xl">
                      {line.emoji ?? "🍽️"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1 px-3 py-2.5">
                    <p className="truncate text-[0.85rem] font-semibold text-white">{line.name}</p>
                    {line.variant ? <p className="mt-0.5 truncate text-[0.7rem] text-white/40">{line.variant}</p> : null}
                    <p className="mt-0.5 text-[0.75rem] text-[#a0a0b0]">
                      {t("home.cart.each", { price: fmt.money(line.unitPrice) })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-white/6 px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setQty(line.lineId, line.qty - 1)}
                      aria-label={t("home.modal.decreaseQty")}
                      className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-[#23232e] text-lg font-bold text-white"
                    >
                      −
                    </button>
                    <span className="min-w-5.5 text-center text-base font-extrabold text-brand-500">{fmt.num(line.qty)}</span>
                    <button
                      onClick={() => setQty(line.lineId, line.qty + 1)}
                      aria-label={t("home.modal.increaseQty")}
                      className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-[#23232e] text-lg font-bold text-white"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-right">
                    <p className="text-[1.1rem] font-extrabold text-brand-500">{fmt.money(line.unitPrice * line.qty)}</p>
                    <button
                      onClick={() => remove(line.lineId)}
                      className="text-[0.65rem] text-[#606070] hover:text-red-400"
                    >
                      ✕ {t("home.cart.remove")}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-white/8 px-5 py-4">
          {view === "cart" ? (
            <>
          {/* req #5 — the branch this order belongs to. A signed-in customer
              with a trusted location sees the SERVER-calculated nearest
              eligible branch; everyone else sees the cart's own branch. */}
          <p className="mb-1 text-[0.7rem] font-bold uppercase tracking-wide text-[#606070]" data-testid="cart-nearest-branch-label">
            {nearestBranch ? t("home.order.nearestBranch") : t("cartBranch.orderingFrom")}
          </p>
          <p className="mb-2.5 text-[0.82rem] font-semibold text-white" data-testid="cart-branch">
            📍 {nearestBranch ?? cartBranchName ?? "—"}
          </p>

          {/* req #3 — Subtotal / Delivery fee / Grand Total. The delivery fee
              depends on the chosen address + branch, which only exist after
              checkout — so here it is shown as "calculated at checkout" rather
              than a guessed number. */}
          <dl className="mb-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-[0.85rem] text-[#a0a0b0]">{t("home.order.subtotal")}</dt>
              <dd className="font-medium text-white">{fmt.money(total)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[0.85rem] text-[#a0a0b0]">{t("home.order.deliveryFee")}</dt>
              <dd className="text-[0.78rem] text-[#a0a0b0]">{t("home.order.deliveryFeeNote")}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-white/8 pt-2">
              <dt className="text-[0.95rem] font-bold text-white">{t("home.order.grandTotal")}</dt>
              <dd className="font-display text-[1.5rem] font-extrabold text-brand-500" data-testid="cart-grand-total">
                {fmt.money(total)}
              </dd>
            </div>
          </dl>

          {signedIn ? (
            /* req #4 — ONE primary action, carrying the grand total, plus the
                Self Pickup alternative underneath. */
            <>
              {platformClosed ? (
                /* ITEM 5 — the SAME honest "here's why, here's what still
                    works" pattern the outside-delivery-area banner uses:
                    browsing and the cart stay open, only placing the order
                    is blocked, with a plain reason and a reopen time. */
                <div
                  className="mb-2.5 rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3"
                  data-testid="drawer-platform-closed"
                  role="status"
                >
                  <p className="text-[0.82rem] font-bold text-amber-300">{t("home.order.platformClosedTitle")}</p>
                  <p className="mt-0.5 text-[0.75rem] text-amber-200/80">{t("home.order.platformClosedBody")}</p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void startCheckout()}
                disabled={platformClosed || cartBranchId == null || lines.length === 0}
                data-testid="place-an-order"
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-[10px] bg-brand-500 py-3.25 text-[0.95rem] font-extrabold text-white transition-colors hover:bg-brand-600",
                  (platformClosed || cartBranchId == null || lines.length === 0) && "cursor-not-allowed opacity-50",
                )}
              >
                {t("home.order.placeAnOrder")} · {fmt.money(total)}
              </button>
              <button
                type="button"
                onClick={startPickupCheckout}
                disabled={platformClosed || cartBranchId == null || lines.length === 0}
                data-testid="self-pickup"
                className={cn(
                  "mt-2 flex w-full items-center justify-center gap-2 rounded-[10px] border border-brand-500/40 py-2.75 text-[0.85rem] font-extrabold text-brand-400 transition-colors hover:bg-brand-500/10",
                  (platformClosed || cartBranchId == null || lines.length === 0) && "cursor-not-allowed opacity-50",
                )}
              >
                🏬 {t("home.order.selfPickup")}
              </button>
            </>
          ) : (
            /* req #6 — not logged in: the flow STOPS here with a clear message
                and the two account actions. The cart survives the login
                round-trip, and the SAME in-drawer checkout opens once the
                customer returns signed in. */
            <div className="space-y-2.5" data-testid="checkout-auth-gate">
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-[0.8rem] text-amber-300">
                {t("home.order.needLogin")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href="/register/customer"
                  onClick={closeCart}
                  className="flex items-center justify-center rounded-[10px] bg-brand-500 py-3 text-[0.85rem] font-extrabold text-white hover:bg-brand-600"
                >
                  {t("home.order.createAccount")}
                </a>
                <a
                  href="/login"
                  onClick={closeCart}
                  className="flex items-center justify-center rounded-[10px] border border-white/12 py-3 text-[0.85rem] font-extrabold text-white hover:border-brand-500"
                >
                  {t("home.order.login")}
                </a>
              </div>
            </div>
          )}
            </>
          ) : view === "pickup-confirm" ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={goBackToCart}
                className="flex items-center justify-center rounded-[10px] border border-white/12 py-3 text-[0.85rem] font-extrabold text-white hover:border-brand-500"
              >
                ← {t("home.order.backToCart")}
              </button>
              <button
                type="button"
                onClick={goPickupPayment}
                disabled={!pickupBranch || loadingPickupBranch}
                data-testid="drawer-confirm-pickup-branch"
                className={cn(
                  "flex items-center justify-center gap-2 rounded-[10px] bg-brand-500 py-3 text-[0.85rem] font-extrabold text-white hover:bg-brand-600",
                  (!pickupBranch || loadingPickupBranch) && "cursor-not-allowed opacity-50",
                )}
              >
                {t("home.order.confirmPickup")} →
              </button>
            </div>
          ) : view === "address" ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={goBackToCart}
                className="flex items-center justify-center rounded-[10px] border border-white/12 py-3 text-[0.85rem] font-extrabold text-white hover:border-brand-500"
              >
                ← {t("home.order.backToCart")}
              </button>
              <button
                type="button"
                onClick={goPayment}
                disabled={(!addressId && !oneTimeAddress) || loadingAddresses}
                data-testid="drawer-next-payment"
                className={cn(
                  "flex items-center justify-center gap-2 rounded-[10px] bg-brand-500 py-3 text-[0.85rem] font-extrabold text-white hover:bg-brand-600",
                  ((!addressId && !oneTimeAddress) || loadingAddresses) && "cursor-not-allowed opacity-50",
                )}
              >
                {t("home.order.continue")} →
              </button>
            </div>
          ) : view === "payment" ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={goBackFromPayment}
                className="flex items-center justify-center rounded-[10px] border border-white/12 py-3 text-[0.75rem] font-extrabold text-white hover:border-brand-500"
              >
                ← {fulfillmentType === "pickup" ? t("home.order.backToPickupConfirm") : t("home.order.selectDeliveryAddress")}
              </button>
              <button
                type="button"
                onClick={goOverview}
                data-testid="drawer-next-overview"
                className="flex items-center justify-center gap-2 rounded-[10px] bg-brand-500 py-3 text-[0.85rem] font-extrabold text-white hover:bg-brand-600"
              >
                {t("home.order.continue")} →
              </button>
            </div>
          ) : view === "overview" ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={goBackToPayment}
                className="w-full rounded-[10px] border border-white/12 py-2.5 text-[0.8rem] font-extrabold text-white hover:border-brand-500"
              >
                ← {t("home.order.paymentMethod")}
              </button>
              <button
                type="button"
                onClick={() => void confirmOrder()}
                disabled={!quote || placing}
                data-testid="drawer-confirm-order"
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-[10px] bg-brand-500 py-3.25 text-[0.95rem] font-extrabold text-white transition-colors hover:bg-brand-600",
                  (!quote || placing) && "cursor-not-allowed opacity-50",
                )}
              >
                {placing ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
                {placing ? t("home.order.placing") : t("orders.confirmOrder")} · {fmt.money(quote ? quote.total : total)}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <a
                href={orderResult ? `/customer/orders/${orderResult.orderId}` : "/customer/orders"}
                data-testid="drawer-view-order"
                className="flex items-center justify-center rounded-[10px] bg-brand-500 py-3 text-[0.85rem] font-extrabold text-white hover:bg-brand-600"
              >
                {t("home.order.viewOrder")}
              </a>
              <button
                type="button"
                onClick={handleClose}
                data-testid="drawer-continue-shopping"
                className="flex items-center justify-center rounded-[10px] border border-white/12 py-3 text-[0.85rem] font-extrabold text-white hover:border-brand-500"
              >
                {t("home.order.continueShopping")}
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
