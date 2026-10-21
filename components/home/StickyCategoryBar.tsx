"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import { accentForeground } from "@/lib/brands/shared";
import type { CategoryKey } from "@/lib/home/types";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** Height of the bar itself; the scroll offset below adds it to the sticky stack. */
export const CATEGORY_BAR_HEIGHT = 44;

export interface BarCategory {
  key: CategoryKey;
  label: string;
  emoji: string;
  count: number;
}

/** The sticky stack above the content: site header + brand tabs (+ this bar). */
function stackHeight(tabs: HTMLElement | null, withBar: boolean): number {
  if (!tabs) return 0;
  const top = parseFloat(getComputedStyle(tabs).top) || 0; // the header's height
  return top + tabs.offsetHeight + (withBar ? CATEGORY_BAR_HEIGHT : 0);
}

function smoothBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Scroll so the element's top sits just below the sticky stack. */
export function scrollToElement(el: Element, tabs: HTMLElement | null) {
  const y = el.getBoundingClientRect().top + window.scrollY - stackHeight(tabs, true) - 8;
  window.scrollTo({ top: Math.max(0, y), behavior: smoothBehavior() });
}

/**
 * Slim one-line category bar that appears under the sticky brand tabs once the
 * wrapped chip block has scrolled out of view. Zero layout height (the sticky
 * wrapper is h-0 and the bar slides over the content), so showing and hiding it
 * never moves the page. Scrollspy highlights the category in view and keeps its
 * chip visible; "All categories" opens the full list (bottom sheet on phones).
 */
