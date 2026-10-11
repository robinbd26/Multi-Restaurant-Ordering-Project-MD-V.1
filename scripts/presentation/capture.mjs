// Presentation screenshots for the client.
//
//   1. npm run build && npm start            (a PRODUCTION server: no dev badges)
//   2. node scripts/presentation/capture.mjs [--only role,role] [--base http://localhost:3000]
//
// Logs in as the demo accounts (npm run seed:real data), waits for maps, images
// and data, and writes docs/presentation/screenshots/<role>/NN-name.png plus
// docs/presentation/screenshots/manifest.md. Bangla UI unless a shot says "en".
//
// The order journey (role "journey") PLACES A REAL ORDER at Uttara and walks it
// through every status, so run it only on demo data.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = argValue("--base", "http://localhost:3000");
const ONLY = (argValue("--only", "") || "").split(",").filter(Boolean);
const OUT = path.resolve(process.cwd(), argValue("--out", "docs/presentation/screenshots"));
const PASSWORD = "Admin12345@##";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// ── helpers ──────────────────────────────────────────────────────────────
async function session(browser, username, { viewport = DESKTOP, locale = "bn", mobile = false } = {}) {
  const context = await browser.newContext({
    viewport,
    baseURL: BASE,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    // Riders and customers are asked for their location; a fixed point near Uttara.
    geolocation: { latitude: 23.8735, longitude: 90.3965 },
    permissions: ["geolocation"],
    timezoneId: "Asia/Dhaka",
  });
  await context.addCookies([{ name: "mad_locale", value: locale, url: BASE }]);
  if (username) {
    const req = context.request;
    const { csrfToken } = await (await req.get("/api/auth/csrf")).json();
    const res = await req.post("/api/auth/callback/credentials", {
      form: { csrfToken, username, password: PASSWORD, callbackUrl: "/", redirect: "false" },
      maxRedirects: 0,
    });
    if (res.status() >= 400) throw new Error(`login failed for ${username}: ${res.status()}`);
  }
  const page = await context.newPage();
  // Never let a stray dialog block the run.
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  return { context, page };
}

/** Wait until the page is really done: network, images, map tiles, spinners. */
async function settle(page, extra = 600) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const imgs = [...document.images].filter((i) => i.getBoundingClientRect().height > 0 && i.loading !== "lazy");
        const imagesDone = imgs.every((i) => i.complete);
        const tiles = [...document.querySelectorAll(".leaflet-tile")];
        const tilesDone = tiles.every((t) => t.classList.contains("leaflet-tile-loaded"));
        const spinning = document.querySelector('[role="progressbar"], .animate-spin');
        return imagesDone && tilesDone && !spinning;
      },
      null,
      { timeout: 20_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(extra);
}

/** Problems that must never appear in a client screenshot. */
async function assertClean(page, label) {
  const text = await page.locator("body").innerText().catch(() => "");
  const bad = [
    /Unhandled Runtime Error/i,
    /Application error/i,
    /BARIKOI_API_KEY|AUTH_SECRET|VAPID_PRIVATE_KEY|DATABASE_URL/,
    /\b[a-z]+(\.[a-zA-Z0-9]+){2,}\b(?=\s|$)/, // a raw i18n key such as home.menu.title
  ];
  for (const re of bad) {
    const m = text.match(re);
    if (m && !/@example\.com|\.webp|\.png|www\./.test(m[0])) {
      console.warn(`  ⚠ ${label}: suspicious text "${m[0]}"`);
    }
  }
  const dev = await page.locator("nextjs-portal, [data-nextjs-toast]").count();
  if (dev) console.warn(`  ⚠ ${label}: Next.js dev overlay present`);
}

const manifest = [];
const counters = new Map();

async function shot(page, role, name, description, { full = false, clip = null, settleMs } = {}) {
  await settle(page, settleMs);
  const n = (counters.get(role) ?? 0) + 1;
  counters.set(role, n);
  const file = `${String(n).padStart(2, "0")}-${name}.png`;
  const dir = path.join(OUT, role);
  await mkdir(dir, { recursive: true });
  await assertClean(page, `${role}/${file}`);
  await page.screenshot({ path: path.join(dir, file), fullPage: full, ...(clip ? { clip } : {}) });
  manifest.push({ role, file, description });
  console.log(`  ✔ ${role}/${file}`);
}

async function go(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

/** Scroll an element into the middle of the viewport. */
async function center(page, locator) {
  await locator.first().scrollIntoViewIfNeeded();
  await locator.first().evaluate((el) => el.scrollIntoView({ block: "center" }));
}

// ── scenes ───────────────────────────────────────────────────────────────
const scenes = {};

const modules = ["admin.mjs", "staff.mjs", "customer.mjs", "journey.mjs"];
for (const m of modules) {
  const mod = await import(new URL(`./scenes/${m}`, import.meta.url));
  Object.assign(scenes, mod.default);
}

const browser = await chromium.launch();
try {
  for (const [role, run] of Object.entries(scenes)) {
    if (ONLY.length && !ONLY.includes(role)) continue;
    console.log(`▶ ${role}`);
    counters.set(role, 0);
    await run(browser, { session, shot, go, settle, center, DESKTOP, MOBILE });
  }
} finally {
  await browser.close();
}

// Manifest: merge with what an earlier partial run (--only) already listed.
const manifestPath = path.join(OUT, "manifest.json");
let previous = [];
try {
  previous = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  previous = [];
}
const ranRoles = new Set(manifest.map((m) => m.role));
const merged = [...previous.filter((m) => !ranRoles.has(m.role)), ...manifest];
await writeFile(manifestPath, JSON.stringify(merged, null, 2) + "\n");

const ROLE_TITLES = {
  super_admin: "Super admin (`super_admin`)",
  management: "Management (`management`)",
  marketing: "Marketing (`marketing`)",
  branch_manager: "Branch manager, Uttara (`branch_manager`)",
  accounts: "Accounts (`accounts`)",
  rider: "Rider, Uttara (`rider`), mobile",
  customer: "Customer (`customer`)",
  blocked_customer: "Blocked customer (`blocked_customer`)",
  journey: "Order journey at Uttara, step by step",
};
const lines = [
  "# Presentation screenshots",
  "",
  "Captured from a production build (`npm run build` + `npm start`) on the `npm run seed:real` data",
  "with `scripts/presentation/capture.mjs`. Bangla interface unless the line says English.",
  "Desktop shots are 1440x900; mobile shots are 390x844 (saved at 2x pixel density).",
  "",
];
for (const role of Object.keys(ROLE_TITLES)) {
  const rows = merged.filter((m) => m.role === role);
  if (!rows.length) continue;
  lines.push(`## ${ROLE_TITLES[role]}`, "");
  for (const r of rows) lines.push(`- [${role}/${r.file}](./${role}/${r.file}): ${r.description}`);
  lines.push("");
}
await writeFile(path.join(OUT, "manifest.md"), lines.join("\n"));
console.log(`\n${manifest.length} screenshots written to ${path.relative(process.cwd(), OUT)}`);
