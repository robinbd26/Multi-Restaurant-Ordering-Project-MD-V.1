"use client";

import { useEffect } from "react";

import { Icon } from "@/components/layout/icons";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { installSoundUnlock, playSound, setSoundMuted, useSoundMuted } from "@/lib/sound";

/**
 * The app-wide sound switch (lib/sound), next to the bell. Mounting it also
 * arms the "first tap unlocks audio" listener, so every sound in the app works
 * after the person's first interaction without a separate enable button.
 *
 * `labelled` renders the text too, for a surface that wants a visible button
 * (the branch manager's order list) rather than a topbar icon.
 */
export function SoundToggle({ labelled = false, className }: { labelled?: boolean; className?: string }) {
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
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!muted}
      aria-label={label}
      title={label}
      data-testid="sound-toggle"
      className={cn(
        labelled
          ? cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium",
              muted ? "bg-surface-muted text-fg-muted" : "bg-emerald-50 text-emerald-700",
            )
          : "flex size-11 items-center justify-center rounded-full border border-border-base bg-surface-muted text-fg-muted transition hover:bg-surface-hover hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        className,
      )}
    >
      <Icon name={muted ? "volume-off" : "volume"} className="size-4.5" />
      {labelled ? <span>{muted ? t("sound.off") : t("sound.on")}</span> : null}
    </button>
  );
}
