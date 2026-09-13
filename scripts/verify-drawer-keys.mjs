// Verifies the Task-3 drawer keys exist in both locales. Run: node scripts/verify-drawer-keys.mjs
import { readFileSync } from "node:fs";

const KEYS = [
  "viewOrder", "continueShopping", "backToCart", "continue", "placing", "placedDesc",
  "paymentPendingNote", "quoteError", "calculatingFee", "savingAddress", "addressSaveError",
  "orderFailed", "errAreaRequired", "errCustomAreaRequired", "errCustomLabelRequired",
  "errAddressRequired", "noSavedAddress", "noSavedAddressDesc", "addNewAddress", "retry",
  "deliverTo",
];

let bad = 0;
for (const locale of ["en", "bn"]) {
  const data = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  for (const key of KEYS) {
    if (!data?.home?.order?.[key]) {
      console.log(`${locale.toUpperCase()} MISSING ${key}`);
      bad += 1;
    }
  }
}
console.log(bad === 0 ? "ALL 21 KEYS PRESENT IN BOTH LOCALES" : `PROBLEMS: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
