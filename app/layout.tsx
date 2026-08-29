import type { Metadata } from "next";

import { siteOrigin } from "@/lib/seo/site";
import { Barlow_Condensed, Inter, JetBrains_Mono, Noto_Sans_Bengali, Sora } from "next/font/google";
import "./globals.css";

import { PushRegistrar } from "@/components/notifications/push-registrar";
import { LanguageProvider } from "@/components/providers/language-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { getLocale } from "@/lib/i18n/server";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme/bootstrap";
import { resolveThemeForServer } from "@/lib/theme/config";
import { getThemePreference } from "@/lib/theme/server";

/**
 * WS-9.2 — font budget for prepaid 3G/4G handsets.
 *
 * Every face declared here is attached to <html>, so Next treats it as "used on
 * every route" and emits a <link rel=preload> for it on EVERY page. The build
 * measured before this pass preloaded 18 woff2 files / ~836 KB per route —
 * 525 KB of that was Noto Sans Bengali alone, because five static weights were
 * requested instead of the one variable file that covers 100-900.
 *
 * Two rules apply below:
 *  1. Ask for the VARIABLE font (omit `weight`) wherever Google publishes one.
 *     One file, every weight, and no synthetic bolding.
 *  2. `preload` only the faces the FIRST PAINT of an arbitrary route actually
 *     needs — Bengali (the default language, first in --font-sans/--font-heading
 *     /--font-mono) and Inter (its Latin partner). The three design faces below
 *     are route-scoped; they still load, just discovered from the CSS instead of
 *     racing the HTML, and `display: swap` (next/font's default) means text
 *     paints immediately in the metric-adjusted fallback either way.
 */

// Body/UI face for Bangla — the DEFAULT language, so this is the one font that
// genuinely has to be on the critical path of every route. Variable: one file
// instead of five weights.
const bengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali"],
});

// Latin partner for the Bengali face (digits, brand words, English copy).
// Already variable — Next picks the variable file when no `weight` is given.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Homepage display face (hero title, section headings, stat numbers). Used ONLY
// under components/home/**, and Google publishes no variable cut, so the weight
// list is trimmed to the four that are actually referenced there
// (semibold/bold/extrabold/black) — 500 had no callers.
const barlow = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  preload: false,
});

// Auth (login) display face — matches the approved login design. Also the
// dashboard heading/KPI face in the branch-manager design. Never used on the
// public homepage, so it is not on the critical path there.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  preload: false,
});

// Tabular numbers in the dashboard design (KPI values, table amounts/times).
// Authenticated surfaces only.
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  preload: false,
});

/**
 * PHASE B — site-wide metadata.
 *
 * `metadataBase` is resolved per request from the forwarded/current host, so
 * canonical/OG links carry the domain that served the request
 * instead of localhost. Individual pages inherit this and only override what is
 * genuinely theirs.
 */
export async function generateMetadata(): Promise<Metadata> {
  const origin = await siteOrigin();
  const title = "MAD DELIVERY HQ";
  const description =
    "Multi-branch food delivery from MAD Delivery HQ — order from your nearest branch with live order tracking.";
  return {
    metadataBase: new URL(origin),
    title: { default: title, template: `%s | ${title}` },
    description,
    applicationName: title,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: title,
      title,
      description,
      url: origin,
      locale: "en_US",
      alternateLocale: ["bn_BD"],
    },
    twitter: { card: "summary_large_image", title, description },
    // Public pages are indexable; every authenticated section opts out in its
    // own layout, which is where the rule actually belongs.
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const themePreference = await getThemePreference();

  return (
    // suppressHydrationWarning: the pre-paint script may correct data-theme
    // (only the browser knows the OS setting) before React hydrates.
    <html
      lang={locale}
      data-theme={resolveThemeForServer(themePreference)}
      data-theme-pref={themePreference}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${bengali.variable} ${inter.variable} ${barlow.variable} ${sora.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head suppressHydrationWarning>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <ThemeProvider initialPreference={themePreference}>
          <LanguageProvider locale={locale}>
            {children}
            {/*
              WS-6.1 — registers /sw.js and keeps this browser's push
              subscription in step. Mounted here because a rider's alert must
              survive navigating anywhere in the app, and inside LanguageProvider
              because its soft-ask copy is translated. Renders nothing at all
              until it has something to ask, so it costs the public pages a
              single deferred status request and no layout space.
            */}
            <PushRegistrar />
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
