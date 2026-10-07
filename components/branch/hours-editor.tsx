"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { brandName, type BrandInfo } from "@/lib/brands/shared";
import { toMinutes, WEEKDAYS, type BrandHours, type DineInHours, type HoursSlot } from "@/lib/hours/schedule";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

/**
 * The hours editor for ONE branch: per brand, the slots that take orders, each
 * with its own Delivery and Pickup boxes ("same every day", plus optional
 * per-weekday overrides), and the display-only dine-in hours.
 *
 * Used by the branch manager (own branch) and the super admin (any branch).
 * PUT /api/branches/[id]/hours re-validates everything and enforces who may
 * save, server-side; this page only makes it easy.
 */

interface SlotDraft extends HoursSlot {
  key: string;
}
interface BrandDraft {
  configured: boolean;
  everyDay: SlotDraft[];
  /** Weekday → own slots; absent = uses every-day. */
  days: Record<string, SlotDraft[]>;
  perDay: boolean;
}

let seq = 0;
const k = () => `s${(seq += 1)}`;
const blankSlot = (): SlotDraft => ({ key: k(), start: "11:00", end: "23:00", delivery: true, pickup: true });
const withKeys = (slots: HoursSlot[]) => slots.map((s) => ({ ...s, key: k() }));
const stripKeys = (slots: SlotDraft[]): HoursSlot[] =>
  slots.map(({ start, end, delivery, pickup }) => ({ start, end, delivery, pickup }));

function draftOf(hours: BrandHours | null): BrandDraft {
  if (!hours) return { configured: false, everyDay: [blankSlot()], days: {}, perDay: false };
  const days: Record<string, SlotDraft[]> = {};
  for (const [d, slots] of Object.entries(hours.days)) days[d] = withKeys(slots ?? []);
  return { configured: true, everyDay: withKeys(hours.everyDay), days, perDay: Object.keys(days).length > 0 };
}

export interface HoursEditorProps {
  branchId: number;
  branchName: string;
  businessType: string;
  brands: { brand: BrandInfo; hours: BrandHours | null }[];
  dineIn: DineInHours | null;
}

