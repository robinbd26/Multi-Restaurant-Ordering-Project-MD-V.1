import "server-only";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { validationError, sk } from "@/lib/http/errors";
import { haversineKm, isValidLatLng, type LatLng } from "@/lib/services/geo";
import { branchOptionsForPoint, coverageForPoint } from "@/lib/services/coverage";

/**
 * WS-4.9 — how a stored fix was obtained. A subset of the picker's
 * `PickerSource`: only these two can ever write `User.currentLat/currentLng`.
 * A saved address is a different record entirely, and "unverified" is an ORDER
 * verdict the server reaches on its own — neither is a live location.
 */
export type CustomerLocationSource = "device_gps" | "map_pin";

/**
 * Narrow a client-supplied provenance claim. Absent (every pre-WS-4.9 caller)
 * means a device reading, which is what those callers send. Anything else is
 * refused rather than coerced: silently downgrading an unknown value would hide
 * a client bug, and silently upgrading it would hand a made-up point the trust
 * of a real GPS reading.
 */
function locationSource(value?: string | null): CustomerLocationSource {
  if (value == null || value === "") return "device_gps";
  if (value === "device_gps" || value === "map_pin") return value;
  throw validationError({ source: sk("errors.location.invalidSource") });
}

/**
 * Save a customer's latest validated GPS fix (req #21). Kept SEPARATE from saved
 * addresses + immutable order snapshots; never overwrites a saved default
 * address. Validates finite + in-range coordinates and non-negative accuracy.
 *
 * WS-4.9 — the same entry point now also stores a pin the customer dragged on
 * the map, so authorization, coordinate validation and the accuracy/timestamp
 * bookkeeping stay in ONE place. A dragged pin has no metre-accuracy and no
 * capture moment, so both are dropped server-side for `map_pin` instead of
 * being taken from the body: a client cannot dress a hand-placed point up as a
 * precise device reading.
 */
export async function saveCustomerLocation(
  user: User,
  lat: number,
  lng: number,
  accuracy?: number | null,
  capturedAt?: number | string | null,
  source?: string | null,
) {
  if (!isValidLatLng(lat, lng)) throw validationError({ location: sk("errors.orders.invalidCoordinates") });
  if (accuracy != null && (!Number.isFinite(Number(accuracy)) || Number(accuracy) < 0)) {
    throw validationError({ accuracy: sk("errors.orders.invalidCoordinates") });
  }
  const from = locationSource(source);
  const isDevice = from === "device_gps";
  const storedAccuracy = isDevice ? accuracy : null;
  if (isDevice) assertFreshFix(capturedAt);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      currentLat: new Prisma.Decimal(lat.toFixed(7)),
      currentLng: new Prisma.Decimal(lng.toFixed(7)),
      currentAccuracy: storedAccuracy != null ? new Prisma.Decimal(Number(storedAccuracy).toFixed(2)) : null,
      locationUpdatedAt: new Date(),
      currentLocationSource: from,
    },
  });
  return { lat, lng };
}

/**
 * PHASE E — a fix the browser captured must be RECENT. A client may report when
 * it took the reading; an old (or future-dated) one is refused rather than
 * stored as if it were current, so a replayed or cached position cannot be
 * passed off as the customer's location right now. No timestamp at all is
 * accepted: the server stamps its own time, which is the existing behaviour.
 */
export const MAX_FIX_AGE_MS = 5 * 60_000;

export function assertFreshFix(capturedAt?: number | string | null) {
  if (capturedAt === undefined || capturedAt === null || capturedAt === "") return;
  const ms = typeof capturedAt === "number" ? capturedAt : Date.parse(String(capturedAt));
  if (!Number.isFinite(ms)) throw validationError({ captured_at: sk("errors.location.staleFix") });
  const age = Date.now() - ms;
  // A little clock skew forward is tolerated; a stale fix is not.
  if (age > MAX_FIX_AGE_MS || age < -60_000) {
    throw validationError({ captured_at: sk("errors.location.staleFix") });
  }
}

/**
 * How long a stored GPS fix stays authoritative for branch resolution.
 *
 * Distinct from MAX_FIX_AGE_MS, which governs ACCEPTING a fix at write time
 * (five minutes — a browser reading older than that is a replay). Reading is a
 * different question: a customer who shared their location this morning has not
 * moved to another city by lunchtime, and expiring the fix in five minutes would
 * drop them out of their branch constantly. After this window the fix is treated
 * as unknown and the saved default address takes over, which is a deliberate
 * fall-through rather than a silent use of an old coordinate.
 */
export const LOCATION_TRUST_WINDOW_MS = 24 * 60 * 60_000;

