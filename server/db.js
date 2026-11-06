"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const SEED = require("../public/js/seed.js");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hours (
  weekday INTEGER PRIMARY KEY, closed INTEGER NOT NULL DEFAULT 0,
  open TEXT, close TEXT, lunch_start TEXT, lunch_end TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS centers (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, en TEXT, summary TEXT, description TEXT, tags TEXT,
  process TEXT, faq TEXT, sort INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, center TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
  topic TEXT NOT NULL, prefer TEXT NOT NULL, message TEXT, status TEXT NOT NULL, staff_memo TEXT, handled_by TEXT,
  consent_at TEXT, purged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inq_center ON inquiries(center, status);
CREATE TABLE IF NOT EXISTS holidays (date TEXT PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fees (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit TEXT, price INTEGER, note TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, career TEXT, quote TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT, pinned INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT NOT NULL,
  treatment TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, memo TEXT, staff_memo TEXT,
  status TEXT NOT NULL, source TEXT NOT NULL, consent_at TEXT, reminded INTEGER NOT NULL DEFAULT 0,
  purged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_res_slot ON reservations(date, time);
CREATE INDEX IF NOT EXISTS idx_res_phone ON reservations(phone);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
  pw TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, username TEXT, action TEXT NOT NULL, target TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, channel TEXT NOT NULL, recipient TEXT, body TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT
);
`;

const DEFAULT_CLINIC = {
  name: "W치과의원",
  shortName: "W치과",
  address: "OO시 OO구 OO대로 000, 4층",
  phone: "02-000-0000",
  subway: "OO역 2번 출구에서 도보 3분",
  parking: "건물 지하 주차장 2시간 무료",
  director: "OOO",
  bizNo: "000-00-00000",
  kakaoUrl: "https://pf.kakao.com/",
  naverBookingUrl: "https://booking.naver.com/",
  naverMapUrl: "https://map.naver.com/",
  kakaoMapUrl: "https://map.kakao.com/"
};

const DEFAULT_BOOKING = {
  slotMinutes: 30,       // 예약 단위(분)
  capacity: 2,           // 시간대당 받을 수 있는 온라인 예약 수
  leadMinutes: 60,       // 지금부터 최소 몇 분 뒤부터 예약 가능
  windowDays: 30,        // 며칠 뒤까지 예약 가능
  lastEntryMinutes: 30,  // 진료 종료 몇 분 전까지 접수
  maxActivePerPhone: 3,  // 한 연락처의 동시 예약 수
  retentionDays: 180     // 지난 예약의 개인정보 보관 기간
};

// 처음 설치할 때 들어가는 예시 비급여 금액(실제 금액으로 바꿔야 함 — 오픈 전 점검이 확인)
const SAMPLE_FEES = [
  ["임플란트 (국산 픽스처 + 지르코니아)", "1개", 1100000, "", 1],
  ["뼈이식 (부분)", "1부위", 300000, "", 2],
  ["지르코니아 크라운", "1개", 500000, "", 3],
  ["레진 충전 (13세 이상)", "1치아", 100000, "", 4],
  ["투명교정 (전체)", "1회 과정", 5500000, "", 5],
  ["전문가 미백", "1회", 200000, "", 6]
];
const SAMPLE_DOCTOR_NAME = "원장 성함";

// 직원이 대시보드에서 바꾸는 '지금 병원 상황' (홈페이지 상단에 실시간 표시)
const DEFAULT_LIVE = { wait: null, message: "", updatedAt: null, updatedBy: null };

function nowIso() { return new Date().toISOString(); }

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA);
  migrate(db);
  seed(db);
  return db;
}

/* ---------- 스키마 버전 (PRAGMA user_version) ----------
 * 규칙: 마이그레이션은 '추가'만 한다(열 · 표 · 색인). 지우거나 이름을 바꿀 때는 두 번의 배포로 나눈다.
 * 그래야 새 버전 배포가 실패해 이전 버전으로 되돌려도 이전 앱이 같은 DB로 그대로 돈다.
 * 각 단계는 트랜잭션이며, 번호는 한 번 쓰면 바꾸지 않는다. */
function addColumn(db, table, col, type) {
  const cols = db.prepare("PRAGMA table_info(" + table + ")").all().map((c) => c.name);
  if (!cols.includes(col)) db.exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + type);
}
const MIGRATIONS = [
  { version: 1, note: "센터 데스크 · 의료진 진료 요일 · 진료비 센터 (번호 매기기 전 열 확인 방식 그대로)", up: legacyMigrate },
  { version: 2, note: "건강 정보 별도 동의 시각 · 접속기록 IP · 비밀번호 바꾼 시각", up(db) {
    addColumn(db, "reservations", "health_consent_at", "TEXT");
    addColumn(db, "inquiries", "health_consent_at", "TEXT");
    addColumn(db, "audit", "ip", "TEXT");
    addColumn(db, "users", "pw_changed_at", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at)");
  } }
];
const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function migrate(db) {
  const current = db.prepare("PRAGMA user_version").get().user_version;
  if (current > SCHEMA_VERSION) throw new Error("DB 스키마(" + current + ")가 이 앱(" + SCHEMA_VERSION + ")보다 새 버전입니다. 앱을 최신으로 올리세요.");
  MIGRATIONS.filter((m) => m.version > current).forEach((m) => {
    db.exec("BEGIN");
    try { m.up(db); db.exec("PRAGMA user_version = " + m.version); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  });
}

// v1: 번호를 매기기 전부터 쓰던 '열이 없으면 추가' 방식. 예전 DB(user_version 0)를 그대로 받아들인다.
function legacyMigrate(db) {
  const cols = db.prepare("PRAGMA table_info(doctors)").all().map((c) => c.name);
  if (!cols.includes("days")) db.exec("ALTER TABLE doctors ADD COLUMN days TEXT NOT NULL DEFAULT '월화수목금토'");
  if (!cols.includes("centers")) {
    db.exec("ALTER TABLE doctors ADD COLUMN centers TEXT NOT NULL DEFAULT ''");
    const set = db.prepare("UPDATE doctors SET centers = ? WHERE sort = ?");
    Object.keys(SEED.DOCTOR_CENTERS).forEach((sort) => set.run(SEED.DOCTOR_CENTERS[sort], Number(sort)));
  }
  const feeCols = db.prepare("PRAGMA table_info(fees)").all().map((c) => c.name);
  if (!feeCols.includes("center")) {
    db.exec("ALTER TABLE fees ADD COLUMN center TEXT");
    const set = db.prepare("UPDATE fees SET center = ? WHERE sort = ?");
    Object.keys(SEED.FEE_CENTERS).forEach((sort) => set.run(SEED.FEE_CENTERS[sort], Number(sort)));
  }
  // 센터 데스크(리셉션) 상태: 직원이 관리 화면에서 바꾸는 값
  const centerCols = db.prepare("PRAGMA table_info(centers)").all().map((c) => c.name);
  [["prep", "TEXT"], ["desk_paused", "INTEGER NOT NULL DEFAULT 0"], ["desk_wait", "INTEGER"], ["desk_message", "TEXT"],
   ["desk_staff", "TEXT"], ["desk_updated_at", "TEXT"], ["desk_updated_by", "TEXT"], ["desk_photo", "TEXT"]].forEach(([col, type]) => {
    if (!centerCols.includes(col)) db.exec("ALTER TABLE centers ADD COLUMN " + col + " " + type);
  });
  if (!db.prepare("SELECT COUNT(*) AS n FROM centers").get().n) {
    const ins = db.prepare("INSERT INTO centers (key, name, en, summary, description, tags, process, faq, prep, sort, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)");
    SEED.CENTERS.forEach((c) => ins.run(c.key, c.name, c.en, c.summary, c.description, c.tags, c.process, c.faq, c.prep, c.sort));
  } else {
    const fill = db.prepare("UPDATE centers SET prep = ? WHERE key = ? AND prep IS NULL");
    SEED.CENTERS.forEach((c) => fill.run(c.prep, c.key));
  }
}

function seed(db) {
  const has = db.prepare("SELECT COUNT(*) AS n FROM settings").get().n;
  if (has) return;
  const setS = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  setS.run("clinic", JSON.stringify(DEFAULT_CLINIC));
  setS.run("booking", JSON.stringify(DEFAULT_BOOKING));

  const h = db.prepare("INSERT INTO hours (weekday, closed, open, close, lunch_start, lunch_end, note) VALUES (?, ?, ?, ?, ?, ?, ?)");
  h.run(0, 1, null, null, null, null, null);
  h.run(1, 0, "09:30", "18:30", "13:00", "14:00", null);
  h.run(2, 0, "09:30", "21:00", "13:00", "14:00", "야간");
  h.run(3, 0, "09:30", "18:30", "13:00", "14:00", null);
  h.run(4, 0, "09:30", "21:00", "13:00", "14:00", "야간");
  h.run(5, 0, "09:30", "18:30", "13:00", "14:00", null);
  h.run(6, 0, "09:30", "14:00", null, null, "점심시간 없음");

  const hol = db.prepare("INSERT INTO holidays (date, label) VALUES (?, ?)");
  hol.run("2026-12-25", "성탄절");
  hol.run("2027-01-01", "신정");

  const f = db.prepare("INSERT INTO fees (name, unit, price, note, sort) VALUES (?, ?, ?, ?, ?)");
  SAMPLE_FEES.forEach((r) => f.run(...r));

  const d = db.prepare("INSERT INTO doctors (name, role, career, quote, sort) VALUES (?, ?, ?, ?, ?)");
  d.run(SAMPLE_DOCTOR_NAME, "대표원장 · 통합치의학과 전문의", "치의학 석사\n임플란트 · 보철 진료", "뽑지 않고 살릴 수 있는 치아부터 찾습니다.", 1);
  d.run(SAMPLE_DOCTOR_NAME, "원장 · 치과교정과 전문의", "교정 · 턱관절 진료\n투명교정 인증의", "교정 기간과 비용은 첫 상담에서 정해 드립니다.", 2);
  d.run(SAMPLE_DOCTOR_NAME, "원장 · 소아치과 전문의", "소아 · 보존 진료\n장애인 치과 진료", "아이가 다음에도 오고 싶어 하는 치과를 만듭니다.", 3);
  db.prepare("UPDATE doctors SET days = ? WHERE sort = ?").run("화목토", 2);
  Object.keys(SEED.DOCTOR_CENTERS).forEach((sort) => db.prepare("UPDATE doctors SET centers = ? WHERE sort = ?").run(SEED.DOCTOR_CENTERS[sort], Number(sort)));
  Object.keys(SEED.FEE_CENTERS).forEach((sort) => db.prepare("UPDATE fees SET center = ? WHERE sort = ?").run(SEED.FEE_CENTERS[sort], Number(sort)));
  db.prepare("UPDATE doctors SET days = ? WHERE sort = ?").run("월수금토", 3);

  db.prepare("INSERT INTO notices (title, body, pinned, published, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("홈페이지에서 바로 예약할 수 있습니다", "원하는 날짜와 시간을 고르면 확인 후 문자로 확정 안내를 드립니다.", 1, 1, nowIso());
}

function getSetting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  const base = key === "clinic" ? DEFAULT_CLINIC : key === "booking" ? DEFAULT_BOOKING : key === "live" ? DEFAULT_LIVE : {};
  return Object.assign({}, base, row ? JSON.parse(row.value) : {});
}
function setSetting(db, key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

// 접속기록: 누가 · 언제 · 어디서(IP) · 무엇을. 개인정보 안전성 확보조치 기준의 접속기록으로 쓰므로 지우지 않는다(2년 이상 보관).
function audit(db, username, action, target, detail, ip) {
  db.prepare("INSERT INTO audit (at, username, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)")
    .run(nowIso(), username || "system", action, target == null ? null : String(target), detail ? JSON.stringify(detail) : null, ip || null);
}

module.exports = { openDb, getSetting, setSetting, audit, nowIso, DEFAULT_CLINIC, DEFAULT_BOOKING, SCHEMA_VERSION, MIGRATIONS, SAMPLE_FEES, SAMPLE_DOCTOR_NAME };