export function HoursEditor({ branchId, branchName, businessType, brands, dineIn }: HoursEditorProps) {
  const { t, fmt, locale } = useTranslation();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, BrandDraft>>(() =>
    Object.fromEntries(brands.map((b) => [b.brand.slug, draftOf(b.hours)])),
  );
  const [dine, setDine] = useState<{ shown: boolean; slots: { key: string; start: string; end: string }[] }>(() => ({
    shown: Boolean(dineIn?.everyDay.length),
    slots: dineIn?.everyDay.length ? dineIn.everyDay.map((s) => ({ ...s, key: k() })) : [{ key: k(), start: "11:00", end: "23:00" }],
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const update = (slug: string, fn: (d: BrandDraft) => BrandDraft) => {
    setSaved(null);
    setDrafts((cur) => ({ ...cur, [slug]: fn(cur[slug]) }));
  };

  async function save() {
    setPending(true);
    setError(null);
    setSaved(null);
    const body = {
      brands: Object.fromEntries(
        Object.entries(drafts).map(([slug, d]) => [
          slug,
          d.configured
            ? {
                everyDay: stripKeys(d.everyDay),
                days: d.perDay ? Object.fromEntries(Object.entries(d.days).map(([day, s]) => [day, stripKeys(s)])) : {},
              }
            : null,
        ]),
      ),
      dine_in: dine.shown ? { everyDay: dine.slots.map(({ start, end }) => ({ start, end })), days: {} } : null,
    };
    try {
      const res = await fetch(`/api/branches/${branchId}/hours`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = parseFieldErrors(await res.json().catch(() => ({})), t("common.error"));
        setError(parsed.formError ?? Object.values(parsed.fieldErrors)[0] ?? t("common.error"));
        return;
      }
      setSaved(t("hours.saved"));
      router.refresh();
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  /** "11:00 AM → 4:00 AM (next day)" for a slot, in 12-hour time. */
  const describe = (s: { start: string; end: string }) => {
    const crosses = toMinutes(s.end) <= toMinutes(s.start);
    return `${fmt.clock(s.start)} → ${fmt.clock(s.end)}${crosses ? ` (${t("hours.nextDay")})` : ""}`;
  };

  const slotRows = (slots: SlotDraft[], onChange: (next: SlotDraft[]) => void, testPrefix: string) => (
    <div className="space-y-2">
      {slots.length === 0 ? <p className="text-sm text-fg-muted">{t("hours.closedAllDay")}</p> : null}
      {slots.map((s, i) => (
        <div key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border-base p-2.5" data-testid={`${testPrefix}-slot-${i}`}>
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            {t("hours.from")}
            <Input
              type="time"
              value={s.start}
              className="h-9 w-32"
              aria-label={t("hours.from")}
              onChange={(e) => onChange(slots.map((x) => (x.key === s.key ? { ...x, start: e.target.value } : x)))}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            {t("hours.lastOrder")}
            <Input
              type="time"
              value={s.end}
              className="h-9 w-32"
              aria-label={t("hours.lastOrder")}
              onChange={(e) => onChange(slots.map((x) => (x.key === s.key ? { ...x, end: e.target.value } : x)))}
            />
          </label>
          <Checkbox
            label={t("hours.channel.delivery")}
            checked={s.delivery}
            onChange={(e) => onChange(slots.map((x) => (x.key === s.key ? { ...x, delivery: e.target.checked } : x)))}
          />
          <Checkbox
            label={t("hours.channel.pickup")}
            checked={s.pickup}
            onChange={(e) => onChange(slots.map((x) => (x.key === s.key ? { ...x, pickup: e.target.checked } : x)))}
          />
          <span className="text-xs text-fg-subtle">{describe(s)}</span>
          {!s.delivery && !s.pickup ? <span className="text-xs font-medium text-amber-600">{t("hours.noChannelWarning")}</span> : null}
          <button
            type="button"
            className="ml-auto text-xs text-red-600 hover:underline"
            onClick={() => onChange(slots.filter((x) => x.key !== s.key))}
          >
            {t("hours.removeSlot")}
          </button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...slots, blankSlot()])} data-testid={`${testPrefix}-add-slot`}>
        + {t("hours.addSlot")}
      </Button>
    </div>
  );

  return (
    <div className="grid gap-5" data-testid="hours-editor">
      <Alert tone="error" message={error} />
      <Alert tone="success" message={saved} />
      <p className="text-sm text-fg-muted">{t("hours.editorIntro", { branch: branchName })}</p>

      {brands.length === 0 ? <Alert tone="warning" message={t("hours.noBrands")} /> : null}

      {brands.map(({ brand }) => {
        const d = drafts[brand.slug];
        const name = brandName(brand, locale);
        return (
          <Card key={brand.slug}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: brand.accent_color }} aria-hidden />
                  {name}
                </span>
              }
              subtitle={t("hours.brandSub")}
            />
            <CardContent className="space-y-4">
              <div data-testid={`hours-brand-${brand.slug}`} className="space-y-4">
                {!d.configured ? (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                    <p className="font-semibold">{t("hours.notSetTitle")}</p>
                    <p className="mt-0.5 text-xs">{t("hours.notSetBody")}</p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2"
                      onClick={() => update(brand.slug, (x) => ({ ...x, configured: true }))}
                      data-testid={`hours-configure-${brand.slug}`}
                    >
                      {t("hours.setHours")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="mb-2 text-sm font-semibold text-fg-base">{t("hours.everyDay")}</p>
                      {slotRows(d.everyDay, (next) => update(brand.slug, (x) => ({ ...x, everyDay: next })), `hours-${brand.slug}-every`)}
                    </div>
                    <Checkbox
                      label={t("hours.perDayToggle")}
                      checked={d.perDay}
                      onChange={(e) => update(brand.slug, (x) => ({ ...x, perDay: e.target.checked }))}
                    />
                    {d.perDay ? (
                      <div className="space-y-3 rounded-xl bg-surface-muted p-3">
                        {WEEKDAYS.map((day) => {
                          const own = d.days[day];
                          return (
                            <div key={day} className="space-y-2" data-testid={`hours-${brand.slug}-day-${day}`}>
                              <div className="flex flex-wrap items-center gap-3">
                                <span className="w-24 text-sm font-semibold text-fg-base">{t(`hours.weekday.${day}`)}</span>
                                <Checkbox
                                  label={t("hours.useEveryDay")}
                                  checked={!own}
                                  onChange={(e) =>
                                    update(brand.slug, (x) => {
                                      const days = { ...x.days };
                                      if (e.target.checked) delete days[day];
                                      else days[day] = x.everyDay.map((s) => ({ ...s, key: k() }));
                                      return { ...x, days };
                                    })
                                  }
                                />
                              </div>
                              {own
                                ? slotRows(
                                    own,
                                    (next) => update(brand.slug, (x) => ({ ...x, days: { ...x.days, [day]: next } })),
                                    `hours-${brand.slug}-day-${day}`,
                                  )
                                : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="text-xs text-fg-muted hover:underline"
                      onClick={() => update(brand.slug, (x) => ({ ...x, configured: false }))}
                    >
                      {t("hours.clearHours")}
                    </button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader title={t("hours.dineInTitle")} subtitle={t("hours.dineInSub")} />
        <CardContent className="space-y-3">
          {businessType === "cloud_kitchen" ? <p className="text-xs text-fg-muted">{t("hours.cloudKitchenNote")}</p> : null}
          <Checkbox label={t("hours.showDineIn")} checked={dine.shown} onChange={(e) => setDine((d) => ({ ...d, shown: e.target.checked }))} />
          {dine.shown ? (
            <div className="space-y-2">
              {dine.slots.map((s) => (
                <div key={s.key} className="flex flex-wrap items-center gap-3">
                  <Input
                    type="time"
                    value={s.start}
                    className="h-9 w-32"
                    aria-label={t("hours.from")}
                    onChange={(e) => setDine((d) => ({ ...d, slots: d.slots.map((x) => (x.key === s.key ? { ...x, start: e.target.value } : x)) }))}
                  />
                  <span className="text-xs text-fg-muted">→</span>
                  <Input
                    type="time"
                    value={s.end}
                    className="h-9 w-32"
                    aria-label={t("hours.until")}
                    onChange={(e) => setDine((d) => ({ ...d, slots: d.slots.map((x) => (x.key === s.key ? { ...x, end: e.target.value } : x)) }))}
                  />
                  <span className="text-xs text-fg-subtle">{describe(s)}</span>
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => setDine((d) => ({ ...d, slots: d.slots.filter((x) => x.key !== s.key) }))}
                  >
                    {t("hours.removeSlot")}
                  </button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDine((d) => ({ ...d, slots: [...d.slots, { key: k(), start: "11:00", end: "23:00" }] }))}
              >
                + {t("hours.addSlot")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void save()} disabled={pending} data-testid="hours-save">
          {pending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : null}
          {t("hours.save")}
        </Button>
        <span className="text-xs text-fg-muted">{t("hours.dhakaNote")}</span>
      </div>
    </div>
  );
}
