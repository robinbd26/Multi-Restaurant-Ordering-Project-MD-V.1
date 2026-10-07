import Image from "next/image";

import { brandName, withAlpha, type BrandInfo } from "@/lib/brands/shared";
import { crossesMidnight, earliness, widest, type Span } from "@/lib/hours/spans";
import { getT } from "@/lib/i18n/server";
import type { PublicHomeBranch } from "@/lib/selectors";

/**
 * The homepage hours section, drawn from data: every live branch and each live
 * brand's own schedule at it (BranchBrand.hours), on today's Asia/Dhaka weekday.
 * Nothing here names a brand or a time — a brand the super admin adds, or an
 * hour a branch manager changes, shows up with no code change.
 */

/** Group branches by today's first opening time ("HH:MM" → names + brands). */
function groupByOpening(branches: PublicHomeBranch[]) {
  const groups = new Map<string, { names: string[]; brands: Set<string> }>();
  for (const b of branches) {
    const span = widest([b.today.delivery, b.today.pickup]);
    if (!span) continue;
    const g = groups.get(span.start) ?? { names: [], brands: new Set<string>() };
    g.names.push(b.name);
    b.brands.forEach((slug) => g.brands.add(slug));
    groups.set(span.start, g);
  }
  return [...groups.entries()]
    .sort(([a], [z]) => earliness(a) - earliness(z))
    .map(([time, g]) => ({ time, names: g.names, brands: [...g.brands] }));
}

function DividerLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[0.68rem] font-bold uppercase text-[#a0a0b0]" style={{ letterSpacing: "1.8px" }}>
        {label}
      </span>
      <span className="h-px flex-1 bg-white/8" />
    </div>
  );
}

function ScheduleRow({ icon, label, detail, color }: { icon: string; label: string; detail: string; color: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-px shrink-0 text-[0.9rem]">{icon}</span>
      <span>
        <span className="block text-[0.68rem] font-bold uppercase tracking-wide" style={{ color }}>
          {label}
        </span>
        <span className="mt-0.5 block text-[0.78rem] leading-5 text-[#a0a0b0]">{detail}</span>
      </span>
    </div>
  );
}

function StatBlock({ label, time }: { label: string; time: string }) {
  return (
    <div className="min-w-25 rounded-xl border border-brand-500/25 bg-brand-500/10 px-4 py-2.5 text-center">
      <p className="mb-1 text-[0.6rem] font-bold uppercase text-[#a0a0b0]" style={{ letterSpacing: "1.2px" }}>
        {label}
      </p>
      <p className="font-display text-[1.4rem] font-black leading-none text-brand-500" style={{ letterSpacing: "1px" }}>
        {time}
      </p>
    </div>
  );
}

