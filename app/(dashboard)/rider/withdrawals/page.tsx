import type { Metadata } from "next";

import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { ListPagination } from "@/components/dashboard/list-controls";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { WithdrawalRequestForm } from "@/components/wallet/withdrawal-request-form";
import { WithdrawalStatusBadge } from "@/components/wallet/withdrawal-status-badge";
import { requireApiUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { pageMeta, parseListParams, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";
import { serializeWithdrawal } from "@/lib/serializers";
import { WITHDRAWAL_INCLUDE, riderWalletSummary } from "@/lib/services/wallet";
import type { RiderWithdrawalT } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("wallet.withdrawalsTitle") };
}

const BASE = "/rider/withdrawals";
const SORTABLE = ["createdAt", "amount"] as const;

/** /rider/withdrawals — request form + own withdrawal history/status. */
export default async function RiderWithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("rider");
  const me = await requireApiUser();
  const sp = await searchParams;

  const { page, pageSize, skip, take, sort, direction } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "createdAt",
  });

  const where = { riderId: me.id };
  const [wallet, count, rows] = await Promise.all([
    riderWalletSummary(me.id),
    prisma.riderWithdrawal.count({ where }),
    prisma.riderWithdrawal.findMany({
      where,
      include: WITHDRAWAL_INCLUDE,
      orderBy: sort === "amount" ? { amount: direction } : { createdAt: direction },
      skip,
      take,
    }),
  ]);

  const history = rows.map(serializeWithdrawal) as unknown as RiderWithdrawalT[];
  const meta = pageMeta(count, page, pageSize);

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/rider/dashboard" },
          { label: t("wallet.withdrawalsTitle") },
        ]}
        title={t("wallet.withdrawalsTitle")}
        subtitle={t("wallet.withdrawalsSub")}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title={t("wallet.requestWithdrawal")} />
          <CardContent>
            <WithdrawalRequestForm availableBalance={wallet.availableBalance.toFixed(2)} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t("wallet.withdrawalHistory")} />
          {history.length === 0 ? (
            <EmptyState title={t("wallet.noWithdrawalsTitle")} description={t("wallet.noWithdrawalsDesc")} />
          ) : (
            <>
              <Table headers={[t("pages.colDate"), t("pages.colAmount"), t("pages.colStatus"), t("wallet.colDecidedBy")]}>
                {history.map((w) => (
                  <tr key={w.id} className="hover:bg-surface-hover/70">
                    <Td><span className="text-xs text-fg-muted">{fmt.dateTime(w.created_at)}</span></Td>
                    <Td><span className="font-semibold">{fmt.money(w.amount)}</span></Td>
                    <Td>
                      <WithdrawalStatusBadge status={w.status} />
                      {w.status === "rejected" && w.rejection_reason ? (
                        <p className="mt-1 text-xs text-red-500">{w.rejection_reason}</p>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="text-xs text-fg-muted">
                        {w.decided_by_name ?? "—"}
                        {w.paid_at ? ` · ${fmt.dateTime(w.paid_at)}` : ""}
                      </span>
                    </Td>
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
      </div>
    </DashboardPage>
  );
}
