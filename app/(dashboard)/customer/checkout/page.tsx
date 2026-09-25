import { redirect } from "next/navigation";

/**
 * Retired. Checkout is ONE flow now: the cart drawer (map pin, saved or
 * one-time address, live coverage, pickup, coupon), opened from the Cart page
 * or the storefront. This page's own form still had a "Delivery Area"
 * dropdown from before coverage was decided by the pin, and choosing an area
 * the pin did not fall in got a 409 from the server. Old links and bookmarks
 * land on the Cart page, whose Checkout button opens the drawer.
 */
export default function CheckoutPage() {
  redirect("/customer/cart");
}
