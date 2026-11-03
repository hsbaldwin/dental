"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("../public/js/core.js");
const { getSetting, setSetting, audit, nowIso } = require("./db");
const auth = require("./auth");
const { createNotifier } = require("./notify");

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2"
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"
  ].join("; ")
};

/* ---------- 작은 유틸 ---------- */
function send(res, status, body, headers) {
  const isStr = typeof body === "string";
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS, {
    "Content-Type": isStr ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }, headers || {}));
  res.end(isStr ? body : JSON.stringify(body));
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > (limit || 64 * 1024)) { reject(new HttpError(413, "요청이 너무 큽니다.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8")); resolve(v && typeof v === "object" ? v : {}); }
      catch (e) { reject(new HttpError(400, "요청 형식이 올바르지 않습니다.")); }
    });
    req.on("error", reject);
  });
}

function rateLimiter(max, windowMs) {
  const hits = new Map();
  return function (key) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return true;
  };
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  const b = crypto.randomBytes(6); let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[b[i] % CODE_CHARS.length];
  return s;
}

function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ---------- 입력 정리 ---------- */
function str(v, max, required, label) {
  const s = v == null ? "" : String(v).trim();
  if (required && !s) throw new HttpError(400, (label || "필수 항목") + "을(를) 입력해 주세요.");
  if (s.length > max) throw new HttpError(400, (label || "입력값") + "이(가) 너무 깁니다.");
  return s;
}
function int(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, (label || "숫자") + " 값을 확인해 주세요.");
  return n;
}
function optTime(v, label) {
  if (v == null || v === "") return null;
  if (!core.isTime(v)) throw new HttpError(400, label + " 시각을 HH:MM 형식으로 입력해 주세요.");
  return v;
}
function httpsUrl(v, label) {
  const s = str(v, 300, false, label);
  if (s && !/^https:\/\/[^\s]+$/.test(s)) throw new HttpError(400, label + " 주소는 https:// 로 시작해야 합니다.");
  return s;
}

function centerKey(v) {
  if (v == null || v === "") return null;
  if (!core.TREATMENTS.some((t) => t.key === v && t.key !== "checkup")) throw new HttpError(400, "진료센터 값이 올바르지 않습니다.");
  return v;
}

/* 관리자 화면에서 편집하는 목록형 콘텐츠 */
const RESOURCES = {
  fees: {
    order: "sort, id",
    clean: (b) => ({ name: str(b.name, 100, true, "항목명"), unit: str(b.unit, 30), price: b.price === "" || b.price == null ? null : int(b.price, 0, 100000000, "금액"), note: str(b.note, 200), center: centerKey(b.center), sort: int(b.sort || 0, 0, 9999, "순서") })
  },
  doctors: {
    order: "sort, id",
    clean: (b) => {
      const days = str(b.days, 7, false, "진료 요일");
      if (/[^일월화수목금토]/.test(days)) throw new HttpError(400, "진료 요일은 '월화수목금' 처럼 요일 글자로 입력해 주세요.");
      const centers = String(b.centers || "").split(",").map((x) => x.trim()).filter(Boolean);
      centers.forEach((k) => centerKey(k));
      return { name: str(b.name, 40, true, "성함"), role: str(b.role, 80), career: str(b.career, 500), quote: str(b.quote, 200), days, centers: centers.join(","), sort: int(b.sort || 0, 0, 9999, "순서") };
    }
  },
  notices: {
    order: "pinned DESC, id DESC",
    clean: (b) => ({ title: str(b.title, 100, true, "제목"), body: str(b.body, 2000), pinned: b.pinned ? 1 : 0, published: b.published === false || b.published === 0 ? 0 : 1 }),
    created: true
  }
};

