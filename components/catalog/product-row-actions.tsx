"use client";

// Aliased: the outside-click handler below listens for the DOM MouseEvent, so
// React's synthetic one must not shadow it.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/layout/icons";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import {
  deleteProductAction,
  setProductHoldAction,
  toggleProductAction,
} from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** Which confirmation is currently open. `null` = none. */
type Dialog = "hold" | "availability" | "delete" | null;

export interface ProductRowActionsProps {
  productId: number;
  productName: string;
  branchName: string;
  isAvailable: boolean;
  heldByAdmin: boolean;
  /** Base path of the owning section, e.g. "/admin/products". */
  basePath: string;
  /** Hold/resume is super-admin-only; soft delete is SA + own-branch manager. */
  canHold?: boolean;
  canDelete?: boolean;
  /**
   * `"menu"` (default) keeps the compact pop-up used by the long Super Admin
   * product table. `"inline"` renders the same actions as always-visible
   * buttons — the Branch Manager catalogue needs Edit/Delete reachable with no
   * extra click and no scrolling, on a phone as much as on a laptop.
   */
  layout?: "menu" | "inline";
}

/**
 * The one action set for a product row — View, Edit, Hold/Resume,
 * Activate/Deactivate, Delete — in either a pop-up menu or an inline bar.
 *
 * The destructive items open a confirmation dialog that names the product and
 * says plainly what the operation does (a "delete" here is a SOFT delete, and
 * the copy says so). Dialog state lives HERE rather than inside each modal,
 * because the menu unmounts on the click that chooses an item and would take an
 * uncontrolled dialog's overlay down with it. State is reset on every exit —
 * success, failure or cancel — so a later row can never inherit it. The inline
 * layout keeps that same lifted state so both layouts behave identically.
 *
 * Every button is only a shortcut: the API re-authorizes each call server-side,
 * so hiding or showing one never decides what a role may actually do.
 */
