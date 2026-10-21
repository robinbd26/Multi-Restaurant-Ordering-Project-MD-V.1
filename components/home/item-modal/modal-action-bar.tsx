"use client";

import { QuantityControl } from "@/components/home/item-modal/quantity-control";
import { useTranslation } from "@/lib/i18n/use-translation";

/** Sticky bottom bar: quantity stepper + red "Add to Cart · ৳total" button. */
export function ModalActionBar({
  qty,
  onQtyChange,
  total,
  accent,
  onAdd,
  disabled = false,
}: {
  qty: number;
  onQtyChange: (qty: number) => void;
  total: number;
  accent: string;
  onAdd: () => void;
  /** Nothing orderable online (a dine-in-only product). */
  disabled?: boolean;
}) {
  const { t, fmt } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-t border-white/8 bg-[#16161E] p-4 sm:px-6">
      <QuantityControl qty={qty} onChange={onQtyChange} accent={accent} />
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        data-testid="modal-add-to-cart"
        className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[10px] bg-brand-500 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-50 disabled:hover:bg-brand-500"
      >
        🛒 {t("home.modal.addToCart")} · {fmt.money(total)}
      </button>
    </div>
  );
}
