/**
 * `npm run seed:real` — the REAL catalogue: 16 branches, the full Cheez and
 * Madchef menus, the MADCHEF30 coupon, demo staff and customers, and two weeks
 * of sample activity. Every machine that runs it ends up with the same data.
 *
 * WHAT IT DOES (in order)
 *   1. Wipes every row of test content: branches, menus, delivery areas,
 *      addresses, orders, reviews, complaints, coupons, campaigns, chats,
 *      notifications, staff records, rider history, and every user account
 *      except the ones listed in KEEP_USERNAMES (+ the ADMIN_USERNAME owner
 *      account). Uploaded product/review/complaint/chat photos of the wiped rows
 *      are deleted from storage too.
 *   2. KEEPS: the 8 demo logins exactly as they are (password untouched), the
 *      owner super admin, the two brands, system settings and reward rules.
 *   3. Builds the real data again (see prisma/seed-real/*.ts for the content).
 *
 * SAFE TO RUN TWICE: step 1 removes everything step 3 creates, so a second run
 * produces the same result instead of duplicates.
 *
 * It uses the app's own services wherever they work outside a web request
 * (orders, status changes, rider assignment and duty, reviews, complaints, order
 * chat, uploads, manager assignment, campaigns). Catalogue and hours writes go
 * through Prisma directly, because their services call Next's revalidatePath,
 * which only works inside a request; the same validation rules are applied here.
 *
 * Run with: npm run seed:real
 * Production (NODE_ENV=production) refuses unless you pass
 * `-- --allow-demo-passwords`: every demo account uses the password published
 * in this repository.
 */
import "./seed-real/load-env";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, PrismaClient, type User } from "@prisma/client";
import bcrypt from "bcryptjs";

import { prisma as appPrisma } from "@/lib/db";
import { deleteUpload, saveUpload } from "@/lib/http/upload";
import { assignBranchManager } from "@/lib/services/branches";
import { addComplaintMessage, changeComplaintStatus, createComplaint } from "@/lib/services/complaints";
import { sendCampaign } from "@/lib/services/marketing";
import { sendChatMessage } from "@/lib/services/order-chat";
import { assignRiderToOrder, createOrder, updateOrderStatus, type OrderItemInput } from "@/lib/services/orders";
import { flagReview, saveReview } from "@/lib/services/product-reviews";
import { respondToAssignment } from "@/lib/services/rider-assignment";
import { startDuty } from "@/lib/services/rider-duty";
import { haversineKm } from "@/lib/services/geo";
import { deriveUsernameBase } from "@/lib/validation/username";
import type { OrderStatus } from "@/types";

import { BRAND_HOURS, DELIVERY_AREA, DINE_IN, REAL_BRANCHES, REAL_ZONES, type RealBranch } from "./seed-real/branches";
import { PROTOTYPE_MENU, type MenuProduct } from "./seed-real/menu-data";
import { BRANCH_STAFF, DEMO_CUSTOMER_ADDRESS, DEMO_CUSTOMERS, type DemoAddress, type DemoPerson } from "./seed-real/people";

// The app's services use the shared client from lib/db; the seed uses the same
// one so everything happens on a single connection.
const prisma: PrismaClient = appPrisma;

/** The password every demo account uses (the same one `npm run seed` sets). */
const DEMO_PASSWORD = "Admin12345@##";

/** Demo logins that are kept as they are. Created only if missing. */
const KEEP_ACCOUNTS = [
  { username: "super_admin", email: "superadmin@example.com", phone: "01700000001", firstName: "Super Admin", role: "super_admin", staff: true },
  { username: "management", email: "management@example.com", phone: "01700000002", firstName: "Management", role: "management" },
  { username: "marketing", email: "marketing@example.com", phone: "01700000003", firstName: "Marketing", role: "marketing" },
  { username: "branch_manager", email: "branchmanager@example.com", phone: "01700000004", firstName: "Branch Manager", role: "branch_manager" },
  { username: "accounts", email: "accounts@example.com", phone: "01700000005", firstName: "Accounts", role: "accounts" },
  { username: "rider", email: "rider@example.com", phone: "01700000006", firstName: "Rider", role: "rider" },
  { username: "customer", email: "customer@example.com", phone: "01711111111", firstName: "Customer", role: "customer" },
  { username: "blocked_customer", email: "blocked@example.com", phone: "", firstName: "Blocked", lastName: "Customer", role: "customer", blocked: true },
] as const;

/** The two Cheez combos the client added (not in the prototype). */
const CHEEZ_COMBOS: MenuProduct[] = [
  {
    brand: "cheez",
    category: "Pizza Combos",
    name: "Classic Combo",
    description: "One 8 inch pizza, thick or thin crust. Choose from Chicken Alfredo, Pepperoni, All 'Bout the Shroom or Creamy Chicken and Sausage.",
    image: "cheez/chicken-alfredo.webp",
    variationType: "BOTH",
    variations: ["Chicken Alfredo", "Pepperoni", "All 'Bout the Shroom", "Creamy Chicken and Sausage"].map((name, i) => ({
      name,
      price: 449,
      servingInfo: "8 inch",
      enabled: true,
      ...(i === 0 ? { isDefault: true } : {}),
    })),
  },
  {
    brand: "cheez",
    category: "Pizza Combos",
    name: "Premium Combo",
    description: "One 8 inch pizza, thick or thin crust. Choose from Fajitas Chicken, Kala Bhuna, Smoked Cheddar Tikka or Hot Crabby Prawnstar.",
    image: "cheez/smoked-cheddar-tikka.webp",
    variationType: "BOTH",
    variations: ["Fajitas Chicken", "Kala Bhuna", "Smoked Cheddar Tikka", "Hot Crabby Prawnstar"].map((name, i) => ({
      name,
      price: 549,
      servingInfo: "8 inch",
      enabled: true,
      ...(i === 0 ? { isDefault: true } : {}),
    })),
  },
];