function createApp(opts) {
  const db = opts.db;
  const env = opts.env || process.env;
  const publicDir = opts.publicDir || path.join(__dirname, "..", "public");
  const clock = opts.now || (() => core.seoulNow());
  const notify = createNotifier(db, env, opts.fetch);
  const trustProxy = env.TRUST_PROXY === "1";
  const limitReserve = rateLimiter(Number(env.RESERVE_LIMIT_PER_HOUR || 10), 3600 * 1000);
  const limitLookup = rateLimiter(30, 3600 * 1000);
  const limitInquiry = rateLimiter(Number(env.INQUIRY_LIMIT_PER_HOUR || 10), 3600 * 1000);
  const limitLogin = rateLimiter(10, 15 * 60 * 1000);

  /* ---------- 실시간 알림 (Server-Sent Events) ----------
   * 예약·설정이 바뀌면 열려 있는 홈페이지에 'update' 신호만 보냅니다(개인정보 없음).
   * 브라우저는 신호를 받으면 /api/live 를 다시 읽습니다. */
  const streams = new Set();
  const MAX_STREAMS = Number(env.MAX_LIVE_CONNECTIONS || 1000);
  let liveVersion = Date.now();
  function emit(kind) {
    liveVersion++;
    const msg = "event: update\ndata: " + JSON.stringify({ kind, v: liveVersion }) + "\n\n";
    for (const res of streams) res.write(msg);
  }
  const heartbeat = setInterval(() => { for (const res of streams) res.write(": ping\n\n"); }, 25000);
  heartbeat.unref();
  function openStream(req, res) {
    if (streams.size >= MAX_STREAMS) return send(res, 503, { error: "접속이 많습니다. 잠시 후 다시 시도해 주세요." });
    res.writeHead(200, Object.assign({}, SECURITY_HEADERS, {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no"
    }));
    res.write("retry: 5000\nevent: hello\ndata: " + JSON.stringify({ v: liveVersion }) + "\n\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
  }
  function closeStreams() { clearInterval(heartbeat); for (const res of streams) res.end(); streams.clear(); }

  const clientIp = (req) => (trustProxy && req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : req.socket.remoteAddress) || "unknown";
  const isSecure = (req) => env.COOKIE_SECURE === "1" || (trustProxy && req.headers["x-forwarded-proto"] === "https");

  /* ---------- 데이터 헬퍼 ---------- */
  const hoursAll = () => db.prepare("SELECT weekday, closed, open, close, lunch_start, lunch_end, note FROM hours ORDER BY weekday").all();
  function holidayMap(from, to) {
    const m = {};
    db.prepare("SELECT date, label FROM holidays WHERE date BETWEEN ? AND ?").all(from, to).forEach((r) => { m[r.date] = r.label; });
    return m;
  }
  function slotCounts(from, to, excludeId) {
    const rows = db.prepare(
      "SELECT date, time, COUNT(*) AS n FROM reservations WHERE date BETWEEN ? AND ? AND status IN ('requested','confirmed') AND id != ? GROUP BY date, time"
    ).all(from, to, excludeId || 0);
    const m = {};
    rows.forEach((r) => { (m[r.date] = m[r.date] || {})[r.time] = r.n; });
    return m;
  }
  const centersAll = (all) => db.prepare("SELECT * FROM centers " + (all ? "" : "WHERE published = 1 ") + "ORDER BY sort, key").all();
  const doctorsAll = () => db.prepare("SELECT id, name, role, career, quote, days, centers FROM doctors ORDER BY sort, id").all();
  // 진료센터 예약은 담당 원장 진료 요일에만 받습니다
  const restrictionFor = (treatment) => core.restriction(treatment, centersAll(true), doctorsAll());
  function slotsFor(ds, now, treatment) {
    const rules = getSetting(db, "booking");
    const rs = restrictionFor(treatment);
    const plan = core.planFor(ds, hoursAll(), holidayMap(ds, ds), rs.days, rs.label);
    return core.computeSlots(ds, plan, rules, slotCounts(ds, ds)[ds] || {}, now);
  }
  function publicReservation(r) {
    const now = clock();
    const future = r.date > now.date || (r.date === now.date && core.toMin(r.time) > now.minutes);
    return {
      code: r.code, name: core.maskName(r.name), treatment: r.treatment, treatmentLabel: core.labelOf(core.TREATMENTS, r.treatment),
      date: r.date, time: r.time, status: r.status, statusLabel: core.labelOf(core.STATUSES, r.status),
      canCancel: core.ACTIVE.includes(r.status) && future
    };
  }
  function resMessage(kind, r) {
    const c = getSetting(db, "clinic");
    const when = core.formatDate(r.date) + " " + r.time;
    const head = "[" + c.shortName + "] ";
    if (kind === "requested") return head + "예약 신청이 접수되었습니다. " + when + " " + core.labelOf(core.TREATMENTS, r.treatment) + ". 확인 후 확정 문자를 드립니다. 예약번호 " + r.code;
    if (kind === "confirmed") return head + when + " 예약이 확정되었습니다. 문의 " + c.phone;
    if (kind === "changed") return head + "예약이 " + when + "(으)로 변경되었습니다. 문의 " + c.phone;
    if (kind === "cancelled") return head + when + " 예약이 취소되었습니다. 문의 " + c.phone;
    if (kind === "reminder") return head + "내일 " + when + " 예약이 있습니다. 변경이 필요하면 " + c.phone + "로 연락 주세요.";
    return head;
  }

  /* ---------- 공개 API ---------- */
  const routes = [];
  const on = (method, pattern, handler, role) => routes.push({ method, pattern, handler, role });

  on("GET", /^\/api\/site$/, () => {
    const now = clock();
    const hours = hoursAll();
    const holidays = db.prepare("SELECT date, label FROM holidays WHERE date >= ? ORDER BY date LIMIT 30").all(now.date);
    const hmap = {}; holidays.forEach((h) => { hmap[h.date] = h.label; });
    const booking = getSetting(db, "booking");
    return {
      clinic: getSetting(db, "clinic"),
      booking: { slotMinutes: booking.slotMinutes, windowDays: booking.windowDays, lastEntryMinutes: booking.lastEntryMinutes, retentionDays: booking.retentionDays },
      hours, holidays,
      status: core.openStatus(hours, hmap, now),
      today: now.date,
      fees: db.prepare("SELECT id, name, unit, price, note, center FROM fees ORDER BY sort, id").all(),
      feesUpdatedAt: (db.prepare("SELECT MAX(at) AS at FROM audit WHERE target LIKE 'fees%'").get() || {}).at || null,
      doctors: doctorsAll(),
      centers: centersAll(false).map((c) => { const o = Object.assign({}, c, { days: core.centerDays(doctorsAll(), c.key) }); delete o.desk_updated_by; return o; }),
      notices: db.prepare("SELECT id, title, body, pinned, created_at FROM notices WHERE published = 1 ORDER BY pinned DESC, id DESC LIMIT 10").all(),
      treatments: core.TREATMENTS
    };
  });

  function pendingByCenter() {
    const m = {};
    db.prepare("SELECT center, COUNT(*) AS n FROM inquiries WHERE status IN ('new','seen') GROUP BY center").all().forEach((r) => { m[r.center] = r.n; });
    return m;
  }
  function liveData() {
    const now = clock(), rules = getSetting(db, "booking"), hours = hoursAll();
    const to = core.addDays(now.date, rules.windowDays);
    const hol = holidayMap(now.date, to);
    const status = core.openStatus(hours, hol, now);
    const ov = core.overview(hours, hol, rules, slotCounts(now.date, to), now, 7);

    const doctors = doctorsAll();
    const counts = slotCounts(now.date, to);
    return {
      v: liveVersion, serverTime: nowIso(), now, status,
      notice: core.liveNotice(getSetting(db, "live"), status, Date.now()),
      today: { date: now.date, plan: core.dayPlan(now.date, hours, hol), remaining: ov.today.remaining, openSlots: ov.today.openSlots, slots: ov.today.slots },
      next: ov.next, week: ov.week,
      doctorsToday: hol[now.date] ? [] : doctors.filter((d) => core.worksOn(d.days, now.weekday)).map((d) => ({ name: d.name, role: d.role })),
      centers: core.centerSummaries(centersAll(false), doctors, hours, hol, rules, counts, now, status, Date.now(), pendingByCenter())
    };
  }
  on("GET", /^\/api\/live$/, () => liveData());

  on("GET", /^\/api\/days$/, (req, url) => {
    const now = clock();
    const rules = getSetting(db, "booking");
    const to = core.addDays(now.date, rules.windowDays);
    const hours = hoursAll(), hol = holidayMap(now.date, to), counts = slotCounts(now.date, to);
    const rs = restrictionFor(url.searchParams.get("treatment"));
    const days = [];
    for (let ds = now.date; ds <= to; ds = core.addDays(ds, 1)) {
      const r = core.computeSlots(ds, core.planFor(ds, hours, hol, rs.days, rs.label), rules, counts[ds] || {}, now);
      days.push({ date: ds, weekday: core.weekdayOf(ds), closed: r.closed, reason: r.reason, available: r.slots.filter((s) => s.remaining > 0).length });
    }
    return { days };
  });

  on("GET", /^\/api\/slots$/, (req, url) => {
    const ds = url.searchParams.get("date");
    if (!core.isDate(ds)) throw new HttpError(400, "날짜 형식이 올바르지 않습니다.");
    return slotsFor(ds, clock(), url.searchParams.get("treatment"));
  });

  on("POST", /^\/api\/reservations$/, async (req) => {
    if (!limitReserve(clientIp(req))) throw new HttpError(429, "예약 신청이 너무 많습니다. 잠시 후 다시 시도하거나 전화로 문의해 주세요.");
    const body = await readJson(req);
    if (body.website) throw new HttpError(400, "요청을 처리할 수 없습니다."); // 스팸 방지용 숨김 필드
    const v = core.validateReservation(body);
    if (!v.ok) throw new HttpError(400, Object.values(v.errors)[0], { fields: v.errors });
    const r = v.value, now = clock(), rules = getSetting(db, "booking");

    const slots = slotsFor(r.date, now, r.treatment);
    const slot = slots.slots.find((s) => s.time === r.time);
    if (slots.closed || !slot) throw new HttpError(409, slots.reason || "선택한 시간에는 예약할 수 없습니다.", { fields: { time: "다른 시간을 선택해 주세요." } });
    if (slot.remaining <= 0) throw new HttpError(409, "방금 다른 분이 예약해 자리가 없습니다. 다른 시간을 선택해 주세요.", { fields: { time: "마감된 시간입니다." } });

    const dup = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE phone = ? AND date = ? AND time = ? AND status IN ('requested','confirmed')").get(r.phone, r.date, r.time).n;
    if (dup) throw new HttpError(409, "같은 시간에 이미 예약이 있습니다.");
    const active = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE phone = ? AND date >= ? AND status IN ('requested','confirmed')").get(r.phone, now.date).n;
    if (active >= rules.maxActivePerPhone) throw new HttpError(409, "이 연락처로 잡힌 예약이 " + active + "건 있습니다. 변경은 전화로 문의해 주세요.");

    let code; do { code = newCode(); } while (db.prepare("SELECT 1 FROM reservations WHERE code = ?").get(code));
    const ts = nowIso();
    db.prepare(
      "INSERT INTO reservations (code, name, phone, treatment, date, time, memo, status, source, consent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', 'web', ?, ?, ?)"
    ).run(code, r.name, r.phone, r.treatment, r.date, r.time, r.memo, ts, ts, ts);
    const saved = db.prepare("SELECT * FROM reservations WHERE code = ?").get(code);
    notify.staff("새 예약 신청: " + core.maskName(r.name) + " · " + core.formatDate(r.date) + " " + r.time + " · " + core.labelOf(core.TREATMENTS, r.treatment));
    notify.patient(r.phone, resMessage("requested", saved));
    return { status: 201, body: publicReservation(saved) };
  });

  function findByCodePhone(body) {
    const code = String(body.code || "").trim().toUpperCase();
    const phone = core.normalizePhone(body.phone);
    if (!/^[A-Z0-9]{6}$/.test(code) || !core.isPhone(phone)) throw new HttpError(400, "예약번호 6자리와 연락처를 확인해 주세요.");
    const r = db.prepare("SELECT * FROM reservations WHERE code = ? AND phone = ? AND purged = 0").get(code, phone);
    if (!r) throw new HttpError(404, "일치하는 예약이 없습니다. 예약번호와 연락처를 다시 확인해 주세요.");
    return r;
  }

  on("POST", /^\/api\/reservations\/lookup$/, async (req) => {
    if (!limitLookup(clientIp(req))) throw new HttpError(429, "조회 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    return publicReservation(findByCodePhone(await readJson(req)));
  });

  on("POST", /^\/api\/reservations\/cancel$/, async (req) => {
    if (!limitLookup(clientIp(req))) throw new HttpError(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    const r = findByCodePhone(await readJson(req));
    if (!publicReservation(r).canCancel) throw new HttpError(409, "이미 지났거나 취소된 예약입니다.");
    db.prepare("UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), r.id);
    audit(db, "patient", "reservation.cancel", "reservation:" + r.id, { code: r.code });
    notify.staff("환자 예약 취소: " + core.maskName(r.name) + " · " + core.formatDate(r.date) + " " + r.time);
    return publicReservation(db.prepare("SELECT * FROM reservations WHERE id = ?").get(r.id));
  });

  /* ---------- 센터 데스크: 전화 상담 요청 ---------- */
  function publicInquiry(q) {
    const c = db.prepare("SELECT name FROM centers WHERE key = ?").get(q.center) || { name: q.center };
    const ahead = ["new", "seen"].includes(q.status)
      ? db.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE center = ? AND status IN ('new','seen') AND id < ?").get(q.center, q.id).n : 0;
    return {
      code: q.code, center: q.center, centerName: c.name, name: core.maskName(q.name),
      topic: q.topic, topicLabel: core.labelOf(core.TOPICS, q.topic), prefer: q.prefer, preferLabel: core.labelOf(core.PREFERS, q.prefer),
      status: q.status, statusLabel: core.labelOf(core.INQ_STATUSES, q.status), ahead, handledBy: q.status === "new" ? null : q.handled_by,
      createdAt: q.created_at, canCancel: q.status === "new"
    };
  }
  on("POST", /^\/api\/inquiries$/, async (req) => {
    if (!limitInquiry(clientIp(req))) throw new HttpError(429, "요청이 너무 많습니다. 잠시 후 다시 시도하거나 전화로 문의해 주세요.");
    const body = await readJson(req);
    if (body.website) throw new HttpError(400, "요청을 처리할 수 없습니다.");
    const v = core.validateInquiry(body);
    if (!v.ok) throw new HttpError(400, Object.values(v.errors)[0], { fields: v.errors });
    const center = db.prepare("SELECT * FROM centers WHERE key = ? AND published = 1").get(v.value.center);
    if (!center) throw new HttpError(404, "진료센터를 찾을 수 없습니다.");
    if (center.desk_paused) throw new HttpError(409, center.name + " 데스크가 지금 온라인 상담 요청을 잠시 받지 않습니다. 전화로 문의해 주세요.");
    const open = db.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE phone = ? AND status IN ('new','seen')").get(v.value.phone).n;
    if (open >= 3) throw new HttpError(409, "이 연락처로 처리 중인 상담 요청이 이미 있습니다. 곧 연락드리겠습니다.");
    let code; do { code = newCode(); } while (db.prepare("SELECT 1 FROM inquiries WHERE code = ?").get(code));
    const ts = nowIso(), q = v.value;
    db.prepare("INSERT INTO inquiries (code, center, name, phone, topic, prefer, message, status, consent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)")
      .run(code, q.center, q.name, q.phone, q.topic, q.prefer, q.message, ts, ts, ts);
    const saved = db.prepare("SELECT * FROM inquiries WHERE code = ?").get(code);
    notify.staff(center.name + " 상담 요청: " + core.maskName(q.name) + " · " + core.labelOf(core.TOPICS, q.topic) + " · " + core.labelOf(core.PREFERS, q.prefer) + " 연락 희망");
    notify.patient(q.phone, "[" + getSetting(db, "clinic").shortName + "] " + center.name + " 상담 요청이 접수되었습니다. 접수 순서대로 연락드립니다. 접수번호 " + code);
    return { status: 201, body: publicInquiry(saved) };
  });
  function findInquiry(body) {
    const code = String(body.code || "").trim().toUpperCase(), phone = core.normalizePhone(body.phone);
    if (!/^[A-Z0-9]{6}$/.test(code) || !core.isPhone(phone)) throw new HttpError(400, "접수번호 6자리와 연락처를 확인해 주세요.");
    const q = db.prepare("SELECT * FROM inquiries WHERE code = ? AND phone = ? AND purged = 0").get(code, phone);
    if (!q) throw new HttpError(404, "일치하는 상담 요청이 없습니다.");
    return q;
  }
  on("POST", /^\/api\/inquiries\/lookup$/, async (req) => {
    if (!limitLookup(clientIp(req))) throw new HttpError(429, "조회 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    return publicInquiry(findInquiry(await readJson(req)));
  });
  on("POST", /^\/api\/inquiries\/cancel$/, async (req) => {
    if (!limitLookup(clientIp(req))) throw new HttpError(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    const q = findInquiry(await readJson(req));
    if (q.status !== "new") throw new HttpError(409, "데스크에서 이미 확인한 요청은 취소할 수 없습니다. 연락드릴 때 말씀해 주세요.");
    db.prepare("UPDATE inquiries SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), q.id);
    return publicInquiry(db.prepare("SELECT * FROM inquiries WHERE id = ?").get(q.id));
  });

  /* ---------- 관리자 API ---------- */
  on("POST", /^\/api\/admin\/login$/, async (req) => {
    if (!limitLogin(clientIp(req))) throw new HttpError(429, "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.");
    const b = await readJson(req);
    const u = db.prepare("SELECT * FROM users WHERE username = ?").get(String(b.username || "").trim());
    if (!u || !auth.verifyPassword(String(b.password || ""), u.pw)) throw new HttpError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");
    const token = auth.createSession(db, u.id);
    audit(db, u.username, "login", null, null);
    return { body: { id: u.id, username: u.username, name: u.name, role: u.role }, headers: { "Set-Cookie": auth.sessionCookie(token, isSecure(req)) } };
  }, "public");

  on("POST", /^\/api\/admin\/logout$/, (req) => {
    auth.destroySession(db, auth.sessionToken(req));
    return { body: { ok: true }, headers: { "Set-Cookie": auth.sessionCookie("", isSecure(req)) } };
  }, "public");

  on("GET", /^\/api\/admin\/me$/, (req, url, user) => user, "staff");

  on("GET", /^\/api\/admin\/summary$/, () => {
    const now = clock();
    const weekEnd = core.addDays(now.date, 6);
    const q = (sql, ...a) => db.prepare(sql).get(...a).n;
    const from30 = core.addDays(now.date, -30);
    const visited = q("SELECT COUNT(*) AS n FROM reservations WHERE status = 'visited' AND date BETWEEN ? AND ?", from30, now.date);
    const noShow = q("SELECT COUNT(*) AS n FROM reservations WHERE status = 'no_show' AND date BETWEEN ? AND ?", from30, now.date);
    return {
      today: now.date, minutes: now.minutes,
      todayCount: q("SELECT COUNT(*) AS n FROM reservations WHERE date = ? AND status IN ('requested','confirmed','visited','no_show')", now.date),
      pending: q("SELECT COUNT(*) AS n FROM reservations WHERE status = 'requested' AND date >= ?", now.date),
      week: q("SELECT COUNT(*) AS n FROM reservations WHERE date BETWEEN ? AND ? AND status IN ('requested','confirmed')", now.date, weekEnd),
      noShowRate: visited + noShow ? Math.round((noShow / (visited + noShow)) * 1000) / 10 : null,
      noShowBase: visited + noShow,
      latestId: (db.prepare("SELECT MAX(id) AS n FROM reservations").get().n) || 0,
      inquiriesOpen: q("SELECT COUNT(*) AS n FROM inquiries WHERE status IN ('new','seen')"),
      inquiriesNew: q("SELECT COUNT(*) AS n FROM inquiries WHERE status = 'new'"),
      latestInquiryId: (db.prepare("SELECT MAX(id) AS n FROM inquiries").get().n) || 0
    };
  }, "staff");

  function listReservations(url) {
    const p = url.searchParams, now = clock();
    const from = core.isDate(p.get("from")) ? p.get("from") : now.date;
    const to = core.isDate(p.get("to")) ? p.get("to") : core.addDays(from, 30);
    const where = ["date BETWEEN ? AND ?"], args = [from, to];
    const status = p.get("status");
    if (status && core.STATUSES.some((s) => s.key === status)) { where.push("status = ?"); args.push(status); }
    const q = (p.get("q") || "").trim();
    if (q) {
      where.push("(name LIKE ? OR phone LIKE ? OR code LIKE ?)");
      const like = "%" + q.replace(/[%_]/g, "") + "%";
      args.push(like, "%" + (core.normalizePhone(q) || "~") + "%", like.toUpperCase());
    }
    return db.prepare("SELECT * FROM reservations WHERE " + where.join(" AND ") + " ORDER BY date, time, id LIMIT 2000").all(...args);
  }

  on("GET", /^\/api\/admin\/reservations$/, (req, url) => ({ items: listReservations(url) }), "staff");

  on("GET", /^\/api\/admin\/reservations\.csv$/, (req, url, user) => {
    const rows = listReservations(url);
    const head = ["예약번호", "날짜", "시간", "진료", "성함", "연락처", "상태", "경로", "환자 메모", "직원 메모", "신청 일시"];
    const lines = [head.join(",")].concat(rows.map((r) => [
      r.code, r.date, r.time, core.labelOf(core.TREATMENTS, r.treatment), r.name, core.formatPhone(r.phone),
      core.labelOf(core.STATUSES, r.status), r.source === "web" ? "홈페이지" : "직원 등록", r.memo, r.staff_memo, r.created_at
    ].map(csvCell).join(",")));
    audit(db, user.username, "reservation.export", null, { count: rows.length });
    return {
      raw: "﻿" + lines.join("\r\n"),
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"reservations.csv\"" }
    };
  }, "staff");

  on("GET", /^\/api\/admin\/slots$/, (req, url) => {
    const ds = url.searchParams.get("date");
    if (!core.isDate(ds)) throw new HttpError(400, "날짜 형식이 올바르지 않습니다.");
    const rules = getSetting(db, "booking");
    const plan = core.dayPlan(ds, hoursAll(), holidayMap(ds, ds));
    // 직원은 지난 시간·예약 기간과 상관없이 볼 수 있도록 '하루 전' 시점으로 계산
    const r = core.computeSlots(ds, plan, Object.assign({}, rules, { windowDays: 3650, leadMinutes: 0 }), slotCounts(ds, ds)[ds] || {}, { date: core.addDays(ds, -1), minutes: 0 });
    return r;
  }, "staff");

  function cleanStaffReservation(b, partial) {
    const out = {};
    if (!partial || "name" in b) out.name = str(b.name, 30, true, "성함");
    if (!partial || "phone" in b) { const p = core.normalizePhone(b.phone); if (!core.isPhone(p)) throw new HttpError(400, "연락처를 확인해 주세요."); out.phone = p; }
    if (!partial || "treatment" in b) { if (!core.TREATMENTS.some((t) => t.key === b.treatment)) throw new HttpError(400, "진료 항목을 선택해 주세요."); out.treatment = b.treatment; }
    if (!partial || "date" in b) { if (!core.isDate(b.date)) throw new HttpError(400, "날짜를 확인해 주세요."); out.date = b.date; }
    if (!partial || "time" in b) { if (!core.isTime(b.time)) throw new HttpError(400, "시간을 확인해 주세요."); out.time = b.time; }
    if ("memo" in b) out.memo = str(b.memo, 500, false, "환자 메모");
    if ("staff_memo" in b) out.staff_memo = str(b.staff_memo, 1000, false, "직원 메모");
    if ("status" in b) { if (!core.STATUSES.some((s) => s.key === b.status)) throw new HttpError(400, "상태 값이 올바르지 않습니다."); out.status = b.status; }
    return out;
  }
  function capacityWarning(date, time, excludeId) {
    const rules = getSetting(db, "booking");
    const used = (slotCounts(date, date, excludeId)[date] || {})[time] || 0;
    return used >= rules.capacity ? "이 시간에는 이미 예약이 " + used + "건 있습니다 (기준 " + rules.capacity + "건)." : null;
  }

  on("POST", /^\/api\/admin\/reservations$/, async (req, url, user) => {
    const b = cleanStaffReservation(await readJson(req), false);
    const status = b.status && core.ACTIVE.includes(b.status) ? b.status : "confirmed";
    let code; do { code = newCode(); } while (db.prepare("SELECT 1 FROM reservations WHERE code = ?").get(code));
    const warning = capacityWarning(b.date, b.time, 0);
    const ts = nowIso();
    const id = Number(db.prepare(
      "INSERT INTO reservations (code, name, phone, treatment, date, time, memo, staff_memo, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff', ?, ?)"
    ).run(code, b.name, b.phone, b.treatment, b.date, b.time, b.memo || "", b.staff_memo || "", status, ts, ts).lastInsertRowid);
    const saved = db.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
    audit(db, user.username, "reservation.create", "reservation:" + id, { date: b.date, time: b.time });
    if (status === "confirmed" && b.notify !== false) notify.patient(saved.phone, resMessage("confirmed", saved));
    return { status: 201, body: { item: saved, warning } };
  }, "staff");

  on("PATCH", /^\/api\/admin\/reservations\/(\d+)$/, async (req, url, user, m) => {
    const id = Number(m[1]);
    const before = db.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
    if (!before) throw new HttpError(404, "예약을 찾을 수 없습니다.");
    if (before.purged) throw new HttpError(409, "개인정보가 파기된 예약은 수정할 수 없습니다.");
    const raw = await readJson(req);
    const b = cleanStaffReservation(raw, true);
    const fields = Object.keys(b);
    if (!fields.length) return { item: before };
    const moved = (b.date && b.date !== before.date) || (b.time && b.time !== before.time);
    const after = Object.assign({}, before, b);
    const warning = moved && core.ACTIVE.includes(after.status) ? capacityWarning(after.date, after.time, id) : null;
    const sets = fields.map((f) => f + " = ?");
    const args = fields.map((f) => b[f]);
    if (moved) sets.push("reminded = 0");
    db.prepare("UPDATE reservations SET " + sets.join(", ") + ", updated_at = ? WHERE id = ?").run(...args, nowIso(), id);
    const saved = db.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
    const changes = {}; fields.forEach((f) => { if (before[f] !== saved[f]) changes[f] = [before[f], saved[f]]; });
    audit(db, user.username, "reservation.update", "reservation:" + id, changes);
    if (raw.notify !== false) {
      if (before.status !== "confirmed" && saved.status === "confirmed") notify.patient(saved.phone, resMessage("confirmed", saved));
      else if (moved && core.ACTIVE.includes(saved.status)) notify.patient(saved.phone, resMessage("changed", saved));
      if (before.status !== "cancelled" && saved.status === "cancelled") notify.patient(saved.phone, resMessage("cancelled", saved));
    }
    return { item: saved, warning };
  }, "staff");

  /* 홈페이지 실시간 안내 (대기 시간 · 오늘의 메시지) */
  on("GET", /^\/api\/admin\/live$/, () => getSetting(db, "live"), "staff");
  on("PUT", /^\/api\/admin\/live$/, async (req, url, user) => {
    const b = await readJson(req);
    const wait = b.wait === null || b.wait === "" || b.wait === undefined ? null : int(b.wait, 0, 240, "대기 시간");
    const v = { wait, message: str(b.message, 120, false, "안내 문구"), updatedAt: nowIso(), updatedBy: user.name };
    setSetting(db, "live", v);
    audit(db, user.username, "live.update", "live", { wait, message: v.message });
    return v;
  }, "staff");

  /* 병원 정보 · 예약 규칙 */
  on("GET", /^\/api\/admin\/settings$/, () => ({ clinic: getSetting(db, "clinic"), booking: getSetting(db, "booking"), hours: hoursAll() }), "staff");

  on("PUT", /^\/api\/admin\/settings\/clinic$/, async (req, url, user) => {
    const b = await readJson(req);
    const c = {
      name: str(b.name, 60, true, "병원 이름"), shortName: str(b.shortName, 30, true, "짧은 이름"),
      address: str(b.address, 200, true, "주소"), phone: str(b.phone, 30, true, "대표 전화"),
      subway: str(b.subway, 200), parking: str(b.parking, 200), director: str(b.director, 30), bizNo: str(b.bizNo, 30),
      kakaoUrl: httpsUrl(b.kakaoUrl, "카카오톡 채널"), naverBookingUrl: httpsUrl(b.naverBookingUrl, "네이버 예약"),
      naverMapUrl: httpsUrl(b.naverMapUrl, "네이버 지도"), kakaoMapUrl: httpsUrl(b.kakaoMapUrl, "카카오맵")
    };
    setSetting(db, "clinic", c);
    audit(db, user.username, "settings.clinic", "clinic", null);
    return c;
  }, "admin");

  on("PUT", /^\/api\/admin\/settings\/booking$/, async (req, url, user) => {
    const b = await readJson(req);
    const s = {
      slotMinutes: int(b.slotMinutes, 10, 120, "예약 단위"), capacity: int(b.capacity, 1, 20, "시간대당 예약 수"),
      leadMinutes: int(b.leadMinutes, 0, 1440, "최소 예약 여유"), windowDays: int(b.windowDays, 1, 180, "예약 가능 기간"),
      lastEntryMinutes: int(b.lastEntryMinutes, 0, 180, "마감 전 접수 종료"), maxActivePerPhone: int(b.maxActivePerPhone, 1, 10, "연락처당 예약 수"),
      retentionDays: int(b.retentionDays, 30, 3650, "개인정보 보관 기간")
    };
    setSetting(db, "booking", s);
    audit(db, user.username, "settings.booking", "booking", s);
    return s;
  }, "admin");

  on("PUT", /^\/api\/admin\/hours$/, async (req, url, user) => {
    const b = await readJson(req);
    if (!Array.isArray(b.hours) || b.hours.length !== 7) throw new HttpError(400, "요일 7개의 진료시간이 필요합니다.");
    const rows = b.hours.map((h) => {
      const w = int(h.weekday, 0, 6, "요일");
      const label = core.WEEKDAYS[w] + "요일";
      if (h.closed) return { weekday: w, closed: 1, open: null, close: null, lunch_start: null, lunch_end: null, note: str(h.note, 30) };
      const open = optTime(h.open, label + " 시작"), close = optTime(h.close, label + " 종료");
      if (!open || !close || core.toMin(close) <= core.toMin(open)) throw new HttpError(400, label + " 진료 시작·종료 시각을 확인해 주세요.");
      const ls = optTime(h.lunch_start, label + " 점심 시작"), le = optTime(h.lunch_end, label + " 점심 종료");
      if ((ls && !le) || (!ls && le) || (ls && core.toMin(le) <= core.toMin(ls))) throw new HttpError(400, label + " 점심시간을 확인해 주세요.");
      return { weekday: w, closed: 0, open, close, lunch_start: ls, lunch_end: le, note: str(h.note, 30) };
    });
    if (new Set(rows.map((r) => r.weekday)).size !== 7) throw new HttpError(400, "요일이 중복되었습니다.");
    const up = db.prepare("UPDATE hours SET closed = ?, open = ?, close = ?, lunch_start = ?, lunch_end = ?, note = ? WHERE weekday = ?");
    db.exec("BEGIN");
    try { rows.forEach((r) => up.run(r.closed, r.open, r.close, r.lunch_start, r.lunch_end, r.note, r.weekday)); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw e; }
    audit(db, user.username, "settings.hours", "hours", null);
    return { hours: hoursAll() };
  }, "admin");

  /* 휴진일 */
  on("GET", /^\/api\/admin\/holidays$/, () => ({ items: db.prepare("SELECT date, label FROM holidays ORDER BY date DESC").all() }), "staff");
  on("POST", /^\/api\/admin\/holidays$/, async (req, url, user) => {
    const b = await readJson(req);
    if (!core.isDate(b.date)) throw new HttpError(400, "날짜를 확인해 주세요.");
    const label = str(b.label, 40, true, "휴진 사유");
    db.prepare("INSERT INTO holidays (date, label) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET label = excluded.label").run(b.date, label);
    const affected = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE date = ? AND status IN ('requested','confirmed')").get(b.date).n;
    audit(db, user.username, "holiday.set", "holidays:" + b.date, { label });
    return { status: 201, body: { date: b.date, label, affected } };
  }, "admin");
  on("DELETE", /^\/api\/admin\/holidays\/(\d{4}-\d{2}-\d{2})$/, (req, url, user, m) => {
    db.prepare("DELETE FROM holidays WHERE date = ?").run(m[1]);
    audit(db, user.username, "holiday.delete", "holidays:" + m[1], null);
    return { ok: true };
  }, "admin");

  /* 진료비 · 의료진 · 공지 */
  Object.keys(RESOURCES).forEach((name) => {
    const R = RESOURCES[name];
    const role = name === "notices" ? "staff" : "admin";
    on("GET", new RegExp("^/api/admin/" + name + "$"), () => ({ items: db.prepare("SELECT * FROM " + name + " ORDER BY " + R.order).all() }), "staff");
    on("POST", new RegExp("^/api/admin/" + name + "$"), async (req, url, user) => {
      const v = R.clean(await readJson(req));
      if (R.created) v.created_at = nowIso();
      const cols = Object.keys(v);
      const id = Number(db.prepare("INSERT INTO " + name + " (" + cols.join(", ") + ") VALUES (" + cols.map(() => "?").join(", ") + ")").run(...cols.map((c) => v[c])).lastInsertRowid);
      audit(db, user.username, name + ".create", name + ":" + id, null);
      return { status: 201, body: db.prepare("SELECT * FROM " + name + " WHERE id = ?").get(id) };
    }, role);
    on("PUT", new RegExp("^/api/admin/" + name + "/(\\d+)$"), async (req, url, user, m) => {
      const id = Number(m[1]);
      if (!db.prepare("SELECT 1 FROM " + name + " WHERE id = ?").get(id)) throw new HttpError(404, "항목을 찾을 수 없습니다.");
      const v = R.clean(await readJson(req));
      const cols = Object.keys(v);
      db.prepare("UPDATE " + name + " SET " + cols.map((c) => c + " = ?").join(", ") + " WHERE id = ?").run(...cols.map((c) => v[c]), id);
      audit(db, user.username, name + ".update", name + ":" + id, null);
      return db.prepare("SELECT * FROM " + name + " WHERE id = ?").get(id);
    }, role);
    on("DELETE", new RegExp("^/api/admin/" + name + "/(\\d+)$"), (req, url, user, m) => {
      db.prepare("DELETE FROM " + name + " WHERE id = ?").run(Number(m[1]));
      audit(db, user.username, name + ".delete", name + ":" + m[1], null);
      return { ok: true };
    }, role);
  });

  /* 센터 데스크 */
  on("PUT", /^\/api\/admin\/centers\/([a-z]+)\/desk$/, async (req, url, user, m) => {
    if (!db.prepare("SELECT 1 FROM centers WHERE key = ?").get(m[1])) throw new HttpError(404, "진료센터를 찾을 수 없습니다.");
    const b = await readJson(req);
    const wait = b.wait === null || b.wait === "" || b.wait === undefined ? null : int(b.wait, 0, 240, "대기 시간");
    const v = { paused: b.paused ? 1 : 0, wait, message: str(b.message, 120, false, "데스크 인사말"), staff: str(b.staff, 30, false, "담당자") };
    db.prepare("UPDATE centers SET desk_paused = ?, desk_wait = ?, desk_message = ?, desk_staff = ?, desk_updated_at = ?, desk_updated_by = ? WHERE key = ?")
      .run(v.paused, v.wait, v.message, v.staff, nowIso(), user.name, m[1]);
    audit(db, user.username, "desk.update", "centers:" + m[1], v);
    return db.prepare("SELECT * FROM centers WHERE key = ?").get(m[1]);
  }, "staff");
  on("GET", /^\/api\/admin\/inquiries$/, (req, url) => {
    const p = url.searchParams, where = [], args = [];
    const st = p.get("status") || "open";
    if (st === "open") where.push("status IN ('new','seen')");
    else if (core.INQ_STATUSES.some((x) => x.key === st)) { where.push("status = ?"); args.push(st); }
    if (p.get("center")) { where.push("center = ?"); args.push(p.get("center")); }
    const sql = "SELECT * FROM inquiries " + (where.length ? "WHERE " + where.join(" AND ") : "") + " ORDER BY " + (st === "open" ? "id" : "id DESC") + " LIMIT 500";
    return { items: db.prepare(sql).all(...args) };
  }, "staff");
  on("PATCH", /^\/api\/admin\/inquiries\/(\d+)$/, async (req, url, user, m) => {
    const q = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(Number(m[1]));
    if (!q) throw new HttpError(404, "상담 요청을 찾을 수 없습니다.");
    const b = await readJson(req);
    const status = b.status === undefined ? q.status : b.status;
    if (!core.INQ_STATUSES.some((x) => x.key === status)) throw new HttpError(400, "상태 값이 올바르지 않습니다.");
    const memo = b.staff_memo === undefined ? q.staff_memo : str(b.staff_memo, 500, false, "메모");
    db.prepare("UPDATE inquiries SET status = ?, staff_memo = ?, handled_by = ?, updated_at = ? WHERE id = ?")
      .run(status, memo, status !== q.status ? user.name : q.handled_by, nowIso(), q.id);
    audit(db, user.username, "inquiry.update", "inquiry:" + q.id, { status });
    return { item: db.prepare("SELECT * FROM inquiries WHERE id = ?").get(q.id) };
  }, "staff");

  /* 진료센터 (센터 종류는 고정, 내용만 편집) */
  on("GET", /^\/api\/admin\/centers$/, () => ({ items: centersAll(true).map((c) => Object.assign({ id: c.key }, c)) }), "staff");
  on("PUT", /^\/api\/admin\/centers\/([a-z]+)$/, async (req, url, user, m) => {
    if (!db.prepare("SELECT 1 FROM centers WHERE key = ?").get(m[1])) throw new HttpError(404, "진료센터를 찾을 수 없습니다.");
    const b = await readJson(req);
    const v = {
      name: str(b.name, 30, true, "센터 이름"), en: str(b.en, 40), summary: str(b.summary, 120), description: str(b.description, 2000),
      tags: str(b.tags, 200), process: str(b.process, 2000), faq: str(b.faq, 4000), prep: str(b.prep, 1000), sort: int(b.sort || 0, 0, 999, "순서"), published: b.published === false || b.published === 0 ? 0 : 1
    };
    const cols = Object.keys(v);
    db.prepare("UPDATE centers SET " + cols.map((c) => c + " = ?").join(", ") + " WHERE key = ?").run(...cols.map((c) => v[c]), m[1]);
    audit(db, user.username, "centers.update", "centers:" + m[1], null);
    return Object.assign({ id: m[1], key: m[1] }, v);
  }, "admin");

  /* 계정 */
  on("GET", /^\/api\/admin\/users$/, () => ({ items: db.prepare("SELECT id, username, name, role, created_at FROM users ORDER BY id").all() }), "admin");
  on("POST", /^\/api\/admin\/users$/, async (req, url, user) => {
    const b = await readJson(req);
    const username = str(b.username, 30, true, "아이디");
    if (!/^[a-z0-9._-]{3,30}$/i.test(username)) throw new HttpError(400, "아이디는 영문·숫자 3자 이상으로 만들어 주세요.");
    const role = b.role === "admin" ? "admin" : "staff";
    const pw = String(b.password || "");
    if (pw.length < 10) throw new HttpError(400, "비밀번호는 10자 이상이어야 합니다.");
    if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) throw new HttpError(409, "이미 있는 아이디입니다.");
    const id = Number(db.prepare("INSERT INTO users (username, name, role, pw, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(username, str(b.name, 30, true, "이름"), role, auth.hashPassword(pw), nowIso()).lastInsertRowid);
    audit(db, user.username, "user.create", "users:" + id, { username, role });
    return { status: 201, body: { id, username, role } };
  }, "admin");
  on("DELETE", /^\/api\/admin\/users\/(\d+)$/, (req, url, user, m) => {
    const id = Number(m[1]);
    if (id === user.id) throw new HttpError(400, "로그인한 계정은 삭제할 수 없습니다.");
    const target = db.prepare("SELECT role FROM users WHERE id = ?").get(id);
    if (!target) throw new HttpError(404, "계정을 찾을 수 없습니다.");
    if (target.role === "admin" && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n <= 1) throw new HttpError(400, "마지막 관리자 계정은 삭제할 수 없습니다.");
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    audit(db, user.username, "user.delete", "users:" + id, null);
    return { ok: true };
  }, "admin");
  on("POST", /^\/api\/admin\/password$/, async (req, url, user) => {
    const b = await readJson(req);
    const row = db.prepare("SELECT pw FROM users WHERE id = ?").get(user.id);
    if (!auth.verifyPassword(String(b.current || ""), row.pw)) throw new HttpError(400, "현재 비밀번호가 올바르지 않습니다.");
    if (String(b.next || "").length < 10) throw new HttpError(400, "새 비밀번호는 10자 이상이어야 합니다.");
    db.prepare("UPDATE users SET pw = ? WHERE id = ?").run(auth.hashPassword(b.next), user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(user.id, crypto.createHash("sha256").update(auth.sessionToken(req) || "").digest("hex"));
    audit(db, user.username, "user.password", "users:" + user.id, null);
    return { ok: true };
  }, "staff");

  /* 기록 */
  on("GET", /^\/api\/admin\/audit$/, () => ({ items: db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 300").all() }), "admin");
  on("GET", /^\/api\/admin\/outbox$/, () => ({ items: db.prepare("SELECT * FROM outbox ORDER BY id DESC LIMIT 300").all() }), "staff");

  /* ---------- 정기 작업 ---------- */
  function runJobs() {
    const now = clock(), rules = getSetting(db, "booking");
    // 1) 보관 기간이 지난 예약의 개인정보 파기
    const cutoff = core.addDays(now.date, -rules.retentionDays);
    const purged = db.prepare("UPDATE reservations SET name = '(파기)', phone = '', memo = '', staff_memo = '', purged = 1 WHERE purged = 0 AND date < ?").run(cutoff).changes;
    if (purged) audit(db, "system", "privacy.purge", "reservations", { count: Number(purged), before: cutoff });
    const purgedQ = db.prepare("UPDATE inquiries SET name = '(파기)', phone = '', message = '', staff_memo = '', purged = 1 WHERE purged = 0 AND created_at < ?").run(cutoff + "T00:00:00Z").changes;
    if (purgedQ) audit(db, "system", "privacy.purge", "inquiries", { count: Number(purgedQ), before: cutoff });
    db.prepare("DELETE FROM outbox WHERE at < ?").run(new Date(Date.now() - rules.retentionDays * 86400000).toISOString());
    // 2) 확정 예약 하루 전 안내 문자 (오전 10시 이후 발송)
    let reminded = 0;
    if (now.minutes >= 600) {
      const tomorrow = core.addDays(now.date, 1);
      db.prepare("SELECT * FROM reservations WHERE date = ? AND status = 'confirmed' AND reminded = 0").all(tomorrow).forEach((r) => {
        db.prepare("UPDATE reservations SET reminded = 1 WHERE id = ?").run(r.id);
        notify.patient(r.phone, resMessage("reminder", r));
        reminded++;
      });
    }
    return { purged: Number(purged), reminded };
  }

  /* ---------- 정적 파일 ---------- */
  function serveStatic(req, res, u) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");
    let p = decodeURIComponent(u.pathname);
    if (p === "/admin") { res.writeHead(301, { Location: "/admin/" }); return res.end(); }
    if (p.endsWith("/")) p += "index.html";
    const file = path.normalize(path.join(publicDir, p));
    if (!file.startsWith(publicDir + path.sep)) return send(res, 403, "Forbidden");
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, "페이지를 찾을 수 없습니다.");
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, Object.assign({}, SECURITY_HEADERS, {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Content-Length": st.size,
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300"
      }));
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  /* ---------- 요청 처리 ---------- */
  async function handler(req, res) {
    const u = new URL(req.url, "http://localhost");
    try {
      if (!u.pathname.startsWith("/api/")) return serveStatic(req, res, u);
      if (u.pathname === "/api/live/stream" && req.method === "GET") return openStream(req, res);
      const route = routes.find((r) => r.method === req.method && r.pattern.test(u.pathname));
      if (!route) {
        const any = routes.some((r) => r.pattern.test(u.pathname));
        throw new HttpError(any ? 405 : 404, any ? "지원하지 않는 요청입니다." : "API를 찾을 수 없습니다.");
      }
      let user = null;
      if (u.pathname.startsWith("/api/admin/")) {
        if (req.method !== "GET") {
          // CSRF 방지: 관리자 화면 스크립트만 보내는 헤더 + 같은 출처 확인
          if (req.headers["x-requested-with"] !== "W-Admin") throw new HttpError(403, "허용되지 않은 요청입니다.");
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, "허용되지 않은 출처입니다.");
        }
        if (route.role !== "public") {
          user = auth.currentUser(db, req);
          if (!user) throw new HttpError(401, "로그인이 필요합니다.");
          if (route.role === "admin" && user.role !== "admin") throw new HttpError(403, "관리자 권한이 필요합니다.");
        }
      }
      const out = await route.handler(req, u, user, u.pathname.match(route.pattern));
      if (req.method !== "GET" && !/\/(login|logout|lookup|password|users)(\/|$)/.test(u.pathname)) emit(u.pathname.startsWith("/api/admin/") ? "admin" : "booking");
      if (out && out.raw !== undefined) {
        res.writeHead(200, Object.assign({}, SECURITY_HEADERS, { "Cache-Control": "no-store" }, out.headers));
        return res.end(out.raw);
      }
      if (out && (out.status || out.headers) && "body" in out) return send(res, out.status || 200, out.body, out.headers);
      return send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, Object.assign({ error: e.message }, e.extra || {}));
      console.error(e);
      return send(res, 500, { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
    }
  }

  return { handler, runJobs, closeStreams, emit };
}

module.exports = { createApp, HttpError };
