import type { MenuProduct } from "./menu-data";

// DEMO placeholder products: not from the prototype menu. They fill out the
// two thin Cheez categories (Appetizers, Carbonated Beverages) to 4 items each.
// Listed in docs/handoff/real-catalog-and-screenshots-report.md ("Demo
// placeholders"); remove them there and here, and from dev.db by name, to drop.
export const DEMO_PRODUCTS: MenuProduct[] = [
  {
    brand: "cheez",
    category: "Appetizers",
    name: "Cheesy Potato Wedges",
    description: "Crispy seasoned potato wedges with creamy cheese sauce and fresh herbs.",
    ingredients: "Potato, Cheese Sauce, Herbs",
    image: "cheez/cheesy-potato-wedges.webp",
    variationType: "THICK",
    preparationTime: 12,
    variations: [{ name: "Regular", price: 249, servingInfo: "Serves 1", enabled: true }],
  },
  {
    brand: "cheez",
    category: "Appetizers",
    name: "BBQ Chicken Wings (6 pcs)",
    description: "Sticky glazed BBQ chicken wings topped with sesame and spring onion.",
    ingredients: "Chicken, BBQ Sauce, Sesame, Spring Onion",
    spicy: true,
    image: "cheez/bbq-chicken-wings.webp",
    variationType: "THICK",
    preparationTime: 18,
    variations: [{ name: "Regular", price: 349, servingInfo: "6 pcs", enabled: true }],
  },
  {
    brand: "cheez",
    category: "Carbonated Beverages",
    name: "Fresh Lime Soda",
    description: "Sparkling soda with fresh lime and mint, served chilled.",
    ingredients: "Lime, Mint, Soda",
    vegetarian: true,
    image: "cheez/fresh-lime-soda.webp",
    variationType: "THICK",
    preparationTime: 5,
    variations: [{ name: "Regular", price: 99, servingInfo: "350ml", enabled: true }],
  },
  {
    brand: "cheez",
    category: "Carbonated Beverages",
    name: "Blue Lagoon Soda",
    description: "Sparkling blue citrus soda with lemon, served chilled.",
    ingredients: "Blue Curacao Syrup (non-alcoholic), Lemon, Soda",
    vegetarian: true,
    image: "cheez/blue-lagoon-soda.webp",
    variationType: "THICK",
    preparationTime: 5,
    variations: [{ name: "Regular", price: 119, servingInfo: "350ml", enabled: true }],
  },
];
