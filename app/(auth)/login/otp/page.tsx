import type { Metadata } from "next";

import { OtpLoginForm } from "@/components/auth/otp-login-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("auth.otpLoginTitle") };
}

/**
 * /login/otp — sign in with a one-time SMS code.
 *
 * Nested under /login because `proxy.ts` already treats that whole subtree as
 * public; the full-page /login design itself lives in the (auth-full) group and
 * is untouched by this route.
 */
export default async function OtpLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const { t } = await getT();

  return (
    <div className="rounded-3xl bg-white p-8 shadow-2xl sm:p-10">
      <h1 className="text-2xl font-bold text-slate-800">{t("auth.otpLoginTitle")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("auth.otpLoginSubtitle")}</p>
      <div className="mt-6">
        <OtpLoginForm callbackUrl={callbackUrl} />
      </div>
    </div>
  );
}