const MENU: MenuProduct[] = [...PROTOTYPE_MENU, ...CHEEZ_COMBOS];
const ASSET_DIR = path.join(process.cwd(), "prisma", "seed-real", "assets", "menu");

const log = (msg: string) => console.log(msg);

// ── Deterministic randomness: every machine gets the same picks ──────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261012);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

// ── Opening hours on the Dhaka clock, for dating "today's" sample orders ──
const DHAKA_OFFSET_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const dhakaMinute = (t: number) => Math.floor(((t + DHAKA_OFFSET_MS) % DAY_MS) / 60_000);

/** Is this brand taking orders at instant t (seed:real hours, Dhaka clock)? */
function brandOpenAt(slug: string, t: number): boolean {
  const h = BRAND_HOURS[slug as keyof typeof BRAND_HOURS];
  if (!h) return false;
  const start = toMinutes(h.start);
  const end = toMinutes(h.end);
  const m = dhakaMinute(t);
  return end > start ? m >= start && m < end : m >= start || m < end;
}
const allOpenAt = (brands: string[], t: number) => brands.every((b) => brandOpenAt(b, t));

/** How many minutes (up to cap) every brand has been open, without a break, until now. */
function openFor(brands: string[], now: number, cap: number): number {
  let m = 0;
  while (m < cap && allOpenAt(brands, now - (m + 1) * 60_000)) m += 1;
  return m;
}

/**
 * A moment earlier TODAY (Dhaka) when every brand was open for the whole
 * `span` minutes, finished at least 10 minutes before now. Searches back from
 * `fromAgo` minutes ago. Null when there is none.
 */
function earlierToday(brands: string[], now: number, span: number, fromAgo: number): number | null {
  const midnight = now - ((now + DHAKA_OFFSET_MS) % DAY_MS);
  const fits: number[] = [];
  for (let ago = fromAgo; now - ago * 60_000 >= midnight; ago += 7) {
    const t = now - ago * 60_000;
    if (t + (span + 10) * 60_000 > now) continue;
    let ok = true;
    for (let m = 0; m <= span && ok; m += 5) ok = allOpenAt(brands, t + m * 60_000);
    if (ok) fits.push(t);
  }
  // Spread the orders over the window rather than stacking them on one minute.
  return fits.length ? fits[Math.floor(rand() * Math.min(fits.length, 30))] : null;
}

// ── Guards ────────────────────────────────────────────────────────────────
function assertAllowedHere(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.argv.includes("--allow-demo-passwords")) {
    console.warn("WARNING: seeding PRODUCTION with demo accounts that use a published password. Change or remove them before launch.");
    return;
  }
  console.error(
    [
      "Refusing to run seed:real with NODE_ENV=production.",
      "Every demo account it keeps or creates uses the password published in this repository.",
      "If this is a demo/staging server, run: npm run seed:real -- --allow-demo-passwords",
    ].join("\n"),
  );
  process.exit(1);
}

// ── 1. Wipe ───────────────────────────────────────────────────────────────
function keptUsernames(): string[] {
  return [...KEEP_ACCOUNTS.map((a) => a.username), process.env.ADMIN_USERNAME?.trim() || "admin"];
}

