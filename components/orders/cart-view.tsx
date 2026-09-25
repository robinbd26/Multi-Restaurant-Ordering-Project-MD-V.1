"use client";

import Link from "next/link";

import { useHomeCart } from "@/components/home/home-cart-context";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * Cart page body: items, quantities, per-item notes, total, checkout.
 *
 * It shows THE cart, the same lines the homepage drawer shows (there used to
 * be a second, separate dashboard cart, so this page read empty while the
 * drawer had items). Checkout is the drawer's own flow, opened in place:
 * saved or one-time address, map pin, live coverage, pickup, coupon. The
 * dashboard layout mounts that drawer for customers.
 */
export function CartView() {
  const { t, fmt } = useTranslation();
  const { lines, total, cartBranchId, cartBranchName, setQty, setNote, remove, clear, openCart } = useHomeCart();

  if (lines.length === 0) {
    return (
      <EmptyState
        title={t("orders.cartEmpty")}
        description={t("orders.cartEmptyDesc")}
        action={<ButtonLink href="/customer/branches">{t("orders.viewRestaurants")}</ButtonLink>}
      />
    );
  }

  return (
    <div className="space-y-5" data-testid="cart-view">
      <p className="text-sm text-fg-muted">
        {t("orders.branch")}: <span className="font-semibold text-fg-base">{cartBranchName ?? "—"}</span>
      </p>

      <div className="divide-y divide-border-base rounded-2xl border border-border-base/80 bg-surface-card shadow-card">
        {lines.map((line) => (
          <div key={line.lineId} className="flex flex-wrap items-center gap-4 p-4" data-testid="cart-line">
            {line.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- already a resolved media URL; see UserAvatar
              <img src={line.image} alt={line.name} width={56} height={56} className="size-14 rounded-xl object-cover" />
            ) : (
              <span className="flex size-14 items-center justify-center rounded-xl bg-surface-muted text-2xl">
                {line.emoji ?? "🍛"}
              </span>
            )}
            <div className="min-w-40 flex-1">
              <p className="font-semibold text-fg-base">
                {line.name}
                {line.variant ? <span className="text-fg-muted"> · {line.variant}</span> : null}
              </p>
              <p className="text-sm text-fg-muted">{fmt.money(line.unitPrice)}</p>
            </div>
            <div className="flex items-center rounded-xl border border-border-base">
              <button
                className="px-3 py-1.5 text-fg-muted hover:text-brand-600"
                onClick={() => setQty(line.lineId, line.qty - 1)}
                aria-label={t("catalog.decrease")}
              >
                −
              </button>
              <span className="min-w-8 text-center text-sm font-semibold" data-testid="cart-line-qty">
                {fmt.num(line.qty)}
              </span>
              <button
                className="px-3 py-1.5 text-fg-muted hover:text-brand-600"
                onClick={() => setQty(line.lineId, line.qty + 1)}
                aria-label={t("catalog.increase")}
              >
                +
              </button>
            </div>
            <p className="w-24 text-right font-semibold text-fg-base">{fmt.money(line.unitPrice * line.qty)}</p>
            <button className="text-sm text-red-500 hover:underline" onClick={() => remove(line.lineId)}>
              {t("common.delete")}
            </button>
            <Input
              className="w-full"
              placeholder={t("orders.itemNotePlaceholder")}
              value={line.foodNote ?? ""}
              onChange={(e) => setNote(line.lineId, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border-base/80 bg-surface-card p-5 shadow-card">
        <div>
          <p className="text-sm text-fg-muted">{t("orders.grandTotal")}</p>
          <p className="text-2xl font-bold text-brand-600">{fmt.money(total)}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={clear}>
            {t("orders.clearCart")}
          </Button>
          <Button size="lg" onClick={openCart} data-testid="cart-checkout">
            {t("orders.proceedCheckout")}
          </Button>
        </div>
      </div>

      {cartBranchId != null ? (
        <p className="text-center text-sm text-fg-muted">
          {t("orders.wantMore")}{" "}
          <Link href={`/customer/branches/${cartBranchId}/menu`} className="font-medium text-brand-600 hover:underline">
            {t("orders.backToMenu")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
