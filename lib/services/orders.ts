import "server-only";
import { Prisma } from "@prisma/client";
import type { Order, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { conflict, forbidden, sk, validationError } from "@/lib/http/errors";
import {
  ALLOWED_TRANSITIONS,
  BRANCH_MANAGER_SETTABLE,
  CUSTOMER_SETTABLE,
  DELAY_MAX_MINUTES,
  DELAY_MIN_MINUTES,
  PICKUP_MIN_LEAD_MINUTES,
  RIDER_SETTABLE,
} from "@/lib/constants/orders";
import { createNotification, notifyBranchManagers } from "@/lib/services/notifications";
import { recordCommissionForOrder } from "@/lib/services/wallet";
import { awardOrderCoinsByRule } from "@/lib/services/reward-rules";
import { awardCoins, consumeRedemptionForOrder, restoreRedemptionForOrder } from "@/lib/services/rewards";
import { claimCouponForOrder, releaseCouponForOrder } from "@/lib/services/marketing";
import { allowedCrustChoices } from "@/lib/constants/enums";
import { isPaymentMethod } from "@/lib/constants";
import { LIMITS } from "@/lib/validation/limits";
import { resolveDeliveryCoordinate } from "@/lib/services/customer-location";
import { coverageForAddress, type AddressCoverage } from "@/lib/services/address-coverage";
import { platformFeeFor } from "@/lib/services/settings";
import { haversineKm } from "@/lib/services/geo";
import { isBranchOpenNow } from "@/lib/services/branch-hours";
import { formatClock } from "@/lib/i18n/format";
import { isFullClosureWindow, isPastNightLastOrder } from "@/lib/services/coverage-window";
import { isReceiveConfirmed } from "@/lib/services/rider-duty";
import { nextOrderNumber } from "@/lib/services/order-number";
import { customerProductWhere } from "@/lib/services/product-eligibility";
import { resolveOrderDeliveryArea } from "@/lib/services/delivery-areas";
import type { OrderStatus } from "@/types";

export interface OrderItemInput {
  product_id: number;
  variation_id?: number;
  quantity: number;
  food_note?: string;
  /** req #4 — chosen crust ("THICK" | "THIN"); validated against the product. */
  variation_type?: string;
}

/**
 * req #4 — resolve the crust the customer may actually order for a product.
 * THICK/THIN products accept only their own crust (a forged "THIN" on a THICK
 * product is REJECTED server-side, never silently coerced); a BOTH product
 * requires an explicit choice. Returns the value snapshotted onto the order item.
 */
function resolveCrustChoice(policy: string, submitted: string | undefined): string {
  const allowed = allowedCrustChoices(policy);
  const chosen = String(submitted ?? "").trim().toUpperCase();
  if (allowed.length === 0) return ""; // unknown/legacy policy → nothing to enforce
  if (policy === "BOTH") {
    if (!chosen) throw validationError({ items: sk("errors.orders.variationTypeRequired") });
    if (!allowed.includes(chosen as "THICK" | "THIN")) {
      throw validationError({ items: sk("errors.orders.variationTypeNotAvailable") });
    }
    return chosen;
  }
  // Fixed-crust product: an explicit mismatching choice is a hard error.
  if (chosen && chosen !== policy) {
    throw validationError({ items: sk("errors.orders.variationTypeNotAvailable") });
  }
  return policy;
}

/**
 * #20 — Resolve the branch for a DELIVERY order SERVER-SIDE from the cart's
 * products + trusted coordinates, IGNORING any client-submitted branch_id (the
 * browser can never force a branch). The catalog is branch-specific, so the only
 * branch that can serve the cart is the one its products belong to; that branch
 * must be active, not archived, NOT ON A BRANCH-MANAGER HOLD, and cover the
 * coordinates. Among branches that could serve the cart it is (trivially) the
 * nearest — computed deterministically with a stable id tiebreak so equal
 * distances resolve consistently. Throws a translated error when no eligible
 * branch can serve the cart.
 */
export 
/**
 * The ONE branch that can fill this cart. A cart is a single branch's products
 * (the menu is branch-scoped), so there is nothing to choose between: either
 * this branch delivers to the destination, or delivery is not offered — which
 * is exactly the no-mixed-branch rule. Ineligible products cannot nominate it.
 */
async function servingBranchForCart(productIds: number[]) {
  const products = await prisma.product.findMany({
    where: customerProductWhere({ ids: productIds }),
    select: { branchId: true },
  });
  const servingBranchIds = [...new Set(products.map((p) => p.branchId))];
  if (products.length === 0 || servingBranchIds.length !== 1) {
    throw validationError({ items: sk("errors.orders.someProductsUnavailable") });
  }
  const branch = await prisma.branch.findFirst({
    where: { id: servingBranchIds[0], isActive: true, isArchived: false },
  });
  if (!branch) throw validationError({ delivery_address: sk("errors.orders.noEligibleBranch") });
  return branch;
}

type PricedProduct = Prisma.ProductGetPayload<{ include: { variations: true } }>;

/**
 * Resolve the purchasable variation for a line (shared by createOrder + quote).
 * A disabled/foreign variation is rejected; when none is specified fall back to
 * the product's default (then any enabled one).
 */
function resolveVariationFor(product: PricedProduct, variationId?: number) {
  const enabled = product.variations.filter((v) => v.isEnabled);
  if (variationId != null) {
    const chosen = enabled.find((v) => v.id === variationId);
    if (!chosen) throw validationError({ items: sk("errors.orders.variationUnavailable") });
    return chosen;
  }
  return enabled.find((v) => v.isDefault) ?? enabled[0] ?? null;
}

/**
 * WS-1.5 — THE MONEY RULE FOR THIS FILE.
 *
 * Every Taka figure below is a `Prisma.Decimal` and every step — the product's
 * percentage discount, the variation price, the quantity multiplication, the
 * coupon, the coin voucher, the delivery charge and the grand total — is EXACT
 * decimal arithmetic. No money value passes through a JS float, because a paisa
 * lost to binary rounding is a total that will not reconcile against a bKash
 * settlement or the accounts ledger.
 *
 * ROUNDING RULE — stated once here and applied nowhere else:
 *   the UNIT PRICE is rounded to 2 decimal places (one paisa), HALF_UP, exactly
 *   ONCE: at the only point that produces sub-paisa precision, a percentage
 *   discount. Everything after it is a sum or difference of 2dp values, which
 *   decimal arithmetic keeps exact, so nothing else rounds. Rounding the UNIT
 *   rather than the line total is what makes an invoice add up — the customer
 *   reads `unit × qty` and it equals the line the ledger stores.
 *
 * NOT rounded here: tax and the service charge. They are deliberately absent
 * from this pipeline — see lib/services/settings.ts, `ChargeRates`: BD menu
 * prices are VAT-inclusive, so those rates EXTRACT a share of money already
 * collected for reporting and are never a surcharge added to a total. Adding
 * them here would invent revenue the till never saw.
 */
const MONEY_DP = 2;
const MONEY_ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

/** Round a Taka figure to the paisa, HALF_UP. The one rounding boundary. */
function toPaisa(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_DP, MONEY_ROUNDING);
}

