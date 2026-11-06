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

test("chatbot understands common patient messages", () => {
  const cases = {
    "이가 시려요": ["symptom", "endo"], "잇몸에서 피가 나요": ["symptom", "perio"], "아이 첫 검진 받고 싶어요": ["symptom", "kids"],
    "임플란트 비용 얼마예요": ["cost", "implant"], "오늘 진료해요?": ["today", null], "주차 되나요": ["way", null],
    "예약하고 싶어요": ["book", null], "내 예약 확인할래요": ["mine", null], "상담원 연결해 주세요": ["call", null],
    "이가 너무 아파요": ["pain", null], "ㅁㄴㅇㄹ": ["unknown", null]
  };
  Object.keys(cases).forEach((t) => {
    const r = core.chatIntent(t);
    assert.equal(r.intent, cases[t][0], t);
    assert.equal(r.symptom ? r.symptom.t : null, cases[t][1], t);
  });
  assert.equal(core.maskPhone("01012345678"), "010-****-5678");
});

test("times are shown in Korean 12-hour form for older patients", () => {
  assert.equal(core.koTime("09:30"), "오전 9:30");
  assert.equal(core.koTime("12:00"), "오후 12:00");
  assert.equal(core.koTime("14:05"), "오후 2:05");
  assert.equal(core.koTime("18:00", true), "오후 6시");
  assert.equal(core.koTime("13:30", true), "오후 1시 30분");
  assert.match(core.openStatus(HOURS, {}, NOW).text, /오후 6:30까지/);
});

test("voice guidance reads times, phones and codes the way people say them", () => {
  const { speakable } = require("../public/js/voice.js");
  assert.equal(speakable("가장 빠른 예약 오늘 오후 2:30"), "가장 빠른 예약 오늘 오후 2시 30분");
  assert.equal(speakable("오전 9:00 ~ 오후 6:30"), "오전 9시부터 오후 6시 30분");
  assert.equal(speakable("전화 010-1234-5678"), "전화 공일공, 일이삼사, 오육칠팔");
  assert.equal(speakable("예약번호 A7NG4T"), "예약번호 A 7 N G 4 T");
  assert.match(speakable("#36 신경치료"), /36번 치아/);
  assert.equal(speakable("2 / 7 단계. 오늘 · 11월 4일 (수)"), "7단계 중 2단계. 오늘, 11월 4일 수요일");
  assert.equal(speakable("충치·신경치료센터"), "충치 신경치료센터");
  // 화면용 줄바꿈 없는 공백(keep)과 오전·오후를 줄인 범위도 말로 읽힘
  assert.equal(speakable("가장\u00a0빠른\u00a0예약\u00a0오늘\u00a0오후\u00a02:30"), "가장 빠른 예약 오늘 오후 2시 30분");
  assert.equal(speakable("점심시간 오후 1:00 ~ 2:00"), "점심시간 오후 1시부터 2시");
  assert.equal(speakable("예약번호 A7NG4T · 010-1234-5678"), "예약번호 A 7 N G 4 T, 공일공, 일이삼사, 오육칠팔");
});

test("reception counter: desk photo paths and time-of-day lighting", () => {
  assert.ok(core.isDeskPhoto("/img/desk/implant.webp"));
  assert.ok(core.isDeskPhoto("/img/desk/kids-2.JPG"));
  ["https://x.com/a.jpg", "/img/desk/../admin.jpg", "/img/desk/a.svg", "//x.com/img/desk/a.jpg", "", null].forEach((p) => assert.equal(core.isDeskPhoto(p), false, String(p)));
  assert.equal(core.deskLight(10 * 60, "open"), "morning");
  assert.equal(core.deskLight(14 * 60, "open"), "afternoon");
  assert.equal(core.deskLight(17 * 60 + 30, "open"), "evening");
  assert.equal(core.deskLight(19 * 60, "closed"), "night");
  assert.equal(core.deskLight(8 * 60 + 30, "closed"), "morning");
  assert.equal(core.deskLight(11 * 60, "off"), "night");
});

test("every symptom has a picture symbol and a text label", () => {
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "public", "index.html"), "utf8");
  core.SYMPTOMS.forEach((s) => {
    assert.ok(html.includes('<symbol id="p-' + s.id + '"'), "그림 없음: " + s.id);
    assert.ok(s.label && s.label.length > 2, "글자 이름 없음: " + s.id);
  });
  assert.deepEqual(core.SYMPTOMS.filter((s) => s.where).map((s) => s.id), ["cold", "bite", "gum", "lost", "color"]);
});
