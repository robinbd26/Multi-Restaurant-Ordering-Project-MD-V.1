/**
 * Saved-address NICKNAMES — Home, Office, or a name the customer types.
 *
 * Stored canonically so the database never holds a translated word: "Home" and
 * "Office" as-is, and a custom name as label "Others" + custom_label (the shape
 * serializeAddress already reads). The screen shows বাসা / অফিস in Bangla.
 *
 * Addresses saved before this existed hold whatever was typed — including the
 * Bangla words themselves — so reading maps those back onto the three choices
 * instead of leaving them stranded as "custom".
 *
 * Isomorphic and dependency-free: both the address book and the checkout drawer
 * use it, so the two forms cannot drift apart on what a nickname means.
 */

export type NicknameKind = "home" | "office" | "custom";

export const NICKNAME_KINDS: readonly NicknameKind[] = ["home", "office", "custom"];

const HOME_WORDS = new Set(["home", "বাসা"]);
const OFFICE_WORDS = new Set(["office", "অফিস"]);

/** Read a stored label back into the form's three-way choice. */
export function nicknameFromLabel(
  label: string | null | undefined,
  customLabel?: string | null,
): { kind: NicknameKind; custom: string } {
  const value = (label ?? "").trim();
  const key = value.toLowerCase();
  if (HOME_WORDS.has(key)) return { kind: "home", custom: "" };
  if (OFFICE_WORDS.has(key)) return { kind: "office", custom: "" };
  if (value === "Others") return { kind: "custom", custom: (customLabel ?? "").trim() };
  return { kind: "custom", custom: value };
}

/** The canonical label to store for a choice. */
export function labelForNickname(kind: NicknameKind): string {
  return kind === "home" ? "Home" : kind === "office" ? "Office" : "Others";
}

/**
 * What to show for a stored address, given a translator. Home/Office are
 * localized; anything custom is shown exactly as the customer wrote it.
 */
export function nicknameDisplay(
  address: { label: string; custom_label?: string | null; display_label?: string | null },
  t: (key: string) => string,
): string {
  const { kind, custom } = nicknameFromLabel(address.label, address.custom_label);
  if (kind === "home") return t("addresses.nicknameHome");
  if (kind === "office") return t("addresses.nicknameOffice");
  return custom || address.display_label || address.label;
}
