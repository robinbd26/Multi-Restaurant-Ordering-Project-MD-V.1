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
  permanentlyDeleteProductAction,
  restoreProductAction,
  setProductHoldAction,
  toggleProductAction,
} from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/**
 * Which confirmation is currently open. `null` = none. "delete" is the soft
 * delete, shown as Archive; "purge" is the permanent delete.
 */
type Dialog = "hold" | "availability" | "delete" | "restore" | "purge" | null;

/** /api/products/[id]/removal-check, for the permanent-delete dialog. */
interface PurgeCheck {
  order_lines: number;
  reviews: number;
  deletable: boolean;
}

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
   * The row is ARCHIVED (soft-deleted). It then offers only View, Restore and
   * Delete permanently; editing, availability and hold wait for a restore.
   */
  isArchived?: boolean;
  /** Restore an archived product (super admin). */
  canRestore?: boolean;
  /** Delete a never-ordered, never-reviewed product for good (super admin). */
  canPermanentDelete?: boolean;
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
  isArchived = false,
  canRestore = false,
  canPermanentDelete = false,
  layout = "menu",
}: ProductRowActionsProps) {
  const { t, fmt } = useTranslation();
  const [purgeCheck, setPurgeCheck] = useState<PurgeCheck | null>(null);
  const [purgeCheckFailed, setPurgeCheckFailed] = useState(false);

  /** Ask the server whether this product was ever ordered or reviewed. */
  function loadPurgeCheck() {
    setPurgeCheck(null);
    setPurgeCheckFailed(false);
    fetch(`/api/products/${productId}/removal-check`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setPurgeCheck((await res.json()) as PurgeCheck);
      })
      .catch(() => setPurgeCheckFailed(true));
  }
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
    if (next === "purge") loadPurgeCheck();
    setDialog(next);
  };

  /** Inline layout: remember the pressed button, then open its confirmation. */
  const openFrom = (event: ReactMouseEvent<HTMLButtonElement>, next: Dialog) => {
    triggerRef.current = event.currentTarget;
    if (next === "purge") loadPurgeCheck();
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
          {isArchived ? null : (
            <>
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
            </>
          )}
          {canHold && !isArchived ? (
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
          {canDelete && !isArchived ? (
            <button
              type="button"
              className={inlineDanger}
              data-testid={`product-delete-${productId}`}
              onClick={(event) => openFrom(event, "delete")}
            >
              <Icon name="trash" className="size-3.5" />
              {t("productRemoval.archive")}
            </button>
          ) : null}
          {canRestore && isArchived ? (
            <button
              type="button"
              className={inlineNeutral}
              data-testid={`product-restore-${productId}`}
              onClick={(event) => openFrom(event, "restore")}
            >
              <Icon name="check" className="size-3.5" />
              {t("productRemoval.restore")}
            </button>
          ) : null}
          {canPermanentDelete ? (
            <button
              type="button"
              className={inlineDanger}
              data-testid={`product-purge-${productId}`}
              onClick={(event) => openFrom(event, "purge")}
            >
              <Icon name="trash" className="size-3.5" />
              {t("productRemoval.deletePermanently")}
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
              {isArchived ? null : (
                <>
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
                </>
              )}
              {canHold && !isArchived ? (
                <button
                  type="button"
                  className={heldByAdmin ? itemClass : dangerClass}
                  data-testid={`product-hold-${productId}`}
                  onClick={() => choose("hold")}
                >
                  {heldByAdmin ? t("adminExtras.releaseHold") : t("adminExtras.hold")}
                </button>
              ) : null}
              {canRestore && isArchived ? (
                <button
                  type="button"
                  className={itemClass}
                  data-testid={`product-restore-${productId}`}
                  onClick={() => choose("restore")}
                >
                  {t("productRemoval.restore")}
                </button>
              ) : null}
              {canDelete && !isArchived ? (
                <button
                  type="button"
                  className={cn(dangerClass, "border-t border-border-base")}
                  data-testid={`product-delete-${productId}`}
                  onClick={() => choose("delete")}
                >
                  {t("productRemoval.archive")}
                </button>
              ) : null}
              {canPermanentDelete ? (
                <button
                  type="button"
                  className={dangerClass}
                  data-testid={`product-purge-${productId}`}
                  onClick={() => choose("purge")}
                >
                  {t("productRemoval.deletePermanently")}
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
        title={t("productRemoval.archiveTitle")}
        // The soft delete is the product's ARCHIVE: says what happens, that
        // orders keep it, and that it can be restored.
        description={t("productRemoval.archiveConfirm", { name: productName, branch: branchName })}
        confirmLabel={t("productRemoval.confirmArchive")}
        action={async () => deleteProductAction(productId)}
        onDone={() => router.refresh()}
      />

      <ConfirmModal
        open={dialog === "restore"}
        onOpenChange={(next) => (next ? setDialog("restore") : closeDialog())}
        title={t("productRemoval.restoreTitle")}
        description={t("productRemoval.restoreConfirm", { name: productName })}
        confirmLabel={t("productRemoval.confirmRestore")}
        action={async () => restoreProductAction(productId)}
        onDone={() => router.refresh()}
      />

      <ConfirmModal
        open={dialog === "purge"}
        onOpenChange={(next) => (next ? setDialog("purge") : closeDialog())}
        title={t("productRemoval.deleteTitle", { name: productName })}
        description={t("productRemoval.deleteDesc")}
        details={
          purgeCheckFailed ? (
            <p className="text-sm text-red-600" role="alert">
              {t("productRemoval.checkFailed")}
            </p>
          ) : !purgeCheck ? (
            <p className="text-sm text-fg-muted">{t("productRemoval.checking")}</p>
          ) : purgeCheck.deletable ? (
            <p className="text-sm text-fg-base" data-testid="product-purge-ok">
              {t("productRemoval.deletable")}
            </p>
          ) : (
            <p
              className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
              data-testid="product-purge-blocked"
            >
              {t("productRemoval.blocked", {
                orders: fmt.num(purgeCheck.order_lines),
                reviews: fmt.num(purgeCheck.reviews),
              })}
            </p>
          )
        }
        confirmDisabled={!purgeCheck?.deletable}
        confirmLabel={t("productRemoval.confirmDelete")}
        action={async () => permanentlyDeleteProductAction(productId)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
