"use client";

import { useState } from "react";

import { ShapeOverview } from "@/components/maps/shape-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/use-translation";

export interface CoverageMapArea {
  id: number;
  branchId: number;
  name: string;
  shape: string | null;
  isActive: boolean;
  isHeld: boolean;
  coverageWindow: string;
  deliveryCharge: string;
  estimatedDeliveryMinutes: number;
}

/**
 * Coverage on a map — one branch's areas for a manager, or every branch's for
 * the super admin, which is the only way to SEE overlaps and gaps.
 *
 * Collapsed by default: this sits above a list that most visits are actually
 * here for, and an unopened map costs no tiles on a metered connection.
 */
export function BranchCoverageMap({
  shapes,
  branches,
  title,
  defaultOpen = false,
}: {
  shapes: CoverageMapArea[];
  branches: { id: number; name: string; lat: number | null; lng: number | null }[];
  title?: string;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  const drawn = shapes.filter((s) => s.shape != null);
  const undrawn = shapes.length - drawn.length;
  const pinless = branches.filter((b) => b.lat == null || b.lng == null);

  return (
    <Card data-testid="coverage-map-card">
      <CardHeader
        title={title ?? t("deliveryArea.coverageMapTitle")}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)} data-testid="coverage-map-toggle">
            {open ? t("mapPicker.close") : t("deliveryArea.showCoverageMap")}
          </Button>
        }
      />
      <CardContent>
        {/* The two honest warnings, shown whether or not the map is open,
            because both mean "this branch delivers nowhere". */}
        {undrawn > 0 ? (
          <p className="mb-2 text-sm text-amber-600 dark:text-amber-400" data-testid="coverage-undrawn">
            {t("deliveryArea.undrawnWarning", { count: undrawn })}
          </p>
        ) : null}
        {pinless.length > 0 ? (
          <p className="mb-2 text-sm text-amber-600 dark:text-amber-400" data-testid="coverage-pinless">
            {t("deliveryArea.pinlessBranches", { names: pinless.map((b) => b.name).join(", ") })}
          </p>
        ) : null}
        {drawn.length === 0 && shapes.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("deliveryArea.noAreasYet")}</p>
        ) : null}

        {open ? (
          <>
            <ShapeOverview
              shapes={drawn.map((s) => ({
                id: s.id,
                name: s.name,
                shape: s.shape,
                isActive: s.isActive,
                isHeld: s.isHeld,
                branchId: s.branchId,
              }))}
              branches={branches}
            />
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-fg-subtle" data-testid="coverage-legend">
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm border-2 border-[#2563eb] bg-[#2563eb]/20" />
                {t("deliveryArea.legendActive")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm border-2 border-[#f59e0b] bg-[#f59e0b]/20" />
                {t("deliveryArea.legendHeld")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm border-2 border-[#94a3b8] bg-[#94a3b8]/20" />
                {t("deliveryArea.legendInactive")}
              </span>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
