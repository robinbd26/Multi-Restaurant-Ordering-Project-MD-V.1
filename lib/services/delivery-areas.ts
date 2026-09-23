import "server-only";
import { Prisma } from "@prisma/client";
import type { BranchDeliveryArea, User } from "@prisma/client";

import {
  MAX_CIRCLE_RADIUS_KM,
  parseShape,
  serializeShape,
  shapeReachKm,
  shapeWithinRadius,
  type CoverageShape,
} from "@/lib/coverage/shape";
import { prisma } from "@/lib/db";
import { COVERAGE_WINDOW_DEFAULT, isCoverageWindow } from "@/lib/constants/enums";
import type {
  DeliveryAreaListQuery,
  DeliveryAreaListResult,
  DeliveryAreaRow,
} from "@/lib/delivery-areas/query";
import { conflict, forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { branchForManager } from "@/lib/selectors";
import { branchPoint, coverageForPoint } from "@/lib/services/coverage";
import { isValidLatLng, type LatLng } from "@/lib/services/geo";
import { LIMITS, decimalPlaces, isFiniteNumber } from "@/lib/validation/limits";

/**
 * Delivery areas: the shapes a branch delivers inside.
 *
 * An area carries the TERMS (name, shift, ETA, charge, hold state, active) and
 * a SHAPE. The shape is the only thing that decides coverage; everything else
 * decides what it costs and when.
 *
 * WHO MAY EDIT: a branch manager owns their own branch's areas, a super admin
 * owns every branch's. A submitted branch id from a manager is ignored rather
 * than trusted, so a manager can never reach another branch's coverage (IDOR).
 *
 * EVERY WRITE IS AUDITED. Create, edit, hold, resume and delete each append a
 * ManagerActivityLog row naming who did it and what changed, because coverage
 * decides who gets served and who does not.
 */

type SerializableArea = BranchDeliveryArea & {
  branch?: { name: string; address?: string; brandType?: string } | null;
};

/** Everything serializeArea needs, in one place so no read forgets the names. */
export const AREA_INCLUDE = {
  branch: { select: { name: true, address: true, brandType: true } },
} as const;

export function serializeArea(a: SerializableArea): DeliveryAreaRow {
  return {
    id: a.id,
    branch: a.branchId,
    branch_name: a.branch?.name ?? null,
    branch_address: a.branch?.address ?? null,
    branch_brand_type: a.branch?.brandType ?? null,
    name: a.name,
    is_active: a.isActive,
    is_held: a.isHeld,
    hold_reason: a.holdReason,
    estimated_delivery_minutes: a.estimatedDeliveryMinutes,
    delivery_charge: (
      a.deliveryCharge instanceof Prisma.Decimal ? a.deliveryCharge : new Prisma.Decimal(a.deliveryCharge)
    ).toFixed(2),
    // The drawn boundary, verbatim, for the map editor. Null = nothing drawn
    // yet, which the list renders as "draw this area" and coverage treats as
    // covering nobody.
    shape: a.shape,
    coverage_window: a.coverageWindow,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

/**
 * The branch a user may manage delivery areas in.
 * - super_admin: the submitted branch (must exist).
 * - branch_manager: ALWAYS their own assigned branch — a submitted branchId is
 *   ignored, so a BM can never spoof another branch (IDOR).
 * Anyone else is forbidden.
 */
export async function resolveAreaBranch(user: User, submittedBranchId?: number) {
  if (user.role === "branch_manager") {
    const branch = await branchForManager(user.id);
    if (!branch) throw forbidden(sk("errors.catalog.noBranchAssigned"));
    return branch;
  }
  if (user.role === "super_admin") {
    if (!submittedBranchId || Number.isNaN(submittedBranchId)) {
      throw validationError({ branch_id: sk("errors.catalog.selectBranch") });
    }
    const branch = await prisma.branch.findUnique({ where: { id: submittedBranchId } });
    if (!branch) throw validationError({ branch_id: sk("errors.catalog.selectBranch") });
    return branch;
  }
  throw forbidden(sk("errors.deliveryArea.forbidden"));
}

/** Load an area the user may manage (SA any; BM own branch), or throw 403/404. */
export async function areaForManage(user: User, areaId: number) {
  const area = await prisma.branchDeliveryArea.findUnique({
    where: { id: areaId },
    include: AREA_INCLUDE,
  });
  if (!area) throw notFound(sk("errors.deliveryArea.notFound"));
  if (user.role === "super_admin") return area;
  if (user.role === "branch_manager") {
    const branch = await branchForManager(user.id);
    if (!branch) throw forbidden(sk("errors.catalog.noBranchAssigned"));
    if (area.branchId !== branch.id) throw forbidden(sk("errors.deliveryArea.notYourBranch"));
    return area;
  }
  throw forbidden(sk("errors.deliveryArea.forbidden"));
}

// ── audit ─────────────────────────────────────────────────────────────────

/**
 * Record a coverage change against the branch. Coverage decides who can be
 * served, so every change is attributable — the Activity Logs screen reads
 * these rows.
 */
async function logAreaChange(user: User, branchId: number, description: string) {
  await prisma.managerActivityLog.create({
    data: { managerId: user.id, branchId, activityType: "action", description },
  });
}

// ── validation ────────────────────────────────────────────────────────────

function parseMinutes(v: unknown): number {
  const n = Number(v);
  if (!isFiniteNumber(v) || !Number.isInteger(n) || n < LIMITS.minutesMin || n > LIMITS.minutesMax) {
    throw validationError({ estimated_delivery_minutes: sk("errors.deliveryArea.invalidMinutes") });
  }
  return Math.round(n);
}

function parseCharge(v: unknown): Prisma.Decimal {
  const raw = typeof v === "number" || typeof v === "string" ? String(v).trim() : "";
  const n = Number(raw);
  if (
    !raw ||
    !isFiniteNumber(raw) ||
    decimalPlaces(raw) > LIMITS.moneyDecimals ||
    n < LIMITS.moneyMin ||
    n > LIMITS.moneyMax
  ) {
    throw validationError({ delivery_charge: sk("errors.deliveryArea.invalidCharge") });
  }
  return new Prisma.Decimal(n.toFixed(2));
}

function validatedName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name) throw validationError({ name: sk("errors.deliveryArea.nameRequired") });
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) {
    throw validationError({
      name: sk("errors.deliveryArea.invalidNameLength", { min: LIMITS.nameMin, max: LIMITS.nameMax }),
    });
  }
  return name;
}

