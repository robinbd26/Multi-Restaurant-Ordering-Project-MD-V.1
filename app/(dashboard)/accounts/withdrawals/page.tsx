import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";

import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td } from "@/components/ui/table";
import { FIELD_CLASS } from "@/components/ui/field-class";
import { WithdrawalActions } from "@/components/wallet/withdrawal-actions";
import { WithdrawalStatusBadge } from "@/components/wallet/withdrawal-status-badge";
import { getJSON } from "@/lib/api/client";
import { WITHDRAWAL_STATUSES } from "@/lib/constants/enums";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { dhakaAddDays, dhakaDayStartFromKey } from "@/lib/utils/dates";
import type { Paginated, RiderWithdrawalT } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("wallet.withdrawalsTitle") };
}

const ZERO = new Prisma.Decimal(0);

type Params = { searchParams: Promise<{ status?: string; from?: string; to?: string }> };

/**
 * /accounts/withdrawals — the money-OUT ledger: rider payouts and, since WS-2.6,
 * the customer refunds paid over the same window.
 *
 * Refunds were unreachable from every ledger screen: this page listed withdrawal
 * requests only, so the single biggest category of money leaving the business
 * appeared in no ledger at all. It is money out, it belongs on the money-out
 * page, and both are now filterable over the same Dhaka date window.
 */
