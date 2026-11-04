"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { openDb } = require("../server/db");
const { ensureAdmin } = require("../server/auth");
const { createApp } = require("../server/app");

const NOW = { date: "2026-11-04", minutes: 600, weekday: 3 }; // 수요일 10:00
let server, base, app, db;
const sent = [];

test.before(async () => {
  db = openDb(":memory:");
  ensureAdmin(db, { ADMIN_PASSWORD: "admin-pass-1234" }, () => {});
  app = createApp({
    db, env: { SMS_WEBHOOK_URL: "https://sms.example/send", NOTIFY_WEBHOOK_URL: "https://hook.example" },
    now: () => NOW,
    fetch: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; }
  });
  server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(() => { app.closeStreams(); server.close(); db.close(); });

async function call(method, path, body, opts = {}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.admin !== false && path.startsWith("/api/admin/") && method !== "GET") headers["x-requested-with"] = "W-Admin";
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text, headers: r.headers };
}
async function login() {
  const r = await call("POST", "/api/admin/login", { username: "admin", password: "admin-pass-1234" });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const booking = (o) => Object.assign({ name: "홍길동", phone: "010-1234-5678", treatment: "implant", date: "2026-11-05", time: "10:00", consent: true }, o);

test("public site data and static page", async () => {
  const r = await call("GET", "/api/site");
  assert.equal(r.status, 200);
  assert.equal(r.json.hours.length, 7);
  assert.equal(r.json.status.open, true);
  assert.ok(r.json.fees.length > 0);
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
  const trav = await fetch(base + "/..%2Fpackage.json");
  assert.ok([403, 404].includes(trav.status));
});

test("days and slots", async () => {
  const d = await call("GET", "/api/days");
  assert.equal(d.json.days[0].date, "2026-11-04");
  assert.equal(d.json.days.find((x) => x.date === "2026-11-08").closed, true);
  const s = await call("GET", "/api/slots?date=2026-11-05");
  assert.equal(s.json.slots[0].time, "09:30");
  assert.equal(s.json.slots[0].remaining, 2);
});

test("reservation flow: create, capacity, lookup, cancel", async () => {
  const a = await call("POST", "/api/reservations", booking());
  assert.equal(a.status, 201, a.text);
  assert.match(a.json.code, /^[A-Z0-9]{6}$/);
  assert.equal(a.json.name, "홍*동");

  const dup = await call("POST", "/api/reservations", booking());
  assert.equal(dup.status, 409);

  const b = await call("POST", "/api/reservations", booking({ phone: "010-2222-3333", name: "김철수" }));
  assert.equal(b.status, 201);
  const full = await call("POST", "/api/reservations", booking({ phone: "010-4444-5555", name: "이영희" }));
  assert.equal(full.status, 409);
  const slots = await call("GET", "/api/slots?date=2026-11-05");
  assert.equal(slots.json.slots.find((s) => s.time === "10:00").remaining, 0);

  const bad = await call("POST", "/api/reservations", booking({ time: "13:00", phone: "010-9999-0000" }));
  assert.equal(bad.status, 409);
  const invalid = await call("POST", "/api/reservations", booking({ consent: false }));
  assert.equal(invalid.status, 400);
  assert.ok(invalid.json.fields.consent);

  const wrong = await call("POST", "/api/reservations/lookup", { code: a.json.code, phone: "010-0000-0000" });
  assert.equal(wrong.status, 404);
  const look = await call("POST", "/api/reservations/lookup", { code: a.json.code.toLowerCase(), phone: "01012345678" });
  assert.equal(look.json.status, "requested");
  assert.equal(look.json.canCancel, true);
  const cancel = await call("POST", "/api/reservations/cancel", { code: a.json.code, phone: "010-1234-5678" });
  assert.equal(cancel.json.status, "cancelled");
  const again = await call("POST", "/api/reservations/cancel", { code: a.json.code, phone: "010-1234-5678" });
  assert.equal(again.status, 409);

  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.some((m) => m.url.includes("sms") && /예약번호/.test(m.body.text)));
  assert.ok(sent.some((m) => m.url.includes("hook") && /새 예약/.test(m.body.text)));
});

