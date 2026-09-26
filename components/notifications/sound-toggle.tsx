"use client";

import { useEffect } from "react";

import { Icon } from "@/components/layout/icons";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { installSoundUnlock, playSound, setSoundMuted, useSoundMuted } from "@/lib/sound";

/**
 * The app-wide sound switch (lib/sound). Three looks for three places:
 *
 *  - "icon": a round button in the topbar next to the bell (sm and up);
 *  - "menu": a row in the profile menu, where it lives on phones, because the
 *    topbar has no room for another button at 360 px;
 *  - "labelled": a pill with text, for a page that wants a visible switch
 *    (the branch manager's order list).
 *
 * Mounting it also arms the "first tap unlocks audio" listener (idempotent;
 * the bell arms it too, so it never depends on a menu being open).
 */
export function SoundToggle({ variant = "icon" }: { variant?: "icon" | "menu" | "labelled" }) {
  const { t } = useTranslation();
  const muted = useSoundMuted();

  useEffect(() => {
    installSoundUnlock();
  }, []);

  function toggle() {
    setSoundMuted(!muted);
    // Turning sound on plays a sample, which doubles as the audio unlock.
    if (muted) playSound("notification");
  }

  const label = muted ? t("sound.turnOn") : t("sound.turnOff");
  const icon = <Icon name={muted ? "volume-off" : "volume"} className={variant === "menu" ? "size-4" : "size-4.5"} />;

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={!muted}
        data-testid="sound-toggle-menu"
        className="flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-sm text-fg-base hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset"
      >
        {icon}
        {muted ? t("sound.off") : t("sound.on")}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!muted}
      aria-label={label}
      title={label}
      data-testid="sound-toggle"
      className={
        variant === "labelled"
          ? cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium",
              muted ? "bg-surface-muted text-fg-muted" : "bg-emerald-50 text-emerald-700",
            )
          : "flex size-11 items-center justify-center rounded-full border border-border-base bg-surface-muted text-fg-muted transition hover:bg-surface-hover hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      }
    >
      {icon}
      {variant === "labelled" ? <span>{muted ? t("sound.off") : t("sound.on")}</span> : null}
    </button>
  );
}