export async function OperatingHours({ branches, brands }: { branches: PublicHomeBranch[]; brands: BrandInfo[] }) {
  const { t, fmt, locale } = await getT();
  const range = (s: Span | null) =>
    s ? t("home.hours.range", { from: fmt.clock(s.start), to: fmt.clock(s.end) }) : t("home.hours.notToday");
  const namesOf = (slugs: string[]) =>
    slugs
      .map((slug) => brands.find((b) => b.slug === slug))
      .filter((b): b is BrandInfo => b !== undefined)
      .map((b) => brandName(b, locale))
      .join(" & ");

  // One card per live brand: its dine-in, delivery and pickup windows today,
  // widest across the branches that serve it.
  const schedule = brands.map((brand) => {
    const serving = branches.filter((b) => b.brands.includes(brand.slug));
    const perBranch = serving.map((b) => b.today.brands.find((x) => x.slug === brand.slug));
    return {
      brand,
      branchCount: serving.length,
      dineIn: widest(serving.map((b) => b.today.dineIn)),
      delivery: widest(perBranch.map((x) => x?.delivery ?? null)),
      pickup: widest(perBranch.map((x) => x?.pickup ?? null)),
    };
  });

  // Late-night service: branches whose delivery runs on past midnight today.
  const lateNight = branches.filter((b) => b.today.delivery && crossesMidnight(b.today.delivery));
  const lateLast = widest(lateNight.map((b) => b.today.delivery))?.end ?? null;
  const groups = groupByOpening(branches);

  const PICKUP = [
    { area: "Mirpur DOHS", place: t("home.hours.pickupMainGate") },
    { area: "Mohakhali DOHS", place: t("home.hours.pickupRawaClub") },
    { area: "Dhaka Cantonment", place: t("home.hours.pickupSainikClub") },
    { area: "Nikunja", place: t("home.hours.pickupNavyHq") },
    { area: "Bashundhara", place: t("home.hours.pickupBaridhara"), note: t("home.hours.bashundharaNote") },
  ];

  return (
    <section className="border-t border-white/8 bg-[#0a0a0c] px-5 pb-20 pt-18" data-testid="home-operating-hours">
      <div className="mx-auto max-w-275">
        <div className="mb-13 text-center">
          <span className="mb-2.5 inline-block text-[0.7rem] font-bold uppercase text-brand-500" style={{ letterSpacing: "2.5px" }}>
            {t("home.hours.eyebrow", { n: fmt.num(branches.length) })}
          </span>
          <h2
            className="font-display font-black text-[#f0f0f2]"
            style={{ fontSize: "clamp(2rem, 5vw, 3rem)", letterSpacing: "1px", lineHeight: 1.1 }}
          >
            {t("home.hours.titlePre")} <span className="text-brand-500">{t("home.hours.titleAccent")}</span>
          </h2>
          <p className="mx-auto mt-3 max-w-120 text-[0.88rem] leading-6 text-[#a0a0b0]">{t("home.hours.subtitleToday")}</p>
        </div>

        {/* Opening times by branch (today) */}
        {groups.length ? (
          <div className="mb-12">
            <DividerLabel label={t("home.hours.openingTimesTitle")} />
            <div className="mt-4 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {groups.map((row) => (
                <div key={row.time} className="flex flex-col gap-2.5 rounded-[14px] border border-white/7 bg-[#1c1c24] p-4.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[1.6rem] font-black leading-none text-brand-500" style={{ letterSpacing: "0.5px" }}>
                      {fmt.clock(row.time)}
                    </span>
                    <span
                      className="whitespace-nowrap rounded-full border border-white/8 bg-white/5 px-2.25 py-0.75 text-[0.62rem] font-bold uppercase text-[#a0a0b0]"
                      style={{ letterSpacing: "0.8px" }}
                    >
                      {namesOf(row.brands)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {row.names.map((n) => (
                      <span key={n} className="rounded-full border border-white/8 bg-white/4 px-2.5 py-0.75 text-[0.74rem] text-[#a0a0b0]">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Dine-in, delivery & pickup by brand (today) */}
        <div className="mb-12">
          <DividerLabel label={t("home.hours.scheduleTitle")} />
          <div className="mt-4 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {schedule.map(({ brand, branchCount, dineIn, delivery, pickup }) => (
              <div
                key={brand.slug}
                className="overflow-hidden rounded-[14px] border"
                style={{ background: withAlpha(brand.accent_color, 0.08), borderColor: withAlpha(brand.accent_color, 0.25) }}
                data-testid={`hours-brand-${brand.slug}`}
              >
                <div className="flex items-center gap-2.5 border-b px-4.5 pb-3 pt-3.5" style={{ borderColor: withAlpha(brand.accent_color, 0.25) }}>
                  <span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md">
                    {brand.logo ? <Image src={brand.logo} alt={brandName(brand, locale)} fill sizes="28px" className="object-cover" /> : brand.emoji}
                  </span>
                  <span className="font-display text-[1.15rem] font-extrabold" style={{ color: brand.accent_color, letterSpacing: "0.5px" }}>
                    {brandName(brand, locale)}
                  </span>
                </div>
                <div className="px-4.5 pb-1.5 pt-3">
                  <ScheduleRow icon="🍽️" label={t("home.hours.dineIn")} detail={range(dineIn)} color={brand.accent_color} />
                  <div className="my-2 h-px bg-white/5" />
                  <ScheduleRow icon="🛵" label={t("home.hours.delivery")} detail={range(delivery)} color={brand.accent_color} />
                  <div className="my-2 h-px bg-white/5" />
                  <ScheduleRow icon="🏬" label={t("home.hours.pickup")} detail={range(pickup)} color={brand.accent_color} />
                </div>
                <div className="mx-3 mb-3 mt-2 rounded-lg bg-black/20 px-3 py-2 text-[0.71rem] leading-5 text-[#a0a0b0]">
                  ℹ️ {t("home.hours.brandNote", { n: fmt.num(branchCount) })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Late-night delivery — branches whose delivery runs past midnight today */}
        {lateNight.length && lateLast ? (
          <div className="mb-4 flex flex-wrap items-start gap-x-8 gap-y-4.5 rounded-2xl border border-brand-500/20 bg-brand-500/6 px-7 py-6" data-testid="hours-late-night">
            <div className="min-w-0 flex-auto">
              <div className="mb-1.5 flex items-center gap-2.5">
                <span className="text-[1.4rem]">🌙</span>
                <h3 className="font-display text-[1.2rem] font-extrabold text-brand-500" style={{ letterSpacing: "0.5px" }}>
                  {t("home.hours.lateNightTitleGeneric")}
                </h3>
              </div>
              <p className="mb-3.5 max-w-120 text-[0.8rem] leading-6 text-[#a0a0b0]">
                {t("home.hours.lateNightBody", { time: fmt.clock(lateLast) })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {lateNight.map((b) => (
                  <span key={b.id} className="rounded-full border border-brand-500/25 bg-brand-500/12 px-2.5 py-0.75 text-[0.74rem] text-[#fca5a5]">
                    {b.name} · {fmt.clock(b.today.delivery!.end)}
                  </span>
                ))}
              </div>
            </div>
            <div className="ml-auto flex flex-wrap gap-2.5">
              <StatBlock label={t("home.hours.lastOrder")} time={fmt.clock(lateLast)} />
            </div>
          </div>
        ) : null}

        {/* Night pickup points — static marketing copy (not driven by the schedules). */}
        <div className="rounded-2xl border px-7 py-6" style={{ background: "rgba(15,12,5,0.9)", borderColor: "rgba(251,191,36,0.4)" }}>
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className="text-[1.25rem]">📍</span>
            <h3 className="font-display text-[1.2rem] font-extrabold text-[#fbbf24]" style={{ letterSpacing: "0.5px" }}>
              {t("home.hours.pickupTitle")}
            </h3>
          </div>
          <p
            className="mb-4 rounded-[10px] border px-3.5 py-2.5 text-[0.78rem] leading-6 text-[#e8e2d0]"
            style={{ background: "rgba(251,191,36,0.07)", borderColor: "rgba(251,191,36,0.25)" }}
          >
            ⏰ {t("home.hours.pickupNotePre")}{" "}
            <strong className="text-[#fbbf24]">Mirpur DOHS, Mohakhali DOHS, Bashundhara, Nikunja & Dhaka Cantonment</strong>{" "}
            {t("home.hours.pickupNoteMid")} <strong className="text-[#fbbf24]">10:15 PM</strong>
            {t("home.hours.pickupNotePost")}
          </p>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
            {PICKUP.map((p) => (
              <div key={p.area} className="rounded-xl border bg-white/4 px-3.5 py-3" style={{ borderColor: "rgba(251,191,36,0.28)" }}>
                <p className="mb-1 font-display text-[0.95rem] font-extrabold text-[#fbbf24]">{p.area}</p>
                <p className="text-[0.74rem] leading-5 text-[#d6cebc]">📍 {p.place}</p>
                {p.note ? (
                  <p className="mt-1.5 border-t pt-1.5 text-[0.69rem] leading-5 text-[#a89060]" style={{ borderColor: "rgba(251,191,36,0.2)" }}>
                    {p.note}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