/** Where a resolved point came from — surfaced so the UI can explain itself. */
export type PointSource = "gps" | "address";

export interface TrustedPoint extends LatLng {
  source: PointSource;
  /**
   * WS-4.9 — true only when a "gps" point really is a device reading. Since the
   * customer can correct a coarse fix by hand, `source: "gps"` on its own no
   * longer means the device measured it.
   */
  deviceGps: boolean;
}

/**
 * Trusted customer coordinates for server-side nearest-branch / coverage.
 *
 * Priority, highest first:
 *   1. a RECENT, valid GPS fix (see LOCATION_TRUST_WINDOW_MS);
 *   2. the default active saved address with valid coordinates.
 *
 * The project models exactly these two sources — there is no separate "selected
 * address" concept, so the default address IS the address-based source. Every
 * coordinate is re-validated with isValidLatLng before use, so a corrupt or
 * out-of-range stored value falls through instead of resolving a wrong branch.
 * Client-supplied coordinates are never trusted here. GPS and saved addresses
 * stay separate: nothing in this module writes one from the other.
 */
export async function trustedCustomerPointDetailed(userId: number): Promise<TrustedPoint | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentLat: true, currentLng: true, locationUpdatedAt: true, currentLocationSource: true },
  });
  if (user?.currentLat != null && user.currentLng != null) {
    const lat = Number(user.currentLat);
    const lng = Number(user.currentLng);
    const stamped = user.locationUpdatedAt?.getTime() ?? null;
    const fresh = stamped != null && Date.now() - stamped <= LOCATION_TRUST_WINDOW_MS;
    // "" is a row written before the provenance column existed — those could
    // only ever be device fixes, so they keep their old standing.
    if (fresh && isValidLatLng(lat, lng)) {
      return { lat, lng, source: "gps", deviceGps: user.currentLocationSource !== "map_pin" };
    }
  }
  // Scoped to THIS customer's own addresses, so an address id can never be
  // borrowed from another account.
  const addr = await prisma.customerAddress.findFirst({
    where: { userId, isActive: true, isDefault: true },
  });
  if (addr?.latitude != null && addr.longitude != null) {
    const lat = Number(addr.latitude);
    const lng = Number(addr.longitude);
    if (isValidLatLng(lat, lng)) return { lat, lng, source: "address", deviceGps: false };
  }
  return null;
}

/**
 * The point of ONE saved address the customer picked, for the storefront's
 * deliver-to selector.
 *
 * The function above answers "where is this customer?" and deliberately knows
 * only two sources, the newest of which wins. This one answers a different
 * question — "where did they SAY to deliver?" — so it reads the chosen row
 * directly and does not fall through to the GPS fix: a customer ordering to
 * their office is not corrected by the fact that their phone is at home.
 *
 * Scoped to THIS customer's own addresses, so an address id lifted from another
 * account (or from a cookie left behind on a shared browser) resolves to null
 * and the caller falls back to the ordinary trusted point. Coordinates are
 * re-validated, so a row saved without a map pin cannot resolve a wrong branch.
 */
export async function pointForCustomerAddress(
  userId: number,
  addressId: number,
): Promise<TrustedPoint | null> {
  if (!Number.isSafeInteger(addressId) || addressId <= 0) return null;
  const addr = await prisma.customerAddress.findFirst({
    where: {
      id: addressId,
      userId,
      isActive: true,
    },
  });
  if (addr?.latitude == null || addr.longitude == null) return null;
  const lat = Number(addr.latitude);
  const lng = Number(addr.longitude);
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng, source: "address", deviceGps: false };
}

// ── WS-4.2 · provenance of an order's delivery coordinate ───────────────

/** Mirrors Order.deliveryCoordSource. "" on a row means legacy/unknown. */
export type DeliveryCoordSource = "device_gps" | "saved_address" | "map_pin" | "unverified";

/**
 * How far a submitted point may sit from something the server already knows
 * about this customer before it stops counting as corroborated.
 *
 * Two kilometres is a compromise, not a security boundary: a phone fix in
 * built-up Dhaka drifts by hundreds of metres, a customer legitimately orders to
 * the flat next door, and the stored fix may be hours old (see
 * LOCATION_TRUST_WINDOW_MS). Anything beyond it is not refused — it is FLAGGED.
 */
export const COORD_CORROBORATION_KM = 2;

export interface ResolvedDeliveryCoordinate {
  lat: number;
  lng: number;
  source: DeliveryCoordSource;
  /** The saved address this order was placed against, when one was chosen. */
  customerAddressId: number | null;
}

