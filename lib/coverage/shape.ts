import { haversineKm, isValidLatLng, type LatLng } from "@/lib/services/geo";

/**
 * THE delivery-area shape: what a branch manager drew on the map, and the only
 * thing that decides whether a customer's pin can be delivered to.
 *
 * Pure geometry — no database, no network, no React — so the rule that admits a
 * customer at checkout is the same code the drawing editor validates with and
 * the same code the tests exercise. Nothing here knows what a branch is.
 *
 * STORED FORM (BranchDeliveryArea.shape, a JSON string):
 *
 *   {"type":"Polygon","coordinates":[[[lng,lat],[lng,lat],…,[lng,lat]]]}
 *   {"type":"Circle","coordinates":[lng,lat],"radiusKm":2.5}
 *
 * Polygon is ordinary GeoJSON (one closed outer ring, no holes). Circle is a
 * documented EXTENSION: GeoJSON has no circle, and a circle an operator drew as
 * a circle must stay an exact circle rather than degrade into an n-gon that
 * quietly covers slightly less than they set. `coordinates` is [lng, lat] in
 * both, as GeoJSON requires — the one place that order is used, converted at
 * the boundary so nothing downstream has to remember it.
 */

export interface PolygonShape {
  type: "Polygon";
  /** One closed outer ring, [lng, lat] pairs. */
  coordinates: [number, number][][];
}

export interface CircleShape {
  type: "Circle";
  /** Centre, [lng, lat]. */
  coordinates: [number, number];
  radiusKm: number;
}

export type CoverageShape = PolygonShape | CircleShape;

/** Lower bound on a drawn area, so a stray double-tap cannot become a shape. */
export const MIN_POLYGON_POINTS = 3;
/**
 * Upper bound on ring size. A hand-drawn neighbourhood needs a few dozen points;
 * anything far beyond that is a runaway client, and every point is re-tested on
 * every coverage check.
 */
export const MAX_POLYGON_POINTS = 500;
/** Smallest circle worth drawing (50 m) and the largest we will store. */
export const MIN_CIRCLE_RADIUS_KM = 0.05;
export const MAX_CIRCLE_RADIUS_KM = 100;

/**
 * Float slack for "inside the branch's maximum radius", in km (≈ 1 m).
 *
 * A circle drawn AT the limit, or a polygon vertex snapped onto it, is the
 * normal case — the editor starts a new area from exactly that circle — so
 * comparing with `<=` on raw floats would reject the editor's own default.
 */
export const RADIUS_EPSILON_KM = 0.001;

// ── parsing ───────────────────────────────────────────────────────────────

function isFinitePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1])) &&
    // GeoJSON order: [lng, lat].
    isValidLatLng(Number(value[1]), Number(value[0]))
  );
}

/**
 * Parse a stored (or client-submitted) shape. Returns null for anything that is
 * not a shape we can test a point against — null shape, malformed JSON, unknown
 * type, too few points, a radius outside the sane range.
 *
 * Deliberately TOTAL: it never throws. A corrupt row must make its area cover
 * nothing, not take down every coverage check that happens to load it.
 */
export function parseShape(raw: unknown): CoverageShape | null {
  if (raw == null || raw === "") return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const shape = value as { type?: unknown; coordinates?: unknown; radiusKm?: unknown };

  if (shape.type === "Circle") {
    if (!isFinitePair(shape.coordinates)) return null;
    const radiusKm = Number(shape.radiusKm);
    if (!Number.isFinite(radiusKm) || radiusKm < MIN_CIRCLE_RADIUS_KM || radiusKm > MAX_CIRCLE_RADIUS_KM) {
      return null;
    }
    const [lng, lat] = shape.coordinates;
    return { type: "Circle", coordinates: [Number(lng), Number(lat)], radiusKm };
  }

  if (shape.type === "Polygon") {
    if (!Array.isArray(shape.coordinates) || shape.coordinates.length === 0) return null;
    const ring = shape.coordinates[0];
    if (!Array.isArray(ring)) return null;
    const points: [number, number][] = [];
    for (const point of ring) {
      if (!isFinitePair(point)) return null;
      points.push([Number(point[0]), Number(point[1])]);
    }
    const open = openRing(points);
    if (open.length < MIN_POLYGON_POINTS || open.length > MAX_POLYGON_POINTS) return null;
    return { type: "Polygon", coordinates: [closeRing(open)] };
  }

  return null;
}

/** The ring without its repeated closing point, whether or not it had one. */
function openRing(points: [number, number][]): [number, number][] {
  if (points.length < 2) return points;
  const [firstLng, firstLat] = points[0];
  const [lastLng, lastLat] = points[points.length - 1];
  return firstLng === lastLng && firstLat === lastLat ? points.slice(0, -1) : points;
}

