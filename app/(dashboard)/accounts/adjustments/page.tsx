import type { Metadata } from "next";

import { AdjustmentForm } from "@/components/accounts/financial-forms";
import { DashboardPage, DashboardPageHeader } from "@/components/dashboard/dashboard-page";
import { ListPagination } from "@/components/dashboard/list-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { pageMeta, parseListParams, type RawSearchParams } from "@/lib/http/list-params";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("financials.adjustmentsTitle") };
}

const BASE = "/accounts/adjustments";
const SORTABLE = ["createdAt", "amount"] as const;

/** /accounts/adjustments — authorized manual financial adjustments. */
export default async function AccountsAdjustmentsPage({
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

  const [count, rows, branches] = await Promise.all([
    prisma.financialAdjustment.count(),
    prisma.financialAdjustment.findMany({
      include: { branch: true, createdBy: true },
      orderBy: sort === "amount" ? { amount: direction } : { createdAt: direction },
      skip,
      take,
    }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const meta = pageMeta(count, page, pageSize);

  return (
    <DashboardPage density="compact">
      <DashboardPageHeader
        breadcrumbs={[
          { label: t("nav.dashboard"), href: "/accounts/dashboard" },
          { label: t("financials.adjustmentsTitle") },
        ]}
        title={t("financials.adjustmentsTitle")}
        subtitle={t("financials.adjustmentsSub")}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title={t("financials.recordAdjustment")} />
          <CardContent>
            <AdjustmentForm branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("financials.adjustmentHistory")} />
          {rows.length === 0 ? (
            <EmptyState title={t("financials.noAdjustments")} />
          ) : (
            <>
              <Table headers={[t("pages.colDate"), t("financials.typeLabel"), t("pages.colAmount"), t("pages.colBranch"), t("financials.noteLabel"), t("financials.recordedBy")]}>
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-hover/70">
                    <Td><span className="text-xs text-fg-muted">{fmt.dateTime(a.createdAt.toISOString())}</span></Td>
                    <Td>
                      <Badge tone={a.type === "credit" ? "green" : "red"}>
                        {t(`financials.${a.type}`)}
                      </Badge>
                    </Td>
                    <Td>
                      <span className={a.type === "credit" ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>
                        {a.type === "credit" ? "+" : "-"}
                        {fmt.money(a.amount.toFixed(2))}
                      </span>
                    </Td>
                    <Td>{a.branch?.name ?? "—"}</Td>
                    <Td><span className="text-xs text-fg-muted">{a.note}</span></Td>
                    <Td>
                      <span className="text-xs text-fg-muted">
                        {a.createdBy
                          ? `${a.createdBy.firstName} ${a.createdBy.lastName}`.trim() || a.createdBy.username
                          : "—"}
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
