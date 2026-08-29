import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RamadanManagePanel } from "@/components/branch/ramadan-manage-panel";
import { TableLayoutEditor, type TableRow } from "@/components/branch/table-layout-editor";
import { LegacyRamadanBookings, type LegacyBookingRow } from "@/components/ramadan/legacy-bookings-panel";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";
import { serializeTable, tablesForBranch } from "@/lib/services/branch-ops";
import { legacyRamadanBookings } from "@/lib/services/ramadan";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("ramadan.title") };
}

/**
 * /branch-manager/ramadan-bookings — the left-sidebar Ramadan section
 * (REQUIREMENTS_ROLES §2): the branch manager configures the table LAYOUT and
 * CAPACITY here, plus the booking window, iftar slots and platters, and works
 * the reservations customers create.
 *
 * WS-9.3 — the layout editor writes the REAL `BranchTable` rows, the same ones
 * normal table reservations and the canonical Ramadan reservations are seated
 * on. It replaces the old Ramadan-only table registry, which was a second,
 * invisible set of tables that the rest of the system could not see.
 */
export default async function BranchRamadanPage() {
  const { t } = await getT();
  await requireRole("branch_manager");
  const me = (await getSessionUser())!;
  const branch = await branchForManager(me.id);
  const tables = branch
    ? ((await tablesForBranch(branch.id)).map(serializeTable) as unknown as TableRow[])
    : [];
  const legacy: LegacyBookingRow[] = await legacyRamadanBookings(me);

  return (
    <>
      <PageHeader title={t("ramadan.title")} subtitle={t("ramadan.configTitle")} />
      <div className="space-y-6">
        <Card>
          <CardHeader title={t("bmExtras.tableLayout")} subtitle={t("bmExtras.tableLayoutSub")} />
          <CardContent className="py-6">
            {branch ? (
              <TableLayoutEditor tables={tables} />
            ) : (
              <p className="text-sm text-fg-muted">{t("errors.ops.noBranchAssigned")}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <RamadanManagePanel />
          </CardContent>
        </Card>
        {legacy.length > 0 ? (
          <Card>
            <CardContent className="py-6">
              <LegacyRamadanBookings rows={legacy} canRelease />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