/** Zero Taka. A fresh instance per call — Decimals are passed around freely. */
function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

/** Never let a money figure go below zero, whatever the discounts add up to. */
function notBelowZero(value: Prisma.Decimal): Prisma.Decimal {
  return value.isNegative() ? zero() : value;
}

/**
 * Apply a product's percentage discount to a unit price — exact Decimal maths,
 * rounded to the paisa once (see the money rule above). A discount of 100 %+ is
 * clamped to a free item rather than a negative price.
 */
function discountedUnit(price: Prisma.Decimal, discount: Prisma.Decimal): Prisma.Decimal {
  const base = new Prisma.Decimal(price);
  if (!discount.greaterThan(0)) return toPaisa(base);
  return toPaisa(notBelowZero(base.minus(base.times(discount).dividedBy(100))));
}

/**
 * The quantity a line may actually be ordered in. Money is MULTIPLIED by this,
 * so a fractional, negative or absurd value would produce a total nobody can
 * reconcile — it is a hard validation error, never silently coerced. (This
 * `Number()` is on a COUNT, not on money; the bounds are the same LIMITS the
 * cart UI enforces, so the two sides can never disagree.)
 */
function resolveQuantity(raw: unknown): number {
  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || quantity < LIMITS.qtyMin || quantity > LIMITS.qtyMax) {
    throw validationError({
      items: sk("errors.orders.invalidQuantity", { min: LIMITS.qtyMin, max: LIMITS.qtyMax }),
    });
  }
  return quantity;
}

/** One fully priced cart line — the shared unit of pricing for quote + create. */
interface PricedLine {
  product: PricedProduct;
  variation: PricedProduct["variations"][number] | null;
  /** req #4 — server-validated crust, snapshotted onto the order item. */
  crust: string;
  quantity: number;
  /** Discounted unit price, already at paisa precision. */
  unitPrice: Prisma.Decimal;
  /** unitPrice × quantity — exact, so it is never re-rounded. */
  lineTotal: Prisma.Decimal;
  /** The customer's per-item note, carried through verbatim. */
  foodNote: string;
}

/**
 * Price every cart line ONCE, for both the quote and the persisted order, so
 * the preview the customer accepted and the order the ledger stores can never
 * disagree by a paisa. Validates the crust, the variation and the quantity on
 * the way through — the same errors either entry point would raise.
 */
function priceLines(items: OrderItemInput[], byId: Map<number, PricedProduct>): PricedLine[] {
  return items.map((item) => {
    const product = byId.get(item.product_id)!;
    const variation = resolveVariationFor(product, item.variation_id);
    const crust = resolveCrustChoice(product.variationType, item.variation_type);
    const quantity = resolveQuantity(item.quantity);
    // Price basis = selected variation price (current), else legacy product price.
    const unitPrice = discountedUnit(variation ? variation.price : product.price, product.discount);
    return {
      product,
      variation,
      crust,
      quantity,
      unitPrice,
      lineTotal: unitPrice.times(quantity),
      foodNote: item.food_note ?? "",
    };
  });
}

/** Items subtotal — an exact sum of exact 2dp lines. */
function sumLines(lines: PricedLine[]): Prisma.Decimal {
  return lines.reduce((sum, line) => sum.plus(line.lineTotal), zero());
}

/**
 * The delivery charge for a cart: pickup is free, a named area supplies its own
 * charge, otherwise the branch-level fee applies. Read straight off the Decimal
 * columns and normalised to the paisa — never recomputed from a client figure.
 */
function deliveryChargeFor(
  fulfillmentType: "delivery" | "pickup",
  branch: { deliveryFee: Prisma.Decimal },
  area: { deliveryCharge: Prisma.Decimal } | null,
): Prisma.Decimal {
  if (fulfillmentType === "pickup") return zero();
  return toPaisa(new Prisma.Decimal(area ? area.deliveryCharge : branch.deliveryFee));
}

/**
 * Resolve the delivery/pickup branch for a cart (shared by createOrder + quote):
 * pickup uses the explicit branch (must be active, not archived, not on a
 * branch-manager hold, pickup-enabled); delivery derives the branch server-side
 * from the cart + trusted coordinates (client branch_id ignored — #20). Also
 * validates coordinates for delivery.
 *
 * THE HOLD CHOKE POINT: every order-creating path (`createOrder`, and through
 * it POST /api/orders and the reorder route) and the checkout quote go through
 * here, so a held branch is refused ONCE, server-side, for all of them — the
 * dashboard control is a convenience, never the enforcement.
 */
/** "Closed, opens at 10:45 PM" when the branch has an opening time to name. */
function branchClosedMessage(opensAt: string | null): string {
  return opensAt
    ? sk("errors.orders.branchClosedOpensAt", { time: formatClock(opensAt) })
    : sk("errors.orders.branchClosed");
}

