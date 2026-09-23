@AGENTS.md

# Project notes

Multi-restaurant ordering app: Next.js (webpack) + Prisma + SQLite, Auth.js. E2E tests are Playwright in `tests/e2e`.

- Two developers on separate machines (Ash, Robin), each on their own branch, merged to `main` through PRs.
- Each machine has its own local `prisma/dev.db` with different data, on purpose. Never assume your data looks like theirs.
- **Never `git push` and never open PRs.** The developer does that. Committing locally is fine.
- Env vars are documented in `.env.example`. `.env` and `.env.local` are gitignored; setup copies the example to both.
- E2E runs against `prisma/test.db`, never `dev.db`: `npm run test:e2e:prepare` then `npm run test:e2e` (needs a prior `npm run build`).

# Working rules

1. **One commit per concern.** The message explains why, not just what. If a fix restores something an earlier commit broke, say so and name that commit.
2. **Migrations must be safe on anyone's data.** A migration that makes a column NOT NULL or adds a constraint (unique, FK) must backfill or repair existing rows inside the migration itself. Never assume clean data (Branch.zoneId crashed on Robin's NULL rows). Test every migration on a scratch copy of the DB (copy `dev.db`, point `DATABASE_URL` at it) before touching the real one.
3. **Windows: `prisma generate` fails while the dev server holds the query engine file.** Stop the dev server first, run generate, and tell the developer you stopped it so they restart it.
4. **Deleting or moving something: search for every reference first** (imports, links, nav menus, sidebar entries, tests, i18n keys in `messages/`). A removed route or component that is still referenced silently breaks navigation.
5. **Verify before saying done.** Run `npx tsc --noEmit`, `npx eslint <touched files>`, and `npm run build` when routes or navigation change. State exactly what you ran and what passed. Say what you did not run.
6. **Side effects:** if a change breaks something else and it is directly caused by that change, fix it and report it clearly. Do not silently fix unrelated things; list them for the developer instead.
7. **Env vars:** never hardcode keys or secrets. Any new env var goes into `.env.example` (name only, plus a one-line comment) in the same commit. Secret API keys are server-side only; only `NEXT_PUBLIC_*` values reach the browser, so never put a secret in one.
8. **End every task with a short report:** what changed, what you verified, and loose ends for the developer (restart the server, add a key to Robin's `.env.local`, run a migration on the other machine).