export default async function AccountsWithdrawalsPage({ searchParams }: Params) {
  const { t, fmt } = await getT();
  await requireRole("accounts", "super_admin");
  const { status = "", from = "", to = "" } = await searchParams;

  const query = new URLSearchParams({ page_size: "100" });
  if (status) query.set("status", status);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const data = await getJSON<Paginated<RiderWithdrawalT>>(`/accounts/withdrawals/?${query}`);

  // The same Dhaka window the API applies, so the summary below can never
  // describe a different period from the table beside it.
  const fromAt = from ? dhakaDayStartFromKey(from) : null;
  const toStart = to ? dhakaDayStartFromKey(to) : null;
  const toAt = toStart ? dhakaAddDays(toStart, 1) : null;
  const range =
    fromAt || toAt ? { ...(fromAt ? { gte: fromAt } : {}), ...(toAt ? { lt: toAt } : {}) } : undefined;

  const [paidOut, held, refundedOut] = await Promise.all([
    // Paid withdrawals are dated by when the money LEFT, not when it was asked for.
    prisma.riderWithdrawal.aggregate({
      where: { status: "paid", ...(range ? { paidAt: range } : {}) },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.riderWithdrawal.aggregate({
      where: { status: { in: ["pending", "approved"] }, ...(range ? { createdAt: range } : {}) },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.refund.aggregate({
      where: range ? { createdAt: range } : {},
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const paidTotal = paidOut._sum.amount ?? ZERO;
  const heldTotal = held._sum.amount ?? ZERO;
  const refundTotal = refundedOut._sum.amount ?? ZERO;
  // Rider payouts and customer refunds are both cash that left the business.
  const totalOut = paidTotal.plus(refundTotal);

  const tab = "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors";
  const keep = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/accounts/withdrawals?${qs}` : "/accounts/withdrawals";
  };

  return (
    <>
      <PageHeader title={t("wallet.withdrawalsTitle")} subtitle={t("wallet.reviewSub")} />

      {/* WS-2.6 — every outflow in one strip. A refund is money out exactly like
          a payout is; keeping it off this page hid it from the ledger entirely. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("wallet.paidWithdrawals")}
          value={fmt.money(paidTotal.toFixed(2))}
          sub={t("accounts.recordsCount", { count: fmt.num(paidOut._count._all) })}
          icon={<Icon name="check" />}
          accent="blue"
        />
        <StatCard
          label={t("wallet.pendingWithdrawals")}
          value={fmt.money(heldTotal.toFixed(2))}
          sub={t("accounts.recordsCount", { count: fmt.num(held._count._all) })}
          icon={<Icon name="clock" />}
          accent="amber"
        />
        <StatCard
          label={t("accounts.refundedOut")}
          value={fmt.money(refundTotal.toFixed(2))}
          sub={t("accounts.recordsCount", { count: fmt.num(refundedOut._count._all) })}
          icon={<Icon name="x" />}
          accent="red"
        />
        <StatCard
          label={t("accounts.totalMoneyOut")}
          value={fmt.money(totalOut.toFixed(2))}
          sub={t("accounts.totalMoneyOutHint")}
          icon={<Icon name="money" />}
          accent="violet"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Link
          href={keep({})}
          className={cn(tab, !status ? "bg-brand-50 text-brand-600" : "text-fg-muted hover:bg-surface-hover")}
        >
          {t("complaints.filterAll")}
        </Link>
        {WITHDRAWAL_STATUSES.map((s) => (
          <Link
            key={s}
            href={keep({ status: s })}
            className={cn(tab, status === s ? "bg-brand-50 text-brand-600" : "text-fg-muted hover:bg-surface-hover")}
          >
            {t(`withdrawalStatus.${s}`)}
          </Link>
        ))}
        {/* The refund ledger itself is one click away — same money, own screen. */}
        <Link href="/accounts/refunds" className={cn(tab, "text-fg-muted hover:bg-surface-hover")}>
          {t("financials.refundsTitle")}
        </Link>
      </div>

      {/* Dates are optional filters with nothing to validate, so the form only
          suppresses the browser's own bubbles. `status` rides along in a hidden
          field so applying a date range never silently clears the active tab. */}
      <form method="GET" noValidate className="my-4 flex flex-wrap items-end gap-3 rounded-xl border border-border-base bg-surface-card p-4 shadow-card">
        <input type="hidden" name="status" value={status} />
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterFrom")}
          <input type="date" name="from" defaultValue={from} className={FIELD_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("wallet.filterTo")}
          <input type="date" name="to" defaultValue={to} className={FIELD_CLASS} />
        </label>
        <button
          type="submit"
          className="h-9 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
        >
          {t("wallet.applyFilters")}
        </button>
      </form>

      <Card>
        <CardHeader title={t("wallet.withdrawalHistory")} subtitle={t("accounts.outflowWindowNote")} />
        {data.results.length === 0 ? (
          <CardContent>
            <EmptyState title={t("wallet.noWithdrawalsTitle")} description={t("wallet.noRequestsDesc")} />
          </CardContent>
        ) : (
          <Table
            headers={[
              t("pages.colDate"),
              t("wallet.colRider"),
              t("pages.colAmount"),
              t("wallet.noteLabel"),
              t("pages.colStatus"),
              t("pages.colActions"),
            ]}
          >
            {data.results.map((w) => (
              <tr key={w.id} className="hover:bg-surface-hover/70">
                <Td>
                  <span className="text-xs text-fg-muted">{fmt.dateTime(w.created_at)}</span>
                  {w.paid_at ? (
                    <span className="block text-xs text-fg-subtle">
                      {t("accounts.paidOn", { date: fmt.dateTime(w.paid_at) })}
                    </span>
                  ) : null}
                </Td>
                <Td>
                  <span className="font-medium text-fg-base">{w.rider_name}</span>
                  <span className="block text-xs text-fg-subtle">@{w.rider_username}</span>
                </Td>
                <Td mono><span className="font-semibold">{fmt.money(w.amount)}</span></Td>
                <Td><span className="text-xs text-fg-muted">{w.note || "—"}</span></Td>
                <Td>
                  <WithdrawalStatusBadge status={w.status} />
                  {w.status === "rejected" && w.rejection_reason ? (
                    <p className="mt-1 text-xs text-red-500">{w.rejection_reason}</p>
                  ) : null}
                  {w.decided_by_name ? (
                    <p className="mt-1 text-xs text-fg-subtle">{w.decided_by_name}</p>
                  ) : null}
                </Td>
                <Td className="text-right">
                  <WithdrawalActions withdrawal={w} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
