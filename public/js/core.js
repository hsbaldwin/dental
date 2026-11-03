/*
 * W치과 공통 로직 — 서버(Node)와 브라우저가 함께 사용합니다.
 * 날짜는 'YYYY-MM-DD', 시각은 'HH:MM' 문자열이며 모두 한국 시간(Asia/Seoul) 기준입니다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TREATMENTS = [
    { key: "checkup", label: "검진 · 상담" },
    { key: "implant", label: "임플란트" },
    { key: "ortho", label: "교정" },
    { key: "endo", label: "충치 · 신경치료" },
    { key: "esthetic", label: "심미 · 미백" },
    { key: "perio", label: "잇몸 치료" },
    { key: "kids", label: "소아치과" },
    { key: "tmj", label: "턱관절" }
  ];

  var STATUSES = [
    { key: "requested", label: "확인 대기" },
    { key: "confirmed", label: "예약 확정" },
    { key: "visited", label: "내원 완료" },
    { key: "no_show", label: "미내원" },
    { key: "cancelled", label: "취소" }
  ];
  var ACTIVE = ["requested", "confirmed"];
  var WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  function labelOf(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].label;
    return key;
  }

  /* ---------- 시간 ---------- */
  function seoulNow(date) {
    var d = date || new Date();
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(d);
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    var ds = o.year + "-" + o.month + "-" + o.day;
    return { date: ds, minutes: (parseInt(o.hour, 10) % 24) * 60 + parseInt(o.minute, 10), weekday: weekdayOf(ds) };
  }
  function toMin(hhmm) {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    var p = hhmm.split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }
  function toHHMM(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")); }
  function isTime(s) { return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function weekdayOf(ds) { return new Date(ds + "T00:00:00Z").getUTCDay(); }
  function addDays(ds, n) {
    var d = new Date(ds + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function diffDays(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  function formatDate(ds) {
    var p = ds.split("-");
    return parseInt(p[1], 10) + "월 " + parseInt(p[2], 10) + "일 (" + WEEKDAYS[weekdayOf(ds)] + ")";
  }

  /* ---------- 전화번호 ---------- */
  function normalizePhone(s) { return String(s || "").replace(/\D/g, ""); }
  function isPhone(digits) { return /^0\d{8,10}$/.test(digits); }
  function formatPhone(d) {
    d = normalizePhone(d);
    if (/^02\d{7,8}$/.test(d)) return d.replace(/^(02)(\d{3,4})(\d{4})$/, "$1-$2-$3");
    if (/^0\d{9,10}$/.test(d)) return d.replace(/^(0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3");
    return d;
  }
  function maskName(name) {
    var n = String(name || "");
    if (n.length <= 1) return n;
    if (n.length === 2) return n[0] + "*";
    return n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
  }

  /* ---------- 진료일 / 예약 가능 시간 ---------- */
  // hours: [{weekday, closed, open, close, lunch_start, lunch_end}] , holidays: {date: label}
  function dayPlan(ds, hours, holidays) {
    if (holidays && holidays[ds]) return { closed: true, reason: holidays[ds] };
    var w = weekdayOf(ds), row = null;
    for (var i = 0; i < hours.length; i++) if (hours[i].weekday === w) row = hours[i];
    if (!row || row.closed) return { closed: true, reason: "정기 휴진" };
    var open = toMin(row.open), close = toMin(row.close);
    if (open === null || close === null || close <= open) return { closed: true, reason: "정기 휴진" };
    return { closed: false, open: open, close: close, lunchStart: toMin(row.lunch_start), lunchEnd: toMin(row.lunch_end) };
  }

  // rules: {slotMinutes, capacity, leadMinutes, windowDays, lastEntryMinutes}
  // counts: {"HH:MM": 예약 수}, now: seoulNow()
  function computeSlots(ds, plan, rules, counts, now) {
    var res = { date: ds, closed: plan.closed, reason: plan.reason || "", slots: [] };
    if (plan.closed) return res;
    var ahead = diffDays(now.date, ds);
    if (ahead < 0 || ahead > rules.windowDays) { res.closed = true; res.reason = "예약 가능 기간이 아닙니다"; return res; }
    var step = rules.slotMinutes, last = plan.close - (rules.lastEntryMinutes || 0);
    for (var t = plan.open; t + step <= plan.close && t <= last; t += step) {
      var inLunch = plan.lunchStart !== null && plan.lunchEnd !== null && t < plan.lunchEnd && t + step > plan.lunchStart;
      if (inLunch) continue;
      if (ahead === 0 && t < now.minutes + rules.leadMinutes) continue;
      var key = toHHMM(t), used = (counts && counts[key]) || 0;
      res.slots.push({ time: key, remaining: Math.max(0, rules.capacity - used) });
    }
    if (!res.slots.length && ahead === 0) { res.closed = true; res.reason = "오늘 예약 가능한 시간이 지났습니다"; }
    return res;
  }

  function openStatus(hours, holidays, now) {
    var plan = dayPlan(now.date, hours, holidays);
    if (plan.closed) return { open: false, text: plan.reason === "정기 휴진" ? "오늘 휴진" : "휴진 · " + plan.reason };
    var m = now.minutes;
    if (plan.lunchStart !== null && plan.lunchEnd !== null && m >= plan.lunchStart && m < plan.lunchEnd)
      return { open: false, text: "점심시간 · " + toHHMM(plan.lunchEnd) + " 재개" };
    if (m >= plan.open && m < plan.close) return { open: true, text: "진료 중 · " + toHHMM(plan.close) + "까지" };
    if (m < plan.open) return { open: false, text: toHHMM(plan.open) + " 진료 시작" };
    return { open: false, text: "오늘 진료 종료" };
  }

  /* ---------- 입력 검증 ---------- */
  function validateReservation(input) {
    var errors = {};
    var name = String(input.name || "").trim();
    var phone = normalizePhone(input.phone);
    var memo = String(input.memo || "").trim();
    if (!name) errors.name = "성함을 입력해 주세요.";
    else if (name.length > 30) errors.name = "성함은 30자 이내로 입력해 주세요.";
    if (!isPhone(phone)) errors.phone = "연락처를 010-1234-5678 형식으로 입력해 주세요.";
    if (!TREATMENTS.some(function (t) { return t.key === input.treatment; })) errors.treatment = "진료 항목을 선택해 주세요.";
    if (!isDate(input.date)) errors.date = "날짜를 선택해 주세요.";
    if (!isTime(input.time)) errors.time = "시간을 선택해 주세요.";
    if (memo.length > 500) errors.memo = "메모는 500자 이내로 입력해 주세요.";
    if (input.consent !== true) errors.consent = "개인정보 수집에 동의해야 예약할 수 있습니다.";
    return {
      ok: Object.keys(errors).length === 0, errors: errors,
      value: { name: name, phone: phone, treatment: input.treatment, date: input.date, time: input.time, memo: memo }
    };
  }

  return {
    TREATMENTS: TREATMENTS, STATUSES: STATUSES, ACTIVE: ACTIVE, WEEKDAYS: WEEKDAYS,
    labelOf: labelOf, seoulNow: seoulNow, toMin: toMin, toHHMM: toHHMM, isDate: isDate, isTime: isTime,
    weekdayOf: weekdayOf, addDays: addDays, diffDays: diffDays, formatDate: formatDate,
    normalizePhone: normalizePhone, isPhone: isPhone, formatPhone: formatPhone, maskName: maskName,
    dayPlan: dayPlan, computeSlots: computeSlots, openStatus: openStatus, validateReservation: validateReservation
  };
});
