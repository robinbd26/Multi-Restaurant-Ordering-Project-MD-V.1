import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("auth.resetConfirmTitle") };
}

/**
 * STEP 2 of the password reset — reached only from the emailed/texted link.
 *
 * Deliberately a child of /forgot-password: `proxy.ts` treats that whole
 * subtree as public, so a logged-out user with a valid token can complete the
 * reset without the route protection bouncing them to /login first.
 *
 * The token is read here and handed to the form as a hidden field. It is NOT
 * validated on this render on purpose — a page that said "this link is
 * invalid" before any submission would let an attacker probe tokens with plain
 * GETs, outside the POST rate limiter.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const { t } = await getT();

  return (
    <div className="rounded-3xl bg-white p-8 shadow-2xl sm:p-10">
      <h1 className="text-2xl font-bold text-slate-800">{t("auth.resetConfirmTitle")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("auth.resetConfirmSubtitle")}</p>
      <div className="mt-6">
        <ResetPasswordForm token={(token ?? "").trim()} />
      </div>
    </div>
  );
}
