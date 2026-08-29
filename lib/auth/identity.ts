import "server-only";
import type { User } from "@prisma/client";

import { normalizeBdPhone } from "@/lib/auth/phone";
import { prisma } from "@/lib/db";

/**
 * THE single place that turns a typed login identifier into one account.
 *
 * Registration mandates an email AND enforces a unique mobile number "as a
 * login identifier" (lib/services/users.assertPhoneAvailable), so all three are
 * legitimate ways in — and Bangladeshi customers overwhelmingly expect the
 * phone one. Every sign-in path (the login server action, the Credentials
 * provider, the password-reset request) calls THIS function so they can never
 * resolve the same input to different accounts.
 *
 * Resolution is ORDERED BY THE SHAPE of the input rather than a single OR
 * query, so a value that is valid under two kinds cannot be hijacked: if
 * someone registers the username "01711111111", a phone-shaped login for that
 * number still resolves to the account that OWNS the number, and only falls
 * through to the username match when no account holds it.
 *
 *   1. Phone-shaped (any written BD form) → User.phone, canonicalized.
 *   2. Contains "@"                       → User.email (stored casing varies).
 *   3. Otherwise / no match above         → User.username.
 *
 * Soft-deleted accounts are excluded: deleteAccountAction anonymizes them and
 * they must never be reachable again.
 */
export async function findUserByIdentifier(identifier: string): Promise<User | null> {
  const value = String(identifier ?? "").trim();
  if (!value) return null;

  const notDeleted = { status: { not: "deleted" } } as const;

  // 1. Mobile number. `normalizeBdPhone` returns "" for anything that is not a
  //    valid BD number, which is essential: User.phone defaults to "" for the
  //    many accounts with none, so a blank lookup would match half the table.
  const phone = normalizeBdPhone(value);
  if (phone) {
    const byPhone = await prisma.user.findFirst({
      where: { ...notDeleted, phone },
      orderBy: { id: "asc" },
    });
    if (byPhone) return byPhone;
  }

  // 2. Email. Registration does not lowercase what it stores, so match both.
  if (value.includes("@")) {
    const byEmail = await prisma.user.findFirst({
      where: { ...notDeleted, OR: [{ email: value }, { email: value.toLowerCase() }] },
      orderBy: { id: "asc" },
    });
    if (byEmail) return byEmail;
  }

  // 3. Username (unique).
  return prisma.user.findFirst({ where: { ...notDeleted, username: value }, orderBy: { id: "asc" } });
}
