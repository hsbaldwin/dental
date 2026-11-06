"use strict";
// 실 사용 운영: 스키마 버전 · 건강 정보 동의 · 접속기록 · 상태 확인 · 운영 알림 · 오픈 전 점검 · 백업과 복구
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { openDb, SCHEMA_VERSION } = require("../server/db");

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wdental-")), name);

test("migrations: an old database (before version numbers) upgrades in place and keeps its data", () => {
  const file = tmp("old.db");
  // 번호를 매기기 전(user_version 0) 모양: 처음 배포 때의 표만, 나중에 생긴 열은 없음
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE doctors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, career TEXT, quote TEXT, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE fees (id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit TEXT, price INTEGER, note TEXT, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT NOT NULL,
      treatment TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, memo TEXT, staff_memo TEXT, status TEXT NOT NULL, source TEXT NOT NULL,
      consent_at TEXT, reminded INTEGER NOT NULL DEFAULT 0, purged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, username TEXT, action TEXT NOT NULL, target TEXT, detail TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, pw TEXT NOT NULL, created_at TEXT NOT NULL);`);
  old.prepare("INSERT INTO settings (key, value) VALUES ('clinic', '{\"name\":\"옛 치과\"}')").run();
  old.prepare("INSERT INTO reservations (code, name, phone, treatment, date, time, status, source, created_at, updated_at) VALUES ('ABC123', '홍길동', '01012345678', 'implant', '2026-11-05', '10:00', 'requested', 'web', 'x', 'x')").run();
  old.close();

  const db = openDb(file);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  const cols = (t) => db.prepare("PRAGMA table_info(" + t + ")").all().map((c) => c.name);
  assert.ok(cols("reservations").includes("health_consent_at"));
  assert.ok(cols("audit").includes("ip"));
  assert.ok(cols("users").includes("pw_changed_at"));
  assert.ok(cols("doctors").includes("days"), "v1(열 확인 방식)도 함께 적용");
  assert.equal(db.prepare("SELECT name FROM reservations WHERE code = 'ABC123'").get().name, "홍길동");
  assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'clinic'").get().value).name, "옛 치과");
  db.close();
  // 두 번째로 열어도 아무 일 없이 같은 버전
  const again = openDb(file);
  assert.equal(again.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  again.close();
});

test("migrations: refuses a database made by a newer app instead of guessing", () => {
  const file = tmp("future.db");
  const d = openDb(file); d.exec("PRAGMA user_version = " + (SCHEMA_VERSION + 5)); d.close();
  assert.throws(() => openDb(file), /새 버전/);
});

/* ---------- 앱을 띄워 확인하는 운영 기능 ---------- */
const http = require("node:http");
const { ensureAdmin } = require("../server/auth");
const { createApp } = require("../server/app");
const NOW = { date: "2026-11-04", minutes: 600, weekday: 3 }; // 수요일 10:00
let srv, base, app, db, smsOk = true;
const sent = [];
test.before(async () => {
  db = openDb(":memory:");
  ensureAdmin(db, { ADMIN_PASSWORD: "admin-pass-1234" }, () => {});
  app = createApp({
    db, env: { SMS_WEBHOOK_URL: "https://sms.example/send", NOTIFY_WEBHOOK_URL: "https://hook.example", HEALTH_TOKEN: "t0ken", APP_VERSION: "v9.9.9-test", TRUST_PROXY: "1" },
    now: () => NOW,
    fetch: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return url.includes("sms") && !smsOk ? { ok: false, status: 502 } : { ok: true, status: 200 }; }
  });
  srv = http.createServer(app.handler);
  await new Promise((r) => srv.listen(0, r));
  base = "http://127.0.0.1:" + srv.address().port;
});
test.after(() => { app.closeStreams(); srv.close(); db.close(); });
async function call(method, p, body, opts = {}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  if (opts.cookie) headers.cookie = opts.cookie;
  if (p.startsWith("/api/admin/") && method !== "GET") headers["x-requested-with"] = "W-Admin";
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text, headers: r.headers };
}
async function login() {
  const r = await call("POST", "/api/admin/login", { username: "admin", password: "admin-pass-1234" });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const booking = (o) => Object.assign({ name: "홍길동", phone: "010-1234-5678", treatment: "endo", date: "2026-11-05", time: "10:00", consent: true }, o);

test("health info needs its own consent; channel tags are not health info", async () => {
  const noConsent = await call("POST", "/api/reservations", booking({ memo: "왼쪽 아래 어금니가 시려요" }));
  assert.equal(noConsent.status, 400);
  assert.ok(noConsent.json.fields.healthConsent);

  const ok = await call("POST", "/api/reservations", booking({ memo: "왼쪽 아래 어금니가 시려요", healthConsent: true }));
  assert.equal(ok.status, 201);
  const row = db.prepare("SELECT memo, consent_at, health_consent_at FROM reservations WHERE code = ?").get(ok.json.code);
  assert.ok(row.consent_at && row.health_consent_at);

  // 쉬운 예약: 메모 없이 경로만 → 건강 정보 동의 없이 접수, 저장된 메모에는 경로 표시만
  const easy = await call("POST", "/api/reservations", booking({ phone: "010-2222-3333", time: "10:30", memo: "", channel: "easy" }));
  assert.equal(easy.status, 201);
  const er = db.prepare("SELECT memo, health_consent_at FROM reservations WHERE code = ?").get(easy.json.code);
  assert.equal(er.memo, "쉬운 예약");
  assert.equal(er.health_consent_at, null);

  // 챗봇 상담 요청(사용자가 쓴 말 없음) → 동의 없이 접수
  const chatQ = await call("POST", "/api/inquiries", { center: "ortho", name: "이상담", phone: "010-4545-1212", topic: "cost", prefer: "pm", message: "", channel: "chat", consent: true });
  assert.equal(chatQ.status, 201);
  assert.equal(db.prepare("SELECT message FROM inquiries WHERE code = ?").get(chatQ.json.code).message, "챗봇에서 신청");
  // 직접 남긴 말씀은 동의가 있어야
  const msgQ = await call("POST", "/api/inquiries", { center: "ortho", name: "김상담", phone: "010-4545-3434", topic: "cost", prefer: "pm", message: "교정 기간이 궁금해요", consent: true });
  assert.equal(msgQ.status, 400);
  assert.ok(msgQ.json.fields.healthConsent);
});

test("access log records views with IP, throttles repeated polling, and exports for monthly review", async () => {
  const cookie = await login();
  const before = db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'reservation.view'").get().n;
  for (let i = 0; i < 3; i++) await call("GET", "/api/admin/reservations?from=2026-11-01", undefined, { cookie, headers: { "x-forwarded-for": "203.0.113.7" } });
  const views = db.prepare("SELECT * FROM audit WHERE action = 'reservation.view' ORDER BY id DESC").all();
  assert.equal(views.length - before, 1, "같은 조건 반복 조회는 10분에 한 번");
  assert.equal(views[0].ip, "203.0.113.7");
  assert.equal(views[0].username, "admin");
  assert.ok(JSON.parse(views[0].detail).count >= 1);
  await call("GET", "/api/admin/inquiries", undefined, { cookie });
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'inquiry.view'").get().n >= 1);
  const csv = await call("GET", "/api/admin/reservations.csv", undefined, { cookie, headers: { "x-forwarded-for": "203.0.113.8" } });
  assert.equal(csv.status, 200);
  assert.equal(db.prepare("SELECT ip FROM audit WHERE action = 'reservation.export' ORDER BY id DESC").get().ip, "203.0.113.8");
  const log = await call("GET", "/api/admin/audit.csv?from=2020-01-01", undefined, { cookie });
  assert.equal(log.status, 200);
  assert.match(log.text, /접속지\(IP\)/);
  assert.match(log.text, /203\.0\.113\.7/);
  assert.match(log.text, /login/, "로그인 기록도 IP와 함께");
});

test("health: outside sees only ok + version; inside or with token sees operations, never personal data", async () => {
  const outside = await call("GET", "/api/health", undefined, { headers: { "x-forwarded-for": "198.51.100.1" } });
  assert.equal(outside.status, 200);
  assert.deepEqual(outside.json, { ok: true, version: "v9.9.9-test" });
  const inside = await call("GET", "/api/health");
  assert.equal(inside.json.db, "ok");
  assert.ok("backup" in inside.json && "smsFailed24h" in inside.json && "uptimeSec" in inside.json);
  const token = await call("GET", "/api/health", undefined, { headers: { "x-forwarded-for": "198.51.100.1", "x-health-token": "t0ken" } });
  assert.equal(token.json.db, "ok");
  assert.doesNotMatch(inside.text + token.text, /010|홍길동|phone|name/);
});

test("operations alert: failed patient texts alert staff once per hour", async () => {
  smsOk = false;
  const r = await call("POST", "/api/reservations", booking({ phone: "010-7777-8888", time: "11:00" }));
  assert.equal(r.status, 201);
  await new Promise((res) => setTimeout(res, 30)); // 문자 발송(비동기) 기록 대기
  smsOk = true;
  const first = app.runJobs();
  assert.deepEqual(first.alerts, ["smsFailed"]);
  assert.ok(sent.some((m) => m.url.includes("hook") && /문자 1건을 보내지 못했습니다/.test(m.body.text)));
  assert.deepEqual(app.runJobs().alerts, [], "1시간 안에는 다시 보내지 않음");
});

test("password change is recorded so the temporary-password banner can go away", async () => {
  const cookie = await login();
  assert.equal((await call("GET", "/api/admin/me", undefined, { cookie })).json.pwChangedAt, null);
  const r = await call("POST", "/api/admin/password", { current: "admin-pass-1234", next: "new-strong-pass-99" }, { cookie });
  assert.equal(r.status, 200);
  assert.ok((await call("GET", "/api/admin/me", undefined, { cookie })).json.pwChangedAt);
  const back = await call("POST", "/api/admin/password", { current: "new-strong-pass-99", next: "admin-pass-1234" }, { cookie });
  assert.equal(back.status, 200);
});

/* ---------- 백업 · 복구 · 보관 규칙 ---------- */
const backup = require("../server/backup");
test("backup: encrypted copy restores with the same counts; tampered or wrong-key files are refused", () => {
  const file = tmp("live.db"), dir = path.join(path.dirname(file), "b");
  const live = openDb(file);
  live.prepare("INSERT INTO reservations (code, name, phone, treatment, date, time, status, source, created_at, updated_at) VALUES ('BK0001', '김백업', '01011112222', 'implant', '2026-11-05', '10:00', 'requested', 'web', 'x', 'x')").run();
  live.close();
  const info = backup.createBackup({ dbFile: file, dir, key: "k".repeat(20), tag: "pre-deploy-v1.0.0" });
  assert.ok(info.encrypted && /pre-deploy-v1\.0\.0\.db\.enc$/.test(info.file));
  assert.equal(fs.readFileSync(info.file).subarray(0, 5).toString(), "WDBK1");
  assert.doesNotMatch(fs.readFileSync(info.file).toString("latin1"), /김백업|01011112222|SQLite format/, "평문이 보이지 않음");
  const v = backup.restore({ file: info.file, key: "k".repeat(20), dbFile: file, verifyOnly: true });
  assert.equal(v.counts.reservations, 1);
  const bad = info.file + ".bad"; const buf = fs.readFileSync(info.file); buf[buf.length - 40] ^= 0xff; fs.writeFileSync(bad, buf);
  assert.throws(() => backup.restore({ file: bad, key: "k".repeat(20), dbFile: file, verifyOnly: true }), /풀 수 없습니다/);
  assert.throws(() => backup.restore({ file: info.file, key: "x".repeat(20), dbFile: file, verifyOnly: true }), /풀 수 없습니다/);
  // 실제 복구: 이전 DB는 옆으로
  const r = backup.restore({ file: info.file, key: "k".repeat(20), dbFile: file });
  assert.ok(r.restored && fs.existsSync(r.previous));
  const back = openDb(file); assert.equal(back.prepare("SELECT name FROM reservations WHERE code = 'BK0001'").get().name, "김백업");
  assert.ok(JSON.parse(back.prepare("SELECT value FROM settings WHERE key = 'ops'").get()?.value || "{}") !== null);
  back.close();
});

test("backup rotation keeps hourly 48h, daily 14d, weekly 8w, 10 deploy copies, and nothing past the privacy retention", () => {
  const now = Date.parse("2026-11-06T03:00:00Z"), H = 3600e3, D = 24 * H;
  const name = (ms, tag) => "/b/wdental-" + new Date(ms).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13) + (tag ? "-" + tag : "") + ".db.enc";
  const files = [];
  for (let h = 0; h < 24 * 200; h++) files.push(name(now - h * H)); // 200일 동안 매시 백업
  for (let i = 0; i < 15; i++) files.push(name(now - i * D - 30 * 60e3, "pre-deploy-v1." + i));
  files.push(name(now - 190 * D, "pre-deploy-v0.9"));
  const drop = new Set(backup.planRotation(files, now, 180));
  const kept = files.filter((f) => !drop.has(f)).map(backup.parseName);
  const plain = kept.filter((k) => !k.tag), tagged = kept.filter((k) => k.tag);
  assert.equal(plain.filter((k) => now - k.at <= 48 * H).length, 49, "48시간 안은 모두");
  assert.ok(plain.every((k) => now - k.at <= 56 * D), "8주 넘는 일반 사본 없음");
  assert.ok(plain.length < 49 + 14 + 8, "하루 1개 · 한 주 1개로 줄어듦");
  assert.equal(tagged.length, 10, "배포 전 사본은 최근 10개");
  assert.ok(kept.every((k) => now - k.at <= 180 * D), "보관 기간을 넘는 사본은 하나도 없음");
});

/* ---------- 오픈 전 점검 ---------- */
const { runPreflight } = require("../server/preflight");
test("preflight: a fresh install is blocked in strict mode for sample content, and passes once filled in", () => {
  const pre = openDb(":memory:");
  ensureAdmin(pre, { ADMIN_PASSWORD: "x".repeat(12) }, () => {});
  const pub = path.join(__dirname, "..", "public");
  const failed = (r) => r.filter((x) => x.level === "fail").map((x) => x.title);
  const env0 = {};
  const basic = runPreflight({ db: pre, env: env0, publicDir: pub, strict: false });
  assert.deepEqual(failed(basic), [], "기본 점검은 예시 내용으로도 통과(알림만)");
  const strict = failed(runPreflight({ db: pre, env: env0, publicDir: pub, strict: true }));
  ["병원 정보 입력", "의료진 성함", "비급여 진료비 실제 금액", "처음 받은 비밀번호 바꿈", "개인정보처리방침 법률 검토", "최근 백업(26시간 안)", "환자 문자 연동"].forEach((t) => assert.ok(strict.includes(t), "막혀야 함: " + t));

  // 채워 넣기
  const { setSetting, getSetting } = require("../server/db");
  setSetting(pre, "clinic", Object.assign(getSetting(pre, "clinic"), { address: "서울시 강남구 테헤란로 1, 4층", phone: "02-555-1234", director: "김원장", bizNo: "123-45-67890", subway: "강남역 2번 출구 도보 3분" }));
  pre.prepare("UPDATE doctors SET name = '김원장'").run();
  pre.prepare("UPDATE fees SET price = price + 10000").run();
  pre.prepare("UPDATE users SET pw_changed_at = 'x'").run();
  pre.prepare("INSERT INTO users (username, name, role, pw, created_at, pw_changed_at) VALUES ('kim', '김실장', 'staff', 'x', 'x', 'x')").run();
  pre.prepare("INSERT OR REPLACE INTO holidays (date, label) VALUES (?, '테스트 휴진')").run(core.addDays(core.seoulNow().date, 10));
  setSetting(pre, "ops", { lastBackup: new Date().toISOString() });
  const env = { COOKIE_SECURE: "1", TRUST_PROXY: "1", NOTIFY_WEBHOOK_URL: "https://h", SMS_WEBHOOK_URL: "https://s", BACKUP_KEY: "k".repeat(24), HEALTH_TOKEN: "t" };
  const privDir = fs.mkdtempSync(path.join(os.tmpdir(), "wdental-pub-"));
  fs.writeFileSync(path.join(privDir, "privacy.html"), "<main>검토를 마친 처리방침. 보호책임자 김원장</main>");
  assert.deepEqual(failed(runPreflight({ db: pre, env, publicDir: privDir, strict: true })), []);
  // 로컬 예시 데이터 표시가 있으면 막음
  setSetting(pre, "ops", { lastBackup: new Date().toISOString(), localSample: true });
  assert.ok(failed(runPreflight({ db: pre, env, publicDir: privDir, strict: true })).includes("예시 데이터 없음"));
  pre.close();
});
const core = require("../public/js/core.js");
