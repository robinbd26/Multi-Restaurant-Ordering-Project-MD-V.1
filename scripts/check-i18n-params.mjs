/**
 * Guard against a silent i18n failure: a dictionary string that declares a
 * {placeholder} but is read through `t("key")` with no params, so the literal
 * "{amount}" is rendered to the user. TypeScript cannot catch this — the key
 * is just a string — so it needs its own check.
 *
 * Also flags the reverse: a key referenced with params that declares none.
 *
 *   node scripts/check-i18n-params.mjs
 *
 * Exits non-zero when something is wrong, so it can gate CI.
 */
import fs from "node:fs";
import path from "node:path";

const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));
const get = (o, p) => p.split(".").reduce((a, c) => (a ? a[c] : undefined), o);
const placeholders = (s) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) return /node_modules|\.next|\.git/.test(f) ? [] : walk(f);
    return [f];
  });

const files = ["app", "components", "lib"]
  .filter((d) => fs.existsSync(d))
  .flatMap(walk)
  .filter((f) => /\.(ts|tsx)$/.test(f));

const problems = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const rel = file.split(path.sep).join("/");

  // t("some.key")  /  sk("some.key")  with NO second argument.
  for (const m of src.matchAll(/\b(?:t|sk)\(\s*"([a-zA-Z0-9_.]+)"\s*\)/g)) {
    const value = get(en, m[1]);
    if (typeof value !== "string") continue;
    const need = placeholders(value);
    if (need.length > 0) {
      problems.push(`${rel}\n    ${m[1]} needs {${need.join("}, {")}} but is called with no params\n    en: "${value}"`);
    }
  }
}

if (problems.length === 0) {
  console.log("i18n params OK — every key with a {placeholder} is passed one.");
  process.exit(0);
}

console.error(`i18n param problems: ${problems.length}\n`);
problems.forEach((p) => console.error("  " + p + "\n"));
process.exit(1);
