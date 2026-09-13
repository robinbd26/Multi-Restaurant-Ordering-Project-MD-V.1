// Task 3 (checkout flow) — adds/updates the keys the drawer checkout flow needs
// in both locales. Idempotent: existing keys are left untouched EXCEPT the
// listed overrides (drawer-only keys). Run: node scripts/add-checkout-flow-keys.mjs
import { readFileSync, writeFileSync } from "node:fs";

const FILES = { en: "messages/en.json", bn: "messages/bn.json" };

const ADD = {
  en: {
    "home.order.selectDeliveryAddress": "Select Delivery Address",
    "home.order.useMapLocation": "Use Map / Current Location",
    "home.order.maxAddressesReached": "You have reached the maximum limit of 5 saved addresses.",
    "home.order.addressCount": "{count}/5 addresses saved",
    "home.order.orderOverview": "Order Overview",
    "home.order.customerInfo": "Customer Information",
    "home.order.statusReceived": "Order Received",
    "home.order.receivedByBranch": "Your order has been received by the nearest branch.",
    "home.order.deliveryTimeTitle": "Estimated Delivery Time",
    "home.order.deliveryTimeEstimate":
      "We expect your food to arrive at your door within approximately 45–50 minutes, with a maximum expected delivery time of 58 minutes.",
    "home.order.quantity": "Quantity",
    "home.order.unitPrice": "Unit Price",
    "home.order.labelHousePlot": "House/Plot",
    "home.order.labelRoad": "Road",
    "home.order.labelArea": "Area",
    "home.order.labelFlat": "Flat",
    "home.order.labelLandmark": "Landmark",
    "home.order.mapLocationRequired": "Please choose a location on the map first.",
    "home.order.orderStatusLabel": "Order Status",
    "payment.bank": "Bank Transfer",
    "orders.bankHint": "Transfer to the branch's bank account — the branch verifies the payment before preparation.",
    "addresses.preset_home2": "Home-2",
    "addresses.preset_home3": "Home-3",
    "addresses.preset_others": "Others",
    "errors.ops.maxAddressesReached": "You can save a maximum of 5 delivery addresses.",
  },
  bn: {
    "home.order.selectDeliveryAddress": "ডেলিভারি ঠিকানা নির্বাচন করুন",
    "home.order.useMapLocation": "ম্যাপ / বর্তমান লোকেশন ব্যবহার করুন",
    "home.order.maxAddressesReached": "আপনি সর্বোচ্চ ৫টি সেভ করা ঠিকানার সীমায় পৌঁছেছেন।",
    "home.order.addressCount": "{count}/৫টি ঠিকানা সেভ করা হয়েছে",
    "home.order.orderOverview": "অর্ডার ওভারভিউ",
    "home.order.customerInfo": "গ্রাহকের তথ্য",
    "home.order.statusReceived": "অর্ডার গৃহীত",
    "home.order.receivedByBranch": "আপনার অর্ডার নিকটতম শাখায় গৃহীত হয়েছে।",
    "home.order.deliveryTimeTitle": "আনুমানিক ডেলিভারি সময়",
    "home.order.deliveryTimeEstimate":
      "আমরা আশা করি আপনার খাবার আনুমানিক ৪৫–৫০ মিনিটের মধ্যে, সর্বোচ্চ ৫৮ মিনিটের মধ্যে আপনার দরজায় পৌঁছে যাবে।",
    "home.order.quantity": "পরিমাণ",
    "home.order.unitPrice": "ইউনিট মূল্য",
    "home.order.labelHousePlot": "বাসা/প্লট",
    "home.order.labelRoad": "রাস্তা",
    "home.order.labelArea": "এলাকা",
    "home.order.labelFlat": "ফ্ল্যাট",
    "home.order.labelLandmark": "ল্যান্ডমার্ক",
    "home.order.mapLocationRequired": "অনুগ্রহ করে প্রথমে ম্যাপে একটি লোকেশন নির্বাচন করুন।",
    "home.order.orderStatusLabel": "অর্ডার স্ট্যাটাস",
    "payment.bank": "ব্যাংক ট্রান্সফার",
    "orders.bankHint": "শাখার ব্যাংক অ্যাকাউন্টে ট্রান্সফার করুন — প্রস্তুতির আগে শাখা পেমেন্ট যাচাই করবে।",
    "addresses.preset_home2": "বাসা-২",
    "addresses.preset_home3": "বাসা-৩",
    "addresses.preset_others": "অন্যান্য",
    "errors.ops.maxAddressesReached": "আপনি সর্বোচ্চ ৫টি ডেলিভারি ঠিকানা সেভ করতে পারবেন।",
  },
};

// Drawer-only key: the address step's primary button reads "Next" (spec #12).
const OVERRIDE = {
  "home.order.continue": { en: "Next", bn: "পরবর্তী" },
};

function setPath(data, path, value) {
  const parts = path.split(".");
  let node = data;
  for (const part of parts.slice(0, -1)) {
    node[part] ??= {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function getPath(data, path) {
  return path.split(".").reduce((node, part) => (node == null ? undefined : node[part]), data);
}

let added = 0;
let overridden = 0;
for (const [locale, file] of Object.entries(FILES)) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  let changed = 0;
  for (const [path, value] of Object.entries(ADD[locale])) {
    if (getPath(data, path) === undefined) {
      setPath(data, path, value);
      changed += 1;
    }
  }
  for (const [path, byLocale] of Object.entries(OVERRIDE)) {
    if (getPath(data, path) !== byLocale[locale]) {
      setPath(data, path, byLocale[locale]);
      overridden += 1;
    }
  }
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`${locale}: +${changed} keys, ${overridden} overridden`);
  added += changed;
}
console.log(`done — ${added} keys added`);
