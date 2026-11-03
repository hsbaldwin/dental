/*
 * 체험판 전용: 서버 없이 브라우저 안에서 API를 흉내 냅니다. (scripts/build-demo.js 가 체험판에만 넣습니다)
 * 데이터는 이 브라우저의 localStorage 에만 저장되며, 실제 운영에서는 server/ 의 Node 서버가 같은 API를 제공합니다.
 */
(function () {
  "use strict";
  var C = window.WCore;
  var KEY = "w-demo-v1";
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var now = function () { return C.seoulNow(); };
  var iso = function () { return new Date().toISOString(); };

  function seed() {
    var t = now().date;
    var s = {
      seq: 100,
      clinic: { name: "W치과의원", shortName: "W치과", address: "OO시 OO구 OO대로 000, 4층", phone: "02-000-0000", subway: "OO역 2번 출구에서 도보 3분", parking: "건물 지하 주차장 2시간 무료", director: "OOO", bizNo: "000-00-00000", kakaoUrl: "https://pf.kakao.com/", naverBookingUrl: "https://booking.naver.com/", naverMapUrl: "https://map.naver.com/", kakaoMapUrl: "https://map.kakao.com/" },
      booking: { slotMinutes: 30, capacity: 2, leadMinutes: 60, windowDays: 30, lastEntryMinutes: 30, maxActivePerPhone: 3, retentionDays: 180 },
      hours: [
        { weekday: 0, closed: 1, open: null, close: null, lunch_start: null, lunch_end: null, note: null },
        { weekday: 1, closed: 0, open: "09:30", close: "18:30", lunch_start: "13:00", lunch_end: "14:00", note: null },
        { weekday: 2, closed: 0, open: "09:30", close: "21:00", lunch_start: "13:00", lunch_end: "14:00", note: "야간" },
        { weekday: 3, closed: 0, open: "09:30", close: "18:30", lunch_start: "13:00", lunch_end: "14:00", note: null },
        { weekday: 4, closed: 0, open: "09:30", close: "21:00", lunch_start: "13:00", lunch_end: "14:00", note: "야간" },
        { weekday: 5, closed: 0, open: "09:30", close: "18:30", lunch_start: "13:00", lunch_end: "14:00", note: null },
        { weekday: 6, closed: 0, open: "09:30", close: "14:00", lunch_start: null, lunch_end: null, note: "점심시간 없음" }
      ],
      holidays: [{ date: "2026-12-25", label: "성탄절" }, { date: "2027-01-01", label: "신정" }],
      fees: [
        ["임플란트 (국산 픽스처 + 지르코니아)", "1개", 1100000], ["뼈이식 (부분)", "1부위", 300000], ["지르코니아 크라운", "1개", 500000],
        ["레진 충전 (13세 이상)", "1치아", 100000], ["투명교정 (전체)", "1회 과정", 5500000], ["전문가 미백", "1회", 200000]
      ].map(function (f, i) { return { id: i + 1, name: f[0], unit: f[1], price: f[2], note: "", sort: i + 1 }; }),
      doctors: [
        { id: 1, name: "원장 성함", role: "대표원장 · 통합치의학과 전문의", career: "치의학 석사\n임플란트 · 보철 진료", quote: "뽑지 않고 살릴 수 있는 치아부터 찾습니다.", sort: 1 },
        { id: 2, name: "원장 성함", role: "원장 · 치과교정과 전문의", career: "교정 · 턱관절 진료\n투명교정 인증의", quote: "교정 기간과 비용은 첫 상담에서 정해 드립니다.", sort: 2 },
        { id: 3, name: "원장 성함", role: "원장 · 소아치과 전문의", career: "소아 · 보존 진료\n장애인 치과 진료", quote: "아이가 다음에도 오고 싶어 하는 치과를 만듭니다.", sort: 3 }
      ],
      notices: [{ id: 1, title: "체험판입니다 · 예약은 이 브라우저에만 저장됩니다", body: "홈페이지에서 예약한 뒤 하단 '직원 로그인'(아이디 admin / 비밀번호 demo1234)으로 들어가 확정해 보세요.", pinned: 1, published: 1, created_at: iso() }],
      users: [{ id: 1, username: "admin", name: "관리자", role: "admin", pw: "demo1234", created_at: iso() }],
      reservations: [], audit: [], outbox: []
    };
    // 예시 예약 (가상 인물)
    var samples = [
      [t, "10:00", "김예시", "01011110001", "implant", "confirmed", "staff", ""],
      [t, "11:30", "이샘플", "01011110002", "perio", "confirmed", "web", "잇몸에서 피가 나요"],
      [t, "15:00", "박체험", "01011110003", "kids", "requested", "web", "아이 첫 검진"],
      [C.addDays(t, 1), "10:30", "최가상", "01011110004", "ortho", "requested", "web", "투명교정 상담 원해요"],
      [C.addDays(t, 2), "19:00", "정데모", "01011110005", "endo", "confirmed", "web", "찬물에 시려요"],
      [C.addDays(t, -3), "14:00", "한지난", "01011110006", "checkup", "visited", "web", ""],
      [C.addDays(t, -2), "16:00", "윤결석", "01011110007", "esthetic", "no_show", "web", ""]
    ];
    samples.forEach(function (x, i) {
      s.reservations.push({ id: i + 1, code: "DEMO0" + (i + 1), date: x[0], time: x[1], name: x[2], phone: x[3], treatment: x[4], status: x[5], source: x[6], memo: x[7], staff_memo: "", consent_at: x[6] === "web" ? iso() : null, reminded: 0, purged: 0, created_at: iso(), updated_at: iso() });
    });
    return s;
  }
  var S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || !S.clinic) S = seed();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  save();
  function sessionUser() { var id; try { id = Number(sessionStorage.getItem("w-demo-user")); } catch (e) { id = window.__wDemoUser; } return S.users.filter(function (u) { return u.id === id; })[0] || null; }
  function setSession(id) { try { if (id) sessionStorage.setItem("w-demo-user", id); else sessionStorage.removeItem("w-demo-user"); } catch (e) { window.__wDemoUser = id; } }

  function Err(status, msg, extra) { this.status = status; this.body = Object.assign({ error: msg }, extra || {}); }
  function audit(user, action, target) { S.audit.unshift({ id: ++S.seq, at: iso(), username: user, action: action, target: target, detail: null }); S.audit = S.audit.slice(0, 300); }
  function out(channel, to, body) { S.outbox.unshift({ id: ++S.seq, at: iso(), channel: channel, recipient: to, body: body, status: "skipped", error: null }); S.outbox = S.outbox.slice(0, 300); }
  function hmap() { var m = {}; S.holidays.forEach(function (h) { m[h.date] = h.label; }); return m; }
  function counts(ds, excludeId) {
    var m = {};
    S.reservations.forEach(function (r) { if (r.date === ds && r.id !== excludeId && C.ACTIVE.indexOf(r.status) >= 0) m[r.time] = (m[r.time] || 0) + 1; });
    return m;
  }
  function slotsFor(ds, n) { return C.computeSlots(ds, C.dayPlan(ds, S.hours, hmap()), S.booking, counts(ds), n || now()); }
  function pub(r) {
    var n = now(), future = r.date > n.date || (r.date === n.date && C.toMin(r.time) > n.minutes);
    return { code: r.code, name: C.maskName(r.name), treatment: r.treatment, treatmentLabel: C.labelOf(C.TREATMENTS, r.treatment), date: r.date, time: r.time, status: r.status, statusLabel: C.labelOf(C.STATUSES, r.status), canCancel: C.ACTIVE.indexOf(r.status) >= 0 && future };
  }
  function msg(kind, r) {
    var h = "[" + S.clinic.shortName + "] ", w = C.formatDate(r.date) + " " + r.time;
    return h + ({ requested: "예약 신청이 접수되었습니다. " + w + ". 예약번호 " + r.code, confirmed: w + " 예약이 확정되었습니다.", changed: "예약이 " + w + "(으)로 변경되었습니다.", cancelled: w + " 예약이 취소되었습니다." })[kind];
  }
  function newCode() { var a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = ""; for (var i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function findCP(b) {
    var code = String(b.code || "").trim().toUpperCase(), phone = C.normalizePhone(b.phone);
    var r = S.reservations.filter(function (x) { return x.code === code && x.phone === phone; })[0];
    if (!r) throw new Err(404, "일치하는 예약이 없습니다. 예약번호와 연락처를 다시 확인해 주세요.");
    return r;
  }
  function need(role) { var u = sessionUser(); if (!u) throw new Err(401, "로그인이 필요합니다."); if (role === "admin" && u.role !== "admin") throw new Err(403, "관리자 권한이 필요합니다."); return u; }
  function staffRes(b, partial) {
    var o = {};
    if (!partial || "name" in b) { o.name = String(b.name || "").trim(); if (!o.name) throw new Err(400, "성함을 입력해 주세요."); }
    if (!partial || "phone" in b) { o.phone = C.normalizePhone(b.phone); if (!C.isPhone(o.phone)) throw new Err(400, "연락처를 확인해 주세요."); }
    ["treatment", "date", "time", "memo", "staff_memo", "status"].forEach(function (k) { if (k in b) o[k] = b[k]; });
    if (o.date !== undefined && !C.isDate(o.date)) throw new Err(400, "날짜를 확인해 주세요.");
    if (o.time !== undefined && !C.isTime(o.time)) throw new Err(400, "시간을 확인해 주세요.");
    return o;
  }
  function list(name) { return S[name].slice().sort(function (a, b) { return name === "notices" ? (b.pinned - a.pinned) || (b.id - a.id) : (a.sort - b.sort) || (a.id - b.id); }); }

  var R = [];
  function on(m, re, fn) { R.push([m, re, fn]); }

  on("GET", /^site$/, function () {
    var n = now(), hol = S.holidays.filter(function (h) { return h.date >= n.date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return { clinic: S.clinic, booking: S.booking, hours: S.hours, holidays: hol, status: C.openStatus(S.hours, hmap(), n), today: n.date, fees: list("fees"), feesUpdatedAt: null, doctors: list("doctors"), notices: list("notices").filter(function (x) { return x.published; }), treatments: C.TREATMENTS };
  });
  on("GET", /^days$/, function () {
    var n = now(), days = [];
    for (var i = 0; i <= S.booking.windowDays; i++) {
      var ds = C.addDays(n.date, i), r = slotsFor(ds, n);
      days.push({ date: ds, weekday: C.weekdayOf(ds), closed: r.closed, reason: r.reason, available: r.slots.filter(function (s) { return s.remaining > 0; }).length });
    }
    return { days: days };
  });
  on("GET", /^slots$/, function (q) { return slotsFor(q.get("date")); });
  on("POST", /^reservations$/, function (q, b) {
    var v = C.validateReservation(b);
    if (!v.ok) throw new Err(400, Object.values(v.errors)[0], { fields: v.errors });
    var r = v.value, sl = slotsFor(r.date), slot = sl.slots.filter(function (s) { return s.time === r.time; })[0];
    if (sl.closed || !slot || slot.remaining <= 0) throw new Err(409, "선택한 시간에는 예약할 수 없습니다. 다른 시간을 선택해 주세요.");
    if (S.reservations.some(function (x) { return x.phone === r.phone && x.date === r.date && x.time === r.time && C.ACTIVE.indexOf(x.status) >= 0; })) throw new Err(409, "같은 시간에 이미 예약이 있습니다.");
    var rec = Object.assign({ id: ++S.seq, code: newCode(), status: "requested", source: "web", staff_memo: "", consent_at: iso(), reminded: 0, purged: 0, created_at: iso(), updated_at: iso() }, r);
    S.reservations.push(rec);
    out("staff", null, "새 예약 신청: " + C.maskName(r.name) + " · " + C.formatDate(r.date) + " " + r.time);
    out("sms", r.phone, msg("requested", rec));
    return [201, pub(rec)];
  });
  on("POST", /^reservations\/lookup$/, function (q, b) { return pub(findCP(b)); });
  on("POST", /^reservations\/cancel$/, function (q, b) {
    var r = findCP(b); if (!pub(r).canCancel) throw new Err(409, "이미 지났거나 취소된 예약입니다.");
    r.status = "cancelled"; r.updated_at = iso(); audit("patient", "reservation.cancel", "reservation:" + r.id);
    out("staff", null, "환자 예약 취소: " + C.maskName(r.name) + " · " + C.formatDate(r.date) + " " + r.time);
    return pub(r);
  });

  on("POST", /^admin\/login$/, function (q, b) {
    var u = S.users.filter(function (x) { return x.username === String(b.username || "").trim() && x.pw === b.password; })[0];
    if (!u) throw new Err(401, "아이디 또는 비밀번호가 올바르지 않습니다. (체험판: admin / demo1234)");
    setSession(u.id); audit(u.username, "login", null);
    return { id: u.id, username: u.username, name: u.name, role: u.role };
  });
  on("POST", /^admin\/logout$/, function () { setSession(null); return { ok: true }; });
  on("GET", /^admin\/me$/, function () { var u = need(); return { id: u.id, username: u.username, name: u.name, role: u.role }; });
  on("GET", /^admin\/summary$/, function () {
    need(); var n = now(), wk = C.addDays(n.date, 6), f30 = C.addDays(n.date, -30), c = function (fn) { return S.reservations.filter(fn).length; };
    var vis = c(function (r) { return r.status === "visited" && r.date >= f30 && r.date <= n.date; }), ns = c(function (r) { return r.status === "no_show" && r.date >= f30 && r.date <= n.date; });
    return {
      today: n.date, todayCount: c(function (r) { return r.date === n.date && r.status !== "cancelled"; }),
      pending: c(function (r) { return r.status === "requested" && r.date >= n.date; }),
      week: c(function (r) { return r.date >= n.date && r.date <= wk && C.ACTIVE.indexOf(r.status) >= 0; }),
      noShowRate: vis + ns ? Math.round(ns / (vis + ns) * 1000) / 10 : null, noShowBase: vis + ns,
      latestId: S.reservations.reduce(function (m, r) { return Math.max(m, r.id); }, 0)
    };
  });
  on("GET", /^admin\/reservations$/, function (q) {
    need(); var from = q.get("from") || now().date, to = q.get("to") || C.addDays(from, 30), st = q.get("status"), s = (q.get("q") || "").trim(), d = C.normalizePhone(s);
    return { items: S.reservations.filter(function (r) {
      return r.date >= from && r.date <= to && (!st || r.status === st) && (!s || r.name.indexOf(s) >= 0 || r.code.indexOf(s.toUpperCase()) >= 0 || (d && r.phone.indexOf(d) >= 0));
    }).sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; }) };
  });
  on("GET", /^admin\/slots$/, function (q) {
    need(); var ds = q.get("date");
    return C.computeSlots(ds, C.dayPlan(ds, S.hours, hmap()), Object.assign({}, S.booking, { windowDays: 3650, leadMinutes: 0 }), counts(ds), { date: C.addDays(ds, -1), minutes: 0 });
  });
  function warn(r) { var used = counts(r.date, r.id)[r.time] || 0; return used >= S.booking.capacity ? "이 시간에는 이미 예약이 " + used + "건 있습니다 (기준 " + S.booking.capacity + "건)." : null; }
  on("POST", /^admin\/reservations$/, function (q, b) {
    var u = need(), o = staffRes(b, false);
    var rec = Object.assign({ id: ++S.seq, code: newCode(), status: "confirmed", source: "staff", memo: "", staff_memo: "", consent_at: null, reminded: 0, purged: 0, created_at: iso(), updated_at: iso() }, o, { status: "confirmed" });
    var w = warn(rec); S.reservations.push(rec); audit(u.username, "reservation.create", "reservation:" + rec.id);
    if (b.notify !== false) out("sms", rec.phone, msg("confirmed", rec));
    return [201, { item: rec, warning: w }];
  });
  on("PATCH", /^admin\/reservations\/(\d+)$/, function (q, b, m) {
    var u = need(), r = S.reservations.filter(function (x) { return x.id === Number(m[1]); })[0];
    if (!r) throw new Err(404, "예약을 찾을 수 없습니다.");
    var before = Object.assign({}, r), o = staffRes(b, true);
    Object.assign(r, o, { updated_at: iso() });
    var moved = r.date !== before.date || r.time !== before.time;
    audit(u.username, "reservation.update", "reservation:" + r.id);
    if (b.notify !== false) {
      if (before.status !== "confirmed" && r.status === "confirmed") out("sms", r.phone, msg("confirmed", r));
      else if (moved && C.ACTIVE.indexOf(r.status) >= 0) out("sms", r.phone, msg("changed", r));
      if (before.status !== "cancelled" && r.status === "cancelled") out("sms", r.phone, msg("cancelled", r));
    }
    return { item: r, warning: moved && C.ACTIVE.indexOf(r.status) >= 0 ? warn(r) : null };
  });
  on("GET", /^admin\/settings$/, function () { need(); return { clinic: S.clinic, booking: S.booking, hours: S.hours }; });
  on("PUT", /^admin\/settings\/clinic$/, function (q, b) { var u = need("admin"); S.clinic = Object.assign({}, S.clinic, b); audit(u.username, "settings.clinic", "clinic"); return S.clinic; });
  on("PUT", /^admin\/settings\/booking$/, function (q, b) { var u = need("admin"); Object.keys(b).forEach(function (k) { if (!(b[k] >= 0)) throw new Err(400, "숫자 값을 확인해 주세요."); }); S.booking = Object.assign({}, S.booking, b); audit(u.username, "settings.booking", "booking"); return S.booking; });
  on("PUT", /^admin\/hours$/, function (q, b) {
    var u = need("admin");
    b.hours.forEach(function (h) { if (!h.closed && (!h.open || !h.close || C.toMin(h.close) <= C.toMin(h.open))) throw new Err(400, C.WEEKDAYS[h.weekday] + "요일 진료 시작·종료 시각을 확인해 주세요."); });
    S.hours = b.hours.map(function (h) { return h.closed ? { weekday: h.weekday, closed: 1, open: null, close: null, lunch_start: null, lunch_end: null, note: h.note } : { weekday: h.weekday, closed: 0, open: h.open, close: h.close, lunch_start: h.lunch_start || null, lunch_end: h.lunch_end || null, note: h.note || null }; });
    audit(u.username, "settings.hours", "hours"); return { hours: S.hours };
  });
  on("GET", /^admin\/holidays$/, function () { need(); return { items: S.holidays.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }) }; });
  on("POST", /^admin\/holidays$/, function (q, b) {
    var u = need("admin"); if (!C.isDate(b.date) || !String(b.label || "").trim()) throw new Err(400, "날짜와 사유를 입력해 주세요.");
    S.holidays = S.holidays.filter(function (h) { return h.date !== b.date; }).concat([{ date: b.date, label: b.label.trim() }]);
    audit(u.username, "holiday.set", "holidays:" + b.date);
    return [201, { date: b.date, label: b.label, affected: S.reservations.filter(function (r) { return r.date === b.date && C.ACTIVE.indexOf(r.status) >= 0; }).length }];
  });
  on("DELETE", /^admin\/holidays\/(.+)$/, function (q, b, m) { var u = need("admin"); S.holidays = S.holidays.filter(function (h) { return h.date !== m[1]; }); audit(u.username, "holiday.delete", "holidays:" + m[1]); return { ok: true }; });
  ["fees", "doctors", "notices"].forEach(function (name) {
    var role = name === "notices" ? "staff" : "admin";
    var clean = function (b) {
      var o = Object.assign({}, b);
      if (name === "notices") { o.pinned = b.pinned ? 1 : 0; o.published = b.published === false ? 0 : 1; if (!String(b.title || "").trim()) throw new Err(400, "제목을 입력해 주세요."); }
      else if (!String(b.name || "").trim()) throw new Err(400, "이름을 입력해 주세요.");
      if ("sort" in o) o.sort = Number(o.sort) || 0;
      return o;
    };
    on("GET", new RegExp("^admin/" + name + "$"), function () { need(); return { items: list(name) }; });
    on("POST", new RegExp("^admin/" + name + "$"), function (q, b) { var u = need(role); var it = Object.assign({ id: ++S.seq, created_at: iso() }, clean(b)); S[name].push(it); audit(u.username, name + ".create", name + ":" + it.id); return [201, it]; });
    on("PUT", new RegExp("^admin/" + name + "/(\\d+)$"), function (q, b, m) { var u = need(role); var it = S[name].filter(function (x) { return x.id === Number(m[1]); })[0]; if (!it) throw new Err(404, "항목을 찾을 수 없습니다."); Object.assign(it, clean(b)); audit(u.username, name + ".update", name + ":" + it.id); return it; });
    on("DELETE", new RegExp("^admin/" + name + "/(\\d+)$"), function (q, b, m) { var u = need(role); S[name] = S[name].filter(function (x) { return x.id !== Number(m[1]); }); audit(u.username, name + ".delete", name + ":" + m[1]); return { ok: true }; });
  });
  on("GET", /^admin\/users$/, function () { need("admin"); return { items: S.users.map(function (u) { return { id: u.id, username: u.username, name: u.name, role: u.role, created_at: u.created_at }; }) }; });
  on("POST", /^admin\/users$/, function (q, b) {
    var u = need("admin");
    if (!/^[a-z0-9._-]{3,30}$/i.test(b.username || "")) throw new Err(400, "아이디는 영문·숫자 3자 이상으로 만들어 주세요.");
    if (String(b.password || "").length < 10) throw new Err(400, "비밀번호는 10자 이상이어야 합니다.");
    if (S.users.some(function (x) { return x.username === b.username; })) throw new Err(409, "이미 있는 아이디입니다.");
    var it = { id: ++S.seq, username: b.username, name: b.name || b.username, role: b.role === "admin" ? "admin" : "staff", pw: b.password, created_at: iso() };
    S.users.push(it); audit(u.username, "user.create", "users:" + it.id); return [201, { id: it.id }];
  });
  on("DELETE", /^admin\/users\/(\d+)$/, function (q, b, m) { var u = need("admin"); if (Number(m[1]) === u.id) throw new Err(400, "로그인한 계정은 삭제할 수 없습니다."); S.users = S.users.filter(function (x) { return x.id !== Number(m[1]); }); return { ok: true }; });
  on("POST", /^admin\/password$/, function (q, b) { var u = need(); if (b.current !== u.pw) throw new Err(400, "현재 비밀번호가 올바르지 않습니다."); if (String(b.next || "").length < 10) throw new Err(400, "새 비밀번호는 10자 이상이어야 합니다."); u.pw = b.next; return { ok: true }; });
  on("GET", /^admin\/audit$/, function () { need("admin"); return { items: S.audit }; });
  on("GET", /^admin\/outbox$/, function () { need(); return { items: S.outbox }; });

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input.url;
    var i = url.indexOf("api/");
    if (i < 0) return realFetch ? realFetch(input, init) : Promise.reject(new Error("fetch unavailable"));
    var u = new URL(url.slice(i + 4), "https://demo.local/");
    var path = u.pathname.slice(1), method = ((init && init.method) || "GET").toUpperCase();
    var body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
    var status = 200, payload;
    try {
      var route = R.filter(function (r) { return r[0] === method && r[1].test(path); })[0];
      if (!route) throw new Err(404, "API를 찾을 수 없습니다.");
      var res = route[2](u.searchParams, body, path.match(route[1]));
      if (Array.isArray(res)) { status = res[0]; payload = res[1]; } else payload = res;
      save();
    } catch (e) {
      if (e instanceof Err) { status = e.status; payload = e.body; } else { status = 500; payload = { error: String(e && e.message || e) }; }
    }
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(new Response(JSON.stringify(payload), { status: status, headers: { "content-type": "application/json" } })); }, 120);
    });
  };
  window.WDemo = { reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); } };
})();
