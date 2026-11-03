"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../public/js/core.js");

const HOURS = [
  { weekday: 0, closed: 1 },
  { weekday: 1, closed: 0, open: "09:30", close: "18:30", lunch_start: "13:00", lunch_end: "14:00" },
  { weekday: 2, closed: 0, open: "09:30", close: "21:00", lunch_start: "13:00", lunch_end: "14:00" },
  { weekday: 3, closed: 0, open: "09:30", close: "18:30", lunch_start: "13:00", lunch_end: "14:00" },
  { weekday: 4, closed: 0, open: "09:30", close: "21:00", lunch_start: "13:00", lunch_end: "14:00" },
  { weekday: 5, closed: 0, open: "09:30", close: "18:30", lunch_start: "13:00", lunch_end: "14:00" },
  { weekday: 6, closed: 0, open: "09:30", close: "14:00", lunch_start: null, lunch_end: null }
];
const RULES = { slotMinutes: 30, capacity: 2, leadMinutes: 60, windowDays: 30, lastEntryMinutes: 30 };
const NOW = { date: "2026-11-04", minutes: 600, weekday: 3 }; // 수요일 10:00

test("weekday and date helpers", () => {
  assert.equal(core.weekdayOf("2026-11-04"), 3);
  assert.equal(core.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(core.diffDays("2026-11-04", "2026-12-04"), 30);
  assert.equal(core.formatDate("2026-11-04"), "11월 4일 (수)");
});

test("phone helpers", () => {
  assert.equal(core.normalizePhone("010-1234-5678"), "01012345678");
  assert.equal(core.formatPhone("01012345678"), "010-1234-5678");
  assert.equal(core.formatPhone("0212345678"), "02-1234-5678");
  assert.ok(core.isPhone("01012345678"));
  assert.ok(!core.isPhone("1234"));
  assert.equal(core.maskName("홍길동"), "홍*동");
});

test("slots skip lunch, respect last entry and lead time", () => {
  const plan = core.dayPlan("2026-11-04", HOURS, {});
  const r = core.computeSlots("2026-11-04", plan, RULES, { "11:00": 2 }, NOW);
  const times = r.slots.map((s) => s.time);
  assert.equal(times[0], "11:00");            // 10:00 + 60분 이후
  assert.ok(!times.includes("13:00") && !times.includes("13:30"));
  assert.equal(times[times.length - 1], "18:00");
  assert.equal(r.slots[0].remaining, 0);
});

test("saturday has no lunch break and closes at 14:00", () => {
  const plan = core.dayPlan("2026-11-07", HOURS, {});
  const r = core.computeSlots("2026-11-07", plan, RULES, {}, NOW);
  assert.deepEqual([r.slots[0].time, r.slots[r.slots.length - 1].time], ["09:30", "13:30"]);
  assert.ok(r.slots.some((s) => s.time === "13:00"));
});

test("holidays, sundays and out-of-window dates are closed", () => {
  assert.equal(core.dayPlan("2026-11-08", HOURS, {}).closed, true);
  const hol = core.dayPlan("2026-12-25", HOURS, { "2026-12-25": "성탄절" });
  assert.deepEqual(hol, { closed: true, reason: "성탄절" });
  const far = core.computeSlots("2027-01-20", core.dayPlan("2027-01-20", HOURS, {}), RULES, {}, NOW);
  assert.equal(far.closed, true);
  const past = core.computeSlots("2026-11-03", core.dayPlan("2026-11-03", HOURS, {}), RULES, {}, NOW);
  assert.equal(past.closed, true);
});

test("open status", () => {
  assert.equal(core.openStatus(HOURS, {}, NOW).open, true);
  assert.match(core.openStatus(HOURS, {}, { date: "2026-11-04", minutes: 13 * 60 + 10 }).text, /점심/);
  assert.equal(core.openStatus(HOURS, {}, { date: "2026-11-08", minutes: 600 }).open, false);
});

test("reservation validation", () => {
  const ok = core.validateReservation({ name: " 홍길동 ", phone: "010-1234-5678", treatment: "implant", date: "2026-11-05", time: "10:00", consent: true });
  assert.ok(ok.ok);
  assert.equal(ok.value.phone, "01012345678");
  const bad = core.validateReservation({ name: "", phone: "12", treatment: "x", date: "bad", time: "25:00", consent: false });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["consent", "date", "name", "phone", "time", "treatment"]);
});
