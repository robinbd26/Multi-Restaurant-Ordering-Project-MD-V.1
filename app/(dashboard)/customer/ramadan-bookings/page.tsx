import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { RamadanBookingPanel } from "@/components/customer/ramadan-booking-panel";
import { LegacyRamadanBookings, type LegacyBookingRow } from "@/components/ramadan/legacy-bookings-panel";
import { getSessionUser } from "@/lib/auth/current-user";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { prisma } from "@/lib/db";
import { legacyRamadanBookings } from "@/lib/services/ramadan";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("ramadan.title") };
}

/**
 * /customer/ramadan-bookings — Ramadan booking flow + my bookings.
 *
 * WS-9.3 — every NEW booking goes through the canonical reservation path
 * (branch → date → iftar slot → real table → platter → advance). Bookings made
 * through the retired system are listed read-only underneath so a customer
 * never loses sight of one, and they still hold their table server-side.
 */
export default async function CustomerRamadanPage() {
  const { t } = await getT();
  await requireRole("customer");
  const me = (await getSessionUser())!;
  // Branches that have Ramadan booking enabled.
  const configs = await prisma.ramadanConfig.findMany({
    where: { isEnabled: true, branch: { isActive: true } },
    include: { branch: true },
    orderBy: { branch: { name: "asc" } },
  });
  const branches = configs.map((c) => ({ id: c.branchId, name: c.branch.name }));
  const legacy: LegacyBookingRow[] = await legacyRamadanBookings(me, { limit: 50 });

  return (
    <>
      <PageHeader title={t("ramadan.title")} subtitle={t("ramadan.book")} />
      <div className="space-y-6">
        <Card>
          <CardContent className="py-6">
            {branches.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("errors.ramadan.notEnabled")}</p>
            ) : (
              <RamadanBookingPanel branches={branches} />
            )}
          </CardContent>
        </Card>
        {legacy.length > 0 ? (
          <Card>
            <CardContent className="py-6">
              <LegacyRamadanBookings rows={legacy} canRelease showCustomer />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
