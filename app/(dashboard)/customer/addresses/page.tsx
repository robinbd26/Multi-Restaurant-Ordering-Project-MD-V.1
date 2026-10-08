import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { AddressManager, type AddressT } from "@/components/customer/address-manager";
import { getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import type { Paginated } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("pages.addressesTitle") };
}

/**
 * /customer/addresses — the saved-address book (up to 5), and only that. Live
 * location is chosen on the storefront ("Choose your current location"), so
 * this page no longer carries its own live-location card.
 */
export default async function CustomerAddressesPage() {
  const { t } = await getT();
  await requireRole("customer");
  const data = await getJSON<Paginated<AddressT>>("/customer/addresses/");

  return (
    <>
      <PageHeader title={t("pages.addressesTitle")} subtitle={t("addresses.subtitle")} />
      <AddressManager addresses={data.results} />
    </>
  );
}
