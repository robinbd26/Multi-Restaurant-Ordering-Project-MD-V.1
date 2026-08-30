"use client";

import { useState } from "react";

import { useHydrated } from "@/components/auth/use-hydrated";
import { Icon } from "@/components/layout/icons";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { LIMITS } from "@/lib/validation/limits";

// Ambiguous glyphs are left out on purpose (no l/1/I, no O/0): a suggested
// password gets read off a phone screen and retyped on a laptop more often than
// anyone likes to admit.
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*?-_";

/** Well above LIMITS.passwordMin — the minimum is a floor, not a target. */
const SUGGESTED_LENGTH = 16;

/**
 * Uniform index in [0, max) from the CSPRNG. Rejection-sampled rather than a
 * plain `% max`, which would quietly favour the first few characters of the
 * alphabet — and never Math.random(), which is not a source of secrets.
 */
function randomIndex(max: number): number {
  const range = 0x100000000;
  const ceiling = range - (range % max);
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= ceiling);
  return value % max;
}

function pick(alphabet: string): string {
  return alphabet[randomIndex(alphabet.length)];
}

/** A password that clears the app's policy and a password manager's own checks. */
export function generatePassword(): string {
  const pool = LOWER + UPPER + DIGITS + SYMBOLS;
  // One character of each class up front, so the result can never be all digits
  // — the case validatePassword rejects — nor accidentally single-class.
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  const length = Math.max(SUGGESTED_LENGTH, LIMITS.passwordMin);
  while (chars.length < length) chars.push(pick(pool));

  // Fisher-Yates with the same CSPRNG: unshuffled, every suggestion would start
  // lower-upper-digit-symbol, which is a pattern anyone reading this file knows.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * Rough strength band, 1 (weak) to 4 (strong). Advisory only — the boundary is
 * still `passwordRule` on the client and `validatePassword` on the server, and
 * anything that fails those is pinned to 1 however long it is.
 */
export function passwordStrength(value: string): 1 | 2 | 3 | 4 {
  if (value.length < LIMITS.passwordMin || /^\d+$/.test(value)) return 1;

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  let score = 1;
  if (value.length >= 12) score += 1;
  if (classes >= 3) score += 1;
  if (classes >= 4 && value.length >= 12) score += 1;
  return Math.min(4, score) as 1 | 2 | 3 | 4;
}

const STRENGTH_TONES = ["bg-red-500", "bg-amber-500", "bg-lime-500", "bg-emerald-500"];
const STRENGTH_LABELS = [
  "register.passwordWeak",
  "register.passwordFair",
  "register.passwordGood",
  "register.passwordStrong",
];

/**
 * Four-segment strength bar. Rendered INSIDE the password <Field>, so every
 * element is phrasing content (<span>, never <div>) — a <div> inside the
 * <label> that Field wraps around its control is invalid markup.
 */
export function PasswordStrengthMeter({ value }: { value: string }) {
  const { t } = useTranslation();
  if (!value) return null;

  const score = passwordStrength(value);
  return (
    <span className="mt-2 block">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((segment) => (
          <span
            key={segment}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              segment < score ? STRENGTH_TONES[score - 1] : "bg-border-base",
            )}
          />
        ))}
      </span>
      {/* The bar is decorative; this line is what a screen reader reads. */}
      <span className="mt-1 block text-xs text-fg-subtle">{t(STRENGTH_LABELS[score - 1])}</span>
    </span>
  );
}

const ICON_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-base " +
  "bg-surface-card text-fg-subtle transition-colors hover:text-fg-muted " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 cursor-pointer";

/**
 * "Suggest a strong password" — one tap generates one AND writes it into both
 * password boxes (that is what `onAccept` does, in register-form).
 *
 * The generated password is then shown in the clear with a reveal toggle and a
 * copy button, because a password the customer never sees is a password they
 * cannot save. Nothing here is a form control: the values live in the real
 * password inputs, which keep their `autoComplete="new-password"` so a password
 * manager still offers to store what was typed.
 */
export function PasswordSuggestion({ onAccept }: { onAccept: (password: string) => void }) {
  const { t } = useTranslation();
  const hydrated = useHydrated();
  const [suggested, setSuggested] = useState("");
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // GRACEFUL DEGRADATION: without JavaScript this button could not fill
  // anything, and a control that silently does nothing is worse than no
  // control — the form falls back to the two plain password fields it has
  // always had, with every validation and error path unchanged.
  if (!hydrated) return null;

  function suggest() {
    const password = generatePassword();
    setSuggested(password);
    setRevealed(true);
    setCopied(false);
    setCopyFailed(false);
    onAccept(password);
  }

  async function copy() {
    if (!suggested) return;
    try {
      await navigator.clipboard.writeText(suggested);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // The Clipboard API is missing on http:// origins and older Android
      // browsers — a real case here. Say so and leave the text selectable
      // rather than pretending the copy worked.
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <div className="rounded-2xl border border-border-base bg-surface-muted p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={suggest}>
          <Icon name="bolt" className="size-4" />
          {suggested ? t("register.suggestAnotherPassword") : t("register.suggestPassword")}
        </Button>
        {suggested ? null : (
          <span className="text-xs text-fg-subtle">{t("register.suggestPasswordHint")}</span>
        )}
      </div>

      {suggested ? (
        <div className="mt-3 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-card px-3 py-2 font-mono text-sm text-fg-base ring-1 ring-border-base select-all">
            {revealed ? suggested : "•".repeat(suggested.length)}
          </code>
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? t("common.hidePassword") : t("common.showPassword")}
            aria-pressed={revealed}
            className={ICON_BUTTON}
          >
            <Icon name={revealed ? "eye-off" : "eye"} />
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={t("register.copyPassword")}
            className={ICON_BUTTON}
          >
            <Icon name={copied ? "check" : "clipboard-check"} />
          </button>
        </div>
      ) : null}

      {suggested ? (
        <p className="mt-2 text-xs text-fg-subtle" aria-live="polite">
          {copyFailed
            ? t("register.passwordCopyFailed")
            : copied
              ? t("register.passwordCopied")
              : t("register.passwordFilled")}
        </p>
      ) : null}
    </div>
  );
}