/** Storage keys in a JSON array column ("[]" by default). */
function keysOf(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

async function wipe(): Promise<void> {
  const keep = keptUsernames();

  // Uploaded files that belong to rows about to go.
  const files: (string | null)[] = [];
  for (const p of await prisma.product.findMany({ select: { image: true } })) files.push(p.image);
  for (const b of await prisma.branch.findMany({ select: { logo: true } })) files.push(b.logo);
  for (const r of await prisma.foodReview.findMany({ select: { photos: true } })) files.push(...keysOf(r.photos));
  for (const c of await prisma.complaint.findMany({ select: { photos: true } })) files.push(...keysOf(c.photos));
  for (const m of await prisma.orderChatMessage.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } })) files.push(m.imageKey);
  for (const e of await prisma.branchEmployee.findMany({ select: { photo: true } })) files.push(e.photo);
  for (const rm of await prisma.ramadanMenu.findMany({ select: { image: true } })) files.push(rm.image);
  for (const u of await prisma.user.findMany({ where: { username: { notIn: keep } }, select: { profilePhoto: true } })) files.push(u.profilePhoto);
  for (const key of files) await deleteUpload(key);

  // Children first; each line is one table emptied completely.
  await prisma.orderChatRead.deleteMany();
  await prisma.orderChatMessage.deleteMany();
  await prisma.orderChat.deleteMany();
  await prisma.orderDeliveryChatMessage.deleteMany();
  await prisma.orderDeliveryChatThread.deleteMany();
  await prisma.orderStatusEvent.deleteMany();
  await prisma.orderReceiveConfirmation.deleteMany();
  await prisma.riderOrderAssignment.deleteMany();
  await prisma.riderCommission.deleteMany();
  await prisma.riderReview.deleteMany();
  await prisma.foodReview.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.couponRedemption.deleteMany();
  await prisma.complaintMessage.deleteMany();
  await prisma.complaint.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.orderNumberCounter.deleteMany();
  await prisma.campaignEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notice.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.audienceSegment.deleteMany();
  await prisma.rewardLedger.deleteMany();
  await prisma.rewardRedemption.deleteMany();
  await prisma.riderWithdrawal.deleteMany();
  await prisma.financialAuditLog.deleteMany();
  await prisma.financialAdjustment.deleteMany();
  await prisma.branchExpense.deleteMany();
  await prisma.branchSettlement.deleteMany();
  await prisma.riderDutyChatMessage.deleteMany();
  await prisma.riderDutyChatThread.deleteMany();
  await prisma.riderBranchDutySession.deleteMany();
  await prisma.riderDutyLog.deleteMany();
  await prisma.riderRoutePoint.deleteMany();
  await prisma.loginHistory.deleteMany();
  await prisma.managerActivityLog.deleteMany();
  await prisma.branchManagerAssignment.deleteMany();
  await prisma.staffAttendance.deleteMany();
  await prisma.employeeAttendance.deleteMany();
  await prisma.branchEmployee.deleteMany();
  await prisma.employeeTeam.deleteMany();
  await prisma.reservationMessage.deleteMany();
  await prisma.tableReservation.deleteMany();
  await prisma.ramadanReservationPayment.deleteMany();
  await prisma.ramadanReservation.deleteMany();
  await prisma.ramadanBooking.deleteMany();
  await prisma.ramadanTable.deleteMany();
  await prisma.ramadanMenuItem.deleteMany();
  await prisma.ramadanMenu.deleteMany();
  await prisma.ramadanTimeSlot.deleteMany();
  await prisma.ramadanConfig.deleteMany();
  await prisma.branchTable.deleteMany();
  await prisma.deliveryAreaExclusion.deleteMany();
  await prisma.branchDeliveryArea.deleteMany();
  await prisma.productVariation.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.branchBrand.deleteMany();
  await prisma.customerAddress.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  // Branch-scoped earning rules are test content; global ones are settings.
  await prisma.rewardEarningRule.deleteMany({ where: { branchId: { not: null } } });
  await prisma.branch.deleteMany();
  await prisma.deliveryZone.deleteMany();
  // Per-branch setting overrides point at branches that no longer exist.
  await prisma.systemSetting.deleteMany({ where: { key: { contains: ":branch:" } } });

  // Every account that is not a kept demo login or the owner super admin.
  await prisma.riderProfile.deleteMany({ where: { user: { username: { notIn: keep } } } });
  await prisma.user.updateMany({ where: { approvedBy: { username: { notIn: keep } } }, data: { approvedById: null } });
  await prisma.user.deleteMany({ where: { username: { notIn: keep } } });

  // SQLite only: restart the id counters of the emptied tables, so branch 1 is
  // Uttara on every machine. Postgres would need its own statement; skipped.
  if ((process.env.DATABASE_URL ?? "").startsWith("file:")) {
    const kept = await prisma.user.aggregate({ _max: { id: true } });
    await prisma.$executeRawUnsafe(`DELETE FROM sqlite_sequence WHERE name <> 'User' AND name NOT IN ('Brand','SystemSetting','RewardRule','RewardEarningRule','RiderProfile')`);
    await prisma.$executeRawUnsafe(`UPDATE sqlite_sequence SET seq = ${kept._max.id ?? 0} WHERE name = 'User'`);
  }
  log(`✔ Wiped test data (kept: ${keep.join(", ")}, brands, settings, reward rules)`);
}

// ── 2. Accounts ──────────────────────────────────────────────────────────
async function ensureKeptAccounts(passwordHash: string): Promise<Record<string, User>> {
  const out: Record<string, User> = {};
  for (const a of KEEP_ACCOUNTS) {
    const existing = await prisma.user.findUnique({ where: { username: a.username } });
    out[a.username] =
      existing ??
      (await prisma.user.create({
        data: {
          username: a.username,
          email: a.email,
          phone: a.phone,
          firstName: a.firstName,
          lastName: "lastName" in a ? a.lastName : "",
          role: a.role,
          status: "approved",
          isStaff: "staff" in a,
          isSuperuser: "staff" in a,
          isBlocked: "blocked" in a,
          blockedReason: "blocked" in a ? "ভুয়া অর্ডার দেওয়ার কারণে ব্লক করা হয়েছে" : "",
          password: passwordHash,
        },
      }));
  }
  return out;
}

async function createPerson(person: DemoPerson, role: "branch_manager" | "rider" | "customer", phone: string, passwordHash: string, approvedById: number): Promise<User> {
  const username = deriveUsernameBase(person.firstName, person.lastName);
  if (!username) throw new Error(`No username for ${person.firstName} ${person.lastName}`);
  return prisma.user.create({
    data: {
      username,
      email: `${username}@example.com`,
      phone,
      firstName: person.firstName,
      lastName: person.lastName,
      role,
      status: "approved",
      approvedById,
      approvedAt: new Date(),
      isStaff: role !== "customer",
      password: passwordHash,
    },
  });
}

// ── 3. Branches ──────────────────────────────────────────────────────────
const ALL_DAY = JSON.stringify({ everyDay: [{ start: "00:00", end: "00:00", delivery: true, pickup: true }], days: {} });

