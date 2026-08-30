import type { Metadata } from "next";

import { LedgerStatusBadge, PaymentStatusBadge } from "@/components/accounts/ledger-badges";
import { paymentStatusKey } from "@/components/accounts/payment-status-labels";
import { OrderStatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { ListPagination } from "@/components/dashboard/list-controls";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Icon } from "@/components/layout/icons";
import { Table, Td } from "@/components/ui/table";
import { getJSON } from "@/lib/api/client";
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_DEFS } from "@/lib/constants";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { pageMeta, param, parseListParams, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import { PAYMENT_STATUSES } from "@/lib/services/payments";
import type { OrderStatus } from "@/types";
import { FIELD_CLASS, SELECT_EXTRA_CLASS } from "@/components/ui/field-class";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("pages.transactionsTitle") };
}

const BASE = "/accounts/transactions";

/**
 * A ledger row as app/api/accounts/transactions/route.ts serializes it. The
 * accounts ledger has its own contract rather than the shared order shape: it
 * needs money columns (refunded, net, payment state) an order screen never uses.
 */
interface LedgerRow {
  id: number;
  order_number: string | null;
  branch: number;
  branch_name: string;
  customer_name: string;
  rider_name: string | null;
  status: OrderStatus;
  payment_method: string;
  payment_status: string;
  paid_amount: string | null;
  total_amount: string;
  refunded_amount: string;
  net_amount: string;
  ledger_status: string;
  created_at: string;
}

interface LedgerPayload {
  count: number;
  /** Whole-filtered-set sums (exact Decimal, database-side) — never a page sum. */
  totals: { gross: string; refunded: string; net: string };
  results: LedgerRow[];
}

/**
 * /accounts/transactions — filterable order-payment ledger.
 *
 * WS-2.9 — the ledger filters like /accounts/commissions now: rider, branch,
 * customer, method, payment/order status, refund state, dates and an order-id q,
 * all resolved SERVER-side, with real pagination instead of a single 100-row
 * page pretending to be the whole book.
 */
