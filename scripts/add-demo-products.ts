/**
 * Adds the four DEMO placeholder Cheez products (prisma/seed-real/demo-products.ts)
 * to every branch that sells Cheez and has the matching category, without a
 * re-seed. Idempotent: a branch that already has a product of that name is
 * skipped, so running it twice adds nothing. Other data is never touched.
 *
 *   npm run demo:products
 *
 * (Runs through the same server-only shim as seed:real, because the photos go
 * through the app's own upload pipeline.)
 */
import "../prisma/seed-real/load-env";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "../lib/db";
import { saveUpload } from "../lib/http/upload";
import { DEMO_PRODUCTS } from "../prisma/seed-real/demo-products";

const ASSET_DIR = path.join(process.cwd(), "prisma", "seed-real", "assets", "menu");

async function main() {
  let added = 0;
  let existing = 0;
  const skipped: string[] = [];
  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });

  for (const branch of branches) {
    for (const item of DEMO_PRODUCTS) {
      const category = await prisma.category.findFirst({
        where: { branchId: branch.id, brand: item.brand, name: item.category },
      });
      if (!category) {
        // Not a branch of this brand (or its category is gone): nothing to add.
        if (await prisma.branchBrand.findFirst({ where: { branchId: branch.id, brand: { slug: item.brand } } })) {
          skipped.push(`${branch.name}: no "${item.category}" category`);
        }
        continue;
      }
      if (await prisma.product.findFirst({ where: { branchId: branch.id, name: item.name } })) {
        existing += 1;
        continue;
      }
      const buf = await readFile(path.join(ASSET_DIR, item.image!));
      const file = new File([new Uint8Array(buf)], path.basename(item.image!), { type: "image/webp" });
      const size = item.variations[0];
      const product = await prisma.product.create({
        data: {
          branchId: branch.id,
          categoryId: category.id,
          name: item.name,
          description: item.description,
          ingredients: item.ingredients ?? "",
          isSpicy: item.spicy ?? false,
          isVegetarian: item.vegetarian ?? false,
          price: new Prisma.Decimal(size.price),
          brand: item.brand,
          image: await saveUpload(file, "products", "image"),
          isAvailable: true,
          preparationTime: item.preparationTime ?? 15,
          variationType: item.variationType,
        },
      });
      await prisma.productVariation.create({
        data: {
          productId: product.id,
          name: size.name,
          price: new Prisma.Decimal(size.price),
          servingInfo: size.servingInfo,
          isDefault: true,
          isEnabled: true,
          sortOrder: 0,
        },
      });
      added += 1;
    }
  }
  console.log(`Demo products: ${added} added, ${existing} already there.`);
  for (const line of skipped) console.log(`  skipped - ${line}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
