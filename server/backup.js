"use strict";
/*
 * 백업 · 복구 (scripts/backup.js, scripts/restore.js가 씀)
 *  - 운영 중에도 안전한 사본: VACUUM INTO → 사본 무결성 검사(PRAGMA integrity_check)
 *  - BACKUP_KEY가 있으면 AES-256-GCM으로 암호화(.db.enc). 파일 머리: "WDBK1" + salt(16) + iv(12), 끝: 인증 태그(16)
 *  - 보관 규칙: 48시간 안은 모두, 14일 안은 하루 1개, 8주 안은 한 주 1개. 배포 전 사본(tag)은 최근 10개.
 *    어떤 사본도 개인정보 보관 기간(기본 180일)을 넘기지 않는다 — 파기한 개인정보가 백업에 남지 않게.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const MAGIC = Buffer.from("WDBK1");
const NAME = /^wdental-(\d{8})-(\d{4})(?:-([a-z0-9.\-]+))?\.db(\.enc)?$/i;

function stampOf(d) { return d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13); }
function parseName(file) {
  const m = NAME.exec(path.basename(file));
  if (!m) return null;
  const [, ymd, hm, tag, enc] = m;
  return { file, tag: tag || null, encrypted: !!enc, at: Date.parse(ymd.slice(0, 4) + "-" + ymd.slice(4, 6) + "-" + ymd.slice(6) + "T" + hm.slice(0, 2) + ":" + hm.slice(2) + ":00Z") };
}

function keyFrom(secret, salt) { return crypto.scryptSync(String(secret), salt, 32); }
function encrypt(buf, secret) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFrom(secret, salt), iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()]);
}
function decrypt(buf, secret) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("W치과 백업 파일 형식이 아닙니다.");
  if (!secret) throw new Error("암호화된 백업입니다. BACKUP_KEY를 지정하세요.");
  const salt = buf.subarray(5, 21), iv = buf.subarray(21, 33), tag = buf.subarray(buf.length - 16), body = buf.subarray(33, buf.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", keyFrom(secret, salt), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(body), d.final()]); }
  catch (e) { throw new Error("백업을 풀 수 없습니다. 키가 다르거나 파일이 손상되었습니다."); }
}

// 사본 파일을 열어 무결성 검사 + 표별 건수
function inspect(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const ok = db.prepare("PRAGMA integrity_check").get().integrity_check === "ok";
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const counts = {};
    tables.forEach((t) => { counts[t] = db.prepare("SELECT COUNT(*) AS n FROM \"" + t + "\"").get().n; });
    return { ok, version, counts };
  } finally { db.close(); }
}

function retentionDays(dbFile) {
  try {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const row = db.prepare("SELECT value FROM settings WHERE key = 'booking'").get();
    db.close();
    const d = row ? JSON.parse(row.value).retentionDays : null;
    return Number.isFinite(d) && d > 0 ? d : 180;
  } catch (e) { return 180; }
}

function recordBackup(dbFile, info) {
  const db = new DatabaseSync(dbFile);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ops'").get();
    const ops = Object.assign(row ? JSON.parse(row.value) : {}, { lastBackup: info.at, lastBackupFile: path.basename(info.file) });
    db.prepare("INSERT INTO settings (key, value) VALUES ('ops', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(ops));
  } finally { db.close(); }
}

/* 백업 하나 만들기 */
function createBackup({ dbFile, dir, key, tag, now }) {
  const at = now || new Date();
  fs.mkdirSync(dir, { recursive: true });
  const safeTag = tag ? String(tag).toLowerCase().replace(/[^a-z0-9.\-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) : "";
  const base = path.join(dir, "wdental-" + stampOf(at) + (safeTag ? "-" + safeTag : "") + ".db");
  const plain = base + ".tmp";
  fs.rmSync(plain, { force: true });
  const src = new DatabaseSync(dbFile);
  try { src.exec("PRAGMA busy_timeout = 5000"); src.exec("VACUUM INTO '" + plain.replace(/'/g, "''") + "'"); } finally { src.close(); }
  const check = inspect(plain);
  if (!check.ok) { fs.rmSync(plain, { force: true }); throw new Error("백업 사본의 무결성 검사에 실패했습니다."); }
  let file = base;
  if (key) { file = base + ".enc"; fs.writeFileSync(file, encrypt(fs.readFileSync(plain), key), { mode: 0o600 }); fs.rmSync(plain); }
  else fs.renameSync(plain, file);
  fs.chmodSync(file, 0o600);
  const info = { file, at: at.toISOString(), encrypted: !!key, bytes: fs.statSync(file).size, counts: check.counts };
  recordBackup(dbFile, info);
  return info;
}

/* 보관 규칙에 따라 지울 파일 고르기(순수 함수: 테스트하기 쉽게) */
function planRotation(files, now, maxDays) {
  const H = 3600 * 1000, D = 24 * H;
  const items = files.map(parseName).filter(Boolean).sort((a, b) => b.at - a.at);
  const keep = new Set(), seenDay = new Set(), seenWeek = new Set();
  let tagged = 0;
  items.forEach((it) => {
    const age = now - it.at;
    if (age > maxDays * D) return; // 개인정보 보관 기간을 넘긴 사본은 무조건 삭제
    if (it.tag) { if (tagged++ < 10) keep.add(it.file); return; }
    const day = new Date(it.at).toISOString().slice(0, 10);
    const week = Math.floor((it.at + 3 * D) / (7 * D)); // 월요일 시작 주
    if (age <= 48 * H) keep.add(it.file);
    else if (age <= 14 * D && !seenDay.has(day)) keep.add(it.file);
    else if (age <= 56 * D && !seenWeek.has(week)) keep.add(it.file);
    seenDay.add(day); seenWeek.add(week);
  });
  return items.filter((it) => !keep.has(it.file)).map((it) => it.file);
}
function rotate(dir, now, maxDays) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [];
  const drop = planRotation(files, now || Date.now(), maxDays || 180);
  drop.forEach((f) => fs.rmSync(f, { force: true }));
  return drop;
}

/* 백업 파일을 평문 DB 파일로 풀기(임시 위치) */
function unpack(file, key, outFile) {
  const buf = fs.readFileSync(file);
  const plain = buf.subarray(0, MAGIC.length).equals(MAGIC) ? decrypt(buf, key) : buf;
  if (!plain.subarray(0, 16).toString("latin1").startsWith("SQLite format 3")) throw new Error("SQLite 데이터 파일이 아닙니다.");
  fs.writeFileSync(outFile, plain, { mode: 0o600 });
  return outFile;
}

/* 복구: 현재 DB는 지우지 않고 옆으로 옮겨 둔다 */
function restore({ file, key, dbFile, verifyOnly, now }) {
  const tmpFile = path.join(path.dirname(dbFile), ".restore-" + process.pid + ".db");
  unpack(file, key, tmpFile);
  const check = inspect(tmpFile);
  if (!check.ok) { fs.rmSync(tmpFile, { force: true }); throw new Error("백업 파일의 무결성 검사에 실패했습니다."); }
  if (verifyOnly) { fs.rmSync(tmpFile, { force: true }); return Object.assign({ verified: true }, check); }
  const aside = dbFile + ".before-restore-" + stampOf(now || new Date());
  if (fs.existsSync(dbFile)) fs.renameSync(dbFile, aside);
  ["-wal", "-shm"].forEach((s) => { if (fs.existsSync(dbFile + s)) fs.renameSync(dbFile + s, aside + s); });
  fs.renameSync(tmpFile, dbFile);
  return Object.assign({ restored: true, previous: fs.existsSync(aside) ? aside : null }, check);
}

module.exports = { createBackup, rotate, planRotation, restore, unpack, inspect, encrypt, decrypt, parseName, retentionDays };