test("admin requires login, csrf header and admin role", async () => {
  assert.equal((await call("GET", "/api/admin/reservations")).status, 401);
  assert.equal((await call("POST", "/api/admin/login", { username: "admin", password: "nope" })).status, 401);
  const cookie = await login();
  const noHeader = await call("PUT", "/api/admin/settings/booking", {}, { cookie, admin: false });
  assert.equal(noHeader.status, 403);
  const crossOrigin = await call("POST", "/api/admin/holidays", { date: "2026-11-20", label: "x" }, { cookie, headers: { origin: "https://evil.example" } });
  assert.equal(crossOrigin.status, 403);

  const u = await call("POST", "/api/admin/users", { username: "desk1", name: "데스크", role: "staff", password: "staff-pass-1234" }, { cookie });
  assert.equal(u.status, 201);
  const sl = await call("POST", "/api/admin/login", { username: "desk1", password: "staff-pass-1234" });
  const staffCookie = sl.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("GET", "/api/admin/reservations", undefined, { cookie: staffCookie })).status, 200);
  assert.equal((await call("PUT", "/api/admin/settings/booking", { slotMinutes: 30 }, { cookie: staffCookie })).status, 403);
});

test("admin manages reservations and exports csv", async () => {
  const cookie = await login();
  const list = await call("GET", "/api/admin/reservations?from=2026-11-01&to=2026-11-30", undefined, { cookie });
  const target = list.json.items.find((r) => r.status === "requested");
  assert.ok(target);
  sent.length = 0;
  const conf = await call("PATCH", "/api/admin/reservations/" + target.id, { status: "confirmed", staff_memo: "CT 촬영 예정" }, { cookie });
  assert.equal(conf.json.item.status, "confirmed");
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.some((m) => /확정/.test(m.body.text)));

  const manual = await call("POST", "/api/admin/reservations", { name: "박민수", phone: "02-123-4567", treatment: "perio", date: "2026-11-05", time: "10:00" }, { cookie });
  assert.equal(manual.status, 201);
  assert.equal(manual.json.warning, null);
  const over = await call("POST", "/api/admin/reservations", { name: "최지은", phone: "010-7777-8888", treatment: "kids", date: "2026-11-05", time: "10:00" }, { cookie });
  assert.match(over.json.warning, /이미 예약이 2건/);

  const summary = await call("GET", "/api/admin/summary", undefined, { cookie });
  assert.equal(summary.json.week, 3);

  const csv = await call("GET", "/api/admin/reservations.csv?from=2026-11-01&to=2026-11-30", undefined, { cookie });
  assert.equal(csv.status, 200);
  assert.ok(csv.text.replace(/^\uFEFF/, "").startsWith("예약번호")); // fetch().text()는 BOM을 제거함
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.text, /박민수/);

  const search = await call("GET", "/api/admin/reservations?from=2026-11-01&to=2026-11-30&q=2222", undefined, { cookie });
  assert.equal(search.json.items.length, 1);
});

