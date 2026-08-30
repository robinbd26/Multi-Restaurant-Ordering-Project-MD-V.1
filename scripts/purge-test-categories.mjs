// Remove the auto-generated CATEGORY rows that automated test runs leave behind
// in a long-lived database (they pollute the Branch Manager category filter and
// the product form's category select).
//
// Usage:
//   node scripts/purge-test-categories.mjs            # DRY RUN — prints, deletes nothing
//   node scripts/purge-test-categories.mjs --apply    # actually delete
//   node scripts/purge-test-categories.mjs --apply --yes   # skip the 5s abort window
//
// Rules — this script is deliberately timid:
//   - It matches ONE machine-generated shape and nothing else: a Glob/Global/
//     Other prefix, a millisecond Date.now() timestamp and a numeric suffix,
//     e.g. "Glob-1784554894812-87861". The pattern is anchored at both ends, so
//     a human name ("Rice Meals", "Classic Pizza", "Carbonated Beverages",
//     "Boats") can never match — and a self-check asserts exactly that on every
//     run, before a single row is read.
//   - DRY RUN IS THE DEFAULT. Deleting requires an explicit --apply.
//   - A matching category that STILL HAS PRODUCTS is never deleted. It is
//     reported instead, so a real product is never orphaned and no Order/
//     OrderItem history is touched.
//   - --apply first writes every row it is about to remove to
//     backups/purge-test-categories-<timestamp>.json, so the purge is
//     reversible (see the restore hint printed at the end).
//   - Exits non-zero only when the self-check fails or the delete errors, so it
//     is safe to run from a maintenance task.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BACKUP_DIR = path.join(ROOT, "backups");

/**
 * The ONLY name shape this script will ever delete.
 *   prefix   Glob | Global | Other   (the generators used by the e2e suites)
 *   -\d{12,17}   a Date.now() millisecond stamp (13 digits today; the range
 *                keeps working either side of that without going unbounded)
 *   -\d{1,10}    the random numeric suffix the generators append
 * Anchored with ^...$ so a name that merely CONTAINS such a run — or a human
 * name of any kind — is left alone.
 */
const TEST_CATEGORY_NAME = /^(?:Glob|Global|Other)-\d{12,17}-\d{1,10}$/;

/** Names the pattern MUST delete — the residue reported from the live list. */
const MUST_MATCH = [
  "Glob-1784554894812-87861",
  "Global-1784554889310-18499",
  "Other-1784554894834-94530",
];

/** Names the pattern MUST NEVER touch. Real categories, plus near misses. */
const MUST_NOT_MATCH = [
  "Rice Meals",
  "Classic Pizza",
  "Carbonated Beverages",
  "Rice Bowls",
  "Boats",
  "Signature Pizzas",
  "Global",
  "Globe Trotter",
  "Other",
  "Other Drinks",
  "Global-2024",
  "Glob-1784554894812",
  "Glob-1784554894812-87861-extra",
  "My Glob-1784554894812-87861",
  "গ্লোবাল বার্গার",
];

/** Fail loudly BEFORE reading the database if the pattern ever drifts. */
function selfCheck() {
  const wrong = [
    ...MUST_MATCH.filter((n) => !TEST_CATEGORY_NAME.test(n)).map((n) => `should match: ${n}`),
    ...MUST_NOT_MATCH.filter((n) => TEST_CATEGORY_NAME.test(n)).map((n) => `must NOT match: ${n}`),
  ];
  if (wrong.length) {
    console.error("Pattern self-check FAILED — refusing to touch the database:");
    wrong.forEach((w) => console.error(`  ${w}`));
    process.exit(1);
  }
  console.log(
    `Pattern self-check OK (${MUST_MATCH.length} junk names matched, ${MUST_NOT_MATCH.length} real names spared).`,
  );
}

/** Dhaka wall-clock stamp for the log line; the app's timezone, not the host's. */
function dhakaNow() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date());
}

const scope = (c) => (c.branchId === null ? "Global" : `branch #${c.branchId}`);

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const skipPause = argv.includes("--yes");

  selfCheck();
  console.log(`Mode: ${apply ? "APPLY (rows will be deleted)" : "DRY RUN (nothing is deleted)"}`);
  console.log(`Run at: ${dhakaNow()} (Asia/Dhaka)\n`);

  const prisma = new PrismaClient();
  try {
    // Prisma has no portable regex filter, and the category table is small
    // (tens of rows), so the match is done in JS against the full list. That
    // also keeps the ONE pattern above as the single source of truth.
    const all = await prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { id: "asc" },
    });
    const matched = all.filter((c) => TEST_CATEGORY_NAME.test(c.name));
    const blocked = matched.filter((c) => c._count.products > 0);
    const removable = matched.filter((c) => c._count.products === 0);

    console.log(`Scanned ${all.length} categories; ${matched.length} match the test pattern.\n`);

    if (removable.length) {
      console.log(`Would delete (${removable.length}):`);
      for (const c of removable) console.log(`  #${c.id}  ${c.name}  [${scope(c)}]`);
      console.log("");
    }
    if (blocked.length) {
      console.log(`SKIPPED — still have products attached (${blocked.length}):`);
      for (const c of blocked) {
        console.log(`  #${c.id}  ${c.name}  [${scope(c)}]  products=${c._count.products}`);
      }
      console.log("  Reassign or remove those products first; nothing was changed for them.\n");
    }
    if (!matched.length) {
      console.log("Nothing matches the test pattern — this database is already clean.");
      return;
    }

    if (!apply) {
      console.log("DRY RUN — no rows were deleted. Re-run with --apply to delete them.");
      console.log(`Summary: ${removable.length} deletable, ${blocked.length} blocked, 0 deleted.`);
      return;
    }
    if (!removable.length) {
      console.log("Summary: 0 deletable, nothing to delete.");
      return;
    }

    if (!skipPause) {
      console.log("Deleting in 5s — Ctrl+C to abort.");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Reversible: dump the full rows first, so a mistaken purge can be replayed.
    // Re-read them WITHOUT the aggregate so the file holds persisted columns only.
    const ids = removable.map((c) => c.id);
    const doomed = await prisma.category.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
    await mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(BACKUP_DIR, `purge-test-categories-${stamp}.json`);
    await writeFile(backup, JSON.stringify(doomed, null, 2), "utf8");
    console.log(`Backup written: ${path.relative(ROOT, backup)}`);

    // Re-assert "no products" inside the delete itself, so a product created
    // between the scan and this statement still blocks its category.
    const { count } = await prisma.category.deleteMany({
      where: { id: { in: ids }, products: { none: {} } },
    });

    console.log(`\nSummary: ${count} deleted, ${blocked.length} blocked, ${all.length - count} remaining.`);
    if (count !== removable.length) {
      console.log(
        `Note: ${removable.length - count} category(ies) gained a product mid-run and were left alone.`,
      );
    }
    console.log(
      "Restore hint: re-insert the rows from the backup file with prisma.category.createMany " +
        "(ids are preserved; on PostgreSQL reset the id sequence afterwards).",
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
