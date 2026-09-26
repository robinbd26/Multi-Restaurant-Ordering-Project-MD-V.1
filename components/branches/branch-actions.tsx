"use client";

import { useState, useTransition } from "react";

import { BranchArchiveButton, BranchPermanentDelete } from "@/components/branches/branch-removal-actions";
import { Button } from "@/components/ui/button";
import { setBranchActiveAction } from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * Super Admin controls on a branch's page: activate/deactivate, Archive (keeps
 * every record) and Delete permanently (only for a branch with no history; the
 * dialog checks first and asks for the name). See branch-removal-actions.tsx.
 */
export function BranchActions({
  branchId,
  branchName,
  isActive,
  isArchived,
}: {
  branchId: number;
  branchName: string;
  isActive: boolean;
  isArchived: boolean;
}) {
  const { t } = useTranslation();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleActive() {
    startTransition(async () => {
      const result = await setBranchActiveAction(branchId, !isActive);
      setError(result.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {isArchived ? null : (
        <Button
          size="sm"
          variant={isActive ? "outline" : "success"}
          onClick={toggleActive}
          disabled={pending}
          data-testid="branch-toggle-active"
        >
          {isActive ? t("branches.deactivate") : t("branches.activate")}
        </Button>
      )}
      {isArchived ? null : (
        <BranchArchiveButton
          branchId={branchId}
          branchName={branchName}
          trigger={
            <Button size="sm" variant="outline" data-testid="branch-archive">
              {t("branchRemoval.archive")}
            </Button>
          }
        />
      )}
      <BranchPermanentDelete
        branchId={branchId}
        branchName={branchName}
        trigger={
          <Button size="sm" variant="outline" className="text-red-600" data-testid="branch-delete">
            {t("branchRemoval.deletePermanently")}
          </Button>
        }
      />
    </div>
  );
}
