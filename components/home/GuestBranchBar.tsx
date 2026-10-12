"use client";

import Link from "next/link";

import {
  BrowsingPicker,
  type BrowseBranchOption,
} from "@/components/home/BrowsingPicker";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * The signed-out storefront's branch strip: only the "Browsing" half of the
 * customer's BranchBar. A guest has no saved addresses or trusted location, so
 * "Deliver to" is replaced by a login invitation; choosing a branch is a view
 * lens (same cookie as a customer's) and never a delivery decision.
 */
export function GuestBranchBar({
  branchId,
  branchName,
  branches,
}: {
  branchId: number | null;
  branchName: string | null;
  branches: BrowseBranchOption[];
}) {
  const { t } = useTranslation();
  return (
    <section
      className="border-b border-white/8 bg-[#111115] px-4 py-3"
      data-testid="home-guest-branch-bar"
      aria-label={t("nearestHome.regionLabel")}
    >
      <div className="mx-auto flex max-w-300 flex-wrap items-center gap-x-4 gap-y-2 text-[0.82rem]">
        <span className="ms-auto flex flex-wrap items-center gap-2">
          <BrowsingPicker
            guest
            branchId={branchId}
            activeBranchId={branchId}
            branches={branches}
            value={branchName ?? t("nearestHome.allBranches")}
          />
          <Link
            href="/login"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-[0.78rem] font-semibold text-white transition-colors hover:border-brand-500 hover:bg-white/5"
          >
            🔑 {t("nearestHome.guestLoginHint")}
          </Link>
        </span>
      </div>
    </section>
  );
}
