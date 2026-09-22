"use client";

import { useRouter } from "next/navigation";

import { BarMenu, MenuHeading, RadioRow } from "@/components/home/BarMenu";
import { updateBrowseScope } from "@/lib/browse-scope/client";
import { useTranslation } from "@/lib/i18n/use-translation";

/** A live branch, from the same public list the rest of the homepage renders. */
export interface BrowseBranchOption {
  id: number;
  name: string;
  brandType: string;
  open: boolean;
}

/**
 * "Browsing: [branch]" — WHOSE MENU is on screen.
 *
 * Owns the other half of the browse scope, and replaces the old standalone
 * "View branches" button: it is the same intent, answered in place instead of
 * sending the customer to another page. Any live branch can be chosen whether or
 * not it can deliver to them; the bar says so when it cannot. "My nearest
 * branch" hands the choice back to the deliver-to point.
 */
export function BrowsingPicker({
  branchId,
  activeBranchId = null,
  branches,
  value,
}: {
  /** The branch the customer explicitly chose; null = "my nearest". */
  branchId: number | null;
  /** The branch whose menu is on screen now (explicit or resolved nearest). */
  activeBranchId?: number | null;
  branches: BrowseBranchOption[];
  value: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  function choose(next: number | null, close: () => void) {
    close();
    updateBrowseScope({ branchId: next });
    router.refresh();
  }

  return (
    <BarMenu
      icon="🏪"
      label={t("nearestHome.browsingFrom")}
      value={value}
      menuLabel={t("nearestHome.browseMenuLabel")}
      testId="home-browse-branch"
      panelTestId="browse-branch-panel"
    >
      {(close) => (
        <>
          <RadioRow
            checked={branchId == null}
            testId="browse-branch-nearest"
            title={t("nearestHome.nearestBranchOption")}
            onSelect={() => choose(null, close)}
          />
          <MenuHeading>{t("nearestHome.otherBranchesGroup")}</MenuHeading>
          {branches.map((b) => (
            <RadioRow
              key={b.id}
              checked={branchId === b.id}
              current={(activeBranchId ?? branchId) === b.id}
              testId={`browse-branch-${b.id}`}
              title={b.name}
              subtitle={t(`brandType.${b.brandType}`)}
              onSelect={() => choose(b.id, close)}
              trailing={
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${
                    b.open
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border border-white/10 bg-white/5 text-[#8a8a98]"
                  }`}
                >
                  {b.open ? t("nearestHome.branchOpen") : t("nearestHome.branchClosed")}
                </span>
              }
            />
          ))}
        </>
      )}
    </BarMenu>
  );
}
