import { brandName, type BrandInfo } from "@/lib/brands/shared";
import { widest } from "@/lib/hours/spans";
import { getT } from "@/lib/i18n/server";
import type { PublicHomeBranch } from "@/lib/selectors";

/**
 * "Call to order" banner. Its hours used to be hardcoded ("11:00 AM – 4:00 AM
 * for all 10 branches", "Cheez! until 3:45 AM · Madchef 10:45 PM"); they now
 * come from the live schedules: today's widest ordering window across the
 * live branches (Asia/Dhaka weekday), the real branch count, and each brand's
 * latest delivery last-order today. Chosen over an admin text setting so the
 * banner can never contradict the hours that are actually enforced.
 */
export async function CallToOrder({ branches, brands }: { branches: PublicHomeBranch[]; brands: BrandInfo[] }) {
  const { t, fmt, locale } = await getT();
  const today = widest(branches.flatMap((b) => [b.today.delivery, b.today.pickup]));
  const perBrand = brands
    .map((brand) => ({
      brand,
      delivery: widest(
        branches.map((b) => b.today.brands.find((x) => x.slug === brand.slug)?.delivery ?? null),
      ),
    }))
    .filter((x) => x.delivery);

  return (
    <section className="relative overflow-hidden bg-linear-to-br from-brand-500 to-[#a0101f] px-5 py-12.5 text-center text-white">
      <div className="grid-overlay-cta pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-3xl">
        <h2
          className="font-display font-black uppercase"
          style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)", letterSpacing: "1px" }}
        >
          {t("home.callToOrder.title")}
        </h2>
        <p className="mt-2 text-[0.95rem] text-white/75" data-testid="call-to-order-hours">
          {today ? (
            <>
              {t("home.callToOrder.availableTodayPre")}{" "}
              <strong className="text-white">
                {fmt.clock(today.start)} – {fmt.clock(today.end)}
              </strong>{" "}
            </>
          ) : (
            <>{t("home.callToOrder.closedToday")} </>
          )}
          {t("home.callToOrder.availablePost", { n: fmt.num(branches.length) })}
        </p>
        {perBrand.length ? (
          <p className="mt-1.5 text-[0.8rem] text-white/55">
            {perBrand
              .map((x) => t("home.callToOrder.brandDeliversUntil", { brand: brandName(x.brand, locale), time: fmt.clock(x.delivery!.end) }))
              .join(" · ")}
          </p>
        ) : null}
        <a
          href="tel:09638050505"
          className="mt-5.5 inline-flex items-center gap-3 rounded-[14px] border-2 border-white/25 bg-white/12 px-8 py-3.5 font-display font-black text-white transition-colors hover:bg-white/20"
          style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.4rem)", letterSpacing: "2px" }}
        >
          📞 09638-050505
        </a>
      </div>
    </section>
  );
}
