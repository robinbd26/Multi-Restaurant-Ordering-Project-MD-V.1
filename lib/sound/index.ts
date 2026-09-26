"use client";

import { useSyncExternalStore } from "react";

/**
 * The app's ONE notification-sound system (browser only).
 *
 * Every surface that wants to make a noise goes through here: the topbar bell
 * (any new notification — new order, status change, assignment, payment,
 * chat), the branch manager's new-order alert, the rider's assignment offer,
 * and an open order chat. Before this, the bell was silent and two surfaces
 * each built their own AudioContext.
 *
 * - Tones are synthesized with WebAudio: nothing to download on a prepaid 3G
 *   connection, and no asset to cache-bust.
 * - Browsers only let a page make sound after the person has interacted with
 *   it. `installSoundUnlock()` (mounted once, from the topbar's SoundToggle)
 *   creates/resumes the shared AudioContext on the first tap or key press
 *   anywhere, so no surface needs its own "enable sound" button.
 * - `announce(event, sound, { link, source })` plays at most once per event
 *   per tab. The bell and a live surface (the rider's assignment modal, the
 *   manager's order list) can hear about the same thing seconds apart, so each
 *   also passes the record's link: whichever sounds first wins, and the other
 *   stays quiet for a short while. Two different notifications about the same
 *   order both sound (the bell keys on the notification id).
 * - One mute switch for the whole app, remembered per browser.
 */

export type SoundName = "message" | "notification" | "order" | "alert";

/** [frequency Hz, start offset s, duration s] */
type Note = readonly [number, number, number];

const SOUNDS: Record<SoundName, { notes: readonly Note[]; gain: number }> = {
  // A soft two-note blip: someone wrote in a chat you are looking at.
  message: { notes: [[660, 0, 0.09], [880, 0.1, 0.12]], gain: 0.12 },
  // A single chime: something new in your notifications.
  notification: { notes: [[740, 0, 0.18]], gain: 0.15 },
  // Three rising notes: a new order for the branch.
  order: { notes: [[660, 0, 0.12], [880, 0.14, 0.12], [1100, 0.28, 0.2]], gain: 0.22 },
  // Insistent two-tone: a delivery offer waiting for the rider's answer.
  alert: { notes: [[880, 0, 0.16], [660, 0.18, 0.16], [880, 0.36, 0.24]], gain: 0.25 },
};

const MUTE_KEY = "mad_sound_muted";
/** How long an announced event is remembered (per tab). */
const ANNOUNCE_MEMORY_MS = 10 * 60 * 1000;
/** The bell and a live surface sounding for the same link this close together = one event. */
const SAME_LINK_WINDOW_MS = 90 * 1000;

let ctx: AudioContext | null = null;
let unlockInstalled = false;
let mutedFallback = false; // used when localStorage is unavailable
const announcedEvents = new Map<string, number>();
const lastByLink = new Map<string, { bell?: number; surface?: number }>();
const muteListeners = new Set<() => void>();

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Create/resume the shared AudioContext on the first user gesture. Idempotent;
 * safe to call from every mount.
 */
export function installSoundUnlock(): void {
  if (typeof window === "undefined" || unlockInstalled) return;
  unlockInstalled = true;
  const unlock = () => {
    const c = audioContext();
    if (c && c.state !== "running") void c.resume().catch(() => {});
    if (c?.state === "running") {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    }
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

/** Play a sound now, unless muted. Never throws: sound is a nicety, not a signal of record. */
export function playSound(name: SoundName): void {
  if (isSoundMuted()) return;
  const c = audioContext();
  if (!c) return;
  try {
    // Succeeds once the page has had a gesture; before that it is a quiet no-op.
    if (c.state !== "running") void c.resume().catch(() => {});
    const { notes, gain } = SOUNDS[name];
    const now = c.currentTime;
    for (const [freq, at, dur] of notes) {
      const osc = c.createOscillator();
      const amp = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Short attack/release so notes do not click.
      amp.gain.setValueAtTime(0.0001, now + at);
      amp.gain.exponentialRampToValueAtTime(gain, now + at + 0.015);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      osc.connect(amp).connect(c.destination);
      osc.start(now + at);
      osc.stop(now + at + dur + 0.02);
    }
  } catch {
    /* audio unavailable — the visual cue carries it */
  }
}

export interface AnnounceOptions {
  /** The in-app link of the record this is about (the notification's link). */
  link?: string;
  /** "bell" for the notification bell, "surface" for everything else. */
  source?: "bell" | "surface";
}

/**
 * Play `name` for `event` (a key unique to that event), once per tab. When a
 * `link` is given and the OTHER source sounded for the same link within the
 * last 90 s, this stays quiet: it is the same news heard twice. Returns true if
 * this was the first call for `event`.
 */
export function announce(event: string, name: SoundName, options: AnnounceOptions = {}): boolean {
  const now = Date.now();
  for (const [k, at] of announcedEvents) if (now - at > ANNOUNCE_MEMORY_MS) announcedEvents.delete(k);
  if (announcedEvents.has(event)) return false;
  announcedEvents.set(event, now);

  if (options.link) {
    const source = options.source ?? "surface";
    const seen = lastByLink.get(options.link) ?? {};
    const other = source === "bell" ? seen.surface : seen.bell;
    lastByLink.set(options.link, { ...seen, [source]: now });
    if (other !== undefined && now - other < SAME_LINK_WINDOW_MS) return true;
  }
  playSound(name);
  return true;
}

// ── Mute switch ─────────────────────────────────────────────────────────

export function isSoundMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return mutedFallback; // storage unavailable (private mode): this tab only
  }
}

export function setSoundMuted(muted: boolean): void {
  mutedFallback = muted;
  try {
    if (muted) window.localStorage.setItem(MUTE_KEY, "1");
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    /* not persisted; the toggle still reflects the click below */
  }
  for (const fn of muteListeners) fn();
}

function subscribeMute(fn: () => void): () => void {
  muteListeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === MUTE_KEY) fn();
  };
  window.addEventListener("storage", onStorage); // another tab flipped it
  return () => {
    muteListeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** The mute switch as React state (server render: not muted). */
export function useSoundMuted(): boolean {
  return useSyncExternalStore(subscribeMute, isSoundMuted, () => false);
}

/**
 * Which sound a notification makes, from its category and link: chat blips,
 * an order at the branch rings the order tone, anything about a rider's
 * delivery rings the insistent one, the rest chime.
 */
export function soundForNotification(type: string | null | undefined, link: string | null | undefined): SoundName {
  if (type === "chat") return "message";
  const path = link ?? "";
  if (path.startsWith("/branch-manager/orders/") && type === "order") return "order";
  if (path.startsWith("/rider/orders/") && (type === "order" || type === "delivery")) return "alert";
  return "notification";
}
