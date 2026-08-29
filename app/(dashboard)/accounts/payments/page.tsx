import type { Metadata } from "next";

import { Icon } from "@/components/layout/icons";
import { PageHeader } from "@/components/layout/page-header";
import { PaymentStatusBadge } from "@/components/accounts/ledger-badges";
import {
  PaymentVerificationQueue,
  type PendingPaymentRow,
} from "@/components/orders/payment-verification-queue";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td } from "@/components/ui/table";
import { ApiError, getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("pages.paymentsTitle") };
}

interface PaymentsPayload {
  total_collected: string;
  /** WS-2.2 — the food/delivery split of the SAME money, not extra money. */
  food_collected: string;
  delivery_collected: string;
  cancelled_orders: number;
  /** WS-2.4 — money still owed, by payment lifecycle status. */
  outstanding_orders: number;
  outstanding_amount: string;
  awaiting_verification_orders: number;
  awaiting_verification_amount: string;
  settled_orders: number;
  settled_amount: string;
  by_payment_status: {
    payment_status: string;
    orders: number;
    amount: string;
    outstanding: boolean;
  }[];
  by_method: {
    payment_method: string;
    orders: number;
    sales: string;
    food_revenue: string;
    delivery_revenue: string;
  }[];
}

/** /accounts/payments — collections + payment-method breakdown. */
export default async function AccountsPaymentsPage() {
  await requireRole("accounts", "super_admin");
  const { t, fmt } = await getT();
  const data = await getJSON<PaymentsPayload>("/accounts/payments/");

  // WS-1.2 — the manual bKash submissions waiting on a decision. Server-fetched
  // so the first paint already carries the rows; the queue keeps itself current
  // afterwards. A failure here must not take the collections report down with
  // it — the queue polls and recovers on its own.
  let pendingPayments: PendingPaymentRow[] | null = null;
  try {
    pendingPayments = (
      await getJSON<{ results: PendingPaymentRow[] }>("/orders/pending-payments/?page_size=50")
    ).results;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    pendingPayments = null;
  }

  return (
    <>
      <PageHeader title={t("pages.paymentsTitle")} subtitle={t("pages.paymentsSub")} />

      {/* WS-2.4 — this strip used to count UNDELIVERED orders as "pending",
          which is a kitchen metric: it told Accounts nothing about money owed.
          Every figure here is now driven by Order.paymentStatus, which no
          accounts screen read at all before. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("wallet.totalCollected")} value={fmt.money(data.total_collected)} icon={<Icon name="money" />} accent="green" />
        <StatCard
          label={t("accounts.outstandingAmount")}
          value={fmt.money(data.outstanding_amount)}
          sub={t("accounts.ordersCount", { count: fmt.num(data.outstanding_orders) })}
          icon={<Icon name="clock" />}
          accent="amber"
        />
        <StatCard
          label={t("accounts.awaitingVerification")}
          value={fmt.money(data.awaiting_verification_amount)}
          sub={t("accounts.ordersCount", { count: fmt.num(data.awaiting_verification_orders) })}
          icon={<Icon name="wallet" />}
          accent="blue"
        />
        <StatCard label={t("accounts.cancelledOrders")} value={fmt.num(data.cancelled_orders)} icon={<Icon name="x" />} accent="slate" />
      </div>

      {/* WS-2.2 — Order.deliveryCharge is snapshotted on every order but was
          referenced by no finance code, so delivery collections were invisible.
          Food + delivery add back up to total collected; neither is extra money. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <StatCard label={t("accounts.foodRevenue")} value={fmt.money(data.food_collected)} icon={<Icon name="list" />} accent="blue" />
        <StatCard label={t("accounts.deliveryRevenue")} value={fmt.money(data.delivery_collected)} icon={<Icon name="bike" />} accent="violet" />
      </div>

      {/* WS-2.4 — the full payment lifecycle, every bucket rendered even at
          zero. `unpaid` is not an error state: cash on delivery lives there
          until the money is settled, which is precisely the money Accounts is
          responsible for chasing. */}
      <Card className="mt-6">
        <CardHeader title={t("accounts.paymentStatusTitle")} subtitle={t("accounts.paymentStatusSub")} />
        <Table
          headers={[
            t("financials.paymentStatusLabel"),
            t("accounts.colOrders"),
            t("pages.colAmount"),
            t("accounts.colMeaning"),
          ]}
        >
          {data.by_payment_status.map((row) => (
            <tr key={row.payment_status} className="hover:bg-surface-hover/70">
              <Td><PaymentStatusBadge status={row.payment_status} /></Td>
              <Td>{fmt.num(row.orders)}</Td>
              <Td mono>
                <span className={row.outstanding ? "font-semibold text-amber-600" : "font-semibold"}>
                  {fmt.money(row.amount)}
                </span>
              </Td>
              <Td>
                <span className="text-xs text-fg-muted">
                  {row.outstanding ? t("accounts.moneyOwedHint") : t("accounts.moneyInHint")}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
        <CardContent>
          <p className="text-xs text-fg-subtle">
            {t("accounts.settledSummary", {
              amount: fmt.money(data.settled_amount),
              count: fmt.num(data.settled_orders),
            })}
          </p>
        </CardContent>
      </Card>

      {/* WS-1.2 — accounts verifies manual bKash for ANY branch, so the queue
          belongs on the money page, above the historical breakdown: it is the
          only part of this screen that is waiting on someone. */}
      <Card className="mt-6">
        <CardHeader title={t("payments.queueTitle")} subtitle={t("payments.queueSub")} />
        <CardContent>
          <PaymentVerificationQueue initial={pendingPayments} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader title={t("accounts.salesByPayment")} subtitle={t("accounts.salesByPaymentSub")} />
        {data.by_method.length === 0 ? (
          <EmptyState title={t("accounts.noSalesYet")} />
        ) : (
          <Table
            headers={[
              t("accounts.colMethod"),
              t("accounts.colOrders"),
              t("accounts.colSales"),
              t("accounts.colFoodRevenue"),
              t("accounts.colDeliveryRevenue"),
            ]}
          >
            {data.by_method.map((row) => (
              <tr key={row.payment_method} className="hover:bg-surface-hover/70">
                <Td><span className="font-medium text-fg-base">{t(`payment.${row.payment_method}`)}</span></Td>
                <Td>{fmt.num(row.orders)}</Td>
                <Td><span className="font-semibold">{fmt.money(row.sales)}</span></Td>
                <Td>{fmt.money(row.food_revenue)}</Td>
                <Td>{fmt.money(row.delivery_revenue)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
