"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td } from "@/components/ui/table";
import type { ActionState } from "@/lib/api/action-state";
import { brandName, type BrandInfo } from "@/lib/brands/shared";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

export interface BrandRow extends BrandInfo {
  usage: { branches: number; products: number; categories: number; orderLines: number; deletable: boolean };
}

/**
 * The super admin's brand list (/admin/brands). Order is set with the up/down
 * arrows (saved immediately, logged); each row can be edited, switched on/off,
 * archived or restored, and deleted only while nothing refers to it — the
 * server re-checks that, so a race can never delete a brand in use.
 */
export function BrandsManager({ brands }: { brands: BrandRow[] }) {
  const { t, fmt, locale } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown): Promise<ActionState> {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const parsed = parseFieldErrors(await res.json().catch(() => ({})), t("common.error"));
      return { error: parsed.formError ?? Object.values(parsed.fieldErrors)[0] ?? t("common.error"), fieldErrors: parsed.fieldErrors };
    }
    return { error: null };
  }

  function run(url: string, method: string, body?: unknown) {
    setError(null);
    startTransition(async () => {
      const state = await call(url, method, body);
      if (state.error) setError(state.error);
      else router.refresh();
    });
  }

  async function confirmed(url: string, method: string): Promise<ActionState> {
    const state = await call(url, method);
    if (!state.error) router.refresh();
    return state;
  }

  const live = brands.filter((b) => !b.is_archived);
  const archived = brands.filter((b) => b.is_archived);

  function move(index: number, delta: -1 | 1) {
    const ids = live.map((b) => b.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run("/api/brands/reorder", "POST", { ids });
  }

  const usageText = (u: BrandRow["usage"]) =>
    t("brandsAdmin.usageLine", {
      branches: fmt.num(u.branches),
      products: fmt.num(u.products),
      orders: fmt.num(u.orderLines),
    });

  const row = (b: BrandRow, index: number, isLive: boolean) => (
    <tr key={b.id} data-testid={`brand-row-${b.slug}`}>
      <Td>
        <span className="flex items-center gap-3">
          <span
            className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 text-lg"
            style={{ borderColor: b.accent_color }}
          >
            {b.logo ? <Image src={b.logo} alt="" fill sizes="40px" className="object-cover" /> : b.emoji}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-fg-base">{brandName(b, locale)}</span>
            <span className="block font-mono text-xs text-fg-subtle">{b.slug}</span>
          </span>
        </span>
      </Td>
      <Td>
        <span className="inline-flex items-center gap-2 font-mono text-xs">
          <span className="size-4 rounded" style={{ background: b.accent_color }} aria-hidden />
          {b.accent_color}
        </span>
      </Td>
      <Td>
        {b.is_archived ? (
          <Badge tone="slate">{t("brandsAdmin.archived")}</Badge>
        ) : b.is_active ? (
          <Badge dot tone="green">{t("common.active")}</Badge>
        ) : (
          <Badge dot tone="amber">{t("brands.inactive")}</Badge>
        )}
        {b.show_crust_guide ? <span className="mt-1 block text-[11px] text-fg-subtle">{t("brandsAdmin.crustGuideOn")}</span> : null}
      </Td>
      <Td>
        <span className="text-xs text-fg-muted">{usageText(b.usage)}</span>
      </Td>
      <Td>
        <span className="flex flex-wrap items-center justify-end gap-2">
          {isLive ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("brandsAdmin.moveUp")}
                disabled={pending || index === 0}
                onClick={() => move(index, -1)}
                data-testid={`brand-up-${b.slug}`}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("brandsAdmin.moveDown")}
                disabled={pending || index === live.length - 1}
                onClick={() => move(index, 1)}
                data-testid={`brand-down-${b.slug}`}
              >
                ↓
              </Button>
              <ButtonLink size="sm" variant="outline" href={`/admin/brands/${b.id}/edit`}>
                {t("common.edit")}
              </ButtonLink>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(`/api/brands/${b.id}`, "PATCH", { is_active: !b.is_active })}
                data-testid={`brand-toggle-${b.slug}`}
              >
                {b.is_active ? t("brandsAdmin.deactivate") : t("brandsAdmin.activate")}
              </Button>
              <ConfirmModal
                trigger={
                  <Button size="sm" variant="outline" className="text-red-600" disabled={pending} data-testid={`brand-archive-${b.slug}`}>
                    {t("brandsAdmin.archive")}
                  </Button>
                }
                title={t("brandsAdmin.archiveTitle", { name: b.name })}
                description={t("brandsAdmin.archiveDesc", { branches: fmt.num(b.usage.branches) })}
                confirmLabel={t("brandsAdmin.archive")}
                action={() => confirmed(`/api/brands/${b.id}/archive`, "POST")}
              />
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/brands/${b.id}/restore`, "POST")}>
              {t("brandsAdmin.restore")}
            </Button>
          )}
          {b.usage.deletable ? (
            <ConfirmModal
              trigger={
                <Button size="sm" variant="ghost" className="text-red-600" disabled={pending} data-testid={`brand-delete-${b.slug}`}>
                  {t("common.delete")}
                </Button>
              }
              title={t("brandsAdmin.deleteTitle", { name: b.name })}
              description={t("brandsAdmin.deleteDesc")}
              confirmLabel={t("common.delete")}
              action={() => confirmed(`/api/brands/${b.id}`, "DELETE")}
            />
          ) : null}
        </span>
      </Td>
    </tr>
  );

  const headers = [
    t("brandsAdmin.brand"),
    t("brandsAdmin.accentColor"),
    t("common.status"),
    t("brandsAdmin.usage"),
    "",
  ];

  return (
    <div className="grid gap-5">
      <Alert tone="error" message={error} />
      <Card>
        <CardHeader
          title={t("brandsAdmin.listTitle")}
          subtitle={t("brandsAdmin.listSub")}
          action={<ButtonLink href="/admin/brands/new" data-testid="brand-new">+ {t("brandsAdmin.newBrand")}</ButtonLink>}
        />
        <CardContent>
          {live.length === 0 ? (
            <EmptyState title={t("brandsAdmin.emptyTitle")} description={t("brandsAdmin.emptyDesc")} />
          ) : (
            <Table headers={headers}>{live.map((b, i) => row(b, i, true))}</Table>
          )}
        </CardContent>
      </Card>
      {archived.length ? (
        <Card>
          <CardHeader title={t("brandsAdmin.archivedTitle")} subtitle={t("brandsAdmin.archivedSub")} />
          <CardContent>
            <Table headers={headers}>{archived.map((b, i) => row(b, i, false))}</Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