async function resolveBranchForCart(input: {
  branchId: number;
  productIds: number[];
  fulfillmentType: "delivery" | "pickup";
  lat?: number | null;
  lng?: number | null;
  /** The ordering customer, so delivery can be pinned to their own branch. */
  customerId?: number;
  /** A saved address of theirs; its own coordinates and locality win. */
  customerAddressId?: number | null;
}): Promise<{
  branch: Awaited<ReturnType<typeof servingBranchForCart>>;
  lat: number | null;
  lng: number | null;
  coverage: AddressCoverage | null;
}> {
  // ITEM 5 — 04:00–11:00 Dhaka: the whole platform is closed, delivery AND
  // pickup, at every branch, whatever that branch's own hours say. Checked
  // before anything branch-specific, so it applies uniformly to both rails.
  if (isFullClosureWindow()) {
    throw validationError({ branch_id: sk("errors.orders.platformClosed") });
  }
  if (input.fulfillmentType === "pickup") {
    const picked = await prisma.branch.findFirst({
      where: { id: input.branchId, isActive: true, isArchived: false },
    });
    if (!picked) throw validationError({ branch_id: sk("errors.orders.branchNotFoundOrClosed") });
    // A branch its MANAGER has put on hold takes no new order on ANY rail —
    // pickup is an order too, so the gate lives here beside the hours check
    // rather than only on the delivery path.
    if (picked.isOnHold) throw validationError({ branch_id: sk("errors.orders.branchOnHold") });
    // A branch outside its opening hours cannot take a pickup order either (§17).
    const pickedHours = isBranchOpenNow(picked);
    if (!pickedHours.orderable) throw validationError({ branch_id: branchClosedMessage(pickedHours.opensAt) });
    if (!picked.pickupEnabled) throw validationError({ fulfillment_type: sk("errors.orders.pickupUnavailable") });
    return { branch: picked, lat: null, lng: null, coverage: null };
  }
  // Decided against the cart's own branch through the SAME coverage function
  // the checkout screen shows live, so the screen and the server can never
  // disagree. Coverage is the customer's PIN inside one of this branch's drawn
  // areas, on the shift running now. The client's branch_id is never trusted.
  const branch = await servingBranchForCart(input.productIds);
  const coverage = await coverageForAddress(branch, {
    customerId: input.customerId ?? 0,
    customerAddressId: input.customerAddressId ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  });
  if (!coverage.covered) {
    if (coverage.reason === "no_location") {
      throw validationError({ delivery_address: sk("errors.orders.locationRequired") });
    }
    // Inside a held area, or this branch paused delivery: pickup is still on
    // offer, so it gets its own message rather than a flat "out of area".
    if (coverage.pickupOnly) {
      throw validationError({ delivery_address: sk("errors.orders.areaOnHoldPickupOnly") });
    }
    // Measured, and outside. Delivery is simply not offered from this branch —
    // no other branch is substituted, because the cart belongs to this one.
    throw validationError({ delivery_address: sk("errors.orders.outsideDeliveryArea") });
  }
  // A manager's hold is a deliberate, current decision, so it is reported ahead
  // of the hours gate — the same order the previous resolver used.
  if (branch.isOnHold) throw validationError({ branch_id: sk("errors.orders.branchOnHold") });
  const branchHours = isBranchOpenNow(branch);
  if (!branchHours.orderable) {
    throw validationError({ branch_id: branchClosedMessage(branchHours.opensAt) });
  }
  // PHASE 3 — the night shift accepts its last delivery order at 03:45, so the
  // ride can finish by 04:00. Pickup has no ride and is governed by hours alone.
  if (isPastNightLastOrder()) {
    throw validationError({ branch_id: sk("errors.orders.nightLastOrderPassed") });
  }
  return {
    branch,
    lat: coverage.point?.lat ?? null,
    lng: coverage.point?.lng ?? null,
    coverage,
  };
}

/**
 * req #6 — a server-derived quote for the checkout summary. Uses the SAME branch,
 * area, product-availability and pricing rules as createOrder, but persists
 * nothing. Everything shown to the customer (subtotal, delivery charge, prep time,
 * delivery estimate, overall estimate, total) is computed here, never trusted from
 * the client. Held/inactive/foreign areas and unavailable products throw the same
 * translated validation errors as placing the order would.
 */