/** Which shift a coverage row applies to. Absent means the all-day default. */
function parseWindow(value: unknown): string {
  if (value === undefined || value === null || value === "") return COVERAGE_WINDOW_DEFAULT;
  const raw = String(value).trim();
  if (!isCoverageWindow(raw)) {
    throw validationError({ coverage_window: sk("errors.deliveryArea.invalidWindow") });
  }
  return raw;
}

function parseActive(value: unknown): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw validationError({ is_active: sk("errors.deliveryArea.invalidActive") });
}

/**
 * The drawn boundary, validated against the branch it belongs to.
 *
 * TWO rules, both enforced HERE rather than only in the editor:
 *   1. it must be a shape we can actually test a point against;
 *   2. it must fit inside the branch's maximum-coverage circle — the super
 *      admin's radius is a ceiling a manager cannot draw past.
 *
 * A branch with no map pin has no circle to measure against, so it cannot have
 * areas at all: that is reported as "set the branch location first" rather than
 * silently accepting a shape nothing bounds.
 */
function parseShapeInput(
  value: unknown,
  branch: { id: number; latitude: unknown; longitude: unknown; deliveryRadiusKm: unknown; name: string },
): CoverageShape | null {
  if (value === undefined || value === null || value === "") return null;
  const shape = parseShape(value);
  if (!shape) throw validationError({ shape: sk("errors.deliveryArea.invalidShape") });

  const center = branchPoint(branch as { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null });
  if (!center) throw validationError({ shape: sk("errors.deliveryArea.branchHasNoLocation") });

  const maxRadiusKm = Math.min(Number(branch.deliveryRadiusKm), MAX_CIRCLE_RADIUS_KM);
  if (!shapeWithinRadius(shape, center, maxRadiusKm)) {
    throw validationError({
      shape: sk("errors.deliveryArea.outsideBranchRadius", {
        max: maxRadiusKm.toFixed(2),
        reach: shapeReachKm(shape, center).toFixed(2),
      }),
    });
  }
  return shape;
}

