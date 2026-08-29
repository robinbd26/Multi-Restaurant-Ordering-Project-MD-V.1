import type { Metadata } from "next";

import { RefundForm } from "@/components/accounts/financial-forms";
import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { ListPagination } from "@/components/dashboard/list-controls";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { pageMeta, parseListParams, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("financials.refundsTitle") };
}

const BASE = "/accounts/refunds";
const SORTABLE = ["createdAt", "amount"] as const;

/** /accounts/refunds — process customer refunds + full history. */
export default async function AccountsRefundsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { t, fmt } = await getT();
  await requireRole("accounts", "super_admin");
  const sp = await searchParams;

  const { page, pageSize, skip, take, sort, direction } = parseListParams(sp, {
    sortable: SORTABLE,
    defaultSort: "createdAt",
  });

  const [count, rows] = await Promise.all([
    prisma.refund.count(),
    prisma.refund.findMany({
      include: { processedBy: true, order: true },
      orderBy: sort === "amount" ? { amount: direction } : { createdAt: direction },
      skip,
      take,
    }),
  ]);
  const meta = pageMeta(count, page, pageSize);

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/accounts/dashboard" },
          { label: t("financials.refundsTitle") },
        ]}
        title={t("financials.refundsTitle")}
        subtitle={t("financials.refundsSub")}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title={t("financials.processRefund")} />
          <CardContent>
            <RefundForm />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("financials.refundHistory")} />
          {rows.length === 0 ? (
            <EmptyState title={t("financials.noRefunds")} />
          ) : (
            <>
              <Table headers={[t("wallet.colOrder"), t("pages.colAmount"), t("adminExtras.colReason"), t("financials.processedBy"), t("pages.colDate")]}>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-hover/70">
                    <Td>
                      <span className="font-semibold text-fg-base">
                        {r.order.orderNumber || `#${fmt.num(r.orderId)}`}
                      </span>
                    </Td>
                    <Td><span className="font-semibold text-red-600">-{fmt.money(r.amount.toFixed(2))}</span></Td>
                    <Td><span className="text-sm text-fg-muted">{r.reason}</span></Td>
                    <Td>
                      {r.processedBy
                        ? `${r.processedBy.firstName} ${r.processedBy.lastName}`.trim() || r.processedBy.username
                        : "—"}
                    </Td>
                    <Td><span className="text-xs text-fg-muted">{fmt.dateTime(r.createdAt.toISOString())}</span></Td>
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
