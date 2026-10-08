import { redirect } from "next/navigation";

/**
 * Old URL from when a branch had many areas. A branch now has exactly one,
 * edited on /branch-manager/delivery-areas, so bookmarks and old links land
 * there instead of on a dead page.
 */
export default function LegacyBranchManagerAreaRoute() {
  redirect("/branch-manager/delivery-areas");
}