export interface AreaInput {
  branchId?: number;
  name: string;
  estimatedDeliveryMinutes?: unknown;
  deliveryCharge?: unknown;
  shape?: unknown;
  isActive?: unknown;
  coverageWindow?: unknown;
}

export async function createArea(user: User, input: AreaInput) {
  const branch = await resolveAreaBranch(user, input.branchId);
  if (!branch.isActive || branch.isArchived) {
    throw validationError({ branch_id: sk("errors.deliveryArea.branchUnavailable") });
  }
  const name = validatedName(input.name);
  const coverageWindow = parseWindow(input.coverageWindow);
  const shape = parseShapeInput(input.shape, branch);

  const area = await prisma.branchDeliveryArea.create({
    data: {
      branchId: branch.id,
      name,
      shape: shape ? serializeShape(shape) : null,
      estimatedDeliveryMinutes:
        input.estimatedDeliveryMinutes === undefined ? 45 : parseMinutes(input.estimatedDeliveryMinutes),
      deliveryCharge:
        input.deliveryCharge === undefined ? new Prisma.Decimal(0) : parseCharge(input.deliveryCharge),
      isActive: input.isActive === undefined ? true : parseActive(input.isActive),
      coverageWindow,
      updatedById: user.id,
    },
    include: AREA_INCLUDE,
  });
  await logAreaChange(
    user,
    branch.id,
    `Created delivery area "${area.name}" (${coverageWindow}${shape ? "" : ", no shape drawn yet"})`,
  );
  return area;
}

export async function updateArea(user: User, areaId: number, input: Partial<AreaInput>) {
  const area = await areaForManage(user, areaId);
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: area.branchId } });
  const data: Prisma.BranchDeliveryAreaUpdateInput = { updatedById: user.id };
  const changes: string[] = [];

  if (input.coverageWindow !== undefined) {
    const nextWindow = parseWindow(input.coverageWindow);
    if (nextWindow !== area.coverageWindow) changes.push(`shift ${area.coverageWindow} → ${nextWindow}`);
    data.coverageWindow = nextWindow;
  }
  if (input.name !== undefined) {
    const name = validatedName(input.name);
    if (name !== area.name) changes.push(`renamed "${area.name}" → "${name}"`);
    data.name = name;
  }
  if (input.estimatedDeliveryMinutes !== undefined) {
    const minutes = parseMinutes(input.estimatedDeliveryMinutes);
    if (minutes !== area.estimatedDeliveryMinutes) {
      changes.push(`time ${area.estimatedDeliveryMinutes} → ${minutes} min`);
    }
    data.estimatedDeliveryMinutes = minutes;
  }
  if (input.deliveryCharge !== undefined) {
    const charge = parseCharge(input.deliveryCharge);
    if (!charge.equals(area.deliveryCharge)) {
      changes.push(`charge ${area.deliveryCharge.toFixed(2)} → ${charge.toFixed(2)}`);
    }
    data.deliveryCharge = charge;
  }
  if (input.isActive !== undefined) {
    const isActive = parseActive(input.isActive);
    if (isActive !== area.isActive) changes.push(isActive ? "activated" : "deactivated");
    data.isActive = isActive;
  }
  if (input.shape !== undefined) {
    const shape = parseShapeInput(input.shape, branch);
    data.shape = shape ? serializeShape(shape) : null;
    changes.push(shape ? "shape redrawn" : "shape cleared");
  }

  const updated = await prisma.branchDeliveryArea.update({
    where: { id: areaId },
    data,
    include: AREA_INCLUDE,
  });
  if (changes.length > 0) {
    await logAreaChange(user, area.branchId, `Updated delivery area "${updated.name}": ${changes.join(", ")}`);
  }
  return updated;
}

