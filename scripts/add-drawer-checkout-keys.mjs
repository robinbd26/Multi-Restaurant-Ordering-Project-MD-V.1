// Task 3 — adds the drawer same-screen-checkout keys under home.order to both
// locales. Idempotent: existing keys are left untouched. Run: node scripts/add-drawer-checkout-keys.mjs
import { readFileSync, writeFileSync } from "node:fs";

const FILES = {
  en: "messages/en.json",
  bn: "messages/bn.json",
};

const KEYS = {
  en: {
    viewOrder: "View Order",
    continueShopping: "Continue Shopping",
    backToCart: "Back to Cart",
    continue: "Continue",
    placing: "Placing…",
    placedDesc: "Your order has been placed successfully.",
    paymentPendingNote: "Payment will be verified by the branch before preparation.",
    quoteError: "Could not calculate the delivery for this address. Please try again.",
    calculatingFee: "Calculating…",
    savingAddress: "Saving…",
    addressSaveError: "Could not save the address. Please try again.",
    orderFailed: "Could not place the order. Please try again.",
    errAreaRequired: "Please select your area.",
    errCustomAreaRequired: "Please enter your area name.",
    errCustomLabelRequired: "Please enter a name for this address.",
    errAddressRequired: "Please select a delivery address.",
    noSavedAddress: "No saved address yet",
    noSavedAddressDesc: "Add your delivery address to place the order.",
    addNewAddress: "Add new address",
    retry: "Retry",
    deliverTo: "Deliver to",
  },
  bn: {
    viewOrder: "অর্ডার দেখুন",
    continueShopping: "শপিং চালিয়ে যান",
    backToCart: "কার্টে ফিরে যান",
    continue: "চালিয়ে যান",
    placing: "প্লেস হচ্ছে…",
    placedDesc: "আপনার অর্ডার সফলভাবে প্লেস হয়েছে।",
    paymentPendingNote: "প্রস্তুতির আগে শাখা কর্তৃক পেমেন্ট যাচাই করা হবে।",
    quoteError: "এই ঠিকানার জন্য ডেলিভারি হিসাব করা যায়নি। আবার চেষ্টা করুন।",
    calculatingFee: "হিসাব হচ্ছে…",
    savingAddress: "সেভ হচ্ছে…",
    addressSaveError: "ঠিকানা সেভ করা যায়নি। আবার চেষ্টা করুন।",
    orderFailed: "অর্ডার প্লেস করা যায়নি। আবার চেষ্টা করুন।",
    errAreaRequired: "আপনার এলাকা নির্বাচন করুন।",
    errCustomAreaRequired: "আপনার এলাকার নাম লিখুন।",
    errCustomLabelRequired: "এই ঠিকানার জন্য একটি নাম দিন।",
    errAddressRequired: "ডেলিভারি ঠিকানা নির্বাচন করুন।",
    noSavedAddress: "এখনও কোনো সেভ করা ঠিকানা নেই",
    noSavedAddressDesc: "অর্ডার দিতে আপনার ডেলিভারি ঠিকানা যোগ করুন।",
    addNewAddress: "নতুন ঠিকানা যোগ করুন",
    retry: "আবার চেষ্টা করুন",
    deliverTo: "ডেলিভারি ঠিকানা",
  },
};

let added = 0;
for (const [locale, file] of Object.entries(FILES)) {
  const raw = readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  data.home ??= {};
  data.home.order ??= {};
  let changed = 0;
  for (const [key, value] of Object.entries(KEYS[locale])) {
    if (data.home.order[key] === undefined) {
      data.home.order[key] = value;
      changed += 1;
    }
  }
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`${locale}: +${changed} keys (home.order)`);
  added += changed;
}
console.log(`done — ${added} keys added`);
