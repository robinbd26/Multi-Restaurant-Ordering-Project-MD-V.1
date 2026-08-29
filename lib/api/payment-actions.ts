"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/api/action-state";
import { ApiError, sendJSON } from "@/lib/api/client";
import { getT } from "@/lib/i18n/server";
import { parseFieldErrors } from "@/lib/validation/contract";

/**
 * WS-1.2 — server actions for the MANUAL bKash flow.
 *
 * The routes have existed since Phase S but nothing called them, so the feature
 * was unreachable: `/api/orders/[id]/payment` (customer submits a TrxID) and
 * `/api/orders/[id]/payment/verify` (staff approves / rejects with a reason).
 *
 * These live in their own module rather than in `lib/api/actions.ts` because a
 * "use server" file may only export async functions — its `errorState` /
 * `promoteFieldError` helpers therefore cannot be imported from another module
 * without turning them into publicly callable server actions. They are repeated
 * below, unchanged in behaviour, for exactly that reason.
 */

/** Translate a message key using the request's active locale (bn/en). */
async function tr(key: string): Promise<string> {
  const { t } = await getT();
  return t(key);
}

/** Turn a failed API call into form state, keeping the backend's per-field messages. */
async function errorState(err: unknown): Promise<ActionState> {
  if (err instanceof ApiError) {
    const { fieldErrors, formError } = parseFieldErrors(err.data);
    const hasFields = Object.keys(fieldErrors).length > 0;
    return {
      error: formError ?? (hasFields ? null : await tr("errors.generic")),
      fieldErrors,
      submissionId: Date.now(),
    };
  }
  throw err; // redirects and unexpected errors propagate
}

/** Promote the first per-field message onto `error` for button-driven mutations. */
function promoteFieldError(state: ActionState): ActionState {
  if (state.error) return state;
  const first = Object.values(state.fieldErrors ?? {})[0];
  return first ? { ...state, error: first } : state;
}

/**
 * Customer submits their manual bKash payment. The server re-validates the
 * TrxID shape, the payer phone, branch availability and duplicate transaction
 * ids, and it — not this action — decides the resulting payment status. The
 * order only ever reaches `pending_verification` here; nothing is auto-paid.
 */
export async function submitBkashPaymentAction(
  orderId: number,
  payload: { transaction_id: string; payer_phone: string },
): Promise<ActionState> {
  try {
    await sendJSON(`/orders/${orderId}/payment/`, "POST", {
      transaction_id: payload.transaction_id,
      payer_phone: payload.payer_phone,
    });
    revalidatePath("/customer/orders");
    revalidatePath(`/customer/orders/${orderId}`);
    return { error: null, success: await tr("payments.submitted") };
  } catch (err) {
    return await errorState(err);
  }
}

/**
 * Staff approves or rejects a submitted payment. A rejection MUST carry a
 * reason — the service refuses a reasonless one — and the reason is stored (and
 * later shown to the customer) exactly as the staffer typed it.
 */
export async function decideBkashPaymentAction(
  orderId: number,
  approve: boolean,
  reason = "",
): Promise<ActionState> {
  try {
    await sendJSON(`/orders/${orderId}/payment/verify/`, "POST", { approve, reason });
    revalidatePath("/accounts/payments");
    revalidatePath("/branch-manager/dashboard");
    revalidatePath("/branch-manager/orders");
    revalidatePath(`/branch-manager/orders/${orderId}`);
    revalidatePath("/customer/orders");
    revalidatePath(`/customer/orders/${orderId}`);
    return { error: null, success: await tr(approve ? "payments.verified" : "payments.rejected") };
  } catch (err) {
    // The reason lives in an inline panel, not a named form field, so the
    // backend's per-field message has to be promoted to the form-level one the
    // queue actually renders.
    return promoteFieldError(await errorState(err));
  }
}