/** Hold (pickup only for this area) or resume it. Existing orders untouched. */
export async function setAreaHold(user: User, areaId: number, held: boolean, reason = "") {
  const area = await areaForManage(user, areaId);
  const updated = await prisma.branchDeliveryArea.update({
    where: { id: areaId },
    data: { isHeld: held, holdReason: held ? String(reason ?? "") : "", updatedById: user.id },
    include: AREA_INCLUDE,
  });
  await logAreaChange(
    user,
    area.branchId,
    held
      ? `Held delivery area "${updated.name}"${reason ? ` — reason: ${String(reason)}` : ""}`
      : `Resumed delivery area "${updated.name}"`,
  );
  return updated;
}

/**
 * DELETE an area outright.
 *
 * Safe because an order never reads its area back: `Order` snapshots the name,
 * the charge and the estimate at checkout, and `deliveryAreaId` is a SetNull
 * link kept only as provenance. Deleting therefore removes a shape from the map
 * without touching a single invoice. The row is loaded first so the audit entry
 * can name what was removed.
 */
export async function deleteArea(user: User, areaId: number) {
  const area = await areaForManage(user, areaId);
  await prisma.branchDeliveryArea.delete({ where: { id: areaId } });
  await logAreaChange(user, area.branchId, `Deleted delivery area "${area.name}"`);
  return area;
}

/** List areas visible to the user, optional branch + status filter. */
export async function areasForUser(
  user: User,
  opts: { branchId?: number; status?: "active" | "held" } = {},
) {
  let where: Prisma.BranchDeliveryAreaWhereInput;
  if (user.role === "branch_manager") {
    const branch = await branchForManager(user.id);
    where = { branchId: branch?.id ?? -1 };
  } else if (user.role === "super_admin") {
    where = opts.branchId ? { branchId: opts.branchId } : {};
  } else {
    throw forbidden(sk("errors.deliveryArea.forbidden"));
  }
  if (opts.status === "held") where = { ...where, isHeld: true };
  else if (opts.status === "active") where = { ...where, isHeld: false, isActive: true };
  return prisma.branchDeliveryArea.findMany({
    where,
    include: AREA_INCLUDE,
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
  });
}

function listScopeWhere(user: User, managerBranchId: number | null): Prisma.BranchDeliveryAreaWhereInput {
  if (user.role === "branch_manager") return { branchId: managerBranchId ?? -1 };
  if (user.role === "super_admin") return {};
  throw forbidden(sk("errors.deliveryArea.forbidden"));
}

function listOrderBy(
  query: DeliveryAreaListQuery,
): Prisma.BranchDeliveryAreaOrderByWithRelationInput[] {
  const direction = query.direction;
  switch (query.sort) {
    case "branch":
      return [{ branch: { name: direction } }, { name: "asc" }, { id: "asc" }];
    case "minutes":
      return [{ estimatedDeliveryMinutes: direction }, { name: "asc" }, { id: "asc" }];
    case "charge":
      return [{ deliveryCharge: direction }, { name: "asc" }, { id: "asc" }];
    case "updated":
      return [{ updatedAt: direction }, { name: "asc" }, { id: "asc" }];
    default:
      return [{ name: direction }, { branchId: "asc" }, { id: "asc" }];
  }
}

/**
 * Server-paginated Delivery Areas management query. Scope is derived from the
 * authenticated user first, then every optional filter is ANDed inside it.
 */
