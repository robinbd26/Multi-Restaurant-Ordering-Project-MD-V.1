// Extracted once from the client's frontend prototype (github.com/robinbd24/MAD-Delivery-V.2,
// the data in its index.html bundle). CONTENT ONLY: names, descriptions, sizes,
// crusts, prices and photos. The mapping rules are written up in
// docs/handoff/real-catalog-and-screenshots-report.md.
//
// Images live in prisma/seed-real/assets/menu/<brand>/ and go through the app's
// own upload pipeline (saveUpload -> storage/uploads/products) when seeded.

export interface MenuVariation {
  name: string;
  price: number;
  /** Shown under the size name, e.g. "8 slices". */
  servingInfo: string;
  isDefault?: boolean;
  /** false = kept for the record but hidden from the menu. */
  enabled: boolean;
  /** Listed on the menu but never sold online (the prototype's 8" pizzas). */
  dineInOnly?: boolean;
  /** The crust this size is baked in, when it has exactly one (12"/16" thin, 14" thick). */
  crust?: "THICK" | "THIN";
}

export interface MenuProduct {
  brand: "cheez" | "madchef";
  category: string;
  name: string;
  /** The About sentence. "What's inside" lives in `ingredients`, not here. */
  description: string;
  /** Comma-separated ingredient chips, e.g. "Green Chili, Pesto". */
  ingredients?: string;
  /** Prototype `taste: "Spicy"`. */
  spicy?: boolean;
  /** Prototype `types: "Vegetable"`. */
  vegetarian?: boolean;
  /** Path under prisma/seed-real/assets/menu/, or null for items with no photo. */
  image: string | null;
  /**
   * Crust policy THICK | THIN | BOTH. Non-pizza items use THICK, the app default: the storefront hides "" (not applicable) products.
   * A pizza is ONE product with BOTH: each size carries its own crust, so thick and thin are never separate products.
   */
  variationType: "THICK" | "THIN" | "BOTH";
  variations: MenuVariation[];
  /** Minutes; the seed falls back to 25 for pizza and 15 for everything else. */
  preparationTime?: number;
}