async function createBranches(): Promise<Map<string, { id: number; def: RealBranch }>> {
  const zones = new Map<string, number>();
  for (const [i, name] of REAL_ZONES.entries()) {
    const z = await prisma.deliveryZone.create({ data: { name, normalizedName: name.trim().toLowerCase(), sortOrder: i } });
    zones.set(name, z.id);
  }
  const brands = new Map((await prisma.brand.findMany()).map((b) => [b.slug, b.id]));
  const out = new Map<string, { id: number; def: RealBranch }>();
  for (const def of REAL_BRANCHES) {
    const zoneId = zones.get(def.zone);
    if (!zoneId) throw new Error(`Zone ${def.zone} missing`);
    const dining = def.businessType === "dine_in";
    const branch = await prisma.branch.create({
      data: {
        name: def.name,
        address: def.address,
        phone: def.phone,
        zoneId,
        latitude: new Prisma.Decimal(def.lat.toFixed(7)),
        longitude: new Prisma.Decimal(def.lng.toFixed(7)),
        deliveryRadiusKm: new Prisma.Decimal(DELIVERY_AREA.radiusKm),
        deliveryFee: new Prisma.Decimal(0),
        businessType: def.businessType,
        prepTimeMinutes: 30,
        pickupEnabled: true,
        pickupAddress: def.address,
        pickupPhone: def.extraPhone ?? def.phone,
        bkashNumber: def.bkash,
        bkashEnabled: Boolean(def.bkash),
        bkashInstructions: def.bkash ? "Send Money to this bKash number, then enter the transaction ID." : "",
        dineInHours: dining ? JSON.stringify({ everyDay: [{ start: DINE_IN.start, end: DINE_IN.end }], days: {} }) : "",
        dineInLastEntry: dining ? DINE_IN.lastEntry : "",
      },
    });
    for (const slug of def.brands) {
      const brandId = brands.get(slug);
      if (!brandId) throw new Error(`Brand ${slug} missing — the brands must exist before seeding`);
      // All-day while the sample orders are placed; the real hours go on at the end.
      await prisma.branchBrand.create({ data: { branchId: branch.id, brandId, hours: ALL_DAY } });
    }
    await prisma.branchDeliveryArea.create({
      data: {
        branchId: branch.id,
        name: def.name,
        shape: JSON.stringify({ type: "Circle", coordinates: [def.lng, def.lat], radiusKm: DELIVERY_AREA.radiusKm }),
        isActive: true,
        estimatedDeliveryMinutes: DELIVERY_AREA.etaMinutes,
        deliveryCharge: new Prisma.Decimal(DELIVERY_AREA.charge),
      },
    });
    out.set(def.key, { id: branch.id, def });
  }
  log(`✔ ${REAL_BRANCHES.length} branches, ${REAL_ZONES.length} zones, one ${DELIVERY_AREA.radiusKm} km delivery area each`);
  return out;
}

async function applyRealHours(): Promise<void> {
  const rows = await prisma.branchBrand.findMany({ include: { brand: true } });
  for (const row of rows) {
    const h = BRAND_HOURS[row.brand.slug as keyof typeof BRAND_HOURS];
    if (!h) continue;
    await prisma.branchBrand.update({
      where: { id: row.id },
      data: { hours: JSON.stringify({ everyDay: [{ start: h.start, end: h.end, delivery: true, pickup: true }], days: {} }) },
    });
  }
  log("✔ Ordering hours: Madchef 11:00 AM–10:30 PM, Cheez 11:00 AM–4:00 AM (delivery + pickup)");
}

// ── 4. Menu ──────────────────────────────────────────────────────────────
const MIME: Record<string, string> = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
const assetCache = new Map<string, Buffer>();

/** One product photo through the app's own upload pipeline (WebP + variants). */
async function uploadMenuImage(rel: string): Promise<string> {
  let buf = assetCache.get(rel);
  if (!buf) {
    buf = await readFile(path.join(ASSET_DIR, rel));
    assetCache.set(rel, buf);
  }
  const ext = path.extname(rel).toLowerCase();
  const file = new File([new Uint8Array(buf)], path.basename(rel), { type: MIME[ext] ?? "application/octet-stream" });
  return saveUpload(file, "products", "image");
}

async function seedMenus(branches: Map<string, { id: number; def: RealBranch }>): Promise<void> {
  let products = 0;
  for (const { id: branchId, def } of branches.values()) {
    for (const brand of def.brands) {
      const items = MENU.filter((m) => m.brand === brand);
      const categories = new Map<string, number>();
      for (const name of [...new Set(items.map((i) => i.category))]) {
        const c = await prisma.category.create({
          data: { branchId, name, normalizedName: name.trim().toLowerCase(), brand, description: "" },
        });
        categories.set(name, c.id);
      }
      for (const item of items) {
        const enabled = item.variations.filter((v) => v.enabled);
        const def0 = enabled.find((v) => v.isDefault) ?? enabled[0];
        const product = await prisma.product.create({
          data: {
            branchId,
            categoryId: categories.get(item.category)!,
            name: item.name,
            description: item.description,
            price: new Prisma.Decimal(def0.price),
            brand,
            image: item.image ? await uploadMenuImage(item.image) : null,
            isAvailable: true,
            preparationTime: item.category.includes("Pizza") ? 25 : 15,
            variationType: item.variationType,
          },
        });
        await prisma.productVariation.createMany({
          data: item.variations.map((v, i) => ({
            productId: product.id,
            name: v.name,
            price: new Prisma.Decimal(v.price),
            servingInfo: v.servingInfo,
            sortOrder: i,
            isDefault: v === def0,
            isEnabled: v.enabled,
          })),
        });
        products += 1;
      }
    }
  }
  log(`✔ Menus: ${products} products across ${branches.size} branches (photos through saveUpload)`);
}

// ── 5. Sample activity helpers ───────────────────────────────────────────
type Plan = "delivered" | "cancelled" | "pickup" | "pending" | "accepted" | "preparing" | "ready" | "on_the_way";

interface PlacedOrder {
  id: number;
  plan: Plan;
  placedAt: Date;
  /** Minutes after placedAt for each status event, in order. */
  steps: number[];
  /** When set, the steps are squeezed to end within this many minutes. */
  maxSpan?: number;
}

async function orderWithBranch(id: number) {
  return prisma.order.findUniqueOrThrow({ where: { id }, include: { branch: { select: { managerId: true } } } });
}

async function move(orderId: number, status: OrderStatus, user: User, reason = ""): Promise<void> {
  await updateOrderStatus({ order: await orderWithBranch(orderId), newStatus: status, user, reason });
}

