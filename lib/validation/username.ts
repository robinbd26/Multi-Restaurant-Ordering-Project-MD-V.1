/**
 * Username derivation — the rule that turns "Robin Mondol" into "robin.mondol".
 *
 * Lives next to `limits.ts` and follows the same contract: imported by BOTH the
 * browser (components/auth/username-field.tsx, which fills the box the instant
 * the customer types a name — no round trip on a prepaid 3G connection) and the
 * server (app/api/auth/register/username, which is the ONLY authority on
 * whether a suggestion is free). The two sides can therefore never disagree
 * about which base name a pair of names produces.
 *
 * This module is CLIENT-SAFE: pure functions and constants only. No database
 * access, no secrets. Uniqueness is decided server-side; nothing here knows or
 * claims that a username is available.
 */

// ── Shape ───────────────────────────────────────────────────────────────

/**
 * Anything shorter than this is not a recognisable handle ("ab", "s.m"), so a
 * base that ends up this short is discarded in favour of a generated one.
 */
export const USERNAME_MIN = 3;

/** Keeps a suggestion typeable on a phone keyboard and inside DB column sizes. */
export const USERNAME_MAX = 30;

/** Longest slice taken from either name before they are joined with a dot. */
const NAME_PART_MAX = 15;

/**
 * Alphabet for generated handles: 32 characters, unambiguous on a small screen
 * (no l/1/I, no O/0). 256 % 32 === 0, so a random byte maps onto it without
 * modulo bias.
 */
const HANDLE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

// ── Bangla → Latin ──────────────────────────────────────────────────────
//
// BD customers routinely type their name in Bangla script, and "রবিন মন্ডল"
// must not become an empty (or non-ASCII, server-rejected) username. We
// TRANSLITERATE rather than reject: the tables below are the pragmatic
// romanisation Bangladeshis actually write their own names with — ফ → "f"
// (Fatema, not Phatema), ভ → "bh" (Bhuiyan), ড় → "r" — not a strict academic
// scheme. It is a suggestion, so "close and readable" beats "linguistically
// exact"; the customer can always overwrite it.

const BN_CONSONANTS: Record<string, string> = {
  ক: "k", খ: "kh", গ: "g", ঘ: "gh", ঙ: "ng",
  চ: "ch", ছ: "chh", জ: "j", ঝ: "jh", ঞ: "n",
  ট: "t", ঠ: "th", ড: "d", ঢ: "dh", ণ: "n",
  ত: "t", থ: "th", দ: "d", ধ: "dh", ন: "n",
  প: "p", ফ: "f", ব: "b", ভ: "bh", ম: "m",
  য: "j", র: "r", ল: "l", শ: "sh", ষ: "sh", স: "s", হ: "h",
  ড়: "r", ঢ়: "rh", য়: "y", ৎ: "t",
};

const BN_VOWELS: Record<string, string> = {
  অ: "o", আ: "a", ই: "i", ঈ: "i", উ: "u", ঊ: "u",
  ঋ: "ri", এ: "e", ঐ: "oi", ও: "o", ঔ: "ou",
};

/** Dependent vowel signs (kar) — they replace the inherent vowel below. */
const BN_VOWEL_SIGNS: Record<string, string> = {
  "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u",
  "ৃ": "ri", "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou",
};

/** Anusvara / visarga / chandrabindu / hasant / nukta. */
const BN_MARKS: Record<string, string> = {
  "ং": "ng", // ং
  "ঃ": "", // ঃ
  "ঁ": "", // ঁ
  "্": "", // ্ hasant — joins a conjunct, so no inherent vowel follows
  "়": "", // ় nukta (only reached when NFC left it standing)
};

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/**
 * Bangla writes no letter for the "inherent" vowel that follows a consonant: it
 * is pronounced when another consonant follows and dropped at the end of a
 * word. Without that rule মন্ডল would come out "mndl"; with it, "mondol".
 */
function transliterateBangla(input: string): string {
  // NFC composes ড + ় into ড় so the single-codepoint entries above match.
  const chars = Array.from(input.normalize("NFC"));
  let out = "";

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const next = chars[i + 1] ?? "";

    const consonant = BN_CONSONANTS[ch];
    if (consonant !== undefined) {
      out += consonant;
      if (BN_CONSONANTS[next] !== undefined) out += "o";
      continue;
    }
    const sign = BN_VOWEL_SIGNS[ch];
    if (sign !== undefined) {
      out += sign;
      continue;
    }
    const vowel = BN_VOWELS[ch];
    if (vowel !== undefined) {
      out += vowel;
      continue;
    }
    const mark = BN_MARKS[ch];
    if (mark !== undefined) {
      out += mark;
      continue;
    }
    const digit = BN_DIGITS.indexOf(ch);
    if (digit !== -1) {
      out += String(digit);
      continue;
    }
    // Latin, spaces and anything else pass through — slugify() decides.
    out += ch;
  }

  return out;
}

/** One name part → the lowercase a-z0-9 run a username may contain. */
function slugify(part: string): string {
  return transliterateBangla(part)
    // Strips Latin diacritics (José → Jose) so an accented name is kept rather
    // than emptied by the a-z filter below.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * "Robin" + "Mondol" → "robin.mondol"; "রবিন" + "মন্ডল" → the same.
 *
 * Returns "" when the two names carry nothing usable (an emoji, a script we do
 * not transliterate, or a result too short to be a handle). Callers treat "" as
 * "use `randomHandle()` instead" — we never emit a username the server's own
 * checks would reject.
 */
export function deriveUsernameBase(firstName: string, lastName: string): string {
  const first = slugify(firstName).slice(0, NAME_PART_MAX);
  const last = slugify(lastName).slice(0, NAME_PART_MAX);
  const base = [first, last].filter(Boolean).join(".");
  if (base.replace(/\./g, "").length < USERNAME_MIN) return "";
  return trimTail(base.slice(0, USERNAME_MAX));
}

/** "robin.mondol" + 2 → "robin.mondol2", staying inside USERNAME_MAX. */
export function withNumericSuffix(base: string, n: number): string {
  const suffix = String(n);
  return `${trimTail(base.slice(0, USERNAME_MAX - suffix.length))}${suffix}`;
}

/**
 * A safe handle for a name we could not romanise — "user7k3qm".
 *
 * Uses the CSPRNG (never Math.random), the same rule the password suggestion
 * follows: these end up as public identifiers and predictable ones would let a
 * third party guess the handle a given registration is about to receive.
 */
export function randomHandle(prefix = "user"): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += HANDLE_ALPHABET[byte % HANDLE_ALPHABET.length];
  return `${prefix}${out}`;
}

/**
 * The candidates a suggestion may take, best first: the plain base, then
 * "…2".."…9", then three random 3-digit variants so a busy base still resolves
 * in ONE database round trip instead of a probe per number.
 */
export function usernameCandidates(base: string): string[] {
  const list = [base];
  for (let n = 2; n <= 9; n += 1) list.push(withNumericSuffix(base, n));

  const random = new Uint16Array(3);
  crypto.getRandomValues(random);
  for (const value of random) list.push(withNumericSuffix(base, 100 + (value % 900)));

  // A random suffix can repeat one already in the list; the caller picks the
  // first FREE candidate, so duplicates only cost a wasted slot.
  return Array.from(new Set(list));
}

/** Drop the separator a length-cap can leave dangling ("robin." → "robin"). */
function trimTail(value: string): string {
  return value.replace(/\.+$/, "");
}
