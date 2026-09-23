import { LIMITS } from "@/lib/validation/limits";

export const DELIVERY_AREA_PAGE_SIZE = 20;
export const DELIVERY_AREA_MAX_PAGE_SIZE = 100;

export const DELIVERY_AREA_SORTS = ["name", "branch", "minutes", "charge", "updated"] as const;
export type DeliveryAreaSort = (typeof DELIVERY_AREA_SORTS)[number];
export type DeliveryAreaSortDirection = "asc" | "desc";
export type DeliveryAreaActiveStatus = "active" | "inactive";
export type DeliveryAreaDeliveryState = "available" | "held";
/** Filter by which shift a coverage row applies to. */
export type DeliveryAreaWindowFilter = "day" | "night" | "both";

export interface DeliveryAreaListQuery {
  search: string;
  branchId?: number;
  activeStatus?: DeliveryAreaActiveStatus;
  deliveryState?: DeliveryAreaDeliveryState;
  coverageWindow?: DeliveryAreaWindowFilter;
  page: number;
  pageSize: number;
  sort: DeliveryAreaSort;
  direction: DeliveryAreaSortDirection;
}

export interface DeliveryAreaRow {
  id: number;
  branch: number;
  branch_name: string | null;
  branch_address: string | null;
  branch_brand_type: string | null;
  name: string;
  is_active: boolean;
  is_held: boolean;
  hold_reason: string;
  estimated_delivery_minutes: number;
  delivery_charge: string;
  /** The drawn boundary as stored JSON; null = nothing drawn yet (covers nobody). */
  shape: string | null;
  /** "day" | "night" | "both" — which shift this coverage row applies to. */
  coverage_window: string;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAreaSummary {
  total: number;
  active: number;
  held: number;
  inactive: number;
  branches: number;
  /** Rows with no shape drawn yet — they cover nobody until one is. */
  undrawn: number;
}

export interface DeliveryAreaListResult {
  count: number;
  page: number;
  pageSize: number;
  results: DeliveryAreaRow[];
  summary: DeliveryAreaSummary;
}

export type DeliveryAreaQueryInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function read(input: DeliveryAreaQueryInput, key: string): string | undefined {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
  const value = input[key];
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number, max?: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

export function parseDeliveryAreaQuery(input: DeliveryAreaQueryInput): DeliveryAreaListQuery {
  const rawStatus = read(input, "status");
  const explicitState = read(input, "deliveryState");
  const rawBranch = read(input, "branch") ?? read(input, "branch_id");
  const branchId = positiveInteger(rawBranch, 0);
  const rawSort = read(input, "sort");
  const rawDirection = read(input, "direction");
  const rawWindow = read(input, "window");

  return {
    search: (read(input, "search") ?? "").trim().slice(0, LIMITS.shortTextMax),
    ...(branchId > 0 ? { branchId } : {}),
    ...(rawStatus === "active" || rawStatus === "inactive"
      ? { activeStatus: rawStatus }
      : {}),
    ...(explicitState === "available" || explicitState === "held"
      ? { deliveryState: explicitState }
      : rawStatus === "held"
        ? { deliveryState: "held" as const }
        : {}),
    ...(rawWindow === "day" || rawWindow === "night" || rawWindow === "both"
      ? { coverageWindow: rawWindow }
      : {}),
    page: positiveInteger(read(input, "page"), 1),
    pageSize: positiveInteger(
      read(input, "page_size"),
      DELIVERY_AREA_PAGE_SIZE,
      DELIVERY_AREA_MAX_PAGE_SIZE,
    ),
    sort: DELIVERY_AREA_SORTS.includes(rawSort as DeliveryAreaSort)
      ? (rawSort as DeliveryAreaSort)
      : "name",
    direction: rawDirection === "desc" ? "desc" : "asc",
  };
}

export function deliveryAreaQueryParams(
  query: DeliveryAreaListQuery,
  options: { includePageSize?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.branchId) params.set("branch", String(query.branchId));
  if (query.activeStatus) params.set("status", query.activeStatus);
  if (query.deliveryState) params.set("deliveryState", query.deliveryState);
  if (query.coverageWindow) params.set("window", query.coverageWindow);
  if (query.page > 1) params.set("page", String(query.page));
  if (options.includePageSize || query.pageSize !== DELIVERY_AREA_PAGE_SIZE) {
    params.set("page_size", String(query.pageSize));
  }
  if (query.sort !== "name") params.set("sort", query.sort);
  if (query.direction !== "asc") params.set("direction", query.direction);
  return params;
}
