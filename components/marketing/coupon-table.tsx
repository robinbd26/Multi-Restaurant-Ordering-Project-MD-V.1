import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Table, Td } from "@/components/ui/table";
import { CouponDeleteButton } from "@/components/marketing/coupon-form";
import { getT } from "@/lib/i18n/server";

export interface CouponRowT {
  id: number;
  code: string;
  discount_type: string;
  value: string;
  min_order: string;
  max_uses: number;
  used_count: number;
  per_customer_limit: number | null;
  is_active: boolean;
  branch_id: number | null;
  branch_name: string | null;
  state: string;
  ends_at: string | null;
}

const STATE_TONE: Record<string, "green" | "blue" | "slate" | "red"> = {
  live: "green",
  scheduled: "blue",
  paused: "slate",
  ended: "red",
  archived: "slate",
};

const STATE_KEY: Record<string, string> = {
  live: "marketingX.stateLive",
  scheduled: "marketingX.stateScheduled",
  paused: "marketingX.statePaused",
  ended: "marketingX.stateEnded",
  archived: "marketingX.stateArchived",
};

/**
 * PHASE 5 — the ONE coupon list, shared by the marketing and branch-manager
 * screens so the two can never describe a coupon differently. The status column
 * is the derived state (live / scheduled / paused / ended), not the raw switch:
 * an enabled coupon whose end time has passed is shown as ended, because it is.
 *
 * ITEM 3 — a branch manager is READ-ONLY: `readOnly` drops the Actions column
 * (and its header) entirely rather than disabling the controls, so there is no
 * dead Edit/Delete UI sitting in front of someone who cannot use it. The API
 * enforces the same rule independently (app/api/marketing/coupons/**), so this
 * is a courtesy, not the guard.
 */
export async function CouponTable({
  coupons,
  editBase,
  showScope,
  readOnly = false,
}: {
  coupons: CouponRowT[];
  editBase: string;
  showScope: boolean;
  readOnly?: boolean;
}) {
  const { t, fmt } = await getT();

  return (
    <Table
      headers={[
        t("marketingX.codeLabel"),
        t("marketingX.discountLabel"),
        t("marketingX.minOrderLabel"),
        t("marketingX.usageLabel"),
        ...(showScope ? [t("marketingX.scopeLabel")] : []),
        t("pages.colStatus"),
        ...(readOnly ? [] : [t("pages.colActions")]),
      ]}
    >
      {coupons.map((c) => (
        <tr key={c.id} className="hover:bg-surface-hover/70" data-testid={`coupon-row-${c.code}`}>
          <Td>
            <span className="font-mono font-semibold text-fg-base">{c.code}</span>
          </Td>
          <Td>{c.discount_type === "percent" ? `${fmt.num(Number(c.value))}%` : fmt.money(c.value)}</Td>
          <Td>{Number(c.min_order) > 0 ? fmt.money(c.min_order) : "—"}</Td>
          <Td>
            <span className="block text-sm">
              {fmt.num(c.used_count)}
              {c.max_uses > 0 ? ` / ${fmt.num(c.max_uses)}` : ""}
            </span>
            <span className="block text-xs text-fg-subtle">
              {c.per_customer_limit != null && c.per_customer_limit > 0
                ? t("marketingX.perCustomerShort", { count: fmt.num(c.per_customer_limit) })
                : t("marketingX.perCustomerUnlimited")}
            </span>
          </Td>
          {showScope ? (
            <Td>
              <span className="text-sm">
                {c.branch_id == null ? t("marketingX.scopeAll") : (c.branch_name ?? `#${c.branch_id}`)}
              </span>
            </Td>
          ) : null}
          <Td>
            <Badge dot tone={STATE_TONE[c.state] ?? "slate"} data-testid="coupon-state">
              {t(STATE_KEY[c.state] ?? "marketingX.statePaused")}
            </Badge>
          </Td>
          {readOnly ? null : (
            <Td className="text-right">
              <span className="flex items-center justify-end gap-2">
                <Link
                  href={`${editBase}/${c.id}/edit`}
                  className="text-sm font-medium text-fg-muted hover:text-brand-600 hover:underline"
                >
                  {t("common.edit")}
                </Link>
                <CouponDeleteButton couponId={c.id} listPath={editBase} />
              </span>
            </Td>
          )}
        </tr>
      ))}
    </Table>
  );
}