/**
 * WS-4.2 — decide WHICH coordinate an order is delivered to, and how much the
 * server can vouch for it.
 *
 * The gap this closes: `app/api/orders/route.ts` used to hand `body.lat` /
 * `body.lng` straight to the order pipeline, and coverage + the delivery fee
 * were enforced against those numbers without ever reconciling them with
 * anything the server knows. A customer could POST a point inside a cheap zone
 * while typing an address kilometres away.
 *
 * Priority:
 *   1. `customer_address_id` — the coordinates are read from that row, which
 *      must belong to THIS customer and be active. The client's lat/lng are
 *      ignored entirely, so a saved-address order cannot be steered by the body.
 *   2. otherwise the submitted point, cross-checked against the stored GPS fix
 *      (`User.currentLat/currentLng`) and the customer's own saved addresses.
 *
 * POLICY — deliberate and load-bearing: a coordinate that cannot be
 * corroborated is recorded as `unverified` and the order STILL GOES THROUGH.
 * Refusing it would break checkout for every customer with GPS switched off,
 * every desktop browser and everyone ordering to an address they have not saved
 * yet — a much larger group than the fee-dodgers. Instead the provenance is
 * persisted on the order, so the branch manager can see it and a fee dispute is
 * traceable after the fact. Coverage, branch resolution, the charged area and
 * the distance snapshot all continue to be computed server-side from the point
 * this function returns — never from anything else the client sent.
 *
 * Returns null when there is no usable coordinate at all; the caller raises the
 * existing "location required" validation error.
 */
export async function resolveDeliveryCoordinate(input: {
  customerId: number;
  customerAddressId?: number | null;
  lat?: number | null;
  lng?: number | null;
  /** The picker's own claim. A HINT only: it can never upgrade trust. */
  sourceHint?: string | null;
}): Promise<ResolvedDeliveryCoordinate | null> {
  // 1. An explicitly chosen saved address — scoped to this customer, so an id
  //    borrowed from another account resolves to nothing and falls through.
  if (input.customerAddressId != null && Number.isSafeInteger(Number(input.customerAddressId))) {
    const saved = await prisma.customerAddress.findFirst({
      where: { id: Number(input.customerAddressId), userId: input.customerId, isActive: true },
    });
    if (saved?.latitude != null && saved.longitude != null) {
      const lat = Number(saved.latitude);
      const lng = Number(saved.longitude);
      if (isValidLatLng(lat, lng)) {
        return { lat, lng, source: "saved_address", customerAddressId: saved.id };
      }
    }
  }

  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (input.lat == null || input.lng == null || !isValidLatLng(lat, lng)) return null;
  const point: LatLng = { lat, lng };

  // 2. Reconcile with the stored, server-written GPS fix.
  const trusted = await trustedCustomerPointDetailed(input.customerId);
  if (trusted && haversineKm(trusted, point) <= COORD_CORROBORATION_KM) {
    // A device fix the SERVER stored itself backs a device_gps claim; anything
    // else near that point is a pin we can at least vouch for. A stored fix the
    // customer placed by hand (WS-4.9) is exactly that — a pin — so it can
    // corroborate a point without ever promoting it to device_gps.
    const source: DeliveryCoordSource =
      trusted.source === "gps" && trusted.deviceGps && input.sourceHint === "device_gps" ? "device_gps" : "map_pin";
    return { lat, lng, source, customerAddressId: null };
  }

  // 3. Or with an address the customer saved earlier (their own rows only).
  const saved = await prisma.customerAddress.findMany({
    where: { userId: input.customerId, isActive: true },
    select: { id: true, latitude: true, longitude: true },
  });
  for (const row of saved) {
    const a = Number(row.latitude);
    const b = Number(row.longitude);
    if (!isValidLatLng(a, b)) continue;
    if (haversineKm({ lat: a, lng: b }, point) <= COORD_CORROBORATION_KM) {
      return { lat, lng, source: "map_pin", customerAddressId: null };
    }
  }

  // 4. Nothing corroborates it. Allowed, flagged, traceable.
  return { lat, lng, source: "unverified", customerAddressId: null };
}

/** Coordinates only — the long-standing signature, kept for existing callers. */
export async function trustedCustomerPoint(userId: number): Promise<LatLng | null> {
  const point = await trustedCustomerPointDetailed(userId);
  return point ? { lat: point.lat, lng: point.lng } : null;
}

/**
 * The customer's currently-saved live GPS fix (req #12/#21), for the location
 * permission/status card. Independent of saved addresses. Null coords means the
 * customer has never shared a live location.
 */