const CHAT = {
  manager: ["আপনার অর্ডার তৈরি হচ্ছে, একটু অপেক্ষা করুন।", "অর্ডার প্যাক করা হয়েছে, রাইডার রওনা দিচ্ছে।"],
  customerToRider: ["গেটে পৌঁছে একটা কল দিবেন প্লিজ।", "লিফটের ৫ তলায় উঠে বাম পাশের দরজা।", "Please call when you reach, thanks!"],
  rider: ["আমি রাস্তায় আছি, ১০ মিনিটের মধ্যে পৌঁছাব।", "On my way, about 15 minutes."],
};

const REVIEWS: [number, string][] = [
  [5, "দারুণ স্বাদ, আবার অর্ডার করব।"],
  [5, "Loved it. Will order again."],
  [4, "খুব ভালো, তবে আরেকটু ঝাল হলে ভালো লাগত।"],
  [5, "Exactly like the picture, and still hot."],
  [4, "Good portion for the price."],
  [3, "স্বাদ ভালো, কিন্তু ডেলিভারিতে একটু দেরি হয়েছে।"],
  [5, "গরম গরম পেয়েছি, খুব ভালো লেগেছে।"],
  [4, "Fresh and well packed."],
];

/** Categories of the dishes people order (and review); not drinks, extras or sauces. */
const MAIN_CATEGORIES = /^(Classic Pizzas|More For Less Pizzas|Gourmet Pizzas|Pizza Combos|Pasta|Pizza Boats|Appetizers|Classic Burgers|Gourmet Burgers|Wraps|Poutines|Rice Meals|Teasers|Crispy Chicken)$/;
const DRINK_CATEGORIES = /^(Drinks|Mocktails|Shakes|Carbonated Beverages)$/;