export async function quoteOrder(input: {
  branchId: number;
  items: OrderItemInput[];
  fulfillmentType?: string;
  lat?: number | null;
  lng?: number | null;
  deliveryAreaId?: number | null;
  /** Pins a delivery quote to the customer's own resolved branch. */
  customerId?: number;
  /** The saved address being checked out to; its own pin wins over lat/lng. */
  customerAddressId?: number | null;
}) {
  const fulfillmentType = input.fulfillmentType === "pickup" ? "pickup" : "delivery";
  const productIds = input.items.map((i) => i.product_id);
  const { branch, coverage } = await resolveBranchForCart({
    branchId: input.branchId,
    productIds,
    fulfillmentType,
    lat: input.lat,
    lng: input.lng,
    customerId: input.customerId,
    customerAddressId: input.customerAddressId ?? null,
  });
  // The area is whatever the branch's shapes resolve the delivery POINT to —
  // never what the client asked for. A stale id from a map the manager has since
  // re-drawn is refused rather than silently billed.
  const area =
    fulfillmentType === "delivery"
      ? await resolveOrderDeliveryArea(branch.id, coverage?.point ?? null, input.deliveryAreaId)
      : null;

  const products = await prisma.product.findMany({
    where: orderableProductWhere(branch.id, productIds),
    include: { variations: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !byId.has(id));
  if (missing.length) throw validationError({ items: sk("errors.orders.someProductsUnavailable") });

  // WS-1.5 — priced with the SAME exact-Decimal helper createOrder uses, so the
  // quote and the order it turns into agree to the paisa. The `.toNumber()`
  // calls below are the JSON SERIALIZATION boundary, not arithmetic: each one
  // converts an already-final 2dp figure for the response body, and nothing is
  // ever computed from the converted value.
  const lines = priceLines(input.items, byId);
  const items = lines.map((line) => ({
    product_id: line.product.id,
    variation_id: line.variation?.id ?? null,
    variation_name: line.variation?.name ?? "",
    variation_type: line.crust,
    name: line.product.name,
    unit_price: line.unitPrice.toNumber(),
    quantity: line.quantity,
    line_total: line.lineTotal.toNumber(),
  }));

  const subtotalAmount = sumLines(lines);
  const deliveryChargeAmount = deliveryChargeFor(fulfillmentType, branch, area);
  // PHASE 4 — the flat platform fee, for delivery AND pickup alike, resolved from
  // the same setting (global, or this branch's override) the order will snapshot.
  const platformFeeAmount = toPaisa(await platformFeeFor(branch.id));
  const subtotal = subtotalAmount.toNumber();
  const deliveryCharge = deliveryChargeAmount.toNumber();
  const prepTime = branch.prepTimeMinutes ?? null;
  const deliveryEstimate = area ? area.estimatedDeliveryMinutes : null;
  const overallEstimate =
    prepTime != null ? prepTime + (deliveryEstimate ?? 0) : deliveryEstimate;

  return {
    fulfillment_type: fulfillmentType,
    branch: { id: branch.id, name: branch.name },
    area: area
      ? {
          id: area.id,
          name: area.name,
          delivery_charge: deliveryCharge,
          estimated_delivery_minutes: area.estimatedDeliveryMinutes,
          is_held: area.isHeld,
        }
      : null,
    items,
    subtotal,
    delivery_charge: deliveryCharge,
    platform_fee: platformFeeAmount.toNumber(),
    prep_time_minutes: prepTime,
    delivery_estimate_minutes: deliveryEstimate,
    overall_estimate_minutes: overallEstimate,
    total: subtotalAmount.plus(deliveryChargeAmount).plus(platformFeeAmount).toNumber(),
  };
}

/**
 * PHASE R — the eligibility a product must satisfy to be ORDERABLE from a
 * branch. This is deliberately the same rule the customer catalogue applies, so
 * a direct API call cannot order something the menu would never have shown:
 * the product must belong to this branch, be available, not held by an admin,
 * not soft-deleted, AND sit under an ACTIVE category (or no category at all).
 * A category scoped to a different branch never qualifies.
 */
/**
 * What may be ORDERED. Delegates to the one shared customer-eligibility
 * definition rather than restating it: this clause used to omit the branch
 * active/archived and enabled-variation rules that the catalog list applied, so
 * a product could be hidden from the menu yet still accepted by the order API
 * (and vice versa). Same rules, one place.
 */
function orderableProductWhere(branchId: number, productIds: number[]): Prisma.ProductWhereInput {
  return customerProductWhere({ branchId, ids: productIds });
}

/** Create an order with items. Prices are snapshotted from the products. */
export async function createOrder(input: {
  customerId: number;
  branchId: number;
  items: OrderItemInput[];
  paymentMethod: string;
  deliveryAddress: string;
  foodNotes?: string;
  couponCode?: string;
  /** WS-7.1 — a reward voucher code the customer is spending on this order. The
   *  Taka value is read from the voucher ROW server-side, never from the client. */
  rewardCode?: string | null;
  fulfillmentType?: string; // "delivery" (default) | "pickup"
  /** Self Pickup — the customer's requested pickup time (ISO string). Required
   *  for pickup orders; ignored for delivery. Must be at least 30 minutes out
   *  from the SERVER's clock — never trusts the client's notion of "now". */
  pickupTime?: string | null;
  lat?: number | null;
  lng?: number | null;
  deliveryAreaId?: number | null; // #1/#13 — selected named delivery area
  /** WS-4.2 — a saved address the customer picked; its stored coordinates win. */
  customerAddressId?: number | null;
  /** WS-4.2 — the picker's claim about the coordinate. A hint, never trusted. */
  coordSourceHint?: string | null;
  /** PHASE R — one key per checkout attempt; a retry with the same key
   *  returns the order that was already created rather than a second one. */
  idempotencyKey?: string | null;
}): Promise<Order> {
  // Blocked (fake-order) customers may not place orders.
  const customer = await prisma.user.findUnique({ where: { id: input.customerId } });
  if (customer?.isBlocked) {
    throw forbidden(sk("errors.orders.accountBlocked"));
  }

  // WS-1.4 — the rail must be one the catalogue actually offers. paymentMethod
  // is a plain string column (no DB enum), so an unrecognised value would be
  // stored happily and then read back as raw text on every payment screen,
  // report and invoice — and would never be collectable. Validated against the
  // ONE shared method set, so a new rail needs no change here.
  const paymentMethod = String(input.paymentMethod ?? "").trim();
  if (!isPaymentMethod(paymentMethod)) {
    throw validationError({ payment_method: sk("errors.orders.invalidPaymentMethod") });
  }

  // PHASE R — duplicate checkout. A double-tapped button or a client retry
  // after a slow response must never become two real orders. The FIRST order
  // is returned unchanged, so the customer sees one order and is charged once.
  // Deliberately not a "same items, recently" heuristic: that would refuse a
  // customer legitimately re-ordering the same food.
  const idempotencyKey = (input.idempotencyKey ?? "").trim().slice(0, 64) || null;
  if (idempotencyKey) {
    const existing = await prisma.order.findFirst({
      where: { customerId: input.customerId, idempotencyKey },
    });
    if (existing) return existing;
  }

  // B1/#20 — fulfillment + branch resolution. For DELIVERY the branch is
  // computed SERVER-SIDE from the cart + trusted coordinates (client branch_id
  // ignored — no spoofing); PICKUP uses the explicit pickup branch. Coverage +
  // coordinate validation live inside resolveBranchForCart (shared with quote).
  const fulfillmentType = input.fulfillmentType === "pickup" ? "pickup" : "delivery";
  const productIds = input.items.map((i) => i.product_id);
  // WS-4.2 — settle WHICH point this order is delivered to, and how much the
  // server can vouch for it, BEFORE anything is priced against it. A chosen
  // saved address is read from its own row (the body's lat/lng are discarded);
  // otherwise the submitted point is reconciled with the stored GPS fix and the
  // customer's own addresses. An uncorroborated point is flagged, not refused —
  // see resolveDeliveryCoordinate for the policy and why it is not a rejection.
  const coordinate =
    fulfillmentType === "delivery"
      ? await resolveDeliveryCoordinate({
          customerId: input.customerId,
          customerAddressId: input.customerAddressId ?? null,
          lat: input.lat,
          lng: input.lng,
          sourceHint: input.coordSourceHint ?? null,
        })
      : null;
  const resolved = await resolveBranchForCart({
    branchId: input.branchId,
    productIds,
    // Coverage, the serving branch, the charged area and the distance snapshot
    // are all decided from the RESOLVED point — never from the raw body values.
    lat: coordinate?.lat ?? input.lat,
    lng: coordinate?.lng ?? input.lng,
    fulfillmentType,
    customerId: input.customerId,
    customerAddressId: input.customerAddressId ?? null,
  });
  const branch = resolved.branch;
  const deliveryLat = resolved.lat != null ? new Prisma.Decimal(resolved.lat.toFixed(7)) : null;
  const deliveryLng = resolved.lng != null ? new Prisma.Decimal(resolved.lng.toFixed(7)) : null;
  // Self Pickup — a requested time is OPTIONAL (some pickup orders are placed
  // without scheduling one), but whenever one is given it must parse and sit
  // at least PICKUP_MIN_LEAD_MINUTES out from the SERVER's clock, never the
  // client's.
  let requestedPickupAt: Date | null = null;
  const rawPickupTime = (input.pickupTime ?? "").trim();
  if (fulfillmentType === "pickup" && rawPickupTime) {
    const parsed = new Date(rawPickupTime);
    if (Number.isNaN(parsed.getTime())) {
      throw validationError({ pickup_time: sk("errors.orders.pickupTimeRequired") });
    }
    const minAllowed = Date.now() + PICKUP_MIN_LEAD_MINUTES * 60_000;
    if (parsed.getTime() < minAllowed) {
      throw validationError({
        pickup_time: sk("errors.orders.pickupTimeTooSoon", { minutes: PICKUP_MIN_LEAD_MINUTES }),
      });
    }
    requestedPickupAt = parsed;
  }
  // #1/#13 — resolve the selected delivery area (delivery only). A held/inactive
  // area or one from another branch is rejected here; its name/charge/estimate
  // are snapshotted IMMUTABLY onto the order so later area edits never change it.
  const area =
    fulfillmentType === "delivery"
      ? await resolveOrderDeliveryArea(branch.id, resolved.coverage?.point ?? null, input.deliveryAreaId)
      : null;
  // PHASE 11 — the delivery charge is SERVER-derived: a named area supplies its
  // own charge; otherwise the branch-level delivery fee applies. Pickup is free.
  // WS-1.5 — same exact-Decimal helper the quote uses; never a float fee.
  const deliveryChargeSnapshot = deliveryChargeFor(fulfillmentType, branch, area);
  const deliveryEstimateSnapshot = area ? area.estimatedDeliveryMinutes : null;
  // Snapshot the radius rule that authorised this delivery (server-computed
  // distance from trusted coordinates). Later radius/fee edits never rewrite it.
  const distanceKm =
    resolved.lat != null && resolved.lng != null && branch.latitude != null && branch.longitude != null
      ? haversineKm({ lat: Number(branch.latitude), lng: Number(branch.longitude) }, { lat: resolved.lat, lng: resolved.lng })
      : null;
  // B2 — snapshot the branch's estimated prep time onto the order (immutable).
  const prepTimeSnapshot = branch.prepTimeMinutes;

  const products = await prisma.product.findMany({
    where: orderableProductWhere(branch.id, productIds),
    include: { variations: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw validationError({ items: sk("errors.orders.someProductsUnavailable") });
  }

  // Variation resolution, crust validation and discount pricing are shared with
  // quoteOrder (priceLines) so the preview and the persisted order can never
  // disagree on price. Priced BEFORE the transaction opens: a bad crust or an
  // impossible quantity is a validation error, not a rolled-back write.
  const lines = priceLines(input.items, byId);
  const itemsSubtotal = sumLines(lines);
  // PHASE 4 — resolved once, before the transaction, from the same rule the quote
  // used, and snapshotted: a later change to the fee never rewrites this order.
  const platformFeeSnapshot = toPaisa(await platformFeeFor(branch.id));

  return prisma.$transaction(async (tx) => {
    // #15 — reserve a unique, immutable order number inside the same
    // transaction so a rollback releases the sequence (no reuse, no collision).
    const orderNumber = await nextOrderNumber(tx);
    const order = await tx.order.create({
      data: {
        orderNumber,
        idempotencyKey,
        customerId: input.customerId,
        branchId: branch.id,
        paymentMethod,
        deliveryAddress: input.deliveryAddress,
        foodNotes: input.foodNotes ?? "",
        fulfillmentType,
        requestedPickupAt,
        deliveryLat,
        deliveryLng,
        // WS-4.2 — how much the server can vouch for that coordinate, and the
        // saved address it came from when there was one. Written once, with the
        // order, so a later fee dispute can be traced back to its provenance.
        deliveryCoordSource: coordinate?.source ?? "",
        customerAddressId: coordinate?.customerAddressId ?? resolved.coverage?.customerAddressId ?? null,
        prepTimeSnapshot,
        deliveryAreaId: area?.id ?? null,
        deliveryAreaName: area?.name ?? "",
        deliveryCharge: deliveryChargeSnapshot,
        platformFee: platformFeeSnapshot,
        deliveryEstimateMinutes: deliveryEstimateSnapshot,
        deliveryDistanceKm: distanceKm != null ? new Prisma.Decimal(distanceKm.toFixed(3)) : null,
        deliveryRadiusKmSnapshot: fulfillmentType === "delivery" ? new Prisma.Decimal(branch.deliveryRadiusKm) : null,
      },
    });
    for (const line of lines) {
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: line.product.id,
          // Snapshot what was actually bought. Reading these back through the
          // live product relation meant a later rename or photo swap rewrote
          // historical orders.
          productName: line.product.name,
          productImage: line.product.image,
          variationId: line.variation?.id ?? null,
          variationName: line.variation?.name ?? "",
          variationType: line.crust,
          quantity: line.quantity,
          // Already at paisa precision (priceLines) — stored as-is, so the
          // ledger's line and the customer's `unit × qty` are the same number.
          unitPrice: line.unitPrice,
          foodNote: line.foodNote,
        },
      });
    }
    // Server recalculates the grand total = items + delivery charge (exact
    // Decimal arithmetic, never trusts a client total).
    const grandTotal = itemsSubtotal.plus(deliveryChargeSnapshot);

    // WS-7.2 — the coupon is claimed INSIDE this transaction now. It used to be
    // applied afterwards, in a separate non-transactional step that read
    // usedCount and incremented it later; see claimCouponForOrder for the race
    // that opened. A coupon failure now rolls the whole order back instead of
    // leaving a half-priced order behind. The discount is still computed against
    // the grand total (items + delivery), exactly as before.
    //
    // WS-1.5 — `claimCouponForOrder` still takes the basis as a number (its own
    // signature, owned by lib/services/marketing.ts). That conversion is a
    // one-way hand-off of an already-final 2dp figure, and what comes BACK is a
    // Decimal rounded to the paisa, which is what the total is computed from —
    // so no float ever reaches the money written here. Widening that signature
    // to Decimal is recorded as a follow-up.
    let couponId: number | null = null;
    let couponDiscount = zero();
    if (input.couponCode?.trim()) {
      const claimed = await claimCouponForOrder(tx, {
        code: input.couponCode,
        subtotal: grandTotal.toNumber(),
        customerId: input.customerId,
        orderId: order.id,
        // PHASE 5 — a branch-scoped coupon only works on its own branch's orders.
        branchId: order.branchId,
      });
      couponId = claimed.couponId;
      couponDiscount = toPaisa(claimed.discount);
    }

    // WS-7.1 — coins become real money here. POLICY: a coin voucher pays for
    // FOOD only, never for the delivery charge — that charge funds the rider's
    // commission and the area's real delivery cost, and letting reward coins
    // erase it would move money out of the rider's pocket. The cap is therefore
    // the items subtotal minus whatever the coupon already took off it, never
    // below zero, so the total can never go negative or eat the delivery fee.
    const coinCap = notBelowZero(itemsSubtotal.minus(couponDiscount));
    const coin = input.rewardCode?.trim()
      ? await consumeRedemptionForOrder(tx, {
          userId: input.customerId,
          code: input.rewardCode,
          orderId: order.id,
          cap: coinCap,
        })
      : null;
    const coinDiscount = coin ? toPaisa(coin.amount) : zero();

    // Every term is an exact 2dp Decimal, so the subtraction is exact too: the
    // `toDecimalPlaces` below is a normalisation of the stored scale, not a
    // correction of accumulated float error (there is none to correct).
    // PHASE 4 — the platform fee is added AFTER every discount. A coupon or a coin
    // voucher prices the food and the delivery, exactly as before, and can never
    // eat into the fee: it is platform revenue, not something a branch offer or a
    // loyalty reward gets to give away.
    const payable = notBelowZero(grandTotal.minus(couponDiscount).minus(coinDiscount)).plus(platformFeeSnapshot);
    return tx.order.update({
      where: { id: order.id },
      data: {
        couponId,
        discountAmount: couponDiscount,
        coinsRedeemed: coin?.coins ?? 0,
        coinDiscountAmount: coinDiscount,
        totalAmount: toPaisa(payable),
      },
    });
  }).then(async (order) => {
    // Confirm to the customer and alert the branch's managers that a new order arrived.
    await createNotification(order.customerId, {
      type: "order",
      titleKey: "notifications.order.placed.title",
      bodyKey: "notifications.order.placed.body",
      params: { id: order.id },
      link: `/customer/orders/${order.id}`,
    });
    await notifyBranchManagers(branch.id, {
      type: "order",
      titleKey: "notifications.order.newOrder.title",
      bodyKey: "notifications.order.newOrder.body",
      params: { id: order.id },
      link: `/branch-manager/orders/${order.id}`,
    });
    return order;
  });
}

type OrderWithBranch = Order & { branch: { managerId: number | null } };

/**
 * WS-5.2 — the extra minutes a rider announces with a `delayed` update.
 *
 * The (frozen) schema has no dedicated column for them, so they ride on the
 * SAME append-only OrderStatusEvent trail every other transition writes to,
 * behind a locale-neutral machine-readable prefix (`+30m`) followed by the
 * rider's own note exactly as typed. Deliberately not a parallel table: the
 * audit trail must stay the single place an order's history is read from.
 */
function formatDelayReason(minutes: number, note: string): string {
  const trimmed = delayNote(note);
  return trimmed ? `+${minutes}m · ${trimmed}` : `+${minutes}m`;
}

/**
 * The rider's free-text delay note, made safe to hand to a NOTIFICATION param.
 * A param value beginning with "@:" is resolved as a dictionary key at render
 * time (see lib/services/notifications.ts), so a note starting that way would
 * let a forged request print an arbitrary translated string into the customer's
 * inbox. Leading markers are stripped and the note is capped like any other
 * user-supplied field.
 */
function delayNote(note: string): string {
  return String(note ?? "").trim().replace(/^(?:@:)+/, "").trim().slice(0, 200);
}

/** Validate the transition and the acting role's right to make it. */
export async function updateOrderStatus(input: {
  order: OrderWithBranch;
  newStatus: OrderStatus;
  user: User;
  /** PHASE J — required when rejecting/cancelling; stored EXACTLY as typed. */
  reason?: string;
  /** WS-5.2 — extra delivery minutes; REQUIRED when newStatus is "delayed". */
  delayMinutes?: number | null;
}): Promise<Order> {
  const { order, newStatus, user, reason = "", delayMinutes = null } = input;
  const allowed = ALLOWED_TRANSITIONS[order.status as OrderStatus] ?? [];
  // ITEM 6 — a pickup order has no rider leg, so "ready" → "delivered" (the
  // customer walked out with it) is a legal move directly for fulfillmentType
  // "pickup" ONLY, skipping the delivery-only picked_up/on_the_way detour. The
  // normal ready → picked_up edge is left untouched (still reachable, e.g. an
  // order staged before this change), so nothing already at "picked_up" is
  // stranded; "delivered" is what every report already keys a completed sale
  // off, so this needs no change anywhere else.
  const pickupSkipsToDelivered =
    order.fulfillmentType === "pickup" && order.status === "ready" && newStatus === "delivered";
  if (!allowed.includes(newStatus) && !pickupSkipsToDelivered) {
    // PHASE J — an illegal move is a STATE CONFLICT, not a bad field: 409.
    throw conflict(sk("errors.orders.cannotTransitionFromStatus", { status: `@:orderStatus.${order.status}` }));
  }

  if (user.role === "super_admin") {
    // any valid transition
  } else if (user.role === "branch_manager") {
    if (order.branch.managerId !== user.id) throw forbidden(sk("errors.orders.notYourBranch"));
    if (!BRANCH_MANAGER_SETTABLE.includes(newStatus)) {
      throw forbidden(sk("errors.orders.branchManagerCannotSetStatus"));
    }
  } else if (user.role === "rider") {
    if (order.riderId !== user.id) throw forbidden(sk("errors.orders.orderNotAssignedToYou"));
    if (!RIDER_SETTABLE.includes(newStatus)) {
      throw forbidden(sk("errors.orders.riderCannotSetStatus"));
    }
    // C5: the rider must confirm physically receiving the order before the
    // delivery workflow (pickup) can begin.
    if (newStatus === "picked_up" && !(await isReceiveConfirmed(order.id, user.id))) {
      throw conflict(sk("errors.rider.mustConfirmReceiveFirst"));
    }
  } else if (user.role === "customer") {
    if (order.customerId !== user.id) throw forbidden(sk("errors.orders.notYourOrder"));
    if (!CUSTOMER_SETTABLE.includes(newStatus) || order.status !== "pending") {
      throw forbidden(sk("errors.orders.onlyPendingCanBeCancelled"));
    }
  } else {
    throw forbidden(sk("errors.orders.noPermissionToChangeStatus"));
  }

  // PHASE J / WS-5.1 — staff cancelling an order must state why (the reason is
  // shown to the customer and kept verbatim in the audit trail). This covers the
  // BRANCH MANAGER rejecting an order and the RIDER handing one back. A
  // super-admin administrative cancellation is not forced to supply one.
  if (
    newStatus === "cancelled" &&
    (user.role === "branch_manager" || user.role === "rider") &&
    !String(reason).trim()
  ) {
    throw validationError({ reason: sk("errors.orders.rejectionReasonRequired") });
  }

  // WS-5.2 — "delayed" exists so the rider can tell the customer that extra
  // delivery time is needed, so the extra minutes are mandatory and bounded.
  // A missing/garbage value is a validation error, never a silent default.
  let extraMinutes = 0;
  if (newStatus === "delayed") {
    const submitted = Number(delayMinutes);
    if (!Number.isFinite(submitted) || Math.trunc(submitted) <= 0) {
      throw validationError({ delay_minutes: sk("errors.orders.delayMinutesRequired") });
    }
    extraMinutes = Math.trunc(submitted);
    if (extraMinutes < DELAY_MIN_MINUTES || extraMinutes > DELAY_MAX_MINUTES) {
      throw validationError({
        delay_minutes: sk("errors.orders.delayMinutesInvalid", {
          min: DELAY_MIN_MINUTES,
          max: DELAY_MAX_MINUTES,
        }),
      });
    }
  }

  // The status change and its audit row are written together, so history can
  // never drift from the order's actual state.
  const previousStatus = order.status;
  // A delay carries its minutes into the same `reason` trail (see
  // formatDelayReason); every other transition stores the reason as typed.
  const eventReason =
    newStatus === "delayed" ? formatDelayReason(extraMinutes, reason) : String(reason ?? "");
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.order.update({ where: { id: order.id }, data: { status: newStatus } });
    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        fromStatus: previousStatus,
        toStatus: newStatus,
        actorId: user.id,
        reason: eventReason,
      },
    });
    return row;
  });

  // Delivered → record the rider's commission exactly once (unique orderId
  // in RiderCommission makes replays/no-ops safe) and notify the rider.
  if (newStatus === "delivered") {
    await recordCommissionForOrder({
      id: order.id,
      riderId: order.riderId,
      branchId: order.branchId,
    });
    // Customer earns reward coins (idempotent per order). PHASE H — a
    // super-admin EARNING RULE prices the order when one matches; otherwise the
    // legacy flat "order_delivered" rule still applies, so nothing that worked
    // before stops working when no earning rule is configured.
    const byRule = await awardOrderCoinsByRule({
      id: order.id,
      customerId: order.customerId,
      branchId: order.branchId,
      status: newStatus,
      paymentStatus: updated.paymentStatus,
      totalAmount: order.totalAmount,
    });
    if (!byRule) await awardCoins(order.customerId, "order_delivered", `order:${order.id}`);
    // C6: close the rider↔customer delivery chat to new messages (history kept).
    await prisma.orderDeliveryChatThread.updateMany({ where: { orderId: order.id, status: "active" }, data: { status: "closed" } });
  }

  // Cancelled → hand back everything the order consumed. WS-7.2 releases the
  // coupon use (a cancelled order used to swallow it permanently) and WS-7.1
  // restores the coin voucher to "active" so the customer's balance is not
  // burned for an order that never happened. Both are idempotent, so a replayed
  // cancellation cannot release the same value twice; both run AFTER the status
  // transition has committed, so a failure here never blocks the cancellation.
  if (newStatus === "cancelled") {
    await releaseCouponForOrder(order.id);
    await restoreRedemptionForOrder(order.id);
  }

  // Notify the customer of every status change (PDF: real-time order updates).
  // WS-5.2 — a DELAY replaces that generic line with the one the customer
  // actually needs: how much longer the food will take, plus the rider's note
  // when they wrote one. Same createNotification path, no parallel mechanism,
  // and only ONE notification per transition.
  if (newStatus === "delayed") {
    const note = delayNote(reason);
    await createNotification(order.customerId, {
      type: "order",
      titleKey: "notifications.order.delayed.title",
      bodyKey: note
        ? "notifications.order.delayedWithNote.body"
        : "notifications.order.delayed.body",
      params: note
        ? { id: order.id, minutes: extraMinutes, note }
        : { id: order.id, minutes: extraMinutes },
      link: `/customer/orders/${order.id}`,
    });
  } else {
    await createNotification(order.customerId, {
      type: "order",
      titleKey: "notifications.order.statusUpdate.title",
      bodyKey: "notifications.order.statusUpdate.body",
      params: { id: order.id, status: `@:orderStatus.${newStatus}` },
      link: `/customer/orders/${order.id}`,
    });
  }

  // Keep the branch's managers in the loop when the rider drives the delivery.
  if (user.role === "rider") {
    await notifyBranchManagers(order.branchId, {
      type: "order",
      titleKey: "notifications.delivery.riderUpdate.title",
      bodyKey: "notifications.delivery.riderUpdate.body",
      params: { id: order.id, status: `@:orderStatus.${newStatus}` },
      link: `/branch-manager/orders/${order.id}`,
    });
  }

  // Tell the assigned rider when their order gets cancelled by someone else.
  if (newStatus === "cancelled" && order.riderId && order.riderId !== user.id) {
    await createNotification(order.riderId, {
      type: "order",
      titleKey: "notifications.order.cancelled.title",
      bodyKey: "notifications.order.cancelled.body",
      params: { id: order.id },
      link: `/rider/orders/${order.id}`,
    });
  }
  return updated;
}

