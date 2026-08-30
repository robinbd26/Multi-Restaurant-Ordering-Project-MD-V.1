import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Direct access to the ISOLATED E2E database (prisma/test.db — see
 * playwright.config.ts) for the password-reset spec ONLY. Deliberately NOT
 * re-exported from helpers/index.ts so the Prisma client is loaded solely by
 * the spec that needs it.
 *
 * WHY the spec needs database access at all: the suite runs the PRODUCTION
 * build (`npm run start`), and in production the app — correctly — never
 * discloses a reset link anywhere a client can read it. The raw token goes out
 * by SMS only, the server persists nothing but its SHA-256, and the
 * non-production `demoLink` convenience is compiled out of the build entirely
 * (`lib/auth/password-reset.ts` gates it on NODE_ENV, which `next build`
 * inlines). So the only way a test can HOLD the secret is to mint one exactly
 * the way `requestPasswordReset` does — 32 CSPRNG bytes, hex-encoded, with
 * ONLY the SHA-256 digest written to the database — and then drive the real
 * /forgot-password/reset UI with it. Everything under test (the confirm
 * boundary, single-use semantics, password policy) is the app's own code.
 */

const prisma = new PrismaClient({
  // Absolute path; matches E2E_DATABASE_URL in playwright.config.ts. SQLite
  // supports a second process fine — one writer at a time, short writes.
  datasourceUrl: `file:${path
    .join(process.cwd(), "prisma", "test.db")
    .replace(/\\/g, "/")}?connection_limit=1&socket_timeout=30&pool_timeout=60`,
});

/** SHA-256 hex digest — must stay identical to lib/auth/tokens.ts hashToken. */
function hashToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

async function userIdOf(username: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error(`E2E: seeded user "${username}" not found in prisma/test.db`);
  return user.id;
}

/**
 * Mint a live reset token for `username`, exactly as the server does: the RAW
 * token is returned to the caller (playing the SMS recipient) and only its
 * SHA-256 is stored. `ttlMinutes` mirrors RESET_TOKEN_TTL_MINUTES by default.
 */
export async function mintResetToken(username: string, ttlMinutes = 30): Promise<string> {
  const userId = await userIdOf(username);
  const token = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
      requestedIp: "e2e",
    },
  });
  return token;
}

/** All reset-token rows for `username`, newest first — for asserting server truth. */
export async function resetTokenRows(username: string) {
  const userId = await userIdOf(username);
  return prisma.passwordResetToken.findMany({
    where: { userId },
    orderBy: { id: "desc" },
    select: { id: true, tokenHash: true, usedAt: true, expiresAt: true },
  });
}

/**
 * Restore a seeded account to a known password and retire every outstanding
 * reset token — the spec's afterAll safety net, so a mid-test failure can
 * never leave the shared "customer" login broken for the rest of the suite.
 */
export async function restoreUserPassword(username: string, password: string): Promise<void> {
  const userId = await userIdOf(username);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(password, 10) },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
}

/** Close the spec's own database connection (afterAll). */
export async function disconnectResetDb(): Promise<void> {
  await prisma.$disconnect();
}
