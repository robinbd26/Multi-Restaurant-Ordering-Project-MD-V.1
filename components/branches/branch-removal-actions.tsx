"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { archiveBranchAction, permanentlyDeleteBranchAction } from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * Super Admin branch removal, under the rule every admin list follows:
 * anything with history is ARCHIVED, only pure setup data is DELETED.
 *
 *   · Archive: always allowed. The branch stops taking orders and leaves the
 *     customer site and the default list; every record is kept.
 *   · Delete permanently: the dialog first asks the server what the branch
 *     has. With any history (orders, payments, rider tallies, reservations…)
 *     it explains why only archiving is possible and offers nothing to click.
 *     Without history it lists the setup data that goes with it and asks for
 *     the branch's name to be typed before the button enables. The server
 *     re-checks both, so the dialog is guidance, not the gate.
 *
 * Both return to the list with ?result=archived|deleted for the banner.
 */

/**
 * Where to land after an archive or delete: the branch list with ?result= for
 * the banner. From the list itself the admin's search, filter and page are
 * kept, so they stay in the list they were working through (dropping them
 * sent a filtered view back to an unfiltered page 1). From a branch's own page
 * it is the plain list.
 */
function listUrlWithResult(result: "archived" | "deleted"): string {
  const onList = window.location.pathname === "/admin/branches";
  const params = new URLSearchParams(onList ? window.location.search : "");
  params.set("result", result);
  return `/admin/branches?${params.toString()}`;
}

interface RemovalCheck {
  deletable: boolean;
  history: Record<string, number>;
  setup: Record<string, number>;
  riders_assigned: number;
  branch: { is_archived: boolean };
}

export function BranchArchiveButton({
  branchId,
  branchName,
  trigger,
}: {
  branchId: number;
  branchName: string;
  trigger: ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <ConfirmModal
      trigger={trigger}
      title={t("branchRemoval.archiveTitle", { name: branchName })}
      description={t("branchRemoval.archiveDesc")}
      confirmLabel={t("branchRemoval.confirmArchive")}
      action={() => archiveBranchAction(branchId)}
      onDone={() => {
        router.replace(listUrlWithResult("archived"));
        router.refresh();
      }}
    />
  );
}

export function BranchPermanentDelete({
  branchId,
  branchName,
  trigger,
}: {
  branchId: number;
  branchName: string;
  trigger: ReactNode;
}) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  const [check, setCheck] = useState<RemovalCheck | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [typed, setTyped] = useState("");

  function onOpenChange(open: boolean) {
    if (!open) return;
    setCheck(null);
    setCheckFailed(false);
    setTyped("");
    fetch(`/api/branches/${branchId}/removal-check`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setCheck((await res.json()) as RemovalCheck);
      })
      .catch(() => setCheckFailed(true));
  }

  const nonZero = (counts: Record<string, number>) => Object.entries(counts).filter(([, n]) => n > 0);
  const countList = (counts: Record<string, number>, testId: string) => (
    <ul className="mt-1 space-y-0.5 text-sm text-fg-base" data-testid={testId}>
      {nonZero(counts).map(([key, n]) => (
        <li key={key} className="flex justify-between gap-3">
          <span>{t(`branchRemoval.labels.${key}`)}</span>
          <span className="font-medium tabular-nums">{fmt.num(n)}</span>
        </li>
      ))}
    </ul>
  );

  const nameMatches = typed.trim() === branchName.trim();

  const details = checkFailed ? (
    <p className="text-sm text-red-600" role="alert">
      {t("branchRemoval.checkFailed")}
    </p>
  ) : !check ? (
    <p className="flex items-center gap-2 text-sm text-fg-muted">
      <Spinner className="size-4" /> {t("branchRemoval.checking")}
    </p>
  ) : !check.deletable ? (
    <div
      className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
      data-testid="branch-delete-blocked"
    >
      <p className="font-semibold">{t("branchRemoval.blockedTitle")}</p>
      <p className="mt-1">
        {check.branch.is_archived ? t("branchRemoval.blockedAlreadyArchived") : t("branchRemoval.blockedBody")}
      </p>
      {countList(check.history, "branch-delete-history")}
    </div>
  ) : (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-fg-base">{t("branchRemoval.willRemove")}</p>
        {nonZero(check.setup).length ? (
          countList(check.setup, "branch-delete-setup")
        ) : (
          <p className="mt-1 text-sm text-fg-muted">{t("branchRemoval.nothingElse")}</p>
        )}
        {check.riders_assigned > 0 ? (
          <p className="mt-2 text-sm text-fg-muted">
            {t("branchRemoval.ridersUnassigned", { count: fmt.num(check.riders_assigned) })}
          </p>
        ) : null}
      </div>
      <label className="block text-sm">
        <span className="text-fg-muted">{t("branchRemoval.typeName", { name: branchName })}</span>
        <Input
          className="mt-1"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          data-testid="branch-delete-confirm-name"
        />
      </label>
    </div>
  );

  return (
    <ConfirmModal
      trigger={trigger}
      onOpenChange={onOpenChange}
      title={t("branchRemoval.title", { name: branchName })}
      description={t("branchRemoval.desc")}
      details={details}
      confirmLabel={t("branchRemoval.confirmDelete")}
      confirmDisabled={!check?.deletable || !nameMatches}
      action={() => permanentlyDeleteBranchAction(branchId, typed)}
      onDone={() => {
        router.replace(listUrlWithResult("deleted"));
        router.refresh();
      }}
    />
  );
}
