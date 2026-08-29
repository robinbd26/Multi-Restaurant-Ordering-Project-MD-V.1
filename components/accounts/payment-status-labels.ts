import type { LedgerStatus } from "@/lib/services/financials";
import type { PaymentStatus } from "@/lib/services/payments";

/**
 * WS-2.4 / WS-2.6 — the label and tone vocabulary for the two MONEY states an
 * accounts screen shows: the payment lifecycle, and the ledger's own outcome for
 * an order (including `refunded`, which had no representation anywhere).
 *
 * Deliberately a plain module with NO "use client" directive: the filter dropdown
 * on a server-rendered page and the badge in a client component both need these
 * labels, and a value exported from a client module cannot be called during
 * server render. The badges themselves live in ./ledger-badges.tsx.
 *
 * The payment labels are the ones the customer-side payment card already ships,
 * so a status never reads differently from one screen to the next. Both type
 * imports are type-only, so nothing from a `server-only` module is pulled into
 * the client bundle.
 */

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "payments.statusUnpaid",
  pending_verification: "payments.statusPending",
  verified: "payments.statusVerified",
  rejected: "payments.statusRejected",
  paid: "payments.statusPaid",
};

export const PAYMENT_STATUS_TONES = {
  unpaid: "amber",
  pending_verification: "blue",
  verified: "green",
  rejected: "red",
  paid: "green",
} as const;

/** Translation key for a payment lifecycle value; unknown values read as unpaid. */
export function paymentStatusKey(status: string): string {
  return PAYMENT_STATUS_LABELS[status as PaymentStatus] ?? PAYMENT_STATUS_LABELS.unpaid;
}

export const LEDGER_STATUS_LABELS: Record<LedgerStatus, string> = {
  refunded: "financials.ledgerRefunded",
  partially_refunded: "financials.ledgerPartiallyRefunded",
  settled: "financials.ledgerSettled",
  outstanding: "financials.ledgerOutstanding",
};

export const LEDGER_STATUS_TONES = {
  // Money handed back reads as a reversal, not as a failure.
  refunded: "violet",
  partially_refunded: "violet",
  settled: "green",
  outstanding: "amber",
} as const;
