/**
 * One-time repair: merge split pizza products into one product with sizes.
 *
 * The first real-catalog seed stored every pizza twice per branch, "<Name>"
 * (thick: 8", 14") and "<Name> (Thin)" (thin: 8", 12", 16"), because crust was
 * a product-level policy. A size now carries its own crust, so each pair becomes
 * ONE product with the prototype's four sizes. This script fixes an existing
 * database in place, without re-seeding:
 *
 *   1. Every "(Thin)" product is folded into its thick twin on the same branch
 *      and brand. Its order lines and reviews move to the merged product and the
 *      matching size first; each order line keeps its price, quantity and name
 *      snapshot, so no order total or receipt changes. Then the twin is deleted.
 *   2. Every pizza the prototype defines gets exactly its sizes (label, slice
 *      note, price, crust, dine-in only), its clean About sentence, ingredient
 *      chips and Spicy / Veg flags (from prisma/seed-real/menu-data.ts).
 *   3. Any other description still carrying "\nInside: …" is split the same way.
 *
 * Idempotent: a second run finds nothing to merge and nothing to change.
 * Every order-line total is summed before and after; a mismatch rolls back.
 *
 *   npx tsx scripts/fix-product-variants.ts            # apply
 *   npx tsx scripts/fix-product-variants.ts --dry-run  # report only
 */
import { Prisma, PrismaClient } from "@prisma/client";

import { PROTOTYPE_MENU, type MenuProduct, type MenuVariation } from "../prisma/seed-real/menu-data";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");
const THIN_SUFFIX = /\s*\(thin\)\s*$/i;
const INSIDE = "\nInside: ";

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
/** "12 inch – Thin Crust" and the legacy "12 inch" share the size key "12". */
const sizeKey = (name: string) => name.match(/^\s*(\d+)\s*(inch|")/i)?.[1] ?? null;

/** Prototype pizzas with sizes, by brand + name. */
const CANONICAL = new Map<string, MenuProduct>(
  PROTOTYPE_MENU.filter((p) => p.variations.some((v) => v.crust)).map((p) => [`${p.brand}|${key(p.name)}`, p]),
);

function splitInside(description: string): { about: string; ingredients: string } | null {
  const at = description.indexOf(INSIDE);
  if (at < 0) return null;
  const inside = description.slice(at + INSIDE.length);
  return {
    about: description.slice(0, at).trim(),
    ingredients: inside
      .split(/\s*[+,]\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", "),
  };
}

const stats = { merged: 0, orderItemsMoved: 0, reviewsMoved: 0, reviewsDropped: 0, productsNormalized: 0, variationsChanged: 0, descriptionsSplit: 0 };

async function orderLineTotal(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ total: string | null; n: bigint }[]>`
    SELECT CAST(SUM(CAST("unitPrice" AS REAL) * "quantity") AS TEXT) AS total, COUNT(*) AS n FROM "OrderItem"`;
  return `${rows[0]?.n ?? 0} lines / ${rows[0]?.total ?? "0"}`;
}

/** Step 1: fold one "(Thin)" product into its thick twin. */
async function mergeTwin(tx: Prisma.TransactionClient, thinId: number, thickId: number): Promise<void> {
  const thin = await tx.product.findUniqueOrThrow({ where: { id: thinId }, include: { variations: true } });
  const thick = await tx.product.findUniqueOrThrow({ where: { id: thickId }, include: { variations: true } });

  // Each thin size goes to the thick product's size of the same inches when it
  // has one (the shared 8"), otherwise the row itself moves over (12", 16").
  for (const v of thin.variations) {
    const target = thick.variations.find((t) => sizeKey(t.name) !== null && sizeKey(t.name) === sizeKey(v.name));
    if (target) {
      const items = await tx.orderItem.findMany({ where: { variationId: v.id } });
      for (const item of items) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            variationId: target.id,
            variationName: item.variationName || v.name,
            variationType: item.variationType || "THIN",
          },
        });
      }
      await tx.productVariation.delete({ where: { id: v.id } });
    } else {
      const clash = thick.variations.some((t) => t.name === v.name);
      await tx.productVariation.update({
        where: { id: v.id },
        data: { productId: thick.id, name: clash ? `${v.name} (Thin)` : v.name, variantType: v.variantType || "THIN" },
      });
    }
  }

  // Order lines: point at the merged product, keeping the name they were sold
  // under (the snapshot) — price, quantity and totals are never touched.
  const lines = await tx.orderItem.findMany({ where: { productId: thin.id } });
  for (const line of lines) {
    await tx.orderItem.update({
      where: { id: line.id },
      data: { productId: thick.id, productName: line.productName || thin.name, productImage: line.productImage ?? thin.image },
    });
  }
  stats.orderItemsMoved += lines.length;

  // Reviews: one per customer per product. A customer who reviewed both keeps
  // the newer review; otherwise the review simply moves.
  const reviews = await tx.foodReview.findMany({ where: { productId: thin.id } });
  for (const review of reviews) {
    const existing = await tx.foodReview.findUnique({
      where: { customerId_productId: { customerId: review.customerId, productId: thick.id } },
    });
    if (!existing) {
      await tx.foodReview.update({ where: { id: review.id }, data: { productId: thick.id } });
      stats.reviewsMoved += 1;
    } else if (review.createdAt > existing.createdAt) {
      await tx.foodReview.delete({ where: { id: existing.id } });
      await tx.foodReview.update({ where: { id: review.id }, data: { productId: thick.id } });
      stats.reviewsMoved += 1;
      stats.reviewsDropped += 1;
    } else {
      await tx.foodReview.delete({ where: { id: review.id } });
      stats.reviewsDropped += 1;
    }
  }

  await tx.product.delete({ where: { id: thin.id } });
  stats.merged += 1;
}

