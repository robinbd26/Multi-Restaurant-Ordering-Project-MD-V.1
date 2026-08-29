"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { decideBkashPaymentAction } from "@/lib/api/payment-actions";
import { useLiveData } from "@/lib/hooks/use-live-data";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * One waiting manual-bKash submission, as `/api/orders/pending-payments`
 * serializes it — everything a verifier compares against their bKash statement
 * and nothing else.
 */
export interface PendingPaymentRow {
  id: number;
  order_number: string | null;
  branch: number;
  branch_name: string;
  customer_name: string;
  customer_phone: string;
  total_amount: string;
  bkash_transaction_id: string;
  bkash_payer_phone: string;
  bkash_destination_number: string;
  payment_submitted_at: string | null;
}

interface QueuePayload {
  count: number;
  results: PendingPaymentRow[];
}

/** One labelled fact inside a queue card. */
function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className={mono ? "mt-0.5 truncate font-mono text-sm tabular-nums text-fg-base" : "mt-0.5 truncate text-sm text-fg-base"}>
        {value || "—"}
      </dd>
    </div>
  );
}

/**
 * A single pending payment with its two decisions.
 *
 * Each row owns its own pending/error state, so one branch's failed decision
 * can never disable or blank another row. Nothing is decided optimistically:
 * the list is re-fetched from the server after every decision, which is also
 * how a row that a colleague just decided disappears.
 */
function QueueRow({
  row,
  orderBasePath,
  onDecided,
}: {
  row: PendingPaymentRow;
  orderBasePath?: string;
  onDecided: () => void;
}) {
  const { t, fmt } = useTranslation();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const decide = useCallback(
    (approve: boolean, rejectionReason: string) => {
      start(async () => {
        const res = await decideBkashPaymentAction(row.id, approve, rejectionReason);
        setError(res.error);
        if (res.error) return;
        setRejecting(false);
        setReason("");
        onDecided();
      });
    },
    [onDecided, row.id],
  );

  function submitReject() {
    // A rejection the customer cannot act on is worthless, and the service
    // refuses one anyway — so the reason is demanded here first, before any
    // request is made.
    if (!reason.trim()) {
      setError(t("payments.errRejectReasonRequired"));
      return;
    }
    setError(null);
    decide(false, reason);
  }

  const label = row.order_number ?? t("orders.orderNumber", { id: fmt.num(row.id) });

  return (
    <div
      className="rounded-xl border border-border-strong p-3.5"
      data-testid="payment-queue-row"
      data-order={row.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-fg-base">
            {orderBasePath ? (
              <Link href={`${orderBasePath}/${row.id}`} className="hover:text-brand-500">
                {label}
              </Link>
            ) : (
              label
            )}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {row.customer_name || "—"}
            {row.customer_phone ? ` • ${row.customer_phone}` : ""}
          </p>
        </div>
        <p className="text-base font-bold text-brand-600" data-testid="payment-queue-amount">
          {fmt.money(row.total_amount)}
        </p>
      </div>

      <dl className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <Fact label={t("payments.transactionId")} value={row.bkash_transaction_id} mono />
        <Fact label={t("payments.payerPhone")} value={row.bkash_payer_phone} mono />
        <Fact label={t("payments.payTo")} value={row.bkash_destination_number} mono />
        <Fact
          label={t("payments.submittedAt")}
          value={row.payment_submitted_at ? fmt.dateTime(row.payment_submitted_at) : "—"}
        />
      </dl>

      {error ? (
        <p className="mt-2 text-sm text-red-600" data-testid="payment-queue-error">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="success"
          disabled={pending}
          data-testid="payment-approve"
          onClick={() => {
            setError(null);
            decide(true, "");
          }}
        >
          {pending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : null}
          {t("payments.verify")}
        </Button>
        {!rejecting ? (
          <Button
            size="sm"
            variant="outline"
            className="text-red-600"
            disabled={pending}
            data-testid="payment-reject-open"
            onClick={() => {
              setError(null);
              setRejecting(true);
            }}
          >
            {t("payments.reject")}
          </Button>
        ) : null}
      </div>

      {rejecting ? (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
          <p className="text-sm font-semibold text-fg-base">{t("payments.rejectReason")}</p>
          <p className="mt-1 text-xs text-fg-muted">{t("payments.rejectReasonHint")}</p>
          <Textarea
            className="mt-2"
            rows={2}
            value={reason}
            disabled={pending}
            aria-label={t("payments.rejectReason")}
            placeholder={t("payments.rejectReasonPlaceholder")}
            data-testid="payment-reject-reason"
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setRejecting(false);
                setReason("");
                setError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              data-testid="payment-reject-confirm"
              onClick={submitReject}
            >
              {pending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : null}
              {t("payments.reject")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * WS-1.2 (b) — the staff pending-verification queue.
 *
 * The routes to approve and reject a manual payment have existed since Phase S
 * but nothing rendered them, so submissions piled up unseen. This is the queue,
 * shared by the branch manager's live board and the accounts payments page.
 *
 * The list comes from `/api/orders/pending-payments`, which scopes rows by the
 * caller's role — a branch manager is served their own branch only, so the
 * queue cannot leak (or offer a decision on) another branch's money. The verify
 * route re-checks that on every decision regardless.
 */
export function PaymentVerificationQueue({
  initial = null,
  pollMs = 10000,
  orderBasePath,
  compact = false,
}: {
  /** Server-rendered first page, so a 3G phone sees rows before the first poll. */
  initial?: PendingPaymentRow[] | null;
  pollMs?: number;
  /** Where an order number links to, when the caller's role has a detail page. */
  orderBasePath?: string;
  /** Board mode: one quiet line when empty instead of a full empty state. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, error, refresh } = useLiveData<QueuePayload>(
    "/api/orders/pending-payments?page_size=50",
    pollMs,
    initial ? { count: initial.length, results: initial } : null,
  );

  const onDecided = useCallback(() => {
    void refresh();
    // The surrounding page is server-rendered (counts, totals), so it has to be
    // told as well — the queue alone re-fetching would leave stale figures.
    router.refresh();
  }, [refresh, router]);

  if (!data) {
    return (
      <p className="text-sm text-fg-muted" data-testid="payment-queue-loading">
        {error ? t("errors.dataLoadFailed") : t("common.loading")}
      </p>
    );
  }

  if (data.results.length === 0) {
    return compact ? (
      <p className="text-sm text-fg-muted" data-testid="payment-queue-empty">
        {t("payments.queueEmpty")}
      </p>
    ) : (
      <EmptyState title={t("payments.queueEmpty")} description={t("payments.queueEmptyDesc")} />
    );
  }

  return (
    <div className="space-y-3" data-testid="payment-queue">
      {/* A stale queue must say so rather than quietly showing old money. */}
      {error ? (
        <p className="text-xs text-amber-600" data-testid="payment-queue-stale">
          {t("bmLive.stale")}
        </p>
      ) : null}
      {data.results.map((row) => (
        <QueueRow key={row.id} row={row} orderBasePath={orderBasePath} onDecided={onDecided} />
      ))}
    </div>
  );
}