/** BM (own branch) or super admin assigns/unassigns a rider on an order. */
export async function assignRiderToOrder(input: {
  order: OrderWithBranch;
  riderId: number | null;
  actingUser: User;
}): Promise<Order> {
  const { order, riderId, actingUser } = input;
  if (actingUser.role === "branch_manager" && order.branch.managerId !== actingUser.id) {
    throw forbidden(sk("errors.orders.notYourBranch"));
  }
  // A pickup order has no rider leg, so it never gets a rider: the customer
  // collects it, and its chat stays the customer and the branch. The branch
  // page already hid the card; this is the server-side guarantee.
  if (riderId !== null && order.fulfillmentType === "pickup") {
    throw validationError({ rider_id: sk("errors.orders.pickupHasNoRider") });
  }
  const previousRiderId = order.riderId;
  let assignSessionId: number | null = null;
  if (riderId !== null) {
    const rider = await prisma.user.findFirst({
      where: { id: riderId, role: "rider", status: "approved" },
      include: { riderProfile: { select: { isOnline: true } } },
    });
    if (!rider) throw validationError({ rider_id: sk("errors.orders.riderNotFoundOrNotApproved") });
    // Roles spec: an offline rider must not receive new orders.
    if (!rider.riderProfile?.isOnline) {
      throw validationError({ rider_id: sk("errors.orders.riderOffline") });
    }
    // C3: the rider must be on an ACTIVE duty session for THIS order's branch.
    const session = await prisma.riderBranchDutySession.findFirst({
      where: { riderId, status: "active", branchId: order.branchId },
    });
    if (!session) throw validationError({ rider_id: sk("errors.orders.riderNotOnBranchDuty") });
    assignSessionId = session.id;
  }
  // #6 — server-computed branch→delivery distance for the assignment offer.
  let distanceKm: Prisma.Decimal | null = null;
  if (riderId !== null && order.deliveryLat != null && order.deliveryLng != null) {
    const b = await prisma.branch.findUnique({ where: { id: order.branchId }, select: { latitude: true, longitude: true } });
    if (b?.latitude != null && b.longitude != null) {
      distanceKm = new Prisma.Decimal(
        haversineKm(
          { lat: Number(b.latitude), lng: Number(b.longitude) },
          { lat: Number(order.deliveryLat), lng: Number(order.deliveryLng) },
        ).toFixed(3),
      );
    }
  }
  // Transactional reassignment: on rider change, close the previous rider's
  // delivery chat (history preserved; the new rider gets a fresh chat only after
  // their own receive confirmation). Supersede prior pending offers and open a
  // fresh pending offer for the new rider (req #6/#7 accept/reject workflow).
  const updated = await prisma.$transaction(async (tx) => {
    if (previousRiderId && previousRiderId !== riderId) {
      await tx.orderDeliveryChatThread.updateMany({ where: { orderId: order.id, riderId: previousRiderId, status: "active" }, data: { status: "closed" } });
    }
    // Any still-pending offer for this order is superseded by the new decision.
    await tx.riderOrderAssignment.updateMany({ where: { orderId: order.id, status: "pending" }, data: { status: "superseded" } });
    if (riderId !== null) {
      await tx.riderOrderAssignment.create({
        data: { orderId: order.id, riderId, branchId: order.branchId, sessionId: assignSessionId, status: "pending", distanceKm },
      });
    }
    return tx.order.update({ where: { id: order.id }, data: { riderId } });
  });

  if (riderId !== null) {
    // Customer sees a rider was assigned; the rider gets a new-delivery ping.
    await createNotification(order.customerId, {
      type: "order",
      titleKey: "notifications.order.riderAssigned.title",
      bodyKey: "notifications.order.riderAssigned.body",
      params: { id: order.id },
      link: `/customer/orders/${order.id}`,
    });
    await createNotification(riderId, {
      type: "order",
      titleKey: "notifications.delivery.assigned.title",
      bodyKey: "notifications.delivery.assigned.body",
      params: { id: order.id },
      link: `/rider/orders/${order.id}`,
    });
  }
  return updated;
}