/** A couple of dishes from what the branch sells, deterministic per order. */
async function cartFor(branchId: number, brands: string[], n: number): Promise<OrderItemInput[]> {
  const products = await prisma.product.findMany({
    where: { branchId, brand: { in: brands }, variations: { some: { isEnabled: true } } },
    include: { category: true, variations: { where: { isEnabled: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { id: "asc" },
  });
  const mains = products.filter((p) => MAIN_CATEGORIES.test(p.category?.name ?? ""));
  const pool = mains.length ? mains : products;
  const lines: OrderItemInput[] = [];
  const used = new Set<number>();
  while (lines.length < n && used.size < pool.length) {
    const p = pick(pool);
    if (used.has(p.id)) continue;
    used.add(p.id);
    const variation = pick(p.variations);
    lines.push({
      product_id: p.id,
      variation_id: variation.id,
      quantity: rand() < 0.75 ? 1 : 2,
      ...(p.variationType === "BOTH" ? { variation_type: rand() < 0.5 ? "THICK" : "THIN" } : {}),
    });
  }
  // A drink with most orders.
  const drinks = products.filter((p) => DRINK_CATEGORIES.test(p.category?.name ?? ""));
  if (drinks.length && rand() < 0.7) lines.push({ product_id: pick(drinks).id, quantity: 1 });
  return lines;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  assertAllowedHere();
  const started = Date.now();

  await wipe();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const kept = await ensureKeptAccounts(passwordHash);
  const superAdmin = kept.super_admin;

  // Brands are kept; create them only on a database that never had them.
  for (const b of [
    { slug: "cheez", name: "Cheez! Pizza", nameBn: "চিজ! পিৎজা", logo: "/images/brand/cheez-logo.webp", accentColor: "#f5a623", emoji: "🍕", showCrustGuide: true, sortOrder: 0 },
    { slug: "madchef", name: "Madchef", nameBn: "ম্যাডশেফ", logo: "/images/brand/madchef-logo.webp", accentColor: "#e8192c", emoji: "🔥", showCrustGuide: false, sortOrder: 1 },
  ]) {
    await prisma.brand.upsert({ where: { slug: b.slug }, update: {}, create: b });
  }

  const branches = await createBranches();
  const branchId = (key: string) => branches.get(key)!.id;

  // ── Staff ──
  const managers = new Map<string, User>();
  const riders = new Map<string, User[]>();
  managers.set("uttara", kept.branch_manager);
  riders.set("uttara", [kept.rider]);
  let m = 0;
  let r = 0;
  for (const def of REAL_BRANCHES) {
    const staff = BRANCH_STAFF[def.key];
    if (!staff) continue;
    m += 1;
    managers.set(def.key, await createPerson(staff.manager, "branch_manager", `0181100${String(100 + m).padStart(4, "0")}`, passwordHash, superAdmin.id));
    const pair: User[] = [];
    for (const person of staff.riders) {
      r += 1;
      pair.push(await createPerson(person, "rider", `0182200${String(100 + r).padStart(4, "0")}`, passwordHash, superAdmin.id));
    }
    riders.set(def.key, pair);
  }
  for (const def of REAL_BRANCHES) {
    await assignBranchManager({ branchId: branchId(def.key), managerId: managers.get(def.key)!.id, assignedById: superAdmin.id, notes: "Initial assignment (seed:real)." });
    for (const rider of riders.get(def.key)!) {
      await prisma.riderProfile.upsert({
        where: { userId: rider.id },
        update: { assignedBranchId: branchId(def.key), vehicleType: "Bike", isOnline: false },
        create: { userId: rider.id, assignedBranchId: branchId(def.key), vehicleType: "Bike" },
      });
      await startDuty(rider, branchId(def.key));
      // A recent position near the branch, so the live rider map has something to show.
      await prisma.riderProfile.update({
        where: { userId: rider.id },
        data: {
          currentLat: new Prisma.Decimal((def.lat + (rand() - 0.5) * 0.01).toFixed(7)),
          currentLng: new Prisma.Decimal((def.lng + (rand() - 0.5) * 0.01).toFixed(7)),
          currentAccuracy: new Prisma.Decimal(12),
          lastPingAt: new Date(),
        },
      });
    }
  }
  log(`✔ Staff: ${managers.size} branch managers (branch_manager runs Uttara), ${r + 1} riders on duty`);

  await seedMenus(branches);

  // ── MADCHEF30 ──
  const marketing = kept.marketing;
  const coupon = await prisma.coupon.create({
    data: {
      code: "MADCHEF30",
      discountType: "percent",
      value: new Prisma.Decimal(30),
      minOrder: new Prisma.Decimal(0),
      maxUses: 0,
      perCustomerLimit: null,
      startsAt: null,
      endsAt: null,
      isActive: true,
      branchId: null,
      createdById: marketing.id,
    },
  });
  log("✔ Coupon MADCHEF30: 30% off, every branch, no end date, no caps");

  // ── Customers and addresses ──
  const customers: { user: User; address: DemoAddress; addressId: number }[] = [];
  const addAddress = async (user: User, a: DemoAddress) =>
    prisma.customerAddress.create({
      data: {
        userId: user.id,
        label: a.label,
        address: a.address,
        area: a.area,
        mainArea: a.area,
        roadLane: a.road,
        housePlot: a.house,
        city: "Dhaka",
        country: "Bangladesh",
        mapAddress: a.address,
        latitude: new Prisma.Decimal(a.lat.toFixed(7)),
        longitude: new Prisma.Decimal(a.lng.toFixed(7)),
        isDefault: true,
      },
    });
  customers.push({ user: kept.customer, address: DEMO_CUSTOMER_ADDRESS, addressId: (await addAddress(kept.customer, DEMO_CUSTOMER_ADDRESS)).id });
  for (const [i, c] of DEMO_CUSTOMERS.entries()) {
    const user = await createPerson(c, "customer", `0183300${String(101 + i).padStart(4, "0")}`, passwordHash, superAdmin.id);
    customers.push({ user, address: c.address, addressId: (await addAddress(user, c.address)).id });
  }
  log(`✔ Customers: customer (Uttara address) + ${DEMO_CUSTOMERS.length} demo customers`);

  // ── Sample orders ──
  const now = Date.now();
  const placed: PlacedOrder[] = [];
  const active: Plan[] = ["pending", "preparing", "on_the_way", "accepted", "ready", "pending", "preparing", "on_the_way"];
  const older: Plan[] = ["cancelled", "pickup", "delivered", "cancelled", "pickup", "delivered"];
  let couponUses = 0;

  for (const [i, def] of REAL_BRANCHES.entries()) {
    const bId = branchId(def.key);
    const manager = managers.get(def.key)!;
    const branchRiders = riders.get(def.key)!;
    const near = customers.filter((c) => haversineKm({ lat: def.lat, lng: def.lng }, { lat: c.address.lat, lng: c.address.lng }) < DELIVERY_AREA.radiusKm - 0.3);
    if (!near.length) throw new Error(`No demo customer lives inside ${def.name}'s area`);

    // Uttara: the branch the screenshots follow, so it gets a fuller history
    // and keeps the demo rider free (no open delivery) for the live journey.
    const plans: Plan[] = def.key === "uttara" ? ["delivered", "delivered", "pickup", "cancelled", "pending", "preparing"] : ["delivered", older[i % older.length], active[i % active.length]];

    for (const [j, plan] of plans.entries()) {
      const isActive = ["pending", "accepted", "preparing", "ready", "on_the_way"].includes(plan);
      const customer = near[(i + j) % near.length];
      // Every "today" timestamp sits inside the real opening hours of the
      // brands in the cart (Dhaka clock), whatever time the seed runs.
      let cartBrands: string[] = def.brands;
      let todayAt: number | null = null;
      let maxSpan: number | undefined;
      if (isActive) {
        // Placed 40–100 minutes ago, but never before the brands opened; a
        // branch that opened recently gets its steps squeezed into that time.
        const wanted = 40 + Math.floor(rand() * 60);
        const open = openFor(def.brands, now, 100);
        const ago = wanted <= open ? wanted : Math.max(5, open - Math.floor(rand() * Math.min(20, Math.max(0, open - 5))));
        todayAt = now - ago * 60_000;
        maxSpan = ago - 2;
      } else if (plan === "delivered" && j === 0 && (def.key === "uttara" || i % 4 === 1)) {
        // A few deliveries finished earlier today, so "today" on the dashboards
        // is not ৳0. Shortly after opening that is Cheez's overnight window
        // (it delivers until 4 AM), so those carts are Cheez only.
        todayAt = earlierToday(def.brands, now, 52, 150);
        if (todayAt == null && def.brands.includes("cheez")) {
          todayAt = earlierToday(["cheez"], now, 52, 150);
          if (todayAt != null) cartBrands = ["cheez"];
        }
      }
      // Older orders: between noon and 9 PM Dhaka time (UTC+6) on their day.
      const daysAgo = 1 + Math.floor(rand() * 13);
      const placedAt =
        todayAt != null
          ? new Date(todayAt)
          : new Date(new Date(now - daysAgo * 86_400_000).setUTCHours(12 + Math.floor(rand() * 9) - 6, Math.floor(rand() * 60), 0, 0));
      const useCoupon = plan === "delivered" && (i + j) % 3 === 0 && couponUses < 7;
      if (useCoupon) couponUses += 1;
      const pickup = plan === "pickup";

      const order = await createOrder({
        customerId: customer.user.id,
        branchId: bId,
        items: await cartFor(bId, cartBrands, 1 + Math.floor(rand() * 2)),
        paymentMethod: "cash",
        deliveryAddress: pickup ? "" : customer.address.address,
        fulfillmentType: pickup ? "pickup" : "delivery",
        customerAddressId: pickup ? null : customer.addressId,
        couponCode: useCoupon ? "MADCHEF30" : undefined,
        foodNotes: rand() < 0.3 ? "কম ঝাল দিবেন প্লিজ" : "",
      });
      const steps: number[] = [];
      const rider = branchRiders[(i + j) % branchRiders.length];
      const customerUser = customer.user;

      if (plan === "pending") {
        placed.push({ id: order.id, plan, placedAt, steps, maxSpan });
        continue;
      }
      if (plan === "cancelled") {
        await move(order.id, "cancelled", manager, pick(["এই আইটেমটি এখন স্টকে নেই।", "Kitchen closed early due to a power cut.", "গ্রাহকের ফোন বন্ধ, ঠিকানা নিশ্চিত করা যায়নি।"]));
        steps.push(6);
        placed.push({ id: order.id, plan, placedAt, steps, maxSpan });
        continue;
      }
      await move(order.id, "accepted", manager);
      steps.push(3);
      if (!pickup) await sendChatMessage(manager, order.id, { text: CHAT.manager[0] });
      if (plan === "accepted") {
        placed.push({ id: order.id, plan, placedAt, steps, maxSpan });
        continue;
      }
      await move(order.id, "preparing", manager);
      steps.push(6);
      if (plan === "preparing") {
        placed.push({ id: order.id, plan, placedAt, steps, maxSpan });
        continue;
      }
      if (pickup) {
        await move(order.id, "ready", manager);
        await move(order.id, "delivered", manager);
        steps.push(24, 41);
        placed.push({ id: order.id, plan, placedAt, steps, maxSpan });
        continue;
      }
      // Delivery: the rider leg.
      await assignRiderToOrder({ order: await orderWithBranch(order.id), riderId: rider.id, actingUser: manager });
      await respondToAssignment(rider, order.id, "accept");
      await move(order.id, "ready", manager);
      steps.push(24);
      if (plan === "ready") {
        placed.push({ id: order.id, plan, placedAt, steps, maxSpan });
        continue;
      }
      await move(order.id, "picked_up", rider);
      await sendChatMessage(customerUser, order.id, { text: pick(CHAT.customerToRider) });
      await move(order.id, "on_the_way", rider);
      await sendChatMessage(rider, order.id, { text: pick(CHAT.rider) });
      steps.push(31, 33);
      if (plan === "on_the_way") {
        placed.push({ id: order.id, plan, placedAt, steps, maxSpan });
        continue;
      }
      await move(order.id, "delivered", rider);
      steps.push(52);
      placed.push({ id: order.id, plan, placedAt, steps, maxSpan });
    }
  }

  // ── Reviews on delivered / collected orders ──
  let reviewCount = 0;
  const done = await prisma.order.findMany({
    where: { status: "delivered" },
    include: { items: { include: { product: { include: { category: true } } } }, customer: true },
    orderBy: { id: "asc" },
  });
  for (const [i, o] of done.entries()) {
    if (i % 4 === 3) continue; // not everyone leaves a review
    const dishes = o.items.filter((l) => MAIN_CATEGORIES.test(l.product.category?.name ?? ""));
    for (const line of dishes.slice(0, i % 3 === 0 ? 2 : 1)) {
      const already = await prisma.foodReview.findUnique({ where: { customerId_productId: { customerId: o.customerId, productId: line.productId } } });
      if (already) continue;
      const [rating, comment] = REVIEWS[(i + reviewCount) % REVIEWS.length];
      await saveReview(o.customer, line.productId, { rating, comment });
      reviewCount += 1;
    }
  }
  // One review a manager wants marketing to look at.
  const toFlag = await prisma.foodReview.findFirst({ where: { rating: { lte: 3 } }, orderBy: { id: "asc" } });
  if (toFlag?.branchId) {
    const flagger = await prisma.user.findFirst({ where: { managedBranches: { some: { id: toFlag.branchId } } } });
    if (flagger) await flagReview(flagger, toFlag.id, "Delivery delay was our rider's fault, not the food. Please check.");
  }
  log(`✔ ${reviewCount} product reviews (one flagged for marketing)`);

  // ── Complaints, routed by the app's own rules ──
  const complaintPlans: { branch: string; category: string; subject: string; message: string; reply?: string; status?: string }[] = [
    { branch: "uttara", category: "food_quality", subject: "পিৎজা ঠান্ডা পৌঁছেছে", message: "আজকের অর্ডারের পিৎজা ঠান্ডা অবস্থায় পেয়েছি। অনুগ্রহ করে বিষয়টি দেখুন।", reply: "দুঃখিত! আমরা কিচেন ও রাইডারের সাথে কথা বলছি। পরের অর্ডারে বিষয়টি খেয়াল রাখব।", status: "in_progress" },
    { branch: "cheez-banani", category: "delivery", subject: "Delivery took over an hour", message: "The tracking said 45 minutes but it took more than an hour to arrive." },
    { branch: "madchef-mirpur", category: "food_quality", subject: "ফ্রাইজ মিসিং ছিল", message: "অর্ডারে বম্ব ফ্রাইজ ছিল কিন্তু প্যাকেটে পাইনি।", reply: "আমরা দুঃখিত। পরবর্তী অর্ডারে ফ্রাইজ ফ্রি দেওয়া হবে।", status: "resolved" },
    { branch: "gulshan", category: "service", subject: "Wrong sauce on the burger", message: "I asked for Garlic Mayo in the note but got BBQ." },
  ];
  for (const c of complaintPlans) {
    const order = await prisma.order.findFirst({ where: { branchId: branchId(c.branch), status: "delivered" }, include: { customer: true }, orderBy: { id: "asc" } });
    if (!order) continue;
    const complaint = await createComplaint({
      complainantId: order.customerId,
      recipientRole: "branch_manager",
      branchId: order.branchId,
      orderId: order.id,
      category: c.category,
      subject: c.subject,
      message: c.message,
    });
    const manager = managers.get(c.branch)!;
    if (c.reply) await addComplaintMessage(complaint.id, manager, c.reply);
    if (c.status) await changeComplaintStatus(complaint.id, c.status, manager);
  }
  log(`✔ ${complaintPlans.length} complaints routed to their branches`);

  // ── A campaign for the coupon, sent to every customer ──
  const campaign = await prisma.campaign.create({
    data: {
      title: "৩০% ছাড় — MADCHEF30",
      description: "সব শাখায় Madchef ও Cheez-এর সব আইটেমে ৩০% ছাড়। চেকআউটে MADCHEF30 কোড দিন।",
      type: "discount",
      startsAt: new Date(now - 14 * 86_400_000),
      endsAt: new Date(now + 60 * 86_400_000),
      couponId: coupon.id,
      createdById: marketing.id,
    },
  });
  await sendCampaign({ campaignId: campaign.id });
  log("✔ Campaign for MADCHEF30 sent to customers");

  await backdate(placed);
  await renumberOrders();
  await applyRealHours();

  log(`\nseed:real done in ${Math.round((Date.now() - started) / 1000)} s. Demo password for every demo account: ${DEMO_PASSWORD}`);
}

// ── Spreading the activity over the last two weeks ───────────────────────
async function backdate(orders: PlacedOrder[]): Promise<void> {
  const at = (o: PlacedOrder, minutes: number) => new Date(o.placedAt.getTime() + minutes * 60_000);
  for (const o of orders) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { statusEvents: { orderBy: { id: "asc" } }, chat: { include: { messages: { orderBy: { id: "asc" } } } } } });
    // The events in order; picked_up/on_the_way share the steps list with the
    // implicit ones, so stretch the times over however many there are.
    const events = order.statusEvents;
    const lastStep = o.steps[o.steps.length - 1] ?? 0;
    const squeeze = o.maxSpan != null && lastStep > o.maxSpan ? o.maxSpan / lastStep : 1;
    const times = events.map((_, i) => at(o, (o.steps[Math.min(i, o.steps.length - 1)] ?? 3 + i * 5) * squeeze));
    for (const [i, e] of events.entries()) await prisma.orderStatusEvent.update({ where: { id: e.id }, data: { createdAt: times[i] } });
    const last = times.length ? times[times.length - 1] : o.placedAt;
    await prisma.order.update({ where: { id: o.id }, data: { createdAt: o.placedAt, updatedAt: last } });

    if (order.chat) {
      const ended = ["delivered", "cancelled"].includes(order.status) ? last : null;
      await prisma.orderChat.update({ where: { id: order.chat.id }, data: { createdAt: o.placedAt, endedAt: ended } });
      for (const [i, msg] of order.chat.messages.entries()) {
        await prisma.orderChatMessage.update({ where: { id: msg.id }, data: { createdAt: at(o, 4 + i * 9) } });
      }
      await prisma.orderChatRead.updateMany({ where: { chatId: order.chat.id }, data: { lastSeenAt: last } });
    }
    await prisma.riderOrderAssignment.updateMany({ where: { orderId: o.id }, data: { createdAt: at(o, 8), respondedAt: at(o, 9), updatedAt: at(o, 9) } });
    await prisma.orderReceiveConfirmation.updateMany({ where: { orderId: o.id }, data: { confirmedAt: at(o, 31) } });
    await prisma.riderCommission.updateMany({ where: { orderId: o.id }, data: { createdAt: last } });
    await prisma.couponRedemption.updateMany({ where: { orderId: o.id }, data: { createdAt: o.placedAt } });
    await prisma.rewardLedger.updateMany({ where: { dedupeKey: `order:${o.id}` }, data: { createdAt: last } });
    await prisma.foodReview.updateMany({ where: { orderId: o.id }, data: { createdAt: at(o, 150), updatedAt: at(o, 150) } });
    await prisma.complaint.updateMany({ where: { orderId: o.id }, data: { createdAt: at(o, 180) } });
    const complaintIds = (await prisma.complaint.findMany({ where: { orderId: o.id }, select: { id: true } })).map((c) => c.id);
    await prisma.complaintMessage.updateMany({ where: { complaintId: { in: complaintIds } }, data: { createdAt: at(o, 240) } });
    // Notifications about this order: same day as the order, in their order.
    const notes = await prisma.notification.findMany({ where: { link: { endsWith: `/orders/${o.id}` } }, orderBy: { id: "asc" } });
    for (const [i, n] of notes.entries()) {
      const when = times[Math.min(i, times.length - 1)] ?? o.placedAt;
      await prisma.notification.update({ where: { id: n.id }, data: { createdAt: when, isRead: when.getTime() < Date.now() - 6 * 3_600_000 } });
    }
  }
  log(`✔ ${orders.length} orders spread over the last two weeks`);
}

/** Order numbers carry the date (ORD-YYYYMMDD-NNNNNN): renumber after backdating. */
async function renumberOrders(): Promise<void> {
  // updatedAt is passed back unchanged: Prisma's @updatedAt would otherwise
  // stamp every order with "now" and undo the backdating.
  const orders = await prisma.order.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, createdAt: true, updatedAt: true } });
  for (const o of orders) await prisma.order.update({ where: { id: o.id }, data: { orderNumber: `TMP-${o.id}`, updatedAt: o.updatedAt } });
  const counters = new Map<string, number>();
  for (const o of orders) {
    const d = o.createdAt;
    const key = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    const seq = (counters.get(key) ?? 0) + 1;
    counters.set(key, seq);
    await prisma.order.update({ where: { id: o.id }, data: { orderNumber: `ORD-${key}-${String(seq).padStart(6, "0")}`, updatedAt: o.updatedAt } });
  }
  await prisma.orderNumberCounter.deleteMany();
  for (const [dateKey, seq] of counters) await prisma.orderNumberCounter.create({ data: { dateKey, seq } });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
