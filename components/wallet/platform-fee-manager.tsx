"use client";

import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

export interface PlatformFeePayload {
  platform_fee: string;
  updated_at: string | null;
  branches: {
    branch_id: number;
    branch_name: string;
    override: string | null;
    effective: string;
  }[];
}

/**
 * PHASE 4 — the platform fee, set by the super admin.
 *
 * One global amount added to every order, with an optional per-branch override.
 * A branch with no override INHERITS: it is never given a copy of the global
 * figure, so changing the global fee moves every inheriting branch at once. The
 * "Charged now" column states what an order at that branch actually pays today,
 * so the effect of an edit is visible without doing the inheritance in your head.
 */
export function PlatformFeeManager({ initial }: { initial: PlatformFeePayload }) {
  const { t, fmt } = useTranslation();
  const [data, setData] = useState(initial);
  const [globalValue, setGlobalValue] = useState(initial.platform_fee);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function put(body: Record<string, unknown>, onDone?: () => void) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const response = await fetch("/api/admin/settings/platform-fee", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const parsed = parseFieldErrors(payload, t("common.error"));
        setError(parsed.formError ?? Object.values(parsed.fieldErrors)[0] ?? t("common.error"));
        return;
      }
      const next = payload as PlatformFeePayload;
      setData(next);
      setGlobalValue(next.platform_fee);
      setSuccess(t("platformFee.saved"));
      onDone?.();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("platformFee.globalLabel")} subtitle={t("platformFee.globalHint")} />
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              put({ platform_fee: globalValue });
            }}
          >
            <Alert tone="error" message={error} />
            <Alert tone="success" message={success} />
            <Field label={t("platformFee.globalLabel")} name="platform_fee" required>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-fg-subtle">
                  ৳
                </span>
                <Input
                  name="platform_fee"
                  inputMode="decimal"
                  className="pl-8"
                  value={globalValue}
                  onChange={(event) => setGlobalValue(event.target.value)}
                  data-testid="platform-fee-global"
                />
              </div>
            </Field>
            <Button type="submit" disabled={pending} data-testid="platform-fee-save">
              {pending ? t("common.saving") : t("platformFee.save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title={t("platformFee.branchOverrides")} subtitle={t("platformFee.branchOverridesHint")} />
        <CardContent className="p-0">
          <ul className="divide-y divide-border-base">
            {data.branches.map((branch) => {
              const draft = drafts[branch.branch_id] ?? branch.override ?? "";
              return (
                <li
                  key={branch.branch_id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3"
                  data-testid={`platform-fee-branch-${branch.branch_id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg-base">{branch.branch_name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                      <Badge tone={branch.override != null ? "blue" : "slate"}>
                        {branch.override != null ? t("platformFee.override") : t("platformFee.inherits")}
                      </Badge>
                      {t("platformFee.effective")}: <strong>{fmt.money(branch.effective)}</strong>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative w-24">
                      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-fg-subtle">
                        ৳
                      </span>
                      <Input
                        aria-label={`${t("platformFee.override")} — ${branch.branch_name}`}
                        inputMode="decimal"
                        className="pl-6"
                        value={draft}
                        placeholder={data.platform_fee}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [branch.branch_id]: event.target.value }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || draft.trim() === ""}
                      onClick={() =>
                        put({ branch_id: branch.branch_id, platform_fee: draft }, () =>
                          setDrafts((current) => {
                            const next = { ...current };
                            delete next[branch.branch_id];
                            return next;
                          }),
                        )
                      }
                    >
                      {t("platformFee.setOverride")}
                    </Button>
                    {branch.override != null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          put({ branch_id: branch.branch_id, platform_fee: null }, () =>
                            setDrafts((current) => {
                              const next = { ...current };
                              delete next[branch.branch_id];
                              return next;
                            }),
                          )
                        }
                      >
                        {t("platformFee.clearOverride")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
