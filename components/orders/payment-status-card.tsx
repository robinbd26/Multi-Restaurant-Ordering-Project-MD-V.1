import { PaymentSubmitForm } from "@/components/orders/payment-submit-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ApiError, getJSON } from "@/lib/api/client";
import { getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/dictionaries";
import type { Order } from "@/types";

/**
 * PHASE S payment lifecycle. `paid` is the legacy settled value and is treated
 * exactly like `verified` everywhere below — money in, nothing left to do.
 */
export type PaymentStatus = "unpaid" | "pending_verification" | "verified" | "rejected" | "paid";

/**
 * The payment half of an order as the API already serializes it
 * (`serializeOrder`). Declared here rather than widening the shared `Order`
 * type, so this feature owns its own contract.
 */
export interface OrderPaymentFields {
  payment_status: PaymentStatus;
  bkash_transaction_id: string;
  bkash_payer_phone: string;
  /** Snapshot of the number the customer was TOLD to pay, taken at submission. */
  bkash_destination_number: string;
  payment_submitted_at: string | null;
  payment_verified_by: number | null;
  payment_verified_at: string | null;
  payment_rejection_reason: string;
}

export type OrderWithPayment = Order & OrderPaymentFields;

/** Only the bKash acceptance settings this panel reads off a branch. */
interface BranchPaymentSettings {
  bkash_number: string;
  bkash_enabled: boolean;
  bkash_instructions: string;
}

const STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "payments.statusUnpaid",
  pending_verification: "payments.statusPending",
  verified: "payments.statusVerified",
  rejected: "payments.statusRejected",
  paid: "payments.statusPaid",
};

const STATUS_TONES = {
  unpaid: "amber",
  pending_verification: "blue",
  verified: "green",
  rejected: "red",
  paid: "green",
} as const;

/** The manual-bKash trail, reusing the lifecycle's own labels as step names. */
const TRAIL: PaymentStatus[] = ["unpaid", "pending_verification", "verified"];

/** The lifecycle pill. `t` is threaded in so this stays a plain sync render. */
function PaymentStatusBadge({ status, t }: { status: PaymentStatus; t: TranslateFn }) {
  return (
    <span data-testid="payment-status-badge" data-status={status}>
      <Badge dot tone={STATUS_TONES[status]}>
        {t(STATUS_LABELS[status])}
      </Badge>
    </span>
  );
}

/**
 * WS-1.2 (c) — where the payment stands, on the same page as the order timeline.
 *
 * A rejected payment is NOT a step backwards in the food timeline, so it gets
 * its own trail: the customer sees that their money was sent, that the branch
 * is checking it, and — if it was refused — the reason the staffer typed, above
 * the form that lets them try again.
 */
