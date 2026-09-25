import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import { RiderAssignmentGate } from "@/components/rider/assignment-gate";
import { RiderLocationTracker } from "@/components/rider/location-tracker";
import { BranchSwitchDialog } from "@/components/home/BranchSwitchDialog";
import { CartDrawer } from "@/components/home/CartDrawer";
import { HomeCartProvider } from "@/components/home/home-cart-context";
import { requireUser } from "@/lib/auth/session";
import { getManagedBranch } from "@/lib/services/branches";
import { getCompanyLogoUrl } from "@/lib/services/settings";
import { activeDutySession } from "@/lib/services/rider-duty";
import { getLocale } from "@/lib/i18n/server";
import { isFullClosureWindow } from "@/lib/services/coverage-window";

/**
 * PHASE B — nothing behind the login is indexable. Declaring it on the shared
 * authenticated layout means every current and future dashboard page inherits
 * the rule, instead of each page having to remember it.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Shared authenticated shell for every role and every authenticated page
 * (/profile, /change-password, /complaints, /notifications included).
 * Layout/structure comes from static_design/Branch-manager_dashboard.html;
 * see components/layout/dashboard-shell.tsx.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // The topbar's BRANCH / MANAGER blocks only apply to a manager who actually
  // has a branch; null for every other role, and the blocks don't render.
  const branch = user.role === "branch_manager" ? await getManagedBranch(user.id) : null;
  const locale = await getLocale();
  const logoUrl = await getCompanyLogoUrl();
  // req #6/#12 — rider blocking assignment popup + GPS tracking (rider only).
  const riderOnDuty = user.role === "rider" ? Boolean(await activeDutySession(user.id)) : false;

  // ONE cart and ONE checkout: the same provider the homepage uses (same
  // storage key), and for a customer the same drawer, so the Cart page's
  // Checkout opens the flow that knows about pins, one-time addresses and
  // coverage. The old dashboard cart and /customer/checkout page are gone.
  const isCustomer = user.role === "customer";

  return (
    <HomeCartProvider>
      {/* `useSearchParams` needs a Suspense boundary; this renders nothing, so
          the boundary never shows a fallback. */}
      <Suspense fallback={null}>
        <ScrollToTop />
      </Suspense>
      <DashboardShell
        name={user.full_name || user.username}
        role={user.role}
        photo={user.profile_photo}
        version={user.updated_at}
        phone={user.phone}
        branchName={branch?.name ?? null}
        locale={locale}
        logoUrl={logoUrl}
      >
        {children}
      </DashboardShell>
      {isCustomer ? (
        <>
          <CartDrawer
            signedIn
            customerName={user.full_name ?? null}
            customerPhone={user.phone ?? null}
            platformClosed={isFullClosureWindow()}
          />
          <BranchSwitchDialog />
        </>
      ) : null}
      {user.role === "rider" ? (
        <>
          <RiderAssignmentGate />
          <RiderLocationTracker onDuty={riderOnDuty} />
        </>
      ) : null}
    </HomeCartProvider>
  );
}