export function StickyCategoryBar({
  categories,
  accent,
  anchorRef,
  tabsRef,
  onSelect,
  onSelectAll,
}: {
  categories: BarCategory[];
  accent: string;
  /** The wrapped chip block: the bar shows once this is above the sticky stack. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The sticky brand tab bar this bar hangs under. */
  tabsRef: RefObject<HTMLElement | null>;
  onSelect: (key: CategoryKey) => void;
  onSelectAll: () => void;
}) {
  const { t, fmt } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [tabsH, setTabsH] = useState(0);
  const [spy, setSpy] = useState<CategoryKey | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [open, setOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());

  const measureEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Direction-agnostic: scrollLeft is negative in RTL, the chips here are LTR.
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  // Visibility + scrollspy, from one rAF-throttled scroll listener.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const tabs = tabsRef.current;
      setTabsH(tabs?.offsetHeight ?? 0);
      const stack = stackHeight(tabs, false);
      const anchor = anchorRef.current;
      const past = anchor ? anchor.getBoundingClientRect().bottom < stack : false;
      setVisible(past);

      const line = stackHeight(tabs, true) + 24;
      let current: CategoryKey | null = null;
      document.querySelectorAll<HTMLElement>("#menu-section [data-cat-key]").forEach((node) => {
        if (node.getBoundingClientRect().top <= line) current = node.dataset.catKey ?? current;
      });
      setSpy(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [anchorRef, tabsRef, categories]);

  // Keep the highlighted chip in view inside the bar (never scrolls the page).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const chip = spy ? chipRefs.current.get(spy) : null;
    if (!scroller || !chip || !visible) return;
    const target = chip.offsetLeft - (scroller.clientWidth - chip.offsetWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, target), behavior: smoothBehavior() });
  }, [spy, visible]);

  // A new brand brings a new chip list: start it from the left again.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ left: 0 });
    measureEdges();
  }, [categories, measureEdges]);

  useEffect(() => {
    measureEdges();
    window.addEventListener("resize", measureEdges);
    return () => window.removeEventListener("resize", measureEdges);
  }, [measureEdges, visible]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Closing the sheet when the bar hides keeps a stray overlay from lingering.
  const sheetOpen = open && visible;
  const activeStyle = { borderColor: accent, background: accent, color: accentForeground(accent) };
  const nudge = (dir: -1 | 1) =>
    scrollerRef.current?.scrollBy({ left: dir * 240, behavior: smoothBehavior() });

  return (
    // h-0 wrapper: sticks under the header, takes no space in the flow.
    <div className="sticky top-14 z-30 h-0 md:top-18" data-testid="category-bar-anchor">
      <div
        className={cn(
          "absolute inset-x-0 border-b border-white/10 bg-[#111115]/95 backdrop-blur transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
          visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
        )}
        style={{ top: tabsH, height: CATEGORY_BAR_HEIGHT }}
        aria-hidden={!visible}
        inert={!visible || undefined}
        data-testid="category-bar"
        data-visible={visible}
      >
        <div className="mx-auto flex h-full max-w-300 items-center gap-2 px-4">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={sheetOpen}
            aria-label={t("home.menu.allCategories")}
            data-testid="category-bar-all"
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 text-sm text-white hover:bg-white/10"
          >
            ☰
          </button>

          <div className="relative min-w-0 flex-1">
            <div
              ref={scrollerRef}
              onScroll={measureEdges}
              className="scrollbar-none flex items-center gap-1.5 overflow-x-auto overflow-y-hidden py-1.5"
            >
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  ref={(node) => {
                    if (node) chipRefs.current.set(c.key, node);
                    else chipRefs.current.delete(c.key);
                  }}
                  onClick={() => onSelect(c.key)}
                  aria-current={spy === c.key ? "true" : undefined}
                  className={cn(
                    "flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-[0.78rem] font-semibold transition-colors",
                    spy === c.key
                      ? ""
                      : "border-white/10 bg-transparent text-white/60 hover:border-white/25 hover:text-white",
                  )}
                  style={spy === c.key ? activeStyle : undefined}
                >
                  <span>{c.emoji}</span>
                  {c.label}
                </button>
              ))}
            </div>
            {/* Edge fades, only on the side that has more to show. */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r from-[#111115] to-transparent transition-opacity",
                edges.left ? "opacity-100" : "opacity-0",
              )}
            />
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-[#111115] to-transparent transition-opacity",
                edges.right ? "opacity-100" : "opacity-0",
              )}
            />
          </div>

          {/* Desktop arrows, only while there is more to scroll to. */}
          <div className="hidden shrink-0 items-center gap-1 md:flex">
            <button
              type="button"
              onClick={() => nudge(-1)}
              disabled={!edges.left}
              aria-label={t("home.menu.scrollCategoriesLeft")}
              className="flex size-7 cursor-pointer items-center justify-center rounded-full border border-white/15 text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              data-testid="category-bar-left"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => nudge(1)}
              disabled={!edges.right}
              aria-label={t("home.menu.scrollCategoriesRight")}
              className="flex size-7 cursor-pointer items-center justify-center rounded-full border border-white/15 text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              data-testid="category-bar-right"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {sheetOpen ? (
        <>
          <button
            type="button"
            aria-label={t("home.modal.close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-pointer bg-black/60 md:bg-transparent"
          />
          <div
            role="dialog"
            aria-label={t("home.menu.allCategories")}
            data-testid="category-sheet"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-[20px] border border-white/10 bg-[#16161E] p-3 pb-24 shadow-2xl md:absolute md:inset-x-auto md:bottom-auto md:left-[max(1rem,calc(50%-600px+1rem))] md:top-(--sheet-top) md:w-80 md:rounded-2xl md:p-2 md:pb-2"
            style={{ "--sheet-top": `${tabsH + CATEGORY_BAR_HEIGHT}px` } as CSSProperties}
          >
            <div className="mb-2 flex justify-center md:hidden">
              <span className="h-1 w-10 rounded-full bg-white/20" />
            </div>
            <ul className="flex flex-col">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSelectAll();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[0.88rem] font-semibold text-white hover:bg-white/8"
                >
                  <span>🍽️</span>
                  <span className="flex-1">{t("home.categoryTabs.all")}</span>
                </button>
              </li>
              {categories.map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onSelect(c.key);
                    }}
                    aria-current={spy === c.key ? "true" : undefined}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[0.88rem] font-semibold hover:bg-white/8",
                      spy === c.key ? "text-white" : "text-white/75",
                    )}
                  >
                    <span>{c.emoji}</span>
                    <span className="flex-1">{c.label}</span>
                    <span className="text-[0.72rem] font-medium text-[#606070]">{fmt.num(c.count)}</span>
                    {spy === c.key ? <span style={{ color: accent }}>●</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
