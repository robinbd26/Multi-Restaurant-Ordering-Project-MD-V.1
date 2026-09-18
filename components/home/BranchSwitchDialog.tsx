"use client";

import { useRouter } from "next/navigation";

import { useHomeCart } from "@/components/home/home-cart-context";
import { updateBrowseScope } from "@/lib/browse-scope/client";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * Confirmation shown whenever the cart's one branch would otherwise stop
 * matching what the page is actually doing — two ways that can happen:
 *
 *   "add"    — adding a product refused because the cart already belongs to a
 *              different branch.
 *   "browse" — the customer switched which branch they are browsing (the
 *              picker, or a Restaurants page card) while the cart still holds
 *              a different branch's items — item 1: the checkout coverage
 *              check reads the cart's branch, so left alone this is exactly
 *              the "browsing says X but checkout still says Y" bug.
 *
 * Same two outcomes either way, just what "cancel" undoes differs: for "add"
 * it simply drops the blocked item; for "browse" it un-does the SWITCH (points
 * browsing back at the branch the cart already belongs to), because there is
 * no third option that leaves the header and the cart telling different
 * stories again.
 *
 * Styled for the storefront's dark palette; the dashboard `ConfirmModal` is a
 * light-theme component and would look foreign here.
 */
export function BranchSwitchDialog() {
  const { pendingBranchSwitch, cartBranchId, confirmBranchSwitch, cancelBranchSwitch } = useHomeCart();
  const { t } = useTranslation();
  const router = useRouter();

  if (!pendingBranchSwitch) return null;
  const { kind, currentBranchName, nextBranchName, input } = pendingBranchSwitch;

  function handleCancel() {
    if (kind === "browse" && cartBranchId != null) {
      // Nothing was cleared, so point browsing back at the branch the cart is
      // actually locked to — the one invariant this dialog exists to keep true.
      updateBrowseScope({ branchId: cartBranchId });
      router.refresh();
    }
    cancelBranchSwitch();
  }

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4"
      data-testid="branch-switch-dialog"
      data-switch-kind={kind}
    >
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={handleCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-switch-title"
        className="relative w-full max-w-md rounded-[16px] border border-white/10 bg-[#16161E] p-5 shadow-2xl"
      >
        <h2 id="branch-switch-title" className="font-display text-[1.15rem] font-extrabold text-white">
          {kind === "add" ? t("cartBranch.switchTitle") : t("cartBranch.browseSwitchTitle", { next: nextBranchName })}
        </h2>
        <p className="mt-2 text-[0.88rem] leading-6 text-[#a0a0b0]">
          {kind === "add"
            ? t("cartBranch.switchBody", {
                current: currentBranchName,
                next: nextBranchName,
                product: input?.name ?? "",
              })
            : t("cartBranch.browseSwitchBody", { current: currentBranchName, next: nextBranchName })}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleCancel}
            data-testid="branch-switch-cancel"
            className="rounded-[10px] border border-white/12 px-4 py-2.5 text-sm font-semibold text-white hover:border-white/30"
          >
            {kind === "add" ? t("common.cancel") : t("cartBranch.keepCurrentBranch", { current: currentBranchName })}
          </button>
          <button
            type="button"
            onClick={confirmBranchSwitch}
            data-testid="branch-switch-confirm"
            className="rounded-[10px] bg-brand-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-600"
          >
            {t("cartBranch.clearAndSwitch")}
          </button>
        </div>
      </div>
    </div>
  );
}
