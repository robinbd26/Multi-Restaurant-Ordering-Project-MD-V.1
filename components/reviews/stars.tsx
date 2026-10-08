"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/** Read-only stars: filled up to `value` (rounded to the nearest half star). */
export function Stars({ value, className, size = "text-sm" }: { value: number; className?: string; size?: string }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className={cn("inline-flex items-center gap-0.5 leading-none", size, className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = rounded >= i ? 1 : rounded >= i - 0.5 ? 0.5 : 0;
        return (
          <span key={i} className="relative inline-block text-slate-300 dark:text-white/20">
            ★
            {fill > 0 ? (
              <span className="absolute inset-0 overflow-hidden text-[#F5A623]" style={{ width: fill === 1 ? "100%" : "50%" }}>
                ★
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** A 1..5 star picker, keyboard operable (radio group semantics). */
export function StarInput({
  value,
  onChange,
  label,
  labels,
  testId = "star-input",
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  /** Spoken / shown name per star count, e.g. ["Poor", …, "Excellent"]. */
  labels: string[];
  testId?: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3" data-testid={testId}>
      <div role="radiogroup" aria-label={label} className="flex items-center" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={labels[i - 1] ?? String(i)}
            onClick={() => onChange(i)}
            onMouseEnter={() => setHover(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                e.preventDefault();
                onChange(Math.min(5, (value || 0) + 1));
              } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                e.preventDefault();
                onChange(Math.max(1, (value || 2) - 1));
              }
            }}
            className={cn(
              "flex size-10 items-center justify-center text-[1.6rem] leading-none transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-brand-500",
              i <= shown ? "text-[#F5A623]" : "text-slate-300 dark:text-white/20",
            )}
            data-testid={`${testId}-${i}`}
          >
            ★
          </button>
        ))}
      </div>
      {shown ? <span className="text-sm font-medium text-fg-muted">{labels[shown - 1]}</span> : null}
    </div>
  );
}
