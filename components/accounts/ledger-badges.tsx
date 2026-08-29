"use client";

import { Badge } from "@/components/ui/badge";
import {
  LEDGER_STATUS_LABELS,
  LEDGER_STATUS_TONES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
} from "@/components/accounts/payment-status-labels";
import { useTranslation } from "@/lib/i18n/use-translation";
import type { LedgerStatus } from "@/lib/services/financials";
import type { PaymentStatus } from "@/lib/services/payments";

/**
 * WS-2.4 / WS-2.6 — the two money pills an accounts screen needs.
 *
 * OrderStatusBadge answers "where is the food?", which is not the same question
 * as "where is the money?". These answer the money questions: the payment
 * lifecycle, and the ledger's own outcome for an order — including `refunded`,
 * which had no representation anywhere in Accounts.
 *
 * Both live in the accounts module rather than components/ui/badge.tsx so the
 * module owns its own vocabulary; the labels themselves sit in a directive-free
 * sibling so a server-rendered filter dropdown can use them too.
 */

export function PaymentStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const known = (status in PAYMENT_STATUS_LABELS ? status : "unpaid") as PaymentStatus;
  return (
    <span data-testid="accounts-payment-status" data-status={known}>
      <Badge dot tone={PAYMENT_STATUS_TONES[known]}>{t(PAYMENT_STATUS_LABELS[known])}</Badge>
    </span>
  );
}

export function LedgerStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const known = (status in LEDGER_STATUS_LABELS ? status : "outstanding") as LedgerStatus;
  return (
    <span data-testid="accounts-ledger-status" data-status={known}>
      <Badge dot tone={LEDGER_STATUS_TONES[known]}>{t(LEDGER_STATUS_LABELS[known])}</Badge>
    </span>
  );
}
