import "server-only";
import { Prisma } from "@prisma/client";
import type { BranchDeliveryArea, DeliveryAreaExclusion, User } from "@prisma/client";

import {
  MAX_CIRCLE_RADIUS_KM,
  parseShape,
  serializeShape,
  shapeReachKm,
  shapeWithinRadius,
  type CoverageShape,
} from "@/lib/coverage/shape";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/services/audit";
import { COVERAGE_WINDOW_DEFAULT, isCoverageWindow } from "@/lib/constants/enums";
import type {
  DeliveryAreaExclusionRow,
  DeliveryAreaListQuery,
  DeliveryAreaListResult,
  DeliveryAreaRow,
} from "@/lib/delivery-areas/query";
import { conflict, forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { branchForManager } from "@/lib/selectors";
import { branchPoint, coverageForPoint, exclusionActive } from "@/lib/services/coverage";
import { isValidLatLng, type LatLng } from "@/lib/services/geo";
import { LIMITS, decimalPlaces, isFiniteNumber } from "@/lib/validation/limits";

/**
 * Delivery areas: the ONE shape a branch delivers inside.
 *
 * Each branch has exactly one area (unique branchId). It carries the TERMS
 * (ETA, charge, hold state, active) and a SHAPE. The shape is the only thing
 * that decides coverage; everything else decides what it costs. Nobody types a
 * name: the row's `name` is kept equal to the branch name so the order snapshot
 * stays readable. Temporary EXCLUSIONS carve a piece out for a while without
 * touching the shape, so removing one restores the area exactly.
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
  branch?: { name: string; address?: string } | null;
  exclusions?: DeliveryAreaExclusion[];
};

/** Everything serializeArea needs, in one place so no read forgets the names. */
export const AREA_INCLUDE = {
  branch: { select: { name: true, address: true } },
  exclusions: { orderBy: { createdAt: "desc" } },
} as const;

export function serializeExclusion(e: DeliveryAreaExclusion): DeliveryAreaExclusionRow {
  return {
    id: e.id,
    shape: e.shape,
    reason: e.reason,
    ends_at: e.endsAt ? e.endsAt.toISOString() : null,
    created_at: e.createdAt.toISOString(),
  };
}

export function serializeArea(a: SerializableArea): DeliveryAreaRow {
  return {
    id: a.id,
    branch: a.branchId,
    branch_name: a.branch?.name ?? null,
    branch_address: a.branch?.address ?? null,
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
    // Only the exclusions still in force: an ended one no longer blocks
    // anything, so listing it would only make the manager wonder.
    exclusions: (a.exclusions ?? []).filter((e) => exclusionActive(e)).map(serializeExclusion),
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
  estimatedDeliveryMinutes?: unknown;
  deliveryCharge?: unknown;
  shape?: unknown;
  isActive?: unknown;
  coverageWindow?: unknown;
}

/**
 * Create or update THE delivery area of a branch (one per branch).
 *
 * BM: always their own branch (a submitted branch id is ignored). SA: any
 * active branch. If the branch already has its area this updates it instead of
 * failing, so "save my branch's area" is one call whatever the starting state.
 * Returns the row and whether it was newly created.
 */
export async function saveBranchArea(user: User, input: AreaInput) {
  const branch = await resolveAreaBranch(user, input.branchId);
  if (!branch.isActive || branch.isArchived) {
    throw validationError({ branch_id: sk("errors.deliveryArea.branchUnavailable") });
  }
  const existing = await prisma.branchDeliveryArea.findUnique({ where: { branchId: branch.id } });
  if (existing) {
    const area = await updateArea(user, existing.id, input);
    return { area, created: false };
  }

  const coverageWindow = parseWindow(input.coverageWindow);
  const shape = parseShapeInput(input.shape, branch);
  const area = await prisma.branchDeliveryArea.create({
    data: {
      branchId: branch.id,
      name: branch.name,
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
    `Created the delivery area of ${branch.name}${shape ? ` (${describeShape(shape)})` : " (no shape drawn yet)"}`,
  );
  return { area, created: true };
}

/** "3.0 km circle" / "12-point shape", for the activity log. */
function describeShape(shape: CoverageShape): string {
  return shape.type === "Circle"
    ? `${shape.radiusKm.toFixed(1)} km circle`
    : `${shape.coordinates[0].length - 1}-point shape`;
}

export async function updateArea(user: User, areaId: number, input: Partial<AreaInput>) {
  const area = await areaForManage(user, areaId);
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: area.branchId } });
  // The name follows the branch (nobody types it any more), so a branch rename
  // is picked up on the next save.
  const data: Prisma.BranchDeliveryAreaUpdateInput = { updatedById: user.id, name: branch.name };
  const changes: string[] = [];

  if (input.coverageWindow !== undefined) {
    const nextWindow = parseWindow(input.coverageWindow);
    if (nextWindow !== area.coverageWindow) changes.push(`shift ${area.coverageWindow} → ${nextWindow}`);
    data.coverageWindow = nextWindow;
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
    const next = shape ? serializeShape(shape) : null;
    if (next !== area.shape) changes.push(shape ? `shape redrawn (${describeShape(shape)})` : "shape cleared");
    data.shape = next;
  }

  const updated = await prisma.branchDeliveryArea.update({
    where: { id: areaId },
    data,
    include: AREA_INCLUDE,
  });
  if (changes.length > 0) {
    await logAreaChange(user, area.branchId, `Updated the delivery area of ${branch.name}: ${changes.join(", ")}`);
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
  // Orders keep their own snapshot of the area's name, charge and estimate,
  // so the area itself is setup data and truly deleted.
  await logAdminAction(user.id, "delete", `Deleted delivery area "${area.name}" (#${area.id})`, { branchId: area.branchId });
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

  if (coverage.pickupOnly) {
    throw validationError({
      delivery_area_id: sk(coverage.reason === "area_excluded" ? "errors.deliveryArea.excluded" : "errors.deliveryArea.held"),
    });
  }
  if (!coverage.covered || !coverage.area) {
    throw validationError({ delivery_area_id: sk("errors.deliveryArea.pointNotCovered") });
  }
  // A stale id from a screen the manager has since re-drawn must not silently
  // bill the customer from the wrong area.
  if (requestedAreaId != null && requestedAreaId !== coverage.area.id) {
    throw conflict(sk("errors.deliveryArea.notForPoint"));
  }
  const row = await prisma.branchDeliveryArea.findUnique({
    where: { id: coverage.area.id },
    include: { branch: { select: { name: true } } },
  });
  // The order snapshots the area's name: with one area per branch that is the
  // branch's current name, whatever the row last stored.
  return row ? { ...row, name: row.branch.name } : null;
}

// ── temporary exclusions ──────────────────────────────────────────────────

const EXCLUSION_REASON_MAX = 200;

export interface ExclusionInput {
  shape: unknown;
  reason?: unknown;
  /** ISO instant, or empty/absent for "until removed". */
  endsAt?: unknown;
}

/**
 * Mark part of a branch's area as temporarily unserved.
 *
 * Same permission as editing the area (BM own branch, SA any), checked through
 * areaForManage. The shape is NOT merged into the area: it is its own row, so
 * removing it, or its end time passing, restores coverage exactly.
 */
export async function addExclusion(user: User, areaId: number, input: ExclusionInput) {
  const area = await areaForManage(user, areaId);
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: area.branchId } });
  const shape = parseShape(input.shape);
  if (!shape) throw validationError({ shape: sk("errors.deliveryArea.invalidShape") });
  // It only ever matters inside the area, so it must sit within the branch's
  // maximum radius like the area itself does.
  const center = branchPoint(branch);
  if (!center) throw validationError({ shape: sk("errors.deliveryArea.branchHasNoLocation") });
  const maxRadiusKm = Math.min(Number(branch.deliveryRadiusKm), MAX_CIRCLE_RADIUS_KM);
  if (!shapeWithinRadius(shape, center, maxRadiusKm)) {
    throw validationError({ shape: sk("errors.deliveryArea.exclusionOutside", { max: maxRadiusKm.toFixed(2) }) });
  }
  const reason = String(input.reason ?? "").trim();
  if (reason.length > EXCLUSION_REASON_MAX) {
    throw validationError({ reason: sk("errors.deliveryArea.exclusionReasonTooLong", { max: EXCLUSION_REASON_MAX }) });
  }
  let endsAt: Date | null = null;
  if (input.endsAt !== undefined && input.endsAt !== null && input.endsAt !== "") {
    endsAt = new Date(String(input.endsAt));
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) {
      throw validationError({ ends_at: sk("errors.deliveryArea.exclusionEndsInPast") });
    }
  }
  const exclusion = await prisma.deliveryAreaExclusion.create({
    data: { areaId: area.id, shape: serializeShape(shape), reason, endsAt, createdById: user.id },
  });
  await logAreaChange(
    user,
    area.branchId,
    `Blocked part of the delivery area of ${branch.name} (${describeShape(shape)})` +
      (endsAt ? ` until ${endsAt.toISOString()}` : " until removed") +
      (reason ? `. Reason: ${reason}` : ""),
  );
  return exclusion;
}

/** Remove an exclusion: the area is back exactly as drawn. */
export async function removeExclusion(user: User, areaId: number, exclusionId: number) {
  const area = await areaForManage(user, areaId);
  const exclusion = await prisma.deliveryAreaExclusion.findUnique({ where: { id: exclusionId } });
  if (!exclusion || exclusion.areaId !== area.id) throw notFound(sk("errors.deliveryArea.exclusionNotFound"));
  await prisma.deliveryAreaExclusion.delete({ where: { id: exclusionId } });
  await logAreaChange(
    user,
    area.branchId,
    `Removed a temporary block from the delivery area of ${area.branch.name}${exclusion.reason ? ` (was: ${exclusion.reason})` : ""}`,
  );
  return exclusion;
}
