import test from "node:test";
import assert from "node:assert/strict";

import { dedupeShowcase } from "@/lib/home/showcase-dedupe";
import type { MenuItem, PublicCategory } from "@/lib/home/types";

function item(id: number, branchId: number, name: string, group: string, category: string, brand = "cheez"): MenuItem {
  return { id: String(id), name, description: "", price: 100, image: "", brand, category, group, emoji: "", branchId, branchName: `B${branchId}` } as MenuItem;
}

test("two branches with identical menus show every product and tab once", () => {
  const items: MenuItem[] = [];
  const categories: PublicCategory[] = [];
  let id = 1;
  for (const branch of [2, 1]) {
    const cat = branch * 10;
    categories.push({ key: String(cat), label: "Desserts", emoji: "", brand: "cheez" });
    for (const name of ["Brownie", "Sundae"]) items.push(item(id++, branch, name, "Desserts", String(cat)));
  }
  const out = dedupeShowcase({ items, categories });
  assert.equal(out.items.length, 2);
  assert.equal(out.categories.length, 1);
  assert.ok(out.items.every((i) => i.branchId === 1), "lowest branch is the stand-in");
  assert.ok(out.items.every((i) => i.category === out.categories[0].key), "cards point at the surviving tab");
});

test("same name under another brand or category is kept", () => {
  const items = [
    item(1, 1, "Fries", "Sides", "1"),
    item(2, 1, "Fries", "Sides", "2", "madchef"),
    item(3, 1, "Fries", "Extras", "3"),
  ];
  const categories: PublicCategory[] = [
    { key: "1", label: "Sides", emoji: "", brand: "cheez" },
    { key: "2", label: "Sides", emoji: "", brand: "madchef" },
    { key: "3", label: "Extras", emoji: "", brand: "cheez" },
  ];
  const out = dedupeShowcase({ items, categories });
  assert.equal(out.items.length, 3);
  assert.equal(out.categories.length, 3);
});