test("settings, hours, holidays and content update the public site", async () => {
  const cookie = await login();
  const hol = await call("POST", "/api/admin/holidays", { date: "2026-11-05", label: "원내 세미나" }, { cookie });
  assert.equal(hol.status, 201);
  assert.equal(hol.json.affected, 3);
  const s = await call("GET", "/api/slots?date=2026-11-05");
  assert.equal(s.json.closed, true);
  assert.equal(s.json.reason, "원내 세미나");
  await call("DELETE", "/api/admin/holidays/2026-11-05", undefined, { cookie });

  const st = await call("GET", "/api/admin/settings", undefined, { cookie });
  const hours = st.json.hours.map((h) => (h.weekday === 6 ? Object.assign({}, h, { closed: 1 }) : h));
  assert.equal((await call("PUT", "/api/admin/hours", { hours }, { cookie })).status, 200);
  assert.equal((await call("GET", "/api/slots?date=2026-11-07")).json.closed, true);
  const badHours = st.json.hours.map((h) => (h.weekday === 1 ? Object.assign({}, h, { open: "19:00" }) : h));
  assert.equal((await call("PUT", "/api/admin/hours", { hours: badHours }, { cookie })).status, 400);

  const clinic = Object.assign({}, st.json.clinic, { phone: "02-555-0000", kakaoUrl: "javascript:alert(1)" });
  assert.equal((await call("PUT", "/api/admin/settings/clinic", clinic, { cookie })).status, 400);
  clinic.kakaoUrl = "https://pf.kakao.com/_abc";
  assert.equal((await call("PUT", "/api/admin/settings/clinic", clinic, { cookie })).status, 200);

  const fee = await call("POST", "/api/admin/fees", { name: "세라믹 인레이", unit: "1치아", price: 350000 }, { cookie });
  assert.equal(fee.status, 201);
  const notice = await call("POST", "/api/admin/notices", { title: "12월 휴진 안내", body: "12/25 휴진", pinned: true }, { cookie });
  assert.equal(notice.status, 201);

  const site = await call("GET", "/api/site");
  assert.equal(site.json.clinic.phone, "02-555-0000");
  assert.ok(site.json.fees.some((f) => f.name === "세라믹 인레이"));
  assert.equal(site.json.notices[0].title, "12월 휴진 안내");

  const log = await call("GET", "/api/admin/audit", undefined, { cookie });
  assert.ok(log.json.items.some((a) => a.action === "settings.hours"));
});

test("jobs send reminders and purge old personal data", async () => {
  db.prepare("INSERT INTO reservations (code, name, phone, treatment, date, time, status, source, created_at, updated_at) VALUES ('OLD001','오래전','01011112222','checkup','2026-01-02','10:00','visited','web','x','x')").run();
  sent.length = 0;
  const r = app.runJobs();
  assert.equal(r.purged, 1);
  assert.ok(r.reminded >= 1); // 11-05 확정 예약
  const old = db.prepare("SELECT * FROM reservations WHERE code = 'OLD001'").get();
  assert.equal(old.name, "(파기)");
  assert.equal(old.phone, "");
  assert.equal(app.runJobs().reminded, 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.some((m) => /내일/.test(m.body.text)));
});

test("live overview and server-sent update events", async () => {
  const live = await call("GET", "/api/live");
  assert.equal(live.status, 200);
  assert.equal(live.json.week.length, 7);
  assert.deepEqual(live.json.week[0].parts.map((p) => p.key), ["am", "pm", "eve"]);
  assert.equal(live.json.next.date, "2026-11-04");
  assert.equal(live.json.next.time, "11:00");
  assert.ok(live.json.today.openSlots > 0);
  assert.ok(Array.isArray(live.json.doctorsToday));
  assert.equal(live.json.notice.wait, null);

  // SSE: 예약이 들어오면 열린 연결로 update 신호가 와야 함
  const ctrl = new AbortController();
  const r = await fetch(base + "/api/live/stream", { signal: ctrl.signal });
  assert.match(r.headers.get("content-type"), /text\/event-stream/);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const waitFor = async (re) => {
    const until = Date.now() + 3000;
    while (!re.test(buf) && Date.now() < until) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); }
    return re.test(buf);
  };
  assert.ok(await waitFor(/event: hello/));
  const made = await call("POST", "/api/reservations", booking({ phone: "010-3333-1212", date: "2026-11-06", time: "15:00" }));
  assert.equal(made.status, 201);
  assert.ok(await waitFor(/event: update\ndata: \{"kind":"booking"/));
  ctrl.abort();

  // 직원이 대기 안내를 올리면 홈페이지 live 에 표시
  const cookie = await login();
  const up = await call("PUT", "/api/admin/live", { wait: 15, message: "오후 2시 수술로 대기가 길 수 있습니다" }, { cookie });
  assert.equal(up.status, 200);
  const after = await call("GET", "/api/live");
  assert.equal(after.json.notice.wait, 15);
  assert.match(after.json.notice.message, /수술/);
  assert.equal((await call("PUT", "/api/admin/live", { wait: 999 }, { cookie })).status, 400);

  const doc = await call("POST", "/api/admin/doctors", { name: "테스트", days: "월X" }, { cookie });
  assert.equal(doc.status, 400);
});