export async function customerLocationStatus(userId: number): Promise<{
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  updatedAt: string | null;
  /** WS-4.9 — device reading or hand-placed pin, so the card can say which. */
  source: CustomerLocationSource;
}> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      currentLat: true,
      currentLng: true,
      currentAccuracy: true,
      locationUpdatedAt: true,
      currentLocationSource: true,
    },
  });
  return {
    lat: u?.currentLat != null ? Number(u.currentLat) : null,
    lng: u?.currentLng != null ? Number(u.currentLng) : null,
    accuracy: u?.currentAccuracy != null ? Number(u.currentAccuracy) : null,
    updatedAt: u?.locationUpdatedAt ? u.locationUpdatedAt.toISOString() : null,
    // Legacy rows ("") predate the column and can only be device fixes.
    source: u?.currentLocationSource === "map_pin" ? "map_pin" : "device_gps",
  };
}

export interface BranchEligibility {
  id: number;
  name: string;
  distance_km: number | null;
  eligible: boolean;
  covered: boolean;
  /** Whether the branch can take an order RIGHT NOW (active + within hours). */
  open_now: boolean;
  /** The branch's opening time ("HH:MM") for the "Opens at …" note; null when unset. */
  opens_at: string | null;
  is_nearest?: boolean;
}

/**
 * Checks whether a specific branch is currently active, unarchived, and covers
 * the authenticated customer's trusted location.
 */
export async function isBranchCoveredForCustomer(userId: number, branchId: number): Promise<boolean> {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true, isArchived: false },
  });
  if (!branch) return false;
  const point = await trustedCustomerPoint(userId);
  if (!point) return false;
  const coverage = await coverageForPoint(branch, point);
  return coverage.covered;
}

/**
 * The branch that should serve a bare coordinate: the nearest one whose drawn
 * areas contain it. Used where there is no customer account in play.
 */
export async function nearestEligibleBranchForPoint(
  point: LatLng,
): Promise<{ id: number; distanceKm: number } | null> {
  const ranked = await branchOptionsForPoint(point);
  const covered = ranked.find((b) => b.covered);
  return covered ? { id: covered.branchId, distanceKm: covered.distanceKm ?? 0 } : null;
}

/**
 * @param pointOverride A deliver-to point the CUSTOMER chose (a saved address
 *   picked in the storefront selector), used in place of their trusted point.
 *   Callers must have resolved it from a row they own — pointForCustomerAddress()
 *   is the only supported producer. Omitted by every ordering path, which keeps
 *   deriving the point from the customer's own record.
 */
export async function nearestEligibleBranch(
  userId: number,
  pointOverride?: TrustedPoint | null,
): Promise<{
  /** The point every verdict below was measured from. Null when unresolved. */
  point: LatLng | null;
  /** Which source that point came from, for UI wording. Null when unresolved. */
  pointSource: PointSource | null;
  nearest: BranchEligibility | null;
  branches: BranchEligibility[];
  /** True when covered branches exist but every one of them is closed right now. */
  allCoveredClosed: boolean;
}> {
  const point = pointOverride ?? (await trustedCustomerPointDetailed(userId));
  if (!point) {
    return { point: null, pointSource: null, nearest: null, branches: [], allCoveredClosed: false };
  }

  // ONE coverage pass over every live branch, ranked: deliver beats hand-over,
  // open beats closed, nearest beats further (lib/coverage/resolve.ts). The old
  // implementation ran its own radius/zone maths here and a second copy in the
  // storefront, which is exactly how the two screens used to disagree.
  const ranked = await branchOptionsForPoint(point);
  const branches: BranchEligibility[] = ranked.map((b) => ({
    id: b.branchId,
    name: b.branchName,
    distance_km: b.distanceKm,
    // "Eligible" and "covered" have always meant the same thing to callers: this
    // branch can deliver here. Pickup-only is NOT covered — it is the fallback
    // offered when nothing can.
    eligible: b.covered,
    covered: b.covered,
    open_now: b.openNow,
    opens_at: b.opensAt,
    is_nearest: false,
  }));

  const covered = branches.filter((b) => b.covered);
  const coveredOpen = covered.filter((b) => b.open_now);
  // Coverage — not opening hours — defines "out of zone", so when every covered
  // branch is shut we still surface the nearest COVERED one and let the UI say
  // "Opens at …" rather than claiming the customer is outside the delivery area.
  const nearestId = (coveredOpen[0] ?? covered[0])?.id ?? null;
  for (const b of branches) b.is_nearest = b.id === nearestId;

  return {
    point: { lat: point.lat, lng: point.lng },
    pointSource: point.source,
    nearest: branches.find((b) => b.id === nearestId) ?? null,
    branches,
    allCoveredClosed: covered.length > 0 && coveredOpen.length === 0,
  };
}

