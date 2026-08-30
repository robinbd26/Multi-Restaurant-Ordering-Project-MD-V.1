"use client";

import { useEffect, useState, type ChangeEvent } from "react";

import { Field, Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { deriveUsernameBase, randomHandle } from "@/lib/validation/username";

/** Quiet period after the last keystroke before the server is asked. */
const DEBOUNCE_MS = 450;

interface Suggestion {
  /** The exact first/last pair this answer belongs to. */
  key: string;
  /** Server-confirmed free handle, or "" when the lookup did not land. */
  username: string;
}

/** NUL joins the two parts so ("ab","c") and ("a","bc") are different keys. */
function nameKey(first: string, last: string): string {
  return `${first}\u0000${last}`;
}

/**
 * The Username box on the registration form — auto-filled from the customer's
 * first and last name, and still just a text field.
 *
 * Three things it is careful about:
 *
 *  1. DIRTY-FIELD GUARD. The moment the customer edits the box themselves it
 *     stops following the name fields, for good. It is never read-only and
 *     never disabled — the auto-fill is a convenience, not a decision.
 *  2. INSTANT, THEN CONFIRMED. The suggestion is derived on render (see
 *     lib/validation/username) so the box fills on the first keystroke with no
 *     round trip, then a debounced call to the availability endpoint replaces
 *     it with the next free variant ("robin.mondol2"). If that call is
 *     rate-limited, offline or simply slow, the locally derived name stays and
 *     nothing breaks.
 *  3. THE SERVER DECIDES. This is UX only. The register route's own uniqueness
 *     check at submit time is the authority and is untouched; a duplicate that
 *     slips through comes back as a field error under this very box.
 */
export function UsernameField({
  firstName,
  lastName,
  error,
}: {
  firstName: string;
  lastName: string;
  /** Server/client validation message for `username`, rendered by <Field>. */
  error?: string;
}) {
  const { t } = useTranslation();
  /** What the customer typed. `null` while they have never touched the box. */
  const [typed, setTyped] = useState<string | null>(null);
  const [remote, setRemote] = useState<Suggestion | null>(null);
  /**
   * One handle per mounted form, so a name we cannot romanise does not produce
   * a different "userxxxxx" on every keystroke.
   */
  const [fallback] = useState(randomHandle);

  const first = firstName.trim();
  const last = lastName.trim();
  const key = nameKey(first, last);
  const hasName = Boolean(first || last);
  const dirty = typed !== null;

  // Derived state, not stored state: recomputed on render, so there is no
  // effect between a keystroke in "First Name" and a username in this box.
  // An empty derivation means the names carry nothing romanisable — a generated
  // handle is offered rather than a username the server would reject.
  const local = hasName ? deriveUsernameBase(first, last) || fallback : "";
  const confirmed = remote && remote.key === key ? remote.username : "";
  const suggested = confirmed || local;
  const value = dirty ? typed : suggested;
  const checking = hasName && !dirty && remote?.key !== key;

  useEffect(() => {
    if (dirty || !hasName) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/auth/register/username", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ first_name: first, last_name: last }),
            cache: "no-store",
            signal: controller.signal,
          });
          const data = res.ok ? ((await res.json()) as { username?: string | null }) : null;
          setRemote({ key, username: data?.username ?? "" });
        } catch {
          // Offline, rate-limited or superseded. A suggestion is a courtesy on
          // top of a field that already works, so a failed lookup must never
          // become an error the customer has to clear: keep the local name.
          if (!controller.signal.aborted) setRemote({ key, username: "" });
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [first, last, key, dirty, hasName]);

  const hint = dirty
    ? undefined
    : checking
      ? t("register.usernameChecking")
      : suggested
        ? t("register.usernameAutoHint")
        : undefined;

  return (
    <div>
      <Field label={t("auth.usernameLabel")} required hint={hint} error={error}>
        <Input
          name="username"
          required
          aria-invalid={!!error}
          autoComplete="username"
          placeholder="username"
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setTyped(event.target.value)}
        />
      </Field>

      {/* Announced once per settled suggestion rather than on every keystroke —
          a screen-reader user typing their name should not hear a new handle
          per letter. Lives outside the <label> so it is a region of its own. */}
      <span aria-live="polite" className="sr-only">
        {!dirty && confirmed ? t("register.usernameSuggestedIs", { username: confirmed }) : ""}
      </span>

      {/* The way back after a manual edit. Only ever rendered once the customer
          has typed, which cannot happen without JavaScript. */}
      {dirty && suggested && suggested !== typed ? (
        <button
          type="button"
          onClick={() => setTyped(null)}
          className="mt-1.5 text-xs font-medium text-brand-500 transition-colors hover:text-brand-400 hover:underline"
        >
          {t("register.usernameUseSuggested", { username: suggested })}
        </button>
      ) : null}
    </div>
  );
}
