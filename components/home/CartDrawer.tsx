"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useHomeCart } from "@/components/home/home-cart-context";
import { MapPicker, type PickedPoint } from "@/components/maps/map-picker";
import { placeOrderAction } from "@/lib/api/actions";
import { CUSTOMER_PAYMENT_METHODS, paymentMethodDef } from "@/lib/constants";
import {
  CUSTOM_VALUE,
  MAIN_AREA_NAMES,
  ROAD_LANE_OPTIONS,
  subAreasFor,
} from "@/lib/constants/area-data";
import { useTranslation } from "@/lib/i18n/use-translation";
import { LIMITS } from "@/lib/validation/limits";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/types";

/* Task 3 — the drawer's checkout state machine. Every step renders INSIDE this
   drawer; nothing navigates to /customer/checkout anymore. */
type CheckoutStep = "cart" | "address" | "payment" | "overview" | "success";

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

/** /api/delivery/quote response — the subset the drawer renders. */
interface DrawerQuote {
  branch: { id: number; name: string };
  subtotal: number;
  delivery_charge: number;
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
  grandTotal: number;
}

/** The card title for a saved address (preset label or the custom name). */
function addressCardLabel(a: DrawerSavedAddress): string {
  if (a.display_label) return a.display_label;
  if (a.label === "Others" && a.custom_label) return a.custom_label;
  return a.label;
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
}: {
  signedIn?: boolean;
  customerName?: string | null;
  customerPhone?: string | null;
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
  const [addresses, setAddresses] = useState<DrawerSavedAddress[]>([]);
  const [addressId, setAddressId] = useState("");
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  // Compact add-address form — the same Area → sub-area model as the address book.
  const [labelChoice, setLabelChoice] = useState("Home");
  const [customLabel, setCustomLabel] = useState("");
  const [mainArea, setMainArea] = useState("");
  const [customMain, setCustomMain] = useState("");
  const [subArea, setSubArea] = useState("");
  const [road, setRoad] = useState("");
  const [house, setHouse] = useState("");
  const [flat, setFlat] = useState("");
  const [landmark, setLandmark] = useState("");
  // Map/current-location add-address ("USE MAP / CURRENT LOCATION"): the picked
  // point carries lat/lng + the reverse-geocoded address and Google place_id.
  const [showMapForm, setShowMapForm] = useState(false);
  const [mapPoint, setMapPoint] = useState<PickedPoint | null>(null);
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

  /* ══════════════ Task 3 — same-screen checkout (NO navigation) ══════════════
     Every step below renders inside this drawer. The /customer/checkout route
     still exists for deep links, but this flow never routes to it. */

  /** Closes the drawer and rewinds to the cart view; checkout state is transient. */
  function handleClose() {
    closeCart();
    setStep("cart");
    setShowAddForm(false);
    setShowMapForm(false);
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

  /**
   * Compact add-address form → POST /api/customer/addresses. Same Area →
   * sub-area model as the address book: a custom main area ("+ Add your Own")
   * disables the sub-area select and stores custom_area instead.
   */
  async function submitNewAddress() {
    const isCustom = mainArea === CUSTOM_VALUE;
    const areaName = isCustom ? customMain.trim() : mainArea.trim();
    if (!areaName) {
      setAddressError(isCustom ? t("home.order.errCustomAreaRequired") : t("home.order.errAreaRequired"));
      return;
    }
    if (labelChoice === "Others" && !customLabel.trim()) {
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
      if (!isCustom && subArea.trim()) parts.push(subArea.trim());
      parts.push(areaName, "Dhaka");
      const res = await fetch("/api/customer/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: labelChoice,
          ...(labelChoice === "Others" ? { custom_label: customLabel.trim() } : {}),
          address: parts.join(", "),
          main_area: areaName,
          ...(isCustom ? { custom_area: areaName } : { sub_area: subArea.trim() }),
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
    if (!chosenAddress || cartBranchId == null) return;
    setQuoteError(null);
    setQuoting(true);
    try {
      const lat = chosenAddress.latitude != null ? Number(chosenAddress.latitude) : undefined;
      const lng = chosenAddress.longitude != null ? Number(chosenAddress.longitude) : undefined;
      const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
      const res = await fetch("/api/delivery/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch_id: cartBranchId,
          fulfillment_type: "delivery",
          ...(hasCoords ? { lat, lng } : {}),
          items: lines.map((l) => ({ product_id: Number(l.itemId), quantity: l.qty })),
        }),
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
    if (!chosenAddress) {
      setAddressError(t("home.order.errAddressRequired"));
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
    setMapPoint(null);
  }

  function goBackToPayment() {
    setStep("payment");
    setPlaceError(null);
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
    if (labelChoice === "Others" && !customLabel.trim()) {
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
          label: labelChoice,
          ...(labelChoice === "Others" ? { custom_label: customLabel.trim() } : {}),
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
    if (!chosenAddress || !quote || placing) return;
    if (!attemptKeyRef.current) rotateAttemptKey();
    setPlacing(true);
    setPlaceError(null);
    try {
      const lat = chosenAddress.latitude != null ? Number(chosenAddress.latitude) : undefined;
      const lng = chosenAddress.longitude != null ? Number(chosenAddress.longitude) : undefined;
      const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
      const result = await placeOrderAction({
        branch_id: quote.branch.id,
        idempotency_key: attemptKeyRef.current,
        payment_method: payment,
        delivery_address: chosenAddress.address,
        food_notes: "",
        fulfillment_type: "delivery",
        ...(hasCoords ? { lat, lng } : {}),
        customer_address_id: chosenAddress.id,
        coord_source: "saved_address",
        items: lines.map((l) => ({ product_id: Number(l.itemId), quantity: l.qty, food_note: "" })),
      });
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
        addressText: chosenAddress.address,
        items: count,
        subtotal: quote.subtotal,
        deliveryFee: quote.delivery_charge,
        grandTotal: quote.total,
      });
      clear(); // ordered — the drawer cart empties (orderResult holds the receipt)
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
                  <span className="text-[#a0a0b0]">{t("home.order.deliveryAddress")}</span>
                  <p className="mt-0.5 break-words text-white">{orderResult.addressText}</p>
                </div>
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
                    <span className="text-white">{fmt.money(orderResult.deliveryFee)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/8 pt-1.5">
                    <span className="font-bold text-white">{t("home.order.grandTotal")}</span>
                    <span className="font-display text-[1.1rem] font-extrabold text-brand-500">
                      {fmt.money(orderResult.grandTotal)}
                    </span>
                  </div>
                </div>
              </div>
              {/* req #18 — estimated delivery expectation. Worded as an
                  EXPECTATION, never a guaranteed exact time. */}
              <div className="rounded-[10px] border border-white/8 bg-surface-dark p-3" data-testid="drawer-delivery-estimate">
                <p className="text-[0.68rem] font-bold uppercase tracking-wide text-[#606070]">
                  {t("home.order.deliveryTimeTitle")}
                </p>
                <p className="mt-1 text-[0.78rem] text-[#a0a0b0]">{t("home.order.receivedByBranch")}</p>
                <p className="mt-1 text-[0.78rem] text-white">{t("home.order.deliveryTimeEstimate")}</p>
              </div>
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
              {!loadingAddresses && !addressError && addresses.length === 0 && !showAddForm ? (
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
                            {addressCardLabel(a)}
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
                        </span>
                      </button>
                    );
                  })}
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
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={labelChoice}
                      onChange={(e) => setLabelChoice(e.target.value)}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                      aria-label={t("addresses.selectLabel")}
                    >
                      <option value="Home">{t("addresses.preset_home")}</option>
                      <option value="Home-2">{t("addresses.preset_home2")}</option>
                      <option value="Home-3">{t("addresses.preset_home3")}</option>
                      <option value="Office">{t("addresses.preset_office")}</option>
                      <option value="Others">{t("addresses.preset_others")}</option>
                    </select>
                    {labelChoice === "Others" ? (
                      <input
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                        placeholder={t("addresses.customLabelPlaceholder")}
                        maxLength={40}
                        className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                        aria-label={t("addresses.selectLabel")}
                      />
                    ) : null}
                  </div>
                  <select
                    value={mainArea}
                    onChange={(e) => {
                      setMainArea(e.target.value);
                      setSubArea("");
                      setCustomMain("");
                    }}
                    className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                    aria-label={t("addresses.selectYourArea")}
                  >
                    <option value="">{t("addresses.selectYourArea")}</option>
                    {MAIN_AREA_NAMES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value={CUSTOM_VALUE}>{t("addresses.addYourOwn")}</option>
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
                    <select
                      value={subArea}
                      onChange={(e) => setSubArea(e.target.value)}
                      className="h-9 w-full rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                      aria-label={t("addresses.selectYourAreaName")}
                    >
                      <option value="">{t("addresses.selectYourAreaName")}</option>
                      {subAreasFor(mainArea).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={road}
                      onChange={(e) => setRoad(e.target.value)}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                      aria-label={t("addresses.selectRoadLane")}
                    >
                      <option value="">{t("addresses.selectRoadLane")}</option>
                      {ROAD_LANE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
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
              ) : addresses.length >= LIMITS.maxSavedAddresses ? (
                /* 5/5 — no way to add a 6th address from the UI (the backend
                    route rejects it independently) */
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
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={labelChoice}
                      onChange={(e) => setLabelChoice(e.target.value)}
                      className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white"
                      aria-label={t("addresses.selectLabel")}
                    >
                      <option value="Home">{t("addresses.preset_home")}</option>
                      <option value="Home-2">{t("addresses.preset_home2")}</option>
                      <option value="Home-3">{t("addresses.preset_home3")}</option>
                      <option value="Office">{t("addresses.preset_office")}</option>
                      <option value="Others">{t("addresses.preset_others")}</option>
                    </select>
                    {labelChoice === "Others" ? (
                      <input
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                        placeholder={t("addresses.customLabelPlaceholder")}
                        maxLength={40}
                        className="h-9 rounded-lg border border-white/10 bg-[#23232e] px-2 text-[0.78rem] text-white placeholder:text-white/30"
                        aria-label={t("addresses.selectLabel")}
                      />
                    ) : null}
                  </div>
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
              <p className="rounded-lg bg-white/4 px-3 py-2 text-center text-[0.72rem] text-[#a0a0b0]">
                {t("home.order.deliverTo")}: {chosenAddress ? addressCardLabel(chosenAddress) : "—"}
              </p>
            </div>
          ) : view === "overview" ? (
            <div className="space-y-2.5 pb-2" data-testid="drawer-checkout-overview-step">
              {/* deliver-to recap — the saved address whose coordinates price
                  and route this order */}
              {chosenAddress ? (
                <div className="rounded-[10px] border border-white/8 bg-surface-dark px-3.5 py-2.5">
                  <p className="text-[0.68rem] font-bold uppercase tracking-wide text-[#606070]">
                    {t("home.order.deliverTo")}
                  </p>
                  <p className="mt-0.5 truncate text-[0.82rem] font-bold text-white">
                    {addressCardLabel(chosenAddress)}
                  </p>
                  <p className="mt-0.5 break-words text-[0.75rem] text-[#a0a0b0]">{chosenAddress.address}</p>
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
                      {quote ? (
                        fmt.money(quote.delivery_charge)
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
            /* req #4 — ONE primary action, carrying the grand total. */
            <button
              type="button"
              onClick={() => void startCheckout()}
              disabled={cartBranchId == null || lines.length === 0}
              data-testid="place-an-order"
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-[10px] bg-brand-500 py-3.25 text-[0.95rem] font-extrabold text-white transition-colors hover:bg-brand-600",
                (cartBranchId == null || lines.length === 0) && "cursor-not-allowed opacity-50",
              )}
            >
              {t("home.order.placeAnOrder")} · {fmt.money(total)}
            </button>
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
                disabled={!addressId || loadingAddresses}
                data-testid="drawer-next-payment"
                className={cn(
                  "flex items-center justify-center gap-2 rounded-[10px] bg-brand-500 py-3 text-[0.85rem] font-extrabold text-white hover:bg-brand-600",
                  (!addressId || loadingAddresses) && "cursor-not-allowed opacity-50",
                )}
              >
                {t("home.order.continue")} →
              </button>
            </div>
          ) : view === "payment" ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={goBackToAddress}
                className="flex items-center justify-center rounded-[10px] border border-white/12 py-3 text-[0.75rem] font-extrabold text-white hover:border-brand-500"
              >
                ← {t("home.order.selectDeliveryAddress")}
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
