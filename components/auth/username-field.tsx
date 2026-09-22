"use client";

import { useEffect, useState, type ChangeEvent } from "react";

import { Field, Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { deriveUsernameBase, randomHandle } from "@/lib/validation/username";

/** Quiet period after the last keystroke before the server is asked. */
const DEBOUNCE_MS = 450;

interface Availability {
  /** The exact username this answer belongs to. */
  value: string;
  available: boolean;
  /** First free numbered variant when `available` is false. */
  suggestion: string | null;
}

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
 * The Username box on the registration form (and, with `checkAvailability`, the
 * super-admin Create New User form) — auto-filled from the customer's
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
  checkAvailability = false,
}: {
  firstName: string;
  lastName: string;
  /** Server/client validation message for `username`, rendered by <Field>. */
  error?: string;
  /**
   * Live "is this taken?" check of whatever is in the box, typed or suggested.
   * Only for surfaces behind the super-admin role: the endpoint it calls takes
   * an arbitrary handle, which a public form must never expose.
   */
  checkAvailability?: boolean;
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
  const [availability, setAvailability] = useState<Availability | null>(null);

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

  const candidate = value.trim();
  useEffect(() => {
    if (!checkAvailability || !candidate) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/auth/users/username-available?username=${encodeURIComponent(candidate)}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (!res.ok) return;
          const data = (await res.json()) as { available?: boolean; suggestion?: string | null };
          setAvailability({ value: candidate, available: Boolean(data.available), suggestion: data.suggestion ?? null });
        } catch {
          // Offline or superseded — the create route re-checks at submit time.
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [candidate, checkAvailability]);

  // Only an answer about the text currently in the box counts; anything older
  // is stale and shows as "checking".
  const known = checkAvailability && candidate && availability?.value === candidate ? availability : null;
  const taken = known && !known.available ? known : null;
  const availabilityChecking = checkAvailability && Boolean(candidate) && !known;

  const hint = known?.available
    ? t("register.usernameAvailable")
    : availabilityChecking
      ? t("register.usernameChecking")
      : dirty
    ? undefined
    : checking
      ? t("register.usernameChecking")
      : suggested
        ? t("register.usernameAutoHint")
        : undefined;

  return (
    <div>
      <Field
        label={t("auth.usernameLabel")}
        required
        hint={hint}
        error={error ?? (taken ? t("register.usernameTaken") : undefined)}
      >
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

      {taken?.suggestion ? (
        <button
          type="button"
          onClick={() => setTyped(taken.suggestion)}
          className="mt-1.5 block text-xs font-medium text-brand-500 transition-colors hover:text-brand-400 hover:underline"
        >
          {t("register.usernameUseSuggested", { username: taken.suggestion })}
        </button>
      ) : null}

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
