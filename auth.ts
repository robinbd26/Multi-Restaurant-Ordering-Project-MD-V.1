import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { authConfig } from "@/auth.config";
import { findUserByIdentifier } from "@/lib/auth/identity";
import { verifyOtp } from "@/lib/auth/otp";
import { prisma } from "@/lib/db";
import type { Role, UserStatus } from "@/types";
import type { User } from "@prisma/client";

/**
 * Full Node-runtime Auth.js instance (Prisma + bcrypt). A provider's
 * `authorize` only *succeeds* for an active, approved user; every other case
 * returns null. The login server action performs a richer pre-check to surface
 * pending/rejected reasons (see lib/auth/actions).
 */

/** The session shape both providers return — built once so they cannot drift. */
function sessionUser(user: User, remember: boolean) {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  return {
    id: String(user.id),
    username: user.username,
    email: user.email,
    name: fullName || user.username,
    image: user.profilePhoto ?? null,
    role: user.role as Role,
    status: user.status as UserStatus,
    remember,
  };
}

/** Login history is recorded for every role (PDF requirement), never fatally. */
async function recordLogin(userId: number): Promise<void> {
  await prisma.loginHistory.create({ data: { userId } }).catch(() => {});
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { username: {}, password: {}, remember: {} },
      async authorize(credentials) {
        // The field is still named `username` for compatibility with every
        // existing signIn() call site, but it accepts ANY login identifier:
        // username, email, or a BD mobile number in any written form. The
        // resolution lives in lib/auth/identity so the server action and this
        // provider can never disagree about which account an input names.
        const identifier = String(credentials?.username ?? "").trim();
        const password = String(credentials?.password ?? "");
        const remember = String(credentials?.remember ?? "") === "1";
        if (!identifier || !password) return null;

        const user = await findUserByIdentifier(identifier);
        if (!user || !user.isActive) return null;
        if (user.status !== "approved") return null;

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return null;

        await recordLogin(user.id);
        return sessionUser(user, remember);
      },
    }),

    /**
     * Sign-in by SMS one-time code. A separate provider id keeps the
     * password path above completely untouched: `signIn("otp", …)` is the only
     * way in here, and it never sees or needs a password.
     *
     * The code is verified AND consumed inside `verifyOtp`, so a replay of the
     * same credentials fails at this line rather than minting a second session.
     */
    Credentials({
      id: "otp",
      name: "otp",
      credentials: { phone: {}, code: {}, remember: {} },
      async authorize(credentials) {
        const phone = String(credentials?.phone ?? "").trim();
        const code = String(credentials?.code ?? "").trim();
        const remember = String(credentials?.remember ?? "") === "1";
        if (!phone || !code) return null;

        const result = await verifyOtp(phone, code);
        if (result.status !== "ok" || !result.userId) return null;

        // Re-read the account rather than trusting the challenge: it may have
        // been deactivated or unapproved in the five minutes since the code
        // was sent.
        const user = await prisma.user.findUnique({ where: { id: result.userId } });
        if (!user || !user.isActive || user.status !== "approved") return null;

        await recordLogin(user.id);
        return sessionUser(user, remember);
      },
    }),
  ],
});