export const PROTOTYPE_MENU: MenuProduct[] = [
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Margherita",
    "description": "Topped with original italian tomato sauce, mozzarella & cheddar cheese, roasted tomato, fragrant oregano & basil leave.",
    "ingredients": "Cheez, Less Vegetable (Plain Pizza)",
    "image": "cheez/classic-margherita.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 299,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 699,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 849,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 999,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "The Pepperonia",
    "description": "Spread of tomato sauce with smoky pepperoni, mozzarella, topped up with fragrant oregano.",
    "ingredients": "Beef",
    "image": "cheez/the-pepperonia.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 349,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 849,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1049,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1199,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "All Bout the Shroom",
    "description": "Topped with button & black mushroom fungi combo-based with white sauce, mozzarella, cheddar & feta, spicy onion, roasted tomato, green sauce & sea salt.",
    "ingredients": "Mushrooms — Black & White (Vegetable)",
    "vegetarian": true,
    "image": "cheez/all-bout-the-shrooms.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 349,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 849,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1049,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1199,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Fiery Corned Beef",
    "description": "Topped with salt-cured brisket of corned beef, based with red & white sauce, mozzarella, spicy onion, mashed sausage gravy & sriracha-mustard cream.",
    "ingredients": "Beef (Normal Spicy)",
    "spicy": true,
    "image": "cheez/fiery-corned-beef.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 379,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 899,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1149,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1299,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Bolognese",
    "description": "Topped with minced beef caramelized in red sauce, delicately covered with a mixture of mozzarella & parmesan cheese.",
    "ingredients": "Beef Kima",
    "image": "cheez/bolognese.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 379,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 899,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1149,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1299,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Chicken Alfredo",
    "description": "Topped with alfredo chicken cubes & mushrooms, showered with a white sauce based on mozzarella, cheddar & parmesan cheese.",
    "ingredients": "Chicken, Mushroom",
    "image": "cheez/chicken-alfredo.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 379,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 899,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1149,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1299,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Thai Pie",
    "description": "Topped with savory thai chicken, mozzarella, cheddar, shrimp, tomato sauce, sriracha cream & sesame seed.",
    "ingredients": "Chicken, (Optional: Shrimp), Vegetable",
    "image": "cheez/thai-pie.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 399,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1049,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1249,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1399,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Spicy Shorisha",
    "description": "Topped with red & white sauce, mozzarella, succulent shrimp with a twist of mashed mustard, chili-flakes & parsley.",
    "ingredients": "Shrimp (Sea Food)",
    "spicy": true,
    "image": "cheez/spicy-shorisha.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 399,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1049,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1249,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1399,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Fajitas Chicken",
    "description": "A fusion-style pizza topped with spiced grilled chicken, bell peppers, onions, and fajita-seasoned sauce for a Tex-Mex twist.",
    "ingredients": "Fajitas Chicken",
    "image": "cheez/fajitas-fiesta.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 379,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 899,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1149,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1299,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Lal Jhal Chicken",
    "description": "A fiery pizza topped with fajita chicken, molten cheese & five sauces teaming up to choose violence.",
    "ingredients": "Chicken (Spicy)",
    "spicy": true,
    "image": "cheez/lal-jhal-chicken.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 349,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 849,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1049,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1199,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Green Chili Pesto",
    "description": "A spicy pizza topped with green chili, pesto sauce, cheese & herbs.",
    "ingredients": "Green Chili, Pesto",
    "vegetarian": true,
    "image": "cheez/green-chilli-pesto.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 279,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 599,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 799,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 899,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Classic Pizzas",
    "name": "Smokewood BBQ Chicken",
    "description": "A smokey pizza topped with bbq sauce, tender chicken & melty cheese in full comfort food mode.",
    "ingredients": "Smokewood BBQ Chicken",
    "image": "cheez/smokewood-bbq-chicken.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 379,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 899,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1149,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1299,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "More For Less Pizzas",
    "name": "Liquid Gold",
    "description": "Cheez only — 3 types of cheese in one golden melt.",
    "ingredients": "Cheez (3 Type Cheez)",
    "image": "cheez/liquid-gold.jpg",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 199,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 449,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 619,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 699,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "More For Less Pizzas",
    "name": "Spicy Sausage",
    "description": "Topped with soft chunks of spicy sausage surrounded by parmesan cheese infused with kisan cheese, topped with our special naga sauce.",
    "ingredients": "Chicken Sausage (Spicy)",
    "spicy": true,
    "image": "cheez/spicy-sausage.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 239,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 499,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 729,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 799,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "More For Less Pizzas",
    "name": "Creamy Chicken & Sausage",
    "description": "Topped with tender creamy chicken pieces, a pack of sausages which gets surrounded by an army of cheese.",
    "ingredients": "Chicken Creamy, Sausage (Normal Spicy)",
    "spicy": true,
    "image": "cheez/creamy-chicken-and-sausage.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 279,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 649,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 829,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 949,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Gourmet Pizzas",
    "name": "The 4 Cheez",
    "description": "Topped with a delicious mix of mozzarella, cheddar, feta & parmesan cheese & crispy beef bacon bits.",
    "ingredients": "Beef, Cheez (Beef Bacon Removeable)",
    "image": "cheez/the-4-cheez.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 399,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1049,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1249,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1399,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Gourmet Pizzas",
    "name": "Nagatastic BBQ",
    "description": "Topped with barbequed chicken cubes mixed with white & spicy naga sauce, mozzarella, cheddar cheese & crispy bacon bits.",
    "ingredients": "Chicken (Beef Removeable)",
    "spicy": true,
    "image": "cheez/nagatastic-bbq.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 429,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1099,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1299,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1449,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Gourmet Pizzas",
    "name": "The Kala Bhuna",
    "description": "Topped with chatgaiyya kala-bhuna beef pieces based with tomato & garlic sauce, cheddar cheese, capsicum, spicy onion, green sauce & sea salt.",
    "ingredients": "Beef (Normal Spicy)",
    "spicy": true,
    "image": "cheez/the-kala-bhuna.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 429,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1099,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1399,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1599,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Gourmet Pizzas",
    "name": "Hot Crabby Prawnstar",
    "description": "Topped with a tangy seafood affair between hot spicy cajun shrimp & crunchiest crab-sticks.",
    "ingredients": "Crabby, Shrimp (Sea Food)",
    "spicy": true,
    "image": "cheez/hot-crabby-prawnstar.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 429,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1099,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1349,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1549,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Gourmet Pizzas",
    "name": "Kolongo The Disgrace",
    "description": "Packs fiery hot naga chicken, thin and crisp slices of pepperoni, and delectably meaty sausage, layered with melted mozzarella & kishan cheese in every bite.",
    "ingredients": "Chicken, Beef (Beef Removeable)",
    "spicy": true,
    "image": "cheez/kolongko-the-disgrace.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 479,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1199,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1499,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1699,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Gourmet Pizzas",
    "name": "Smoked Cheddar Tikka",
    "description": "A flavorful pizza topped with smoky cheddar cheese, juicy chicken tikka pieces, and a blend of aromatic spices.",
    "ingredients": "Chicken, Mushroom, Dhoniya, Capsicum, Onion (Removeable)",
    "image": "cheez/smoked-cheddar-tikka.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 429,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1099,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1299,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1499,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Gourmet Pizzas",
    "name": "Meat Lovers",
    "description": "Topped with chicken, beef kala bhuna, chicken sausage, capsicum, mozzarella cheese & green chili.",
    "ingredients": "Beef, Chicken, Sauces",
    "image": "cheez/meat-lovers-pizza.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 479,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1249,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1499,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1699,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Gourmet Pizzas",
    "name": "SMG",
    "description": "Topped with gorgeous mozzarella, cheddar, feta & parmesan cheese over alfredo chicken & pepperoni, topped with crispy bacon bits.",
    "ingredients": "Beef, Chicken, Mushroom (Beef Removeable)",
    "image": "cheez/smg.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 479,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1199,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1499,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1699,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Gourmet Pizzas",
    "name": "Grand Garlic Shrimp",
    "description": "A flavorful pizza topped with mozzarella & cheddar over juicy shrimp with serious garlic energy.",
    "ingredients": "Garlic, Shrimp (Sea Food)",
    "image": "cheez/grand-garlic-shrimp.webp",
    "variationType": "BOTH",
    "variations": [
      {
        "name": "8 inch – Thick & Thin",
        "price": 479,
        "servingInfo": "Dine-in only",
        "enabled": true,
        "dineInOnly": true
      },
      {
        "name": "12 inch – Thin Crust",
        "price": 1199,
        "servingInfo": "6 Slices",
        "crust": "THIN",
        "enabled": true
      },
      {
        "name": "14 inch – Thick Crust",
        "price": 1499,
        "servingInfo": "8 Slices",
        "crust": "THICK",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "16 inch – Thin Crust",
        "price": 1699,
        "servingInfo": "8 Slices",
        "crust": "THIN",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pasta",
    "name": "Fettuccine Alfredo",
    "description": "Creamy buttery fettuccine tossed with tender chicken in a rich alfredo sauce & parmesan cheese",
    "image": "cheez/creamy-chicken-alfredo.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 549,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pasta",
    "name": "Mac n Cheezsteak",
    "description": "Macaroni pasta with tender steak meat, capsicums & button mushrooms alongside a perfect blend of mozzarella, parmesan cheese & sriracha sauce",
    "image": "cheez/mac-n-cheezsteak.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 649,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pasta",
    "name": "Naga Chicken Bake",
    "description": "Cheezy macaroni pasta with tomato baked with mozzarella cheese on top & hot chunks of naga chicken with capsicum & chili flake",
    "image": "cheez/naga-chicken-bake.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 549,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pasta",
    "name": "Seafood Marinara",
    "description": "Perfect affair of crabs & shrimps with the blend of tomato, herb & spices",
    "image": "cheez/seafood-marinara.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 649,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pasta",
    "name": "Shrimp Aglio Olio",
    "description": "Juicy shrimp tossed in olive oil, garlic, chili flakes & lemony freshness",
    "image": "cheez/shrimp-aglio-olio.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 699,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pasta",
    "name": "Chicken Chili Crisp Spaghetti",
    "description": "Prepared with spaghetti, chicken, spicy chili crisp, onion & special herbs",
    "image": "cheez/chicken-chili-crisp-spaghetti.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 499,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pasta",
    "name": "Truffle Shiitake Penne",
    "description": "Creamy buttery penne with shiitake mushrooms & black pepper warmth",
    "image": "cheez/truffle-shiitake-penne.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 549,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pasta",
    "name": "Spaghetti Bolognese",
    "description": "Prepared with spaghetti, minced beef, tomato sauce, herbs & cheese",
    "image": "cheez/spaghetti-bolognese.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 649,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pizza Boats",
    "name": "Classic Boat",
    "description": "It doesn't get much better than a warm slice of garlic bread immersed in cheezy goodness taken freshly out of the oven",
    "image": "cheez/classic-garlic-boat.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 349,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pizza Boats",
    "name": "Alfredo Boat",
    "description": "Creamy alfredo infused with tender pieces of chicken & gooey cheez sits atop a soft gentle boat made of garlic bread",
    "image": "cheez/alfredo-boat.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 399,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pizza Boats",
    "name": "Steak Boat",
    "description": "Tender steak enveloped in a cheezy goodness floods a tasty garlic bread boat to the brim",
    "image": "cheez/steak-boat.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 449,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Pizza Boats",
    "name": "Spicy Sausage Boat",
    "description": "Be careful this might sting a bit! Chunks of spicy sausage engulfed in a wave of cheezy goodness rest on top of a soft garlic bread boat",
    "image": "cheez/spicy-sausage-boat.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 399,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Appetizers",
    "name": "Cheezy Garlic Bread",
    "description": "Cheezy garlic bread with a crunchy crust & herb infused flavors, topped with mozzarella cheese",
    "image": "cheez/cheezy-garlic-bread.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 299,
        "servingInfo": "6 pcs",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Appetizers",
    "name": "Spicy Garlic Bread",
    "description": "Prepared with naga sauce, garlic sauce, mozzarella cheese & fresh parsley",
    "image": "cheez/spicy-garlic-bread.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 329,
        "servingInfo": "6 pcs",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Soups",
    "name": "Cream Of Tomato",
    "description": "Freshly roasted tomatoes meet creamy goodness",
    "image": "cheez/cream-of-tomato.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 399,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Soups",
    "name": "Cream Of Mushroom",
    "description": "Hearty blend of creamy mushrooms & earthly flavors",
    "image": "cheez/cream-of-mushroom.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 449,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Soups",
    "name": "Bacon Cheddar Chowder",
    "description": "Cheeziest soup in town with a generous serving of bacon bits",
    "image": "cheez/bacon-cheddar-chowder.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 499,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Drinks",
    "name": "Lemon Iced Tea",
    "description": "Prepared with tea liquor, fresh lemon juice, sugar syrup & ice",
    "image": "cheez/lemon-iced-tea.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 219,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Drinks",
    "name": "Lime Refreshmint",
    "description": "Prepared with green mint leaves, black salt, sugar syrup, fresh lemon juice, ice & filter water",
    "image": "cheez/lime-refreshment.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 219,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Drinks",
    "name": "Honey Limeade",
    "description": "Prepared with honey, green mint leaves, fresh lemon juice, ice & soda water",
    "image": "cheez/honey-limeade.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 249,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Drinks",
    "name": "Passion Punk",
    "description": "Prepared with fresh lemon juice, sugar syrup, passion fruit squash, soft drinks & ice",
    "image": "cheez/passion-punk.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 279,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Carbonated Beverages",
    "name": "Mojo Can",
    "description": "Bangladesh's No.1 local cola brand — refreshes with a rewardingly uplifting experience · 250ml",
    "image": "cheez/mojo-can.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 40,
        "servingInfo": "250ml",
        "enabled": true
      }
    ]
  },
  {
    "brand": "cheez",
    "category": "Carbonated Beverages",
    "name": "Clemon Can",
    "description": "Made from fresh lemon extract — aids digestion & prevents acidity · 250ml",
    "image": "cheez/clemon-can.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 40,
        "servingInfo": "250ml",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Classic Burgers",
    "name": "Signature Chicken",
    "description": "Tasty burger prepared with chicken patty & signature sauce\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/signature-chicken.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 299,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 299,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Classic Burgers",
    "name": "Signature Beef",
    "description": "Juicy burger prepared with beef patty & signature sauce\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/signature-beef.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 329,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 329,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Gourmet Burgers",
    "name": "Mad Chicken Sandwich",
    "description": "Savory burger prepared with crispy chicken patty & cocktail sauce\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/mad-chicken-sandwich.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 379,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 379,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Gourmet Burgers",
    "name": "Smokin' Chic",
    "description": "BBQ burger prepared with chicken patty, smoked chicken & bacon\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/smokin-chic.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 449,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 449,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Gourmet Burgers",
    "name": "Mushroom Melt",
    "description": "Juicy burger prepared with beef patty & cheesy mushroom sauce\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/mushroom-melt.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 449,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 449,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Gourmet Burgers",
    "name": "Shrimp Supreme",
    "description": "Savory burger prepared with cajun shrimp patty & tartar sauce\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/shrimp-supreme.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 479,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 479,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Gourmet Burgers",
    "name": "Madchef's Fav!",
    "description": "Classic burger prepared with naga blast & crispy pepperoni\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/madchefs-fav.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 479,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 479,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Gourmet Burgers",
    "name": "Madame Lucy",
    "description": "Hearty burger prepared with beef patty, sausage gravy & bacon\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/madame-lucy.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 499,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 499,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Gourmet Burgers",
    "name": "The Dhakaiya",
    "description": "Unique burger prepared with beef patty & fried paneer\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/the-dhakaiya.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 499,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 499,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Gourmet Burgers",
    "name": "The Hawk",
    "description": "Deluxe burger prepared with double beef patty & crispy pepperoni\nSauce: Classic, Garlic Mayo, Smokedwood BBQ or Nagablast (mention yours in the order note).",
    "image": "madchef/the-hawk.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Potato Brioche",
        "price": 699,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Garlic Crusted Brioche",
        "price": 699,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Burger Extras",
    "name": "Cheese Slice",
    "description": "Add to any burger.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 39,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Burger Extras",
    "name": "Beef Bacon",
    "description": "Add to any burger.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 89,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Burger Extras",
    "name": "Beef Pepperoni",
    "description": "Add to any burger.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 89,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Burger Extras",
    "name": "Smoked Chicken",
    "description": "Add to any burger.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 89,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Burger Extras",
    "name": "Extra Patty",
    "description": "Add to any burger.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 199,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Burger Extras",
    "name": "Jalapeño",
    "description": "Add to any burger.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 39,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Burger Extras",
    "name": "Pickle",
    "description": "Add to any burger.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 19,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Burger Extras",
    "name": "Egg",
    "description": "Add to any burger.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 19,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Wraps",
    "name": "Garlic Gyro Chicken",
    "description": "Flavorful wrap prepared with gyro chicken & garlic sauce",
    "image": "madchef/garlic-gyro-chicken-wrap.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 319,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Spicy",
        "price": 319,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Wraps",
    "name": "Crispy Chicken",
    "description": "Crunchy wrap prepared with crispy chicken & signature sauce",
    "image": "madchef/crispy-chicken-wrap.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 299,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Spicy",
        "price": 299,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Wraps",
    "name": "Velvet Mushroom",
    "description": "Creamy wrap prepared with mushroom & savory white sauce",
    "image": "madchef/velvet-mushroom-wrap.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 299,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Wraps",
    "name": "Green Chilli Chicken",
    "description": "Spicy wrap prepared with chicken & green chili sauce",
    "image": "madchef/green-chili-chicken-wrap.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 319,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Wraps",
    "name": "Sausage & Egg",
    "description": "Breakfast wrap prepared with sausage, egg & fresh vegetable",
    "image": "madchef/egg-and-sausage-wrap.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 299,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Poutines",
    "name": "Roast Chicken",
    "description": "Consists of potato fries, shredded roast chicken & brown gravy",
    "image": "madchef/roast-chicken-poutine.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 399,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Poutines",
    "name": "Gyro Chicken Over Cajun Fries",
    "description": "Consists of cajun fries, gyro chicken & mint yogurt sauce",
    "image": "madchef/gyro-chicken-over-cajun-fries.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 499,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Poutines",
    "name": "Shah Poutine",
    "description": "Consists of fries, beef bacon, garlic mushroom & fried egg",
    "image": "madchef/shah-poutine.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 499,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Poutines",
    "name": "Crispy Chicken & Bacon",
    "description": "Consists of fries, katsu chicken, beef bacon & brown gravy",
    "image": "madchef/crispy-chicken-and-bacon-poutine.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 499,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Rice Meals",
    "name": "Achari Rice with Katsu Chicken",
    "description": "Consists of achari fried rice & crispy katsu chicken",
    "image": "madchef/achari-rice-with-katsu-chicken.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Garlic Achar Rice",
        "price": 399,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Naga Achar Rice",
        "price": 399,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Rice Meals",
    "name": "Bangkok Chicken Rice Meal",
    "description": "Consists of bangkok style chicken, sauteed vegetable & egg rice",
    "image": "madchef/bangkok-chicken-rice-meal.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 449,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Rice Meals",
    "name": "Spicy Basil Chicken",
    "description": "Consists of spicy thai basil chicken, butter rice & egg",
    "image": "madchef/spicy-basil-chicken.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 449,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Rice Meals",
    "name": "Korean Chargrilled Chicken",
    "description": "Consists of chargrilled chicken, sauteed vegetable & fried rice",
    "image": "madchef/korean-chargrilled-chicken.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 549,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Rice Meals",
    "name": "Steak n Mushroom Adobo",
    "description": "Consists of savory beef steak, mushroom & egg fried rice",
    "image": "madchef/steak-n-mushroom-adobo.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 549,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Rice Meals",
    "name": "Gyro Chicken Over Rice",
    "description": "Consists of spiced gyro chicken, mint yogurt & fried rice",
    "image": "madchef/gyro-chicken-over-rice.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 579,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Rice Meals",
    "name": "Smoked Butter Chicken",
    "description": "Consists of smoked butter chicken, cashewnut & butter rice",
    "image": "madchef/smoked-butter-chicken.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 579,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Rice Meals",
    "name": "Spicy Basil Beef",
    "description": "Consists of spicy thai basil beef, butter rice & egg",
    "image": "madchef/spicy-basil-beef.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 579,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Rice Meals",
    "name": "Creamy Mushroom Stuffed Chicken",
    "description": "Consists of mushroom stuffed chicken, sauteed vegetable & rice",
    "image": "madchef/creamy-mushroom-stuffed-chicken.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 649,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Teasers",
    "name": "Chicken Cheese Bombs",
    "description": "Juicy chicken bites stuffed with molten cheddar cheese & fried golden",
    "image": "madchef/chicken-cheese-bombs.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 349,
        "servingInfo": "4 pcs",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Teasers",
    "name": "Paneer Sticks",
    "description": "Crispy golden sticks made from fresh paneer, lightly spiced & deep fried",
    "image": "madchef/paneer-sticks.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "4 pcs",
        "price": 379,
        "servingInfo": "",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "6 pcs",
        "price": 549,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Teasers",
    "name": "Spicy Garlic Mushrooms",
    "description": "Sautéed button mushrooms tossed in garlic butter & house chili blend",
    "image": "madchef/spicy-garlic-mushroom.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 399,
        "servingInfo": "180-200gms",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Teasers",
    "name": "Onion Rings",
    "description": "Crispy onion rings prepared with sliced onion & seasoned batter",
    "image": "madchef/onion-rings.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 179,
        "servingInfo": "12 pcs",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Fries",
    "name": "Salt & Pepper Fries",
    "description": "Simple fries prepared with sliced potato, salt & pepper",
    "image": "madchef/salt-and-pepper-fries.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Medium",
        "price": 139,
        "servingInfo": "",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Large",
        "price": 179,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Fries",
    "name": "Spicy Cajun Fries",
    "description": "Zesty fries prepared with potato, cajun spice & deep fry",
    "image": "madchef/spicy-cajun-fries.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Medium",
        "price": 159,
        "servingInfo": "",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Large",
        "price": 199,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Fries",
    "name": "OG Cheez Fries",
    "description": "Cheesy fries prepared with potato & melted cheddar cheese",
    "image": "madchef/og-cheez-fries.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 279,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Fries",
    "name": "Bomb Fries",
    "description": "Spicy fries prepared with potato, secret spice & cheese",
    "image": "madchef/bomb-fries.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 379,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Crispy Chicken",
    "name": "Chicken Wings",
    "description": "Crispy golden chicken wings tossed in your choice of signature sauce.\nFlavours: The Original, Buffalo, Naga Tastic or Mango Habanero (mention yours in the order note).",
    "image": "madchef/chicken-wings.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "4 pcs",
        "price": 239,
        "servingInfo": "",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "6 pcs",
        "price": 349,
        "servingInfo": "",
        "enabled": true
      },
      {
        "name": "10 pcs",
        "price": 549,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Crispy Chicken",
    "name": "Bangkok Style Crispy Chicken",
    "description": "Bangkok-style crispy chicken with bold Southeast Asian flavours, served in your choice of sauce.\nFlavours: The Original, Buffalo, Naga Tastic or Mango Habanero (mention yours in the order note).",
    "image": "madchef/bangkok-style-crispy-chicken.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "4 pcs",
        "price": 279,
        "servingInfo": "",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "6 pcs",
        "price": 399,
        "servingInfo": "",
        "enabled": true
      },
      {
        "name": "10 pcs",
        "price": 649,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Mocktails",
    "name": "Lemon Iced Tea",
    "description": "Refreshing drink prepared with tea, lemon & cold water",
    "image": "madchef/lemon-iced-tea.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 189,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Mocktails",
    "name": "Lime Refreshment",
    "description": "Zesty drink prepared with fresh lime, mint & ice",
    "image": "madchef/lime-refreshmint.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 219,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Mocktails",
    "name": "Passionfruit Caipirinha",
    "description": "Exotic drink prepared with passionfruit, lime & cold water",
    "image": "madchef/passionfruit-caipirinha.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 219,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Mocktails",
    "name": "Madhouse Special",
    "description": "House drink prepared with secret syrup, fruit & ice",
    "image": "madchef/madhouse-special.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 329,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Mocktails",
    "name": "Mad Mojito",
    "description": "Refreshing drink prepared with fresh mint, lime & soda",
    "image": "madchef/mad-mojito.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Lemon Mint",
        "price": 249,
        "servingInfo": "1:1",
        "isDefault": true,
        "enabled": true
      },
      {
        "name": "Apple Mint",
        "price": 249,
        "servingInfo": "1:1",
        "enabled": true
      },
      {
        "name": "Honey Lemon",
        "price": 249,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Shakes",
    "name": "Cold Coffee",
    "description": "Chilled drink prepared with espresso, milk & sweet sugar",
    "image": "madchef/cold-coffee.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 219,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Shakes",
    "name": "Choco Coffee Punch",
    "description": "Rich drink prepared with chocolate, coffee & cold milk",
    "image": "madchef/choco-coffee-punch.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 249,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Shakes",
    "name": "Just Milo",
    "description": "Sweet drink prepared with milo powder, milk & ice",
    "image": "madchef/just-milo.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 299,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Shakes",
    "name": "Chocolate Peanut Butter",
    "description": "Thick milkshake prepared with peanut butter, chocolate & milk",
    "image": "madchef/chocolate-peanut-butter.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 329,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Shakes",
    "name": "Oreo Shake",
    "description": "Creamy milkshake prepared with oreo cookie, milk & ice",
    "image": "madchef/og-oreo-shake.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 329,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Shakes",
    "name": "Nutella Shake",
    "description": "Rich milkshake prepared with nutella, chocolate & milk",
    "image": "madchef/nutella-madness.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 379,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Carbonated Beverages",
    "name": "Mojo Can",
    "description": "Bangladesh's no. 1 local cola — refreshing, uplifting taste in every sip. 250ml",
    "image": "madchef/mojo-can.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 40,
        "servingInfo": "250ml",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Carbonated Beverages",
    "name": "Clemon Can",
    "description": "Made from fresh lemon extract. Promotes hydration, aids digestion & prevents acidity. 250ml",
    "image": "madchef/clemon-can.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 40,
        "servingInfo": "250ml",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Sauces",
    "name": "House Mayo",
    "description": "Dip or extra sauce.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 29,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Sauces",
    "name": "Garlic Mayo",
    "description": "Dip or extra sauce.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 29,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Sauces",
    "name": "Naga Blast",
    "description": "Dip or extra sauce.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 29,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Sauces",
    "name": "Sweet Chilli",
    "description": "Dip or extra sauce.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 29,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Sauces",
    "name": "Smokewood BBQ",
    "description": "Dip or extra sauce.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 49,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Sauces",
    "name": "Mango Habanero",
    "description": "Dip or extra sauce.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 49,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Sauces",
    "name": "Mint Yogurt",
    "description": "Dip or extra sauce.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 29,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Sauces",
    "name": "Nagatastic",
    "description": "Dip or extra sauce.",
    "image": null,
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 49,
        "servingInfo": "",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Desserts",
    "name": "Milo Mousse",
    "description": "Sweet dessert prepared with milo, cream & sugar",
    "image": "madchef/milo-mousse.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 219,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Desserts",
    "name": "Limoncello Tiramisu",
    "description": "Classic dessert prepared with lemon, coffee & creamy cheese",
    "image": "madchef/limoncello-tiramisu.webp",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 279,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  },
  {
    "brand": "madchef",
    "category": "Desserts",
    "name": "Brownie with Ice Cream",
    "description": "Sweet chocolate brownie prepared with delicious ice cream on top",
    "image": "madchef/brownie-with-ice-cream.jpeg",
    "variationType": "THICK",
    "variations": [
      {
        "name": "Regular",
        "price": 279,
        "servingInfo": "1:1",
        "enabled": true
      }
    ]
  }
];
