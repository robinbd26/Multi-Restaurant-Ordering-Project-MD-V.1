import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { BmDutyChats } from "@/components/branch/bm-duty-chats";
import { BranchRiderFleet, type BranchRider } from "@/components/maps/branch-rider-fleet";
import { getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { branchForManager } from "@/lib/selectors";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("pages.ridersTitle") };
}

/**
 * /branch-manager/riders — riders for this manager's own branch.
 *
 * WS-4.3 — the requirement is "rider information (online/offline/on duty) and
 * the rider's live pin location on Google Maps", and this page used to be a
 * static name/phone/vehicle/branch table with none of it. The roster is now
 * rendered by <BranchRiderFleet>, which adds duty state and a live map of the
 * riders currently on duty HERE and keeps it fresh with a 20-second poll that
 * pauses while the tab is hidden (see the component for why that transport).
 *
 * The first payload is fetched here on the server so the board is complete on
 * first paint, before any client request happens — the manager on a 3G phone
 * sees their riders immediately, not a spinner.
 */
export default async function BranchRidersPage() {
  const { t } = await getT();
  const me = await requireRole("branch_manager");
  const [riders, branch] = await Promise.all([
    getJSON<BranchRider[]>("/riders/branch/").catch(() => [] as BranchRider[]),
    // Only used to FRAME the map before the first rider pings; the coordinates
    // that matter still come from the authorization-checked API payload.
    branchForManager(Number(me.id)),
  ]);

  return (
    <>
      <PageHeader title={t("pages.ridersTitle")} subtitle={t("pages.ridersSub")} />
      <Card className="mb-6">
        <CardHeader title={t("rider.onlineRiders")} />
        <CardContent>
          <BmDutyChats viewerId={Number(me.id)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader title={t("bmRiders.mapTitle")} subtitle={t("bmRiders.mapSubtitle")} />
        <CardContent>
          <BranchRiderFleet
            initialRiders={riders}
            branchLat={branch?.latitude != null ? Number(branch.latitude) : null}
            branchLng={branch?.longitude != null ? Number(branch.longitude) : null}
          />
        </CardContent>
      </Card>
    </>
  );
}
