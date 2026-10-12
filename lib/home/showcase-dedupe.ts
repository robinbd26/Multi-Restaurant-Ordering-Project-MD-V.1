import type { MenuItem, PublicCategory } from "@/lib/home/types";

/**
 * SHOWCASE DEDUPE — one menu per brand for a visitor who has not picked a branch.
 *
 * The catalogue is branch-specific: every branch owns its own Product and
 * Category rows, so the all-branches query returns the same menu once per
 * branch (73 products × 10 Cheez branches = 730 cards). A guest cannot order
 * from "all branches" anyway — they are looking at ONE menu — so the showcase
 * lists each brand + category + product name once and shows each category tab
 * once.
 *
 * The card that stands in for the group is the lowest-numbered branch's copy
 * (stable, so two renders never disagree). It keeps its real product id and
 * branch, so adding it still puts a real, branch-locked product in the cart;
 * when the visitor signs in and their own branch differs, the existing cart
 * branch-switch dialog (home-cart-context) reconciles it. Never used for a
 * branch-scoped view — that one shows the branch's own prices and availability.
 */

const norm = (s: string) => s.trim().toLowerCase();

function repRank(a: MenuItem, b: MenuItem): number {
  return (a.branchId ?? Infinity) - (b.branchId ?? Infinity) || Number(a.id) - Number(b.id);
}

export function dedupeShowcase<T extends { items: MenuItem[]; categories: PublicCategory[] }>(
  menu: T,
): { items: MenuItem[]; categories: PublicCategory[] } {
  // One tab per brand + category name; its key is the first one seen.
  const categories: PublicCategory[] = [];
  const tabKey = new Map<string, string>();
  for (const c of menu.categories) {
    const k = `${c.brand}|${norm(c.label)}`;
    if (tabKey.has(k)) continue;
    tabKey.set(k, c.key);
    categories.push(c);
  }

  const reps = new Map<string, MenuItem>();
  for (const item of menu.items) {
    const k = `${item.brand}|${norm(item.group ?? "")}|${norm(item.name)}`;
    const cur = reps.get(k);
    if (!cur || repRank(item, cur) < 0) reps.set(k, item);
  }

  // Keep the original (featured-first) order of each group's first appearance.
  const emitted = new Set<string>();
  const items: MenuItem[] = [];
  for (const item of menu.items) {
    const k = `${item.brand}|${norm(item.group ?? "")}|${norm(item.name)}`;
    if (emitted.has(k)) continue;
    emitted.add(k);
    const rep = reps.get(k)!;
    const key = tabKey.get(`${rep.brand}|${norm(rep.group ?? "")}`) ?? rep.category;
    items.push(key === rep.category ? rep : { ...rep, category: key });
  }
  return { items, categories };
}
