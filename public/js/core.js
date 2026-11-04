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
  // 어르신도 읽기 쉬운 시각: "14:30" → "오후 2:30" (long: "오후 2시 30분")
  function koTime(hhmm, long) {
    var m = typeof hhmm === "number" ? hhmm : toMin(hhmm);
    if (m === null || m === undefined) return String(hhmm || "");
    var h = Math.floor(m / 60) % 24, mi = m % 60, ap = h < 12 ? "오전" : "오후", h12 = h % 12 === 0 ? 12 : h % 12;
    if (long) return ap + " " + h12 + "시" + (mi ? " " + mi + "분" : "");
    return ap + " " + h12 + ":" + (mi < 10 ? "0" : "") + mi;
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
      return { open: false, text: "점심시간 · " + koTime(plan.lunchEnd) + "부터 다시 진료" };
    if (m >= plan.open && m < plan.close) return { open: true, text: "진료 중 · " + koTime(plan.close) + "까지" };
    if (m < plan.open) return { open: false, text: "진료 시작 전 · " + koTime(plan.open) + "부터" };
    return { open: false, text: "오늘 진료 종료" };
  }

  /* ---------- 실시간 예약 현황 ---------- */
  var PARTS = [
    { key: "am", label: "오전", from: 0, to: 12 * 60 },
    { key: "pm", label: "오후", from: 12 * 60, to: 18 * 60 },
    { key: "eve", label: "저녁", from: 18 * 60, to: 24 * 60 }
  ];
  // countsByDate: {"YYYY-MM-DD": {"HH:MM": n}}
  function overview(hours, holidays, rules, countsByDate, now, weekDays, days, label) {
    var week = [], next = null, today = { remaining: 0, openSlots: 0, slots: [] };
    for (var i = 0; i <= rules.windowDays; i++) {
      var ds = addDays(now.date, i);
      var r = computeSlots(ds, planFor(ds, hours, holidays, days, label), rules, countsByDate[ds] || {}, now);
      if (!next) for (var k = 0; k < r.slots.length; k++) if (r.slots[k].remaining > 0) { next = { date: ds, time: r.slots[k].time }; break; }
      if (i === 0) {
        today.slots = r.slots;
        r.slots.forEach(function (s) { today.remaining += s.remaining; if (s.remaining > 0) today.openSlots++; });
      }
      if (i < (weekDays || 7)) {
        week.push({
          date: ds, weekday: weekdayOf(ds), closed: r.closed, reason: r.reason,
          parts: PARTS.map(function (p) {
            var inPart = r.slots.filter(function (s) { var m = toMin(s.time); return m >= p.from && m < p.to; });
            return { key: p.key, label: p.label, total: inPart.length, available: inPart.filter(function (s) { return s.remaining > 0; }).length };
          })
        });
      }
      if (next && i >= (weekDays || 7)) break;
    }
    return { week: week, next: next, today: today };
  }
  // 직원이 올린 대기 안내는 진료 중이고 3시간 이내에 갱신된 경우에만 보여줍니다.
  function liveNotice(live, status, nowMs) {
    var fresh = live && live.updatedAt && (nowMs - Date.parse(live.updatedAt)) < 3 * 3600 * 1000;
    return {
      wait: fresh && status.open && live.wait !== null && live.wait !== undefined ? live.wait : null,
      message: fresh && live.message ? live.message : "",
      updatedAt: fresh ? live.updatedAt : null
    };
  }
  /* ---------- 진료센터 ---------- */
  var DAY_ORDER = "월화수목금토일";
  function inCenter(doctor, key) { return ("," + String(doctor.centers || "").replace(/\s/g, "") + ",").indexOf("," + key + ",") >= 0; }
  // 센터 담당 원장들의 진료 요일 합집합. 담당 원장이 없으면 null(요일 제한 없음)
  function centerDays(doctors, key) {
    var s = "";
    (doctors || []).forEach(function (d) { if (inCenter(d, key)) s += d.days || ""; });
    if (!s) return null;
    return DAY_ORDER.split("").filter(function (w) { return s.indexOf(w) >= 0; }).join("");
  }
  function planFor(ds, hours, holidays, days, label) {
    var p = dayPlan(ds, hours, holidays);
    if (!p.closed && days !== null && days !== undefined && days.indexOf(WEEKDAYS[weekdayOf(ds)]) < 0)
      return { closed: true, reason: (label || "센터") + " 진료일이 아닙니다", centerOff: true };
    return p;
  }
  // 진료 항목(센터)에 맞는 진료일 제한 정보
  function restriction(treatment, centers, doctors) {
    var c = (centers || []).filter(function (x) { return x.key === treatment; })[0];
    if (!c) return { days: null, label: null };
    return { days: centerDays(doctors, c.key), label: c.name };
  }
  /* ---------- 센터 데스크(리셉션) ---------- */
  var INQ_STATUSES = [
    { key: "new", label: "접수" }, { key: "seen", label: "데스크 확인" }, { key: "done", label: "연락 완료" }, { key: "cancelled", label: "취소" }
  ];
  var TOPICS = [
    { key: "first", label: "첫 방문 상담" }, { key: "cost", label: "비용 문의" }, { key: "schedule", label: "일정 · 예약 변경" },
    { key: "pain", label: "통증 · 불편" }, { key: "other", label: "기타" }
  ];
  var PREFERS = [{ key: "asap", label: "지금 바로" }, { key: "am", label: "오전" }, { key: "pm", label: "오후" }, { key: "eve", label: "저녁 (18시 이후)" }];
  // desk: 센터 행(desk_paused, desk_wait, desk_message, desk_staff, desk_updated_at), cs: 센터 요약, clinic: openStatus()
  function deskState(desk, cs, clinic, nowMs) {
    var fresh = desk.desk_updated_at && (nowMs - Date.parse(desk.desk_updated_at)) < 3 * 3600 * 1000;
    var key, label;
    if (desk.desk_paused) { key = "paused"; label = "온라인 접수 잠시 중단"; }
    else if (!cs.today.open) { key = "off"; label = /진료일이 아닙니다/.test(cs.today.reason) ? "오늘은 진료가 없는 날" : "오늘 " + (cs.today.reason || "휴진"); }
    else if (/점심/.test(clinic.text)) { key = "lunch"; label = clinic.text; }
    else if (clinic.open) { key = "open"; label = clinic.text.replace("진료 중", "접수 중"); }
    else { key = "closed"; label = clinic.text.replace("진료 시작 전", "접수 시작 전"); }
    return {
      status: key, label: label, accepting: key !== "paused",
      wait: fresh && key === "open" && desk.desk_wait !== null && desk.desk_wait !== undefined ? desk.desk_wait : null,
      message: desk.desk_message || "", staff: desk.desk_staff || "", updatedAt: desk.desk_updated_at || null
    };
  }
  // 접수 데스크 사진: 같은 사이트 안 /img/desk/ 경로의 이미지 파일만(외부 주소 · 상위 경로 금지)
  function isDeskPhoto(p) { return /^\/img\/desk\/[A-Za-z0-9_\-]+\.(jpe?g|png|webp)$/i.test(String(p || "")); }
  // 시간대별 데스크 조명: 아침 · 오후 · 저녁(접수 종료 뒤엔 소등)
  function deskLight(minutes, status) {
    if (status === "off" || status === "closed" && (minutes >= 17 * 60 || minutes < 8 * 60)) return "night";
    if (minutes < 12 * 60) return "morning";
    if (minutes < 17 * 60) return "afternoon";
    return "evening";
  }
  function validateInquiry(input) {
    var errors = {};
    var name = String(input.name || "").trim(), phone = normalizePhone(input.phone), message = String(input.message || "").trim();
    if (!name) errors.name = "성함을 입력해 주세요."; else if (name.length > 30) errors.name = "성함은 30자 이내로 입력해 주세요.";
    if (!isPhone(phone)) errors.phone = "연락처를 010-1234-5678 형식으로 입력해 주세요.";
    if (!TREATMENTS.some(function (t) { return t.key === input.center && t.key !== "checkup"; })) errors.center = "진료센터를 확인해 주세요.";
    if (!TOPICS.some(function (t) { return t.key === input.topic; })) errors.topic = "상담 내용을 골라 주세요.";
    if (!PREFERS.some(function (t) { return t.key === input.prefer; })) errors.prefer = "연락받을 시간을 골라 주세요.";
    if (message.length > 300) errors.message = "남기실 말씀은 300자 이내로 적어 주세요.";
    if (input.consent !== true) errors.consent = "개인정보 수집에 동의해야 상담을 요청할 수 있습니다.";
    return { ok: !Object.keys(errors).length, errors: errors, value: { name: name, phone: phone, center: input.center, topic: input.topic, prefer: input.prefer, message: message } };
  }

  function centerSummaries(centers, doctors, hours, holidays, rules, countsByDate, now, clinic, nowMs, pending) {
    return centers.map(function (c) {
      var days = centerDays(doctors, c.key);
      var ov = overview(hours, holidays, rules, countsByDate, now, 7, days, c.name);
      var tp = planFor(now.date, hours, holidays, days, c.name);
      return {
        key: c.key, name: c.name, days: days, next: ov.next, week: ov.week,
        today: { open: !tp.closed, reason: tp.reason || "", openSlots: ov.today.openSlots },
        doctorsToday: tp.closed ? [] : doctors.filter(function (d) { return inCenter(d, c.key) && worksOn(d.days, now.weekday); }).map(function (d) { return d.name; })
      };
    }).map(function (cs, i) {
      if (clinic) { cs.desk = deskState(centers[i], cs, clinic, nowMs || Date.now()); cs.desk.pending = (pending && pending[cs.key]) || 0; }
      return cs;
    });
  }
  function parseLines(text) {
    return String(text || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var i = l.indexOf("|"); return i < 0 ? { title: l, body: "" } : { title: l.slice(0, i).trim(), body: l.slice(i + 1).trim() };
    });
  }

  /* ---------- 안내 챗봇 (규칙 기반) ---------- */
  var SYMPTOMS = [
    { id: "cold", where: true, label: "이가 시려요", t: "endo", time: "약 40분", ins: "검사와 기본 치료는 건강보험 적용", kw: ["시려", "시림", "시린", "찬물", "충치", "썩"] },
    { id: "bite", where: true, label: "씹을 때 아파요", t: "endo", time: "약 50분", ins: "신경치료는 건강보험 적용", kw: ["씹을", "욱신", "치통", "이가 아", "이빨이 아", "신경"] },
    { id: "gum", where: true, label: "잇몸에서 피가 나요", t: "perio", time: "약 60분", ins: "만 19세 이상 스케일링 연 1회 보험", kw: ["잇몸", "피가", "출혈", "스케일링", "치석", "붓"] },
    { id: "lost", where: true, label: "이가 빠졌어요", t: "implant", time: "60 – 90분 (CT 포함)", ins: "만 65세 이상 평생 2개 보험", kw: ["빠졌", "빠진", "없어", "임플란트", "틀니", "발치"] },
    { id: "crooked", label: "치아가 삐뚤어요", t: "ortho", time: "약 60분 (정밀 진단)", ins: "비급여 (진료비 안내 참고)", kw: ["삐뚤", "교정", "덧니", "돌출", "투명교정"] },
    { id: "jaw", label: "턱에서 소리가 나요", t: "tmj", time: "약 60분", ins: "검사 일부 건강보험 적용", kw: ["턱", "딱딱", "이갈", "입이 안"] },
    { id: "kid", label: "아이 첫 검진", t: "kids", time: "약 30분", ins: "만 18세 이하 실란트 보험", kw: ["아이", "아기", "어린이", "유치", "소아", "실란트", "불소"] },
    { id: "color", where: true, label: "치아 색이 누래요", t: "esthetic", time: "약 40분", ins: "비급여 (진료비 안내 참고)", kw: ["누래", "누런", "미백", "하얗", "라미네이트", "색"] }
  ];
  var INTENTS = [
    { key: "mine", kw: ["내 예약", "예약 확인", "예약확인", "예약 취소", "취소", "변경", "접수번호", "예약번호"] },
    { key: "call", kw: ["상담원", "통화", "전화", "연락", "사람", "직원"] },
    { key: "cost", kw: ["비용", "가격", "얼마", "금액", "보험", "비싸"] },
    { key: "today", kw: ["오늘", "지금", "진료 중", "진료하", "몇 시", "몇시", "영업", "야간", "토요일", "주말", "점심"] },
    { key: "way", kw: ["위치", "주소", "오시는", "주차", "지하철", "어디", "찾아"] },
    { key: "book", kw: ["예약", "방문", "가고 싶", "진료 받"] },
    { key: "hello", kw: ["안녕", "처음", "도와"] }
  ];
  // 자유 입력 문장 → { intent, symptom } (증상 단어가 있으면 증상 안내가 우선)
  function chatIntent(text) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    var sym = null;
    SYMPTOMS.forEach(function (s) { if (!sym && s.kw.some(function (k) { return t.indexOf(k) >= 0; })) sym = s; });
    var intent = null;
    INTENTS.forEach(function (it) { if (!intent && it.kw.some(function (k) { return t.indexOf(k) >= 0; })) intent = it.key; });
    if (sym && (intent === null || intent === "book" || intent === "hello")) intent = "symptom";
    if (!intent && /아파|아프|통증|불편/.test(t)) intent = "pain";
    return { intent: intent || "unknown", symptom: sym };
  }
  function maskPhone(p) { var d = formatPhone(p); return d.replace(/-(\d{3,4})-/, "-****-"); }

  function waitLabel(w) { return w === null || w === undefined ? "" : w === 0 ? "바로 진료 가능" : "대기 약 " + w + "분"; }
  function worksOn(days, weekday) { return String(days || "").indexOf(WEEKDAYS[weekday]) >= 0; }

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
    labelOf: labelOf, koTime: koTime, seoulNow: seoulNow, toMin: toMin, toHHMM: toHHMM, isDate: isDate, isTime: isTime,
    weekdayOf: weekdayOf, addDays: addDays, diffDays: diffDays, formatDate: formatDate,
    normalizePhone: normalizePhone, isPhone: isPhone, formatPhone: formatPhone, maskName: maskName,
    dayPlan: dayPlan, computeSlots: computeSlots, isDeskPhoto: isDeskPhoto, deskLight: deskLight, openStatus: openStatus, validateReservation: validateReservation,
    PARTS: PARTS, overview: overview, liveNotice: liveNotice, waitLabel: waitLabel, worksOn: worksOn,
    SYMPTOMS: SYMPTOMS, chatIntent: chatIntent, maskPhone: maskPhone,
    INQ_STATUSES: INQ_STATUSES, TOPICS: TOPICS, PREFERS: PREFERS, deskState: deskState, validateInquiry: validateInquiry,
    inCenter: inCenter, centerDays: centerDays, planFor: planFor, restriction: restriction, centerSummaries: centerSummaries, parseLines: parseLines
  };
});