export default async function AccountsTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("accounts", "super_admin");
  const sp = await searchParams;

  // Sorting is fixed (newest first) on this ledger, so only the paging half of
  // parseListParams is used; `sortable` still has to be given a whitelist.
  const { page, pageSize } = parseListParams(sp, {
    sortable: ["createdAt"] as const,
    defaultSort: "createdAt",
  });

  const filters = {
    q: param(sp, "q"),
    customer: param(sp, "customer"),
    rider: param(sp, "rider"),
    branch: param(sp, "branch"),
    status: param(sp, "status"),
    payment_status: param(sp, "payment_status"),
    method: param(sp, "method"),
    refunded: param(sp, "refunded"),
    from: param(sp, "from"),
    to: param(sp, "to"),
  };

  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }

  const [data, branches, riders] = await Promise.all([
    getJSON<LedgerPayload>(`/accounts/transactions/?${query}`),
    prisma.branch.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { role: "rider", status: "approved" },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true, username: true },
    }),
  ]);

  const meta = pageMeta(data.count, page, pageSize);
  const field = FIELD_CLASS;
  const selectField = `${FIELD_CLASS} ${SELECT_EXTRA_CLASS}`;

  return (
    <>
      <PageHeader title={t("pages.transactionsTitle")} subtitle={t("pages.transactionsSub")} />

      {/* WS-2.6 — refunds are money that LEFT again. Showing gross beside
          refunded and net is what makes a refunded order impossible to read as
          a completed sale. Totals cover the WHOLE filtered set (summed as exact
          Decimals in the API), never just the page on screen. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("accounts.colSales")} value={fmt.money(data.totals.gross)} icon={<Icon name="money" />} accent="green" />
        <StatCard label={t("accounts.refundsLabel")} value={fmt.money(data.totals.refunded)} icon={<Icon name="x" />} accent="red" />
        <StatCard label={t("financials.netLabel")} value={fmt.money(data.totals.net)} icon={<Icon name="chart" />} accent="blue" />
      </div>

      {/* GET filter bar — server-rendered, no JS needed. Every control is an
          optional filter with no constraint to validate, so the only part of
          the form standard that applies is suppressing the browser's bubbles. */}
      <form method="GET" noValidate className="my-4 flex flex-wrap items-end gap-3 rounded-xl border border-border-base bg-surface-card p-4 shadow-card">
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterOrderId")}
          <input name="q" defaultValue={filters.q} className={field} placeholder="#" />
        </label>
        {/* WS-2.9 — customer lookup by what the accountant has in hand: a name,
            an @username or the phone number on the order call. */}
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("financials.filterCustomer")}
          <input
            name="customer"
            defaultValue={filters.customer}
            className={field}
            placeholder={t("financials.filterCustomerHint")}
          />
        </label>
        {/* WS-2.9 — a disputed COD hand-in is traced by WHO delivered it. */}
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.colRider")}
          <select name="rider" defaultValue={filters.rider} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>
                {`${r.firstName} ${r.lastName}`.trim() || r.username}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("pages.colBranch")}
          <select name="branch" defaultValue={filters.branch} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("pages.colStatus")}
          <select name="status" defaultValue={filters.status} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(`orderStatus.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {/* WS-2.4 — Order.paymentStatus was read by NO accounts screen, so the
            ledger could not answer "has this been paid for?". */}
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("financials.paymentStatusLabel")}
          <select name="payment_status" defaultValue={filters.payment_status} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(paymentStatusKey(s))}
              </option>
            ))}
          </select>
        </label>
        {/* WS-1.4 — every rail from the one catalogue, never a hardcoded pair. */}
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("pages.colMethod")}
          <select name="method" defaultValue={filters.method} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {PAYMENT_METHOD_DEFS.map((m) => (
              <option key={m.value} value={m.value}>{t(m.labelKey)}</option>
            ))}
          </select>
        </label>
        {/* WS-2.6 — "refunded" had no value, no column and no filter anywhere. */}
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("financials.refunded")}
          <select name="refunded" defaultValue={filters.refunded} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            <option value="yes">{t("financials.refundedOnly")}</option>
            <option value="no">{t("financials.notRefunded")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterFrom")}
          <input type="date" name="from" defaultValue={filters.from} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterTo")}
          <input type="date" name="to" defaultValue={filters.to} className={field} />
        </label>
        <button
          type="submit"
          className="h-9 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
        >
          {t("wallet.applyFilters")}
        </button>
      </form>

      <Card>
        {data.results.length === 0 ? (
          <EmptyState title={t("pages.noData")} />
        ) : (
          <>
            <Table
              headers={[
                "#",
                t("pages.colDate"),
                t("pages.colBranch"),
                t("pages.colMethod"),
                t("financials.paymentStatusLabel"),
                t("pages.colStatus"),
                t("financials.ledgerStatusLabel"),
                t("pages.colAmount"),
                t("accounts.colRefunds"),
                t("financials.netLabel"),
              ]}
            >
              {data.results.map((o) => (
                <tr key={o.id} className="hover:bg-surface-hover/70">
                  <Td>
                    <span className="font-semibold text-fg-base">{o.order_number || `#${fmt.num(o.id)}`}</span>
                    <span className="block text-xs text-fg-subtle">{o.customer_name}</span>
                  </Td>
                  <Td><span className="text-xs text-fg-muted">{fmt.dateTime(o.created_at)}</span></Td>
                  <Td>
                    {o.branch_name}
                    {o.rider_name && (
                      <span className="block text-xs text-fg-subtle">{o.rider_name}</span>
                    )}
                  </Td>
                  <Td>{t(`payment.${o.payment_method}`)}</Td>
                  <Td><PaymentStatusBadge status={o.payment_status} /></Td>
                  <Td><OrderStatusBadge status={o.status} /></Td>
                  <Td><LedgerStatusBadge status={o.ledger_status} /></Td>
                  <Td mono><span className="font-semibold">{fmt.money(o.total_amount)}</span></Td>
                  <Td mono>
                    {Number(o.refunded_amount) > 0 ? (
                      <span className="font-semibold text-red-600">-{fmt.money(o.refunded_amount)}</span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </Td>
                  <Td mono><span className="font-semibold text-emerald-600">{fmt.money(o.net_amount)}</span></Td>
                </tr>
              ))}
            </Table>
            <ListPagination
              basePath={BASE}
              searchParams={sp}
              meta={meta}
              labels={{
                showing: t("list.showing", {
                  from: fmt.num(meta.from),
                  to: fmt.num(meta.to),
                  total: fmt.num(meta.total),
                }),
                previous: t("list.previous"),
                next: t("list.next"),
                pagination: t("list.pagination"),
              }}
            />
          </>
        )}
      </Card>
    </>
  );
}
