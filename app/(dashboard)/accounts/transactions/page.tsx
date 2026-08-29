import type { Metadata } from "next";

import { LedgerStatusBadge, PaymentStatusBadge } from "@/components/accounts/ledger-badges";
import { paymentStatusKey } from "@/components/accounts/payment-status-labels";
import { OrderStatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Icon } from "@/components/layout/icons";
import { Table, Td } from "@/components/ui/table";
import { getJSON } from "@/lib/api/client";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { PAYMENT_STATUSES } from "@/lib/services/payments";
import type { OrderStatus, Paginated } from "@/types";
import { FIELD_CLASS, SELECT_EXTRA_CLASS } from "@/components/ui/field-class";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("pages.transactionsTitle") };
}

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

type Params = {
  searchParams: Promise<{
    status?: string;
    payment_status?: string;
    method?: string;
    refunded?: string;
    from?: string;
    to?: string;
    q?: string;
  }>;
};

/** /accounts/transactions — filterable order-payment ledger. */
export default async function AccountsTransactionsPage({ searchParams }: Params) {
  const { t, fmt } = await getT();
  await requireRole("accounts", "super_admin");
  const sp = await searchParams;

  const query = new URLSearchParams({ page_size: "100" });
  for (const key of ["status", "payment_status", "method", "refunded", "from", "to", "q"] as const) {
    if (sp[key]) query.set(key, sp[key]!);
  }
  const data = await getJSON<Paginated<LedgerRow>>(`/accounts/transactions/?${query}`);

  // Footer totals for the rows ON SCREEN. Exact-2dp strings are summed in paisa
  // (integers) and formatted back, so the ledger never shows a float artefact.
  const paisa = (value: string) => Math.round(Number(value) * 100);
  const totals = data.results.reduce(
    (acc, row) => ({
      gross: acc.gross + paisa(row.total_amount),
      refunded: acc.refunded + paisa(row.refunded_amount),
      net: acc.net + paisa(row.net_amount),
    }),
    { gross: 0, refunded: 0, net: 0 },
  );
  const taka = (value: number) => (value / 100).toFixed(2);

  const field = FIELD_CLASS;
  const selectField = `${FIELD_CLASS} ${SELECT_EXTRA_CLASS}`;

  return (
    <>
      <PageHeader title={t("pages.transactionsTitle")} subtitle={t("pages.transactionsSub")} />

      {/* WS-2.6 — refunds are money that LEFT again. Showing gross beside
          refunded and net is what makes a refunded order impossible to read as
          a completed sale. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("accounts.colSales")} value={fmt.money(taka(totals.gross))} icon={<Icon name="money" />} accent="green" />
        <StatCard label={t("accounts.refundsLabel")} value={fmt.money(taka(totals.refunded))} icon={<Icon name="x" />} accent="red" />
        <StatCard label={t("financials.netLabel")} value={fmt.money(taka(totals.net))} icon={<Icon name="chart" />} accent="blue" />
      </div>

      {/* GET filter bar — server-rendered, no JS needed. Every control is an
          optional filter with no constraint to validate, so the only part of
          the form standard that applies is suppressing the browser's bubbles. */}
      <form method="GET" noValidate className="my-4 flex flex-wrap items-end gap-3 rounded-xl border border-border-base bg-surface-card p-4 shadow-card">
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterOrderId")}
          <input name="q" defaultValue={sp.q ?? ""} className={field} placeholder="#" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("pages.colStatus")}
          <select name="status" defaultValue={sp.status ?? ""} className={selectField}>
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
          <select name="payment_status" defaultValue={sp.payment_status ?? ""} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(paymentStatusKey(s))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("pages.colMethod")}
          <select name="method" defaultValue={sp.method ?? ""} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            <option value="cash">{t("payment.cash")}</option>
            <option value="bkash">{t("payment.bkash")}</option>
          </select>
        </label>
        {/* WS-2.6 — "refunded" had no value, no column and no filter anywhere. */}
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("financials.refunded")}
          <select name="refunded" defaultValue={sp.refunded ?? ""} className={selectField}>
            <option value="">{t("complaints.filterAll")}</option>
            <option value="yes">{t("financials.refundedOnly")}</option>
            <option value="no">{t("financials.notRefunded")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterFrom")}
          <input type="date" name="from" defaultValue={sp.from ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterTo")}
          <input type="date" name="to" defaultValue={sp.to ?? ""} className={field} />
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
                <Td>{o.branch_name}</Td>
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
        )}
      </Card>
    </>
  );
}
