"use client";

import { accentForeground } from "@/lib/brands/shared";
import type { Category, CategoryKey } from "@/lib/home/types";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

export function CategoryTabs({
  categories,
  accent,
  active,
  onChange,
}: {
  categories: Category[];
  /** The active brand's accent colour (Brand.accentColor). */
  accent: string;
  active: CategoryKey | "all";
  onChange: (key: CategoryKey | "all") => void;
}) {
  const { t } = useTranslation();
  const activeStyle = { borderColor: accent, background: accent, color: accentForeground(accent) };

  const tabs: { key: CategoryKey | "all"; label: string; emoji: string }[] = [
    { key: "all", label: t("home.categoryTabs.all"), emoji: "🍽️" },
    // `c.label` is the category's name straight from the database. It used to be
    // a t() lookup against a fixed key set, which would print a raw key for any
    // category an admin creates.
    ...categories.map((c) => ({ key: c.key, label: c.label, emoji: c.emoji })),
  ];

  return (
    // Wraps onto as many lines as it needs: a horizontal scroller hid the
    // categories past the edge, and customers never saw them.
    <div className="flex flex-wrap gap-1.5 sm:gap-2" data-testid="category-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          aria-pressed={active === tab.key}
          className={cn(
            "flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-[0.78rem] font-semibold transition-colors sm:gap-1.5 sm:px-3.5 sm:text-[0.82rem]",
            active === tab.key
              ? ""
              : "border-white/10 bg-transparent text-white/60 hover:border-white/25 hover:text-white",
          )}
          style={active === tab.key ? activeStyle : undefined}
        >
          <span>{tab.emoji}</span>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