test("treatment centers: content, doctor days and booking restriction", async () => {
  const site = await call("GET", "/api/site");
  assert.equal(site.json.centers.length, 7);
  const ortho = site.json.centers.find((c) => c.key === "ortho");
  assert.equal(ortho.name, "교정센터");
  assert.equal(ortho.days, "화목토");

  // 수요일(11-04)은 교정 원장 진료일이 아님
  const days = await call("GET", "/api/days?treatment=ortho");
  const wed = days.json.days.find((d) => d.date === "2026-11-04");
  assert.equal(wed.closed, true);
  assert.match(wed.reason, /교정센터 진료일이 아닙니다/);
  assert.equal(days.json.days.find((d) => d.date === "2026-11-10").closed, false); // 화요일
  const slots = await call("GET", "/api/slots?date=2026-11-04&treatment=ortho");
  assert.equal(slots.json.closed, true);
  const bad = await call("POST", "/api/reservations", booking({ treatment: "ortho", date: "2026-11-04", time: "15:30", phone: "010-8888-1111" }));
  assert.equal(bad.status, 409);
  const ok = await call("POST", "/api/reservations", booking({ treatment: "ortho", date: "2026-11-10", time: "15:30", phone: "010-8888-1111" }));
  assert.equal(ok.status, 201, ok.text);

  const live = await call("GET", "/api/live");
  const lo = live.json.centers.find((c) => c.key === "ortho");
  assert.equal(lo.today.open, false);
  assert.equal(lo.next.date, "2026-11-05"); // 목요일
  const li = live.json.centers.find((c) => c.key === "implant");
  assert.equal(li.today.open, true);
  assert.equal(li.doctorsToday.length, 1);

  const cookie = await login();
  const up = await call("PUT", "/api/admin/centers/ortho", { name: "교정센터", summary: "바뀐 소개", sort: 2 }, { cookie });
  assert.equal(up.status, 200);
  assert.equal((await call("GET", "/api/site")).json.centers.find((c) => c.key === "ortho").summary, "바뀐 소개");
  assert.equal((await call("PUT", "/api/admin/centers/nope", { name: "x" }, { cookie })).status, 404);
  assert.equal((await call("POST", "/api/admin/doctors", { name: "새 원장", days: "월", centers: "implant,xx" }, { cookie })).status, 400);
  const nd = await call("POST", "/api/admin/doctors", { name: "새 원장", days: "수", centers: "ortho" }, { cookie });
  assert.equal(nd.status, 201);
  // 수요일 교정 원장이 생기면 교정센터 수요일 예약이 열림
  assert.equal((await call("GET", "/api/slots?date=2026-11-04&treatment=ortho")).json.closed, false);
});