/** Step 2: give a prototype pizza exactly the prototype's sizes and content. */
async function normalize(tx: Prisma.TransactionClient, productId: number, def: MenuProduct): Promise<void> {
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, include: { variations: true } });
  let changed = false;
  const claimed = new Set<number>();

  for (const [i, want] of def.variations.entries()) {
    const k = sizeKey(want.name);
    const have =
      product.variations.find((v) => !claimed.has(v.id) && v.name === want.name) ??
      product.variations.find((v) => !claimed.has(v.id) && k !== null && sizeKey(v.name) === k);
    const data = variationData(want, i);
    if (have) {
      claimed.add(have.id);
      const same =
        have.name === data.name &&
        have.price.equals(data.price) &&
        have.servingInfo === data.servingInfo &&
        have.variantType === data.variantType &&
        have.sortOrder === data.sortOrder &&
        have.isDefault === data.isDefault &&
        have.isEnabled === data.isEnabled &&
        have.dineInOnly === data.dineInOnly;
      if (!same) {
        await tx.productVariation.update({ where: { id: have.id }, data });
        stats.variationsChanged += 1;
        changed = true;
      }
    } else {
      await tx.productVariation.create({ data: { ...data, productId } });
      stats.variationsChanged += 1;
      changed = true;
    }
  }
  // A size the prototype does not have (none on a seeded database): hidden, not
  // deleted, so any order line pointing at it keeps its variation.
  for (const v of product.variations) {
    if (claimed.has(v.id) || !v.isEnabled) continue;
    await tx.productVariation.update({ where: { id: v.id }, data: { isEnabled: false, isDefault: false } });
    stats.variationsChanged += 1;
    changed = true;
  }

  const orderable = def.variations.filter((v) => v.enabled && !v.dineInOnly);
  const basePrice = new Prisma.Decimal((orderable.find((v) => v.isDefault) ?? orderable[0]).price);
  const target = {
    name: def.name,
    description: def.description,
    ingredients: def.ingredients ?? "",
    isSpicy: def.spicy ?? false,
    isVegetarian: def.vegetarian ?? false,
    variationType: def.variationType,
    price: basePrice,
  };
  const same =
    product.name === target.name &&
    product.description === target.description &&
    product.ingredients === target.ingredients &&
    product.isSpicy === target.isSpicy &&
    product.isVegetarian === target.isVegetarian &&
    product.variationType === target.variationType &&
    product.price.equals(target.price);
  if (!same) {
    await tx.product.update({ where: { id: productId }, data: target });
    changed = true;
  }
  if (changed) stats.productsNormalized += 1;
}

function variationData(v: MenuVariation, sortOrder: number) {
  return {
    name: v.name,
    price: new Prisma.Decimal(v.price),
    servingInfo: v.servingInfo,
    variantType: v.crust ?? "",
    sortOrder,
    isDefault: v.isDefault ?? false,
    isEnabled: v.enabled,
    dineInOnly: v.dineInOnly ?? false,
  };
}

async function main(): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const before = await orderLineTotal(tx);
      const beforeCount = await tx.product.count();

      // 1. Merge "(Thin)" twins into their thick product (same branch + brand).
      const all = await tx.product.findMany({ select: { id: true, branchId: true, brand: true, name: true } });
      for (const thin of all.filter((p) => THIN_SUFFIX.test(p.name))) {
        const base = key(thin.name.replace(THIN_SUFFIX, ""));
        const thick = all.find(
          (p) => p.id !== thin.id && p.branchId === thin.branchId && p.brand === thin.brand && key(p.name) === base,
        );
        if (thick) await mergeTwin(tx, thin.id, thick.id);
        else console.warn(`! no thick twin for #${thin.id} "${thin.name}" (branch ${thin.branchId}), left as is`);
      }

      // 2. Prototype pizzas: exact sizes, About, ingredients, badges.
      const products = await tx.product.findMany({ select: { id: true, brand: true, name: true, description: true } });
      for (const p of products) {
        const def = p.brand ? CANONICAL.get(`${p.brand}|${key(p.name)}`) : undefined;
        if (def) await normalize(tx, p.id, def);
      }

      // 3. Anything else still carrying "Inside: …" in its description.
      const rest = await tx.product.findMany({ where: { description: { contains: INSIDE } }, select: { id: true, description: true, ingredients: true } });
      for (const p of rest) {
        const split = splitInside(p.description)!;
        await tx.product.update({
          where: { id: p.id },
          data: { description: split.about, ingredients: p.ingredients || split.ingredients },
        });
        stats.descriptionsSplit += 1;
      }

      const after = await orderLineTotal(tx);
      if (before !== after) throw new Error(`order lines changed: ${before} -> ${after}`);
      console.log(`products ${beforeCount} -> ${await tx.product.count()}; order lines unchanged (${after})`);
      console.log(stats);
      if (DRY_RUN) throw new DryRun();
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
  console.log("✔ applied");
}

class DryRun extends Error {}

main()
  .catch((e) => {
    if (e instanceof DryRun) {
      console.log("dry run: rolled back, nothing written");
      return;
    }
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