export async function deliveryAreaListForUser(
  user: User,
  query: DeliveryAreaListQuery,
): Promise<DeliveryAreaListResult> {
  const managerBranch = user.role === "branch_manager" ? await branchForManager(user.id) : null;
  const scopeWhere = listScopeWhere(user, managerBranch?.id ?? null);
  const filters: Prisma.BranchDeliveryAreaWhereInput[] = [scopeWhere];

  if (user.role === "super_admin" && query.branchId) filters.push({ branchId: query.branchId });
  if (query.activeStatus) filters.push({ isActive: query.activeStatus === "active" });
  if (query.deliveryState) filters.push({ isHeld: query.deliveryState === "held" });
  if (query.coverageWindow) filters.push({ coverageWindow: query.coverageWindow });
  if (query.search) {
    filters.push({
      OR: [
        { name: { contains: query.search } },
        { branch: { name: { contains: query.search } } },
        { branch: { address: { contains: query.search } } },
      ],
    });
  }

  const where: Prisma.BranchDeliveryAreaWhereInput = { AND: filters };
  const count = await prisma.branchDeliveryArea.count({ where });
  const totalPages = Math.max(1, Math.ceil(count / query.pageSize));
  const page = Math.min(query.page, totalPages);

  const [rows, total, active, held, inactive, covered, undrawn] = await Promise.all([
    prisma.branchDeliveryArea.findMany({
      where,
      include: AREA_INCLUDE,
      orderBy: listOrderBy(query),
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.branchDeliveryArea.count({ where: scopeWhere }),
    prisma.branchDeliveryArea.count({ where: { AND: [scopeWhere, { isActive: true }] } }),
    prisma.branchDeliveryArea.count({ where: { AND: [scopeWhere, { isHeld: true }] } }),
    prisma.branchDeliveryArea.count({ where: { AND: [scopeWhere, { isActive: false }] } }),
    prisma.branchDeliveryArea.groupBy({ by: ["branchId"], where: scopeWhere }),
    // Rows carried over from name matching, which cover nobody until drawn.
    prisma.branchDeliveryArea.count({ where: { AND: [scopeWhere, { shape: null }] } }),
  ]);

  return {
    count,
    page,
    pageSize: query.pageSize,
    results: rows.map(serializeArea),
    summary: { total, active, held, inactive, branches: covered.length, undrawn },
  };
}

/**
 * Resolve + validate the delivery area for a NEW order on a branch.
 *
 * The area is not taken from the client: it is whatever the branch's own shapes
 * resolve the delivery POINT to (cheapest, then fastest — lib/coverage). A
 * client-supplied id is only accepted when it matches that answer, so a
 * customer cannot be admitted by one area and billed from a cheaper one.
 *
 * Returns the row whose name, charge and estimate get snapshotted onto the
 * order, so later edits — or deleting the area outright — never change it.
 */
export async function resolveOrderDeliveryArea(
  branchId: number,
  point: LatLng | null | undefined,
  requestedAreaId?: number | null,
) {
  if (!point || !isValidLatLng(point.lat, point.lng)) return null;
  const coverage = await (async () => {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    return branch ? coverageForPoint(branch, point) : null;
  })();
  if (!coverage) return null;

  if (coverage.pickupOnly) throw validationError({ delivery_area_id: sk("errors.deliveryArea.held") });
  if (!coverage.covered || !coverage.area) {
    throw validationError({ delivery_area_id: sk("errors.deliveryArea.pointNotCovered") });
  }
  // A stale id from a screen the manager has since re-drawn must not silently
  // bill the customer from the wrong area.
  if (requestedAreaId != null && requestedAreaId !== coverage.area.id) {
    throw conflict(sk("errors.deliveryArea.notForPoint"));
  }
  return prisma.branchDeliveryArea.findUnique({ where: { id: coverage.area.id } });
}
