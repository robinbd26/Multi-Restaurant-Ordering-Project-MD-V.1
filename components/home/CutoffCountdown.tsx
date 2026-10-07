"use client";

import { useEffect, useState } from "react";

import { useHomeCart } from "@/components/home/home-cart-context";
import { brandName } from "@/lib/brands/shared";
import { useTranslation } from "@/lib/i18n/use-translation";

const TONES = {
  red: { bg: "#ef4444", fg: "#fff", glow: "rgba(239,68,68,0.45)", ring: "rgba(239,68,68,0.25)" },
  amber: { bg: "#f59e0b", fg: "#111", glow: "rgba(245,158,11,0.45)", ring: "rgba(245,158,11,0.25)" },
  green: { bg: "#16a34a", fg: "#fff", glow: "rgba(22,163,74,0.40)", ring: "rgba(22,163,74,0.20)" },
} as const;

/** A brand's last delivery order, computed on the server from its schedule. */
export interface Cutoff {
  slug: string;
  /** The absolute instant of the last order (ISO). */
  deadline: string;
  /** That instant on the Asia/Dhaka clock, "HH:MM". */
  time: string;
}

/** Only count down the final stretch; earlier it is just noise. */
const SHOW_WITHIN_MS = 2 * 60 * 60 * 1000;

/**
 * Live last-order countdown (bottom-right). The deadlines come from the
 * server: each live brand's delivery slot running now, per its own schedule
 * (lib/hours/availability), on the Asia/Dhaka clock. The browser only counts
 * down to those absolute instants, so the visitor's own clock or timezone
 * cannot move a deadline. Shows the soonest one within two hours.
 * Green >1h, amber <1h, red <30m.
 */
export function CutoffCountdown({ cutoffs }: { cutoffs: Cutoff[] }) {
  const { t, fmt, locale } = useTranslation();
  const { brandInfo } = useHomeCart();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const boot = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(boot);
      clearInterval(timer);
    };
  }, []);

  if (now == null) return null;
  const next = cutoffs
    .map((c) => ({ ...c, left: new Date(c.deadline).getTime() - now }))
    .filter((c) => c.left > 0 && c.left <= SHOW_WITHIN_MS)
    .sort((a, b) => a.left - b.left)[0];
  if (!next) return null;
  const info = brandInfo(next.slug);

  const left = Math.floor(next.left / 1000);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const display = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const tone = TONES[left < 1800 ? "red" : left < 3600 ? "amber" : "green"];

  return (
    <div
      data-testid="cutoff-countdown"
      className="animate-fade-slide-in fixed bottom-22 right-4 z-40 flex min-w-42 select-none flex-col items-start gap-0.5 rounded-2xl px-4 pb-2.5 pt-2.75 md:bottom-4"
      style={{ background: tone.bg, color: tone.fg, boxShadow: `0 6px 28px ${tone.glow}, 0 0 0 1px ${tone.ring}` }}
    >
      <p className="mb-0.5 text-[0.6rem] font-extrabold uppercase tracking-widest opacity-80">
        {info?.emoji ?? "🛵"} {t("home.countdown.brandLastOrder", { brand: info ? brandName(info, locale) : next.slug })}
      </p>
      <p className="font-display text-[2rem] font-black leading-none" style={{ letterSpacing: "1px" }}>
        {display}
      </p>
      <p className="mt-0.5 text-[0.6rem] opacity-75">{t("home.countdown.orderBefore", { time: fmt.clock(next.time) })}</p>
    </div>
  );
}
