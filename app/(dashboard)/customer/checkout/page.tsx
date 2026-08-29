import type { Metadata } from "next";

import { CheckoutForm } from "@/components/orders/checkout-form";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { customerLocationStatus } from "@/lib/services/customer-location";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("customer.checkoutTitle") };
}

export default async function CheckoutPage() {
  const user = await requireRole("customer");
  const { t } = await getT();
  const location = await customerLocationStatus(user.id);

  return (
    <>
      <PageHeader title={t("customer.checkoutTitle")} subtitle={t("customer.checkoutSubtitle")} />
      <CheckoutForm
        defaultAddress={user.address}
        defaultLat={location.lat}
        defaultLng={location.lng}
      />
    </>
  );
}
