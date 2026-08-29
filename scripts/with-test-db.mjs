/**
 * Cross-platform env wrapper for the isolated E2E SQLite database.
 * Usage: node scripts/with-test-db.mjs [--seed] <command> [args...]
 *
 * Windows shells do not understand `VAR=value cmd`, so npm scripts that
 * previously used that Unix form failed before Prisma could migrate/seed.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const seedMode = args[0] === "--seed";
if (seedMode) args.shift();

const command = args[0];
const commandArgs = args.slice(1);
if (!command) {
  console.error("Usage: node scripts/with-test-db.mjs [--seed] <command> [args...]");
  process.exit(1);
}

const dbFile = path.join(process.cwd(), "prisma", "test.db");
const databaseUrl = seedMode
  ? `file:${dbFile}?connection_limit=1&socket_timeout=60&pool_timeout=60`
  : `file:${dbFile}`;

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