test("center front desk: status, callback requests and staff handling", async () => {
  const cookie = await login();
  let live = await call("GET", "/api/live");
  let ortho = live.json.centers.find((c) => c.key === "ortho");
  // 이전 테스트에서 수요일 교정 원장이 추가되어 오늘(수) 교정센터도 진료
  assert.equal(ortho.desk.status, "open");
  assert.match(ortho.desk.label, /접수 중/);
  assert.equal(ortho.desk.pending, 0);

  const up = await call("PUT", "/api/admin/centers/ortho/desk", { paused: false, wait: 10, message: "교정센터입니다. 오늘 오후는 여유가 있습니다.", staff: "김코디" }, { cookie });
  assert.equal(up.status, 200);
  live = await call("GET", "/api/live");
  ortho = live.json.centers.find((c) => c.key === "ortho");
  assert.equal(ortho.desk.wait, 10);
  assert.equal(ortho.desk.staff, "김코디");
  assert.match(ortho.desk.message, /여유/);

  // 접수 데스크 사진: 같은 사이트 /img/desk/ 경로만
  const badPhoto = await call("PUT", "/api/admin/centers/ortho/desk", { paused: false, wait: 10, staff: "김코디", photo: "https://evil.example/x.jpg" }, { cookie });
  assert.equal(badPhoto.status, 400);
  const okPhoto = await call("PUT", "/api/admin/centers/ortho/desk", { paused: false, wait: 10, message: "교정센터입니다. 오늘 오후는 여유가 있습니다.", staff: "김코디", photo: "/img/desk/ortho.webp" }, { cookie });
  assert.equal(okPhoto.status, 200);
  const site = await call("GET", "/api/site");
  assert.equal(site.json.centers.find((c) => c.key === "ortho").desk_photo, "/img/desk/ortho.webp");

  const bad = await call("POST", "/api/inquiries", { center: "ortho", name: "이상담", phone: "010-4545-1212", topic: "cost", prefer: "pm", consent: false });
  assert.equal(bad.status, 400);
  const q1 = await call("POST", "/api/inquiries", { center: "ortho", name: "이상담", phone: "010-4545-1212", topic: "cost", prefer: "pm", message: "투명교정 비용", consent: true });
  assert.equal(q1.status, 201, q1.text);
  assert.equal(q1.json.status, "new");
  assert.equal(q1.json.ahead, 0);
  const q2 = await call("POST", "/api/inquiries", { center: "ortho", name: "박상담", phone: "010-4545-3434", topic: "first", prefer: "asap", consent: true });
  assert.equal(q2.json.ahead, 1);
  live = await call("GET", "/api/live");
  assert.equal(live.json.centers.find((c) => c.key === "ortho").desk.pending, 2);

  const list = await call("GET", "/api/admin/inquiries?center=ortho", undefined, { cookie });
  assert.equal(list.json.items.length, 2);
  const id = list.json.items[0].id;
  await call("PATCH", "/api/admin/inquiries/" + id, { status: "seen" }, { cookie });
  const look = await call("POST", "/api/inquiries/lookup", { code: q1.json.code, phone: "01045451212" });
  assert.equal(look.json.status, "seen");
  assert.equal(look.json.handledBy, "관리자");
  assert.equal((await call("POST", "/api/inquiries/cancel", { code: q1.json.code, phone: "01045451212" })).status, 409);
  await call("PATCH", "/api/admin/inquiries/" + id, { status: "done", staff_memo: "통화 완료, 상담 예약 안내" }, { cookie });
  assert.equal((await call("POST", "/api/inquiries/lookup", { code: q1.json.code, phone: "01045451212" })).json.status, "done");
  assert.equal((await call("POST", "/api/inquiries/lookup", { code: q2.json.code, phone: "01045453434" })).json.ahead, 0);
  const sum = await call("GET", "/api/admin/summary", undefined, { cookie });
  assert.equal(sum.json.inquiriesOpen, 1);

  // 데스크 일시 중단이면 상담 요청을 받지 않음
  await call("PUT", "/api/admin/centers/ortho/desk", { paused: true }, { cookie });
  live = await call("GET", "/api/live");
  assert.equal(live.json.centers.find((c) => c.key === "ortho").desk.status, "paused");
  const blocked = await call("POST", "/api/inquiries", { center: "ortho", name: "최상담", phone: "010-4545-5656", topic: "other", prefer: "am", consent: true });
  assert.equal(blocked.status, 409);
  await call("PUT", "/api/admin/centers/ortho/desk", { paused: false }, { cookie });
});