export function ProductRowActions({
  productId,
  productName,
  branchName,
  isAvailable,
  heldByAdmin,
  basePath,
  canHold = false,
  canDelete = false,
  layout = "menu",
}: ProductRowActionsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * The control focus returns to when a dialog closes. In the menu layout that
   * is always the one trigger; inline it is whichever button was pressed, so it
   * is captured at click time rather than bound to a single element.
   */
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  /** Every dialog closes through here, so focus and state always reset together. */
  const closeDialog = () => {
    setDialog(null);
    triggerRef.current?.focus();
  };

  const itemClass =
    "flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-fg-base hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
  const dangerClass =
    "flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-red-400 dark:hover:bg-red-500/10";

  const choose = (next: Dialog) => {
    setMenuOpen(false);
    setDialog(next);
  };

  /** Inline layout: remember the pressed button, then open its confirmation. */
  const openFrom = (event: ReactMouseEvent<HTMLButtonElement>, next: Dialog) => {
    triggerRef.current = event.currentTarget;
    setDialog(next);
  };

  // ── Inline layout ─────────────────────────────────────────────────────
  // Pill buttons, 40px tall on a phone (comfortable thumb target) and 36px from
  // md up so a dense table row does not grow. They wrap instead of pushing the
  // table wider, which is what forced the horizontal scroll people complained
  // about. Labels are always visible except on View, which is the one action
  // the row's own link already duplicates.
  const inlineBase =
    "inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:min-h-9";
  const inlineNeutral = cn(
    inlineBase,
    "bg-surface-card text-fg-base ring-border-base hover:bg-surface-hover",
  );
  const inlineDanger = cn(
    inlineBase,
    "text-red-600 ring-red-200 hover:bg-red-50 dark:text-red-400 dark:ring-red-500/30 dark:hover:bg-red-500/10",
  );

  return (
    <div ref={rootRef} className={layout === "inline" ? "flex min-w-0" : "relative inline-flex"}>
      {layout === "inline" ? (
        <div
          role="group"
          aria-label={t("catalog.actionsFor", { name: productName })}
          data-testid={`product-actions-${productId}`}
          className="flex flex-wrap items-center justify-end gap-1.5"
        >
          <Link
            href={`${basePath}/${productId}`}
            aria-label={t("common.view")}
            title={t("common.view")}
            className={cn(inlineNeutral, "px-2")}
            data-testid={`product-view-${productId}`}
          >
            <Icon name="eye" className="size-4" />
          </Link>
          <Link
            href={`${basePath}/${productId}/edit`}
            className={inlineNeutral}
            data-testid={`product-edit-${productId}`}
          >
            <Icon name="edit" className="size-3.5" />
            {t("common.edit")}
          </Link>
          <button
            type="button"
            className={isAvailable ? inlineDanger : inlineNeutral}
            data-testid={`product-availability-${productId}`}
            onClick={(event) => openFrom(event, "availability")}
          >
            <Icon name={isAvailable ? "x" : "check"} className="size-3.5" />
            {isAvailable ? t("catalog.deactivate") : t("catalog.activate")}
          </button>
          {canHold ? (
            <button
              type="button"
              className={heldByAdmin ? inlineNeutral : inlineDanger}
              data-testid={`product-hold-${productId}`}
              onClick={(event) => openFrom(event, "hold")}
            >
              <Icon name="lock" className="size-3.5" />
              {heldByAdmin ? t("adminExtras.releaseHold") : t("adminExtras.hold")}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className={inlineDanger}
              data-testid={`product-delete-${productId}`}
              onClick={(event) => openFrom(event, "delete")}
            >
              <Icon name="trash" className="size-3.5" />
              {t("common.delete")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <button
            ref={triggerRef}
            type="button"
            aria-label={t("catalog.actionsFor", { name: productName })}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            data-testid={`product-actions-${productId}`}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex size-9 items-center justify-center rounded-xl text-fg-muted hover:bg-surface-hover hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Icon name="list" className="size-4.5" />
          </button>

          {menuOpen ? (
            <div className="absolute right-0 top-10 z-30 min-w-48 overflow-hidden rounded-xl border border-border-base bg-surface-card p-1.5 shadow-xl">
              <Link
                href={`${basePath}/${productId}`}
                className={itemClass}
                data-testid={`product-view-${productId}`}
                onClick={() => setMenuOpen(false)}
              >
                {t("common.view")}
              </Link>
              <Link
                href={`${basePath}/${productId}/edit`}
                className={itemClass}
                data-testid={`product-edit-${productId}`}
                onClick={() => setMenuOpen(false)}
              >
                {t("common.edit")}
              </Link>
              <button
                type="button"
                className={isAvailable ? dangerClass : itemClass}
                data-testid={`product-availability-${productId}`}
                onClick={() => choose("availability")}
              >
                {isAvailable ? t("catalog.deactivate") : t("catalog.activate")}
              </button>
              {canHold ? (
                <button
                  type="button"
                  className={heldByAdmin ? itemClass : dangerClass}
                  data-testid={`product-hold-${productId}`}
                  onClick={() => choose("hold")}
                >
                  {heldByAdmin ? t("adminExtras.releaseHold") : t("adminExtras.hold")}
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  className={cn(dangerClass, "border-t border-border-base")}
                  data-testid={`product-delete-${productId}`}
                  onClick={() => choose("delete")}
                >
                  {t("common.delete")}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {/* Deactivate requires a reason (it is shown to the branch); reactivating
          does not, so the textarea is only offered on the way down. */}
      <ConfirmModal
        open={dialog === "availability"}
        onOpenChange={(next) => (next ? setDialog("availability") : closeDialog())}
        title={isAvailable ? t("catalog.deactivateProductTitle") : t("catalog.activateProductTitle")}
        description={
          isAvailable
            ? t("catalog.deactivateProductConfirm", { name: productName, branch: branchName })
            : t("catalog.activateProductConfirm", { name: productName, branch: branchName })
        }
        confirmLabel={isAvailable ? t("catalog.deactivate") : t("catalog.activate")}
        withReason={isAvailable}
        reasonPlaceholder={t("catalog.deactivationReasonPlaceholder")}
        action={async (reason) => toggleProductAction(productId, reason)}
        onDone={() => router.refresh()}
      />

      <ConfirmModal
        open={dialog === "hold"}
        onOpenChange={(next) => (next ? setDialog("hold") : closeDialog())}
        title={heldByAdmin ? t("catalog.resumeProductTitle") : t("catalog.holdProductTitle")}
        description={
          heldByAdmin
            ? t("catalog.resumeProductConfirm", { name: productName })
            : t("catalog.holdProductConfirm", { name: productName })
        }
        confirmLabel={heldByAdmin ? t("adminExtras.releaseHold") : t("adminExtras.hold")}
        action={async () => setProductHoldAction(productId, !heldByAdmin)}
        onDone={() => router.refresh()}
      />

      <ConfirmModal
        open={dialog === "delete"}
        onOpenChange={(next) => (next ? setDialog("delete") : closeDialog())}
        title={t("catalog.deleteProductTitle")}
        // States explicitly that this is a SOFT delete and that order history
        // survives — the modal must describe the operation it performs.
        description={t("catalog.deleteProductConfirm", { name: productName, branch: branchName })}
        confirmLabel={t("catalog.confirmDelete")}
        action={async () => deleteProductAction(productId)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