function PaymentTrail({
  status,
  t,
  fmt,
}: {
  status: PaymentStatus;
  t: TranslateFn;
  fmt: Formatters;
}) {
  // A rejection holds at "submitted": the money WAS sent, it just was not
  // recognised. The red notice beside the trail carries the explanation.
  const effective: PaymentStatus =
    status === "paid" ? "verified" : status === "rejected" ? "pending_verification" : status;
  const currentIndex = TRAIL.indexOf(effective);
  return (
    <ol className="flex flex-wrap items-center gap-y-3" data-testid="payment-trail">
      {TRAIL.map((step, i) => (
        <li key={step} className="flex items-center">
          <span
            className={
              i <= currentIndex
                ? "flex size-7 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white"
                : "flex size-7 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-fg-subtle"
            }
          >
            {fmt.num(i + 1)}
          </span>
          <span
            className={
              i <= currentIndex ? "mx-2 text-xs font-medium text-fg-base" : "mx-2 text-xs text-fg-subtle"
            }
          >
            {t(STATUS_LABELS[step])}
          </span>
          {i < TRAIL.length - 1 ? (
            <span className={i < currentIndex ? "mr-2 h-0.5 w-5 bg-brand-400" : "mr-2 h-0.5 w-5 bg-slate-200"} />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** One labelled fact from the submission (TrxID, payer number, timestamps). */
function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={mono ? "mt-1 font-mono text-sm tabular-nums text-fg-base" : "mt-1 text-sm text-fg-base"}>
        {value || "—"}
      </p>
    </div>
  );
}

/**
 * WS-1.2 (a) — the customer's payment panel.
 *
 * The bKash number shown is the order's OWN snapshot whenever it has one, so a
 * branch that edits its number tomorrow never rewrites what this customer was
 * told to pay today. Only a first payment (no snapshot yet) falls back to the
 * branch's current number — which is exactly what the service will snapshot the
 * moment the customer submits.
 */
export async function PaymentStatusCard({ order }: { order: OrderWithPayment }) {
  const { t, fmt } = await getT();
  const status: PaymentStatus = order.payment_status ?? "unpaid";
  const settled = status === "verified" || status === "paid";

  if (order.payment_method !== "bkash") {
    return (
      <section data-testid="payment-panel" data-method="cash">
        <Card>
          <CardHeader
            title={t("orders.payment")}
            subtitle={t("payments.cod")}
            action={<PaymentStatusBadge status={status} t={t} />}
          />
          <CardContent>
            <p className="text-sm text-fg-muted">
              {settled
                ? t("payments.codSettled")
                : t("payments.codNotice", { amount: fmt.money(order.total_amount) })}
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  // The branch lookup only supplies the CONVENIENCE bits — instructions, and
  // the number for a first payment. It is never allowed to break the page: an
  // order that already carries a snapshot needs nothing from it.
  let branch: BranchPaymentSettings | null = null;
  try {
    branch = await getJSON<BranchPaymentSettings>(`/branches/${order.branch}/`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // redirects and real failures propagate
    branch = null;
  }

  const destination = order.bkash_destination_number || branch?.bkash_number || "";
  // A first payment is only possible while the branch still accepts bKash; a
  // resubmission after rejection is judged the same way.
  const canPay = Boolean(destination) && (branch?.bkash_enabled ?? Boolean(order.bkash_destination_number));
  const needsPayment = status === "unpaid" || status === "rejected";

  return (
    <section data-testid="payment-panel" data-method="bkash">
      <Card>
        <CardHeader
          title={t("orders.payment")}
          subtitle={t("payments.bkash")}
          action={<PaymentStatusBadge status={status} t={t} />}
        />
        <CardContent className="space-y-4">
          <PaymentTrail status={status} t={t} fmt={fmt} />

          {status === "pending_verification" ? (
            <Alert tone="info" message={t("payments.pendingNotice")} />
          ) : null}
          {settled ? <Alert tone="success" message={t("payments.verifiedNotice")} /> : null}
          {status === "rejected" ? (
            <div
              className="rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/25"
              data-testid="payment-rejection"
            >
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                {t("payments.rejectedNotice")}
              </p>
              {/* The staffer's words, verbatim — never paraphrased or translated. */}
              <p className="mt-1 text-sm text-red-700 dark:text-red-300" data-testid="payment-rejection-reason">
                {order.payment_rejection_reason || t("payments.rejectedNoReason")}
              </p>
            </div>
          ) : null}

          {/* What was actually submitted, kept on screen in every state after the
              first submission so the customer can quote it to the branch. */}
          {order.bkash_transaction_id ? (
            <div className="grid gap-4 sm:grid-cols-2" data-testid="payment-submission">
              <Detail label={t("payments.transactionId")} value={order.bkash_transaction_id} mono />
              <Detail label={t("payments.payerPhone")} value={order.bkash_payer_phone} mono />
              <Detail label={t("payments.payTo")} value={order.bkash_destination_number} mono />
              <Detail
                label={t("payments.submittedAt")}
                value={order.payment_submitted_at ? fmt.dateTime(order.payment_submitted_at) : "—"}
              />
              {order.payment_verified_at ? (
                <Detail label={t("payments.decidedAt")} value={fmt.dateTime(order.payment_verified_at)} />
              ) : null}
            </div>
          ) : null}

          {needsPayment && canPay ? (
            <PaymentSubmitForm
              orderId={order.id}
              destinationNumber={destination}
              instructions={branch?.bkash_instructions ?? ""}
              amount={fmt.money(order.total_amount)}
              defaultPayerPhone={order.bkash_payer_phone || order.customer_phone || ""}
              resubmit={status === "rejected"}
            />
          ) : null}
          {needsPayment && !canPay ? (
            <Alert tone="warning" message={t("payments.bkashDisabled")} />
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