/** The ring with its closing point, as GeoJSON requires. */
function closeRing(points: [number, number][]): [number, number][] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, [first[0], first[1]]];
}

/** Serialize for storage. The inverse of `parseShape`. */
export function serializeShape(shape: CoverageShape): string {
  return JSON.stringify(shape);
}

// ── construction ──────────────────────────────────────────────────────────

/** A circle shape from a centre and a radius in km. */
export function circleShape(center: LatLng, radiusKm: number): CircleShape {
  return { type: "Circle", coordinates: [center.lng, center.lat], radiusKm };
}

/** The points of a shape, in [lat, lng] form, for map rendering and bounds. */
export function shapePoints(shape: CoverageShape): LatLng[] {
  if (shape.type === "Circle") return [{ lat: shape.coordinates[1], lng: shape.coordinates[0] }];
  return openRing(shape.coordinates[0]).map(([lng, lat]) => ({ lat, lng }));
}

/** The centre of a shape: a circle's centre, or a polygon's vertex average. */
export function shapeCenter(shape: CoverageShape): LatLng {
  if (shape.type === "Circle") return { lat: shape.coordinates[1], lng: shape.coordinates[0] };
  const points = shapePoints(shape);
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return { lat, lng };
}

/**
 * How many degrees of longitude make up one kilometre at a given latitude.
 * Used only to turn a radius in km into a drawable ring — coverage itself is
 * always measured with the haversine distance, never with this approximation.
 */
const KM_PER_DEGREE_LAT = 110.574;
function kmPerDegreeLng(lat: number): number {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}

/**
 * A circle as a polygon ring — what the editor hands the manager when they ask
 * to reshape a circle by dragging its points. `segments` is the vertex count.
 */
export function circleToPolygon(center: LatLng, radiusKm: number, segments = 32): PolygonShape {
  const count = Math.max(MIN_POLYGON_POINTS, Math.min(segments, MAX_POLYGON_POINTS));
  const lngScale = kmPerDegreeLng(center.lat);
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    const lat = center.lat + (radiusKm / KM_PER_DEGREE_LAT) * Math.cos(angle);
    // Guard the pathological case of a near-polar centre, where a degree of
    // longitude collapses to nothing; Bangladesh never hits it, but a bad pin
    // should not produce Infinity.
    const lng = center.lng + (lngScale > 0.001 ? (radiusKm / lngScale) * Math.sin(angle) : 0);
    points.push([lng, lat]);
  }
  return { type: "Polygon", coordinates: [closeRing(points)] };
}

// ── the coverage test ─────────────────────────────────────────────────────

/**
 * Is this point inside the shape?
 *
 * Circle: haversine distance from the centre — exact, and the same distance
 * function every other coverage decision uses.
 *
 * Polygon: even-odd ray casting. A point exactly on an edge is not guaranteed
 * either way, which is correct: a boundary is a line with no width, and a
 * customer standing on one is metres from being inside it.
 */
export function pointInShape(point: LatLng, shape: CoverageShape): boolean {
  if (!isValidLatLng(point.lat, point.lng)) return false;
  if (shape.type === "Circle") {
    const center = { lat: shape.coordinates[1], lng: shape.coordinates[0] };
    return haversineKm(center, point) <= shape.radiusKm;
  }
  const ring = openRing(shape.coordinates[0]);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // Does the horizontal ray from the point cross this edge?
    const straddles = yi > point.lat !== yj > point.lat;
    if (!straddles) continue;
    const crossingLng = xi + ((point.lat - yi) * (xj - xi)) / (yj - yi);
    if (point.lng < crossingLng) inside = !inside;
  }
  return inside;
}

/**
 * The furthest a shape reaches from `origin`, in km — the branch pin in
 * practice. For a circle that is centre distance plus radius; for a polygon it
 * is the furthest vertex, which is exact because a polygon's extreme points are
 * always vertices.
 */
export function shapeReachKm(shape: CoverageShape, origin: LatLng): number {
  if (shape.type === "Circle") {
    const center = { lat: shape.coordinates[1], lng: shape.coordinates[0] };
    return haversineKm(origin, center) + shape.radiusKm;
  }
  return shapePoints(shape).reduce((max, p) => Math.max(max, haversineKm(origin, p)), 0);
}

/**
 * Does the whole shape fit inside the branch's maximum-coverage circle?
 *
 * The super admin's "Delivery Radius (km)" is a ceiling a branch manager cannot
 * draw past. Enforced server-side on every write — the editor warns, but the
 * service is what refuses.
 */
export function shapeWithinRadius(shape: CoverageShape, origin: LatLng, maxRadiusKm: number): boolean {
  return shapeReachKm(shape, origin) <= maxRadiusKm + RADIUS_EPSILON_KM;
}
