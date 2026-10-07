import test from "node:test";
import assert from "node:assert/strict";

import { dhakaMoment } from "@/lib/hours/clock";
import {
  everyDaySpan,
  minutesUntilClose,
  nextOpening,
  normaliseBrandHours,
  openSlotAt,
  type BrandHours,
} from "@/lib/hours/schedule";

/**
 * The per-brand ordering-hours rules, without a database or a clock. The real
 * example from the Uttara branch: Madchef 11:00 AM–10:30 PM (delivery + pickup),
 * Cheez 11:00 AM–4:00 AM with delivery all the way and pickup until 11 PM.
 */
const at = (day: number, hhmm: string) => ({ day, minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) });

const madchef: BrandHours = {
  everyDay: [{ start: "11:00", end: "22:30", delivery: true, pickup: true }],
  days: {},
};
const cheez: BrandHours = {
  everyDay: [
    { start: "11:00", end: "23:00", delivery: true, pickup: true },
    { start: "23:00", end: "04:00", delivery: true, pickup: false },
  ],
  days: {},
};

test("a daytime slot is open inside and closed outside", () => {
  assert.ok(openSlotAt(madchef, "delivery", at(3, "11:00")));
  assert.ok(openSlotAt(madchef, "pickup", at(3, "22:29")));
  assert.equal(openSlotAt(madchef, "delivery", at(3, "22:30")), null, "the end is the last-order cutoff");
  assert.equal(openSlotAt(madchef, "delivery", at(3, "10:59")), null);
});

test("a slot crossing midnight stays open into the next morning", () => {
  assert.ok(openSlotAt(cheez, "delivery", at(5, "02:30")), "Friday 2:30 AM, from Thursday's slot");
  assert.equal(openSlotAt(cheez, "delivery", at(5, "04:00")), null);
  assert.equal(openSlotAt(cheez, "pickup", at(5, "02:30")), null, "the late slot is delivery only");
  assert.equal(openSlotAt(cheez, "delivery", at(5, "07:00")), null, "4 AM to 11 AM everything is closed");
});

test("a crossing slot belongs to the day it started", () => {
  // Saturday is closed all day, but Friday's 23:00 → 04:00 still runs into Saturday.
  const closedSaturday: BrandHours = { ...cheez, days: { "6": [] } };
  assert.ok(openSlotAt(closedSaturday, "delivery", at(6, "01:00")), "Friday night continues into Saturday");
  assert.equal(openSlotAt(closedSaturday, "delivery", at(6, "12:00")), null, "Saturday itself is closed");
  assert.equal(openSlotAt(closedSaturday, "delivery", at(0, "01:00")), null, "nothing starts on Saturday night");
});

test("a weekday override replaces the every-day schedule for that day", () => {
  const fridayLate: BrandHours = { ...madchef, days: { "5": [{ start: "14:00", end: "23:30", delivery: true, pickup: false }] } };
  assert.equal(openSlotAt(fridayLate, "delivery", at(5, "12:00")), null);
  assert.ok(openSlotAt(fridayLate, "delivery", at(5, "23:00")));
  assert.equal(openSlotAt(fridayLate, "pickup", at(5, "15:00")), null);
  assert.ok(openSlotAt(fridayLate, "pickup", at(4, "12:00")), "other days keep the default");
});

test("next opening is later today, or the next day with a slot", () => {
  assert.deepEqual(nextOpening(madchef, "delivery", at(2, "08:00")), { dayOffset: 0, day: 2, time: "11:00" });
  assert.deepEqual(nextOpening(madchef, "delivery", at(2, "23:00")), { dayOffset: 1, day: 3, time: "11:00" });
  const weekendsOnly: BrandHours = { everyDay: [], days: { "5": madchef.everyDay } };
  assert.deepEqual(nextOpening(weekendsOnly, "pickup", at(1, "12:00")), { dayOffset: 4, day: 5, time: "11:00" });
  assert.equal(nextOpening({ everyDay: [], days: {} }, "pickup", at(1, "12:00")), null);
});

test("minutes until close counts across midnight", () => {
  assert.equal(minutesUntilClose(cheez, "delivery", at(3, "23:30")), 270);
  assert.equal(minutesUntilClose(cheez, "delivery", at(4, "03:00")), 60);
  assert.equal(minutesUntilClose(madchef, "delivery", at(3, "23:00")), null);
});

test("the every-day span reads 11:00 AM to 4:00 AM, not 4:00 AM to 11:00 PM", () => {
  assert.deepEqual(everyDaySpan(cheez), { start: "11:00", end: "04:00" });
  assert.deepEqual(everyDaySpan(cheez, "pickup"), { start: "11:00", end: "23:00" });
});

test("validation refuses bad times and overlapping slots, and needs explicit channels", () => {
  assert.equal(normaliseBrandHours({ everyDay: [{ start: "25:00", end: "10:00" }] }).problems[0]?.key, "errors.hours.badTime");
  const overlap = normaliseBrandHours({
    everyDay: [
      { start: "11:00", end: "16:00", delivery: true, pickup: true },
      { start: "15:00", end: "18:00", delivery: true, pickup: true },
    ],
  });
  assert.equal(overlap.problems[0]?.key, "errors.hours.overlap");
  const unticked = normaliseBrandHours({ everyDay: [{ start: "11:00", end: "16:00" }] });
  assert.deepEqual(unticked.problems, []);
  assert.equal(unticked.hours?.everyDay[0].delivery, false, "a channel is never guessed");
});

test("the Dhaka clock ignores the machine's own zone", () => {
  // 2026-10-07T22:30Z is Thursday 04:30 in Dhaka (UTC+6).
  assert.deepEqual(dhakaMoment(new Date("2026-10-07T22:30:00Z")), { day: 4, minutes: 270 });
});
