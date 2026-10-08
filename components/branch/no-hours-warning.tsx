import Link from "next/link";

import { getT } from "@/lib/i18n/server";

/**
 * "No hours set, closed to customers" — shown wherever an admin or a branch
 * manager looks at a branch whose live brands include one with no schedule.
 * Since no hours now means closed (lib/hours/availability.ts), this must be
 * impossible to miss. Renders nothing when every brand has hours.
 */
export async function NoHoursWarning({
  brandNames,
  href,
  compact = false,
}: {
  brandNames: string[];
  /** The hours editor for this branch. */
  href: string;
  /** A one-line badge for tables instead of a full banner. */
  compact?: boolean;
}) {
  if (brandNames.length === 0) return null;
  const { t } = await getT();
  if (compact) {
    return (
      <Link
        href={href}
        className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 hover:underline dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25"
        data-testid="no-hours-badge"
      >
        ⚠ {t("hours.noHoursClosed")}
      </Link>
    );
  }
  return (
    <div
      role="alert"
      className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
      data-testid="no-hours-warning"
    >
      <p className="font-semibold">⚠ {t("hours.noHoursClosed")}</p>
      <p className="mt-0.5">
        {t("hours.noHoursBrands", { brands: brandNames.join(", ") })}{" "}
        <Link href={href} className="font-semibold underline">
          {t("hours.setHoursNow")}
        </Link>
      </p>
    </div>
  );
}
