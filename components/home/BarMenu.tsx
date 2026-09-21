"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The branch bar's dropdown shell, shared by "Deliver to" and "Browsing".
 *
 * Two controls, one behaviour: the same trigger, the same panel, and the same
 * dismissal rules as the storefront's existing popover (NavSearch) — a mousedown
 * outside or Escape closes it. The rows inside are each control's own business.
 *
 * PHONE — a bottom sheet, not a dropdown. The bar sits below the hero, so by the
 * time a customer taps a trigger the page is usually scrolled, and a panel
 * positioned from the trigger lands wherever the document put it — often off
 * screen. (The first cut used `fixed` with no explicit offset, which resolves to
 * the element's position in the DOCUMENT, not the viewport, and put the
 * "Browsing" list below the fold.) A sheet pinned to the viewport bottom is
 * always reachable, holds a long branch list comfortably, and sits above the
 * storefront's z-40 floating "Order Now" button while staying under the z-60
 * branch-switch dialog and the z-70 toast.
 *
 * DESKTOP (`sm` and up) — an ordinary dropdown hanging off the trigger's end edge.
 */
export function BarMenu({
  icon,
  label,
  value,
  menuLabel,
  testId,
  panelTestId,
  children,
}: {
  icon: string;
  /** The control's name — "Deliver to", "Browsing". */
  label: string;
  /** What is currently in force, as the server resolved it. */
  value: string;
  /** Accessible name for the panel, and the sheet's heading on a phone. */
  menuLabel: string;
  testId: string;
  panelTestId: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative w-full sm:w-auto" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-[0.78rem] font-semibold text-white transition-colors hover:border-brand-500 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none sm:w-auto"
      >
        <span aria-hidden>{icon}</span>
        <span className="shrink-0 text-[#a0a0b0]">{label}</span>
        <span className="min-w-0 flex-1 truncate text-start font-bold sm:max-w-56 sm:flex-none">{value}</span>
        <span aria-hidden className="text-[#70707e]">
          ▾
        </span>
      </button>

      {open ? (
        <>
          {/* Phone-only scrim: the sheet covers the page, so a tap on the page
              behind it has to mean "close". Inside boxRef, so it closes here
              rather than through the outside-mousedown listener. */}
          <div aria-hidden className="fixed inset-0 z-50 bg-black/60 sm:hidden" onClick={close} />
          <div
            role="menu"
            aria-label={menuLabel}
            data-testid={panelTestId}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-y-auto rounded-t-2xl border border-white/12 bg-[#17171d] p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 sm:absolute sm:inset-x-auto sm:bottom-auto sm:end-0 sm:mt-2 sm:max-h-[70vh] sm:w-80 sm:rounded-xl sm:p-1.5"
          >
            <div aria-hidden className="mx-auto mt-1 mb-2 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
            <p className="px-2.5 pb-1 text-sm font-bold text-white sm:hidden">{menuLabel}</p>
            {children(close)}
          </div>
        </>
      ) : null}
    </div>
  );
}

export const menuRowClass =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[0.8rem] text-white transition-colors hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none";

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pt-3 pb-1 text-[0.68rem] font-bold tracking-wider text-[#70707e] uppercase">
      {children}
    </p>
  );
}

/** One choice in a single-choice list; menuitemradio says so to assistive tech. */
export function RadioRow({
  checked,
  disabled,
  onSelect,
  testId,
  title,
  subtitle,
  trailing,
  current,
}: {
  checked: boolean;
  /** The row that is ACTIVE on screen right now, even when it was not picked
      explicitly (e.g. the branch "My nearest branch" resolved to). Draws a
      highlight and a check so the open menu always shows where you are. */
  current?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  testId: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-current={current ? "true" : undefined}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
      className={`${menuRowClass} min-h-11 disabled:cursor-not-allowed disabled:opacity-45 ${
        current ? "bg-white/8" : ""
      }`}
    >
      <span
        aria-hidden
        className={`h-2.5 w-2.5 shrink-0 rounded-full border ${
          checked ? "border-brand-500 bg-brand-500" : "border-white/25"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[0.72rem] text-[#8a8a98]">{subtitle}</span>
        ) : null}
      </span>
      {trailing}
      {current ? (
        <span aria-hidden data-testid={`${testId}-current`} className="shrink-0 text-[0.9rem] font-bold text-brand-500">
          ✓
        </span>
      ) : null}
    </button>
  );
}
