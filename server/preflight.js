"use strict";
/*
 * 오픈 전 · 배포 전 점검 (scripts/preflight.js)
 *  - basic : 언제든 통과해야 하는 것(스키마, 쓰기 가능, 안전한 쿠키 설정)만 막고 나머지는 알림
 *  - strict: 운영 오픈 · 운영 배포. 아래 '막음' 항목이 하나라도 남으면 실패
 * 결과는 [{ level: "ok" | "fail" | "warn", title, detail }] — 한국어 목록으로 출력.
 */
const fs = require("node:fs");
const path = require("node:path");
const core = require("../public/js/core.js");
const { getSetting, DEFAULT_CLINIC, SAMPLE_FEES, SAMPLE_DOCTOR_NAME, SCHEMA_VERSION } = require("./db");

const PLACEHOLDER = /O{2,}|000-0000|000-00-00000/;

function runPreflight({ db, env, publicDir, strict, now }) {
  const out = [];
  const t = now || Date.now();
  // always: basic에서도 막음 / block: strict에서 막음, basic에선 알림 / warn: 늘 알림만
  const check = (kind, pass, title, detail) => out.push({ kind, level: pass ? "ok" : (kind === "always" || (kind === "block" && strict)) ? "fail" : "warn", title, detail: pass ? "" : detail });

  /* 1) 스키마 · 저장소 */
  const ver = db.prepare("PRAGMA user_version").get().user_version;
  check("always", ver === SCHEMA_VERSION, "DB 스키마 v" + SCHEMA_VERSION, "지금 v" + ver + ". 앱을 한 번 실행해 마이그레이션을 적용하세요.");
  let writable = true;
  try { db.exec("BEGIN IMMEDIATE"); db.exec("ROLLBACK"); } catch (e) { writable = false; }
  check("always", writable, "DB에 쓸 수 있음", "DB 파일이나 폴더 권한을 확인하세요.");

  /* 2) 환경 설정 */
  check("block", env.COOKIE_SECURE === "1", "로그인 쿠키 Secure(HTTPS 전용)", "운영에서는 COOKIE_SECURE=1");
  check("block", env.TRUST_PROXY === "1", "HTTPS 프록시(Caddy) 뒤에서 실행", "Caddy 뒤라면 TRUST_PROXY=1 — 그래야 접속기록에 실제 접속지(IP)가 남습니다.");
  check("block", !!env.NOTIFY_WEBHOOK_URL, "직원 알림 웹훅", "NOTIFY_WEBHOOK_URL이 비어 있어 새 예약 · 운영 알림이 직원에게 가지 않습니다.");
  check("block", !!env.SMS_WEBHOOK_URL, "환자 문자 연동", "SMS_WEBHOOK_URL이 비어 있어 접수 · 확정 · 전날 안내 문자가 나가지 않습니다.");
  check("block", String(env.BACKUP_KEY || "").length >= 16, "백업 암호화 키(16자 이상)", "BACKUP_KEY가 없거나 짧습니다. 백업에는 개인정보가 들어 있습니다.");
  check("warn", !!env.HEALTH_TOKEN, "상태 확인 토큰", "HEALTH_TOKEN이 있으면 외부 감시에서 백업 · 문자 상태까지 볼 수 있습니다.");
  check("warn", !env.ADMIN_PASSWORD, "첫 관리자 비밀번호를 설정 파일에서 뺐음", "첫 실행 뒤에는 ADMIN_PASSWORD를 .env에서 지우세요.");

  /* 3) 병원 내용 */
  const clinic = getSetting(db, "clinic");
  const leftover = ["name", "address", "phone", "director", "bizNo", "subway"].filter((k) => PLACEHOLDER.test(String(clinic[k] || "")) || clinic[k] === DEFAULT_CLINIC[k] && k !== "name" && k !== "shortName");
  check("block", !leftover.length, "병원 정보 입력", "예시 값이 남아 있습니다: " + leftover.join(", ") + " (관리 화면 → 병원 정보)");
  const docs = db.prepare("SELECT COUNT(*) AS n FROM doctors WHERE name = ?").get(SAMPLE_DOCTOR_NAME).n;
  check("block", !docs, "의료진 성함", "'" + SAMPLE_DOCTOR_NAME + "' " + docs + "명이 남아 있습니다 (관리 화면 → 의료진)");
  const fees = db.prepare("SELECT name, price FROM fees ORDER BY sort, id").all();
  const sameAsSample = fees.length === SAMPLE_FEES.length && fees.every((f, i) => f.name === SAMPLE_FEES[i][0] && f.price === SAMPLE_FEES[i][2]);
  check("block", !sameAsSample, "비급여 진료비 실제 금액", "처음 설치 때의 예시 금액 그대로입니다 (관리 화면 → 진료비). 비급여 고지 금액은 실제와 같아야 합니다.");
  const today = core.seoulNow().date;
  const upcoming = db.prepare("SELECT COUNT(*) AS n FROM holidays WHERE date >= ?").get(today).n;
  const soon = db.prepare("SELECT COUNT(*) AS n FROM holidays WHERE date BETWEEN ? AND ?").get(today, core.addDays(today, 60)).n;
  check("block", upcoming > 0, "앞으로의 휴진일 등록", "오늘 뒤로 등록된 휴진일이 없습니다 (관리 화면 → 진료시간 · 휴진일)");
  check("warn", soon > 0, "앞으로 60일 휴진일", "60일 안에 휴진일이 없습니다. 공휴일을 확인하세요.");
  const ops = getSetting(db, "ops");
  check("block", !ops.localSample, "예시 데이터 없음", "이 DB는 로컬 테스트용 예시 데이터로 만들어졌습니다. 운영에는 새 DB로 시작하세요.");

  /* 4) 계정 */
  const users = db.prepare("SELECT username, pw_changed_at FROM users ORDER BY id").all();
  const temp = users.filter((u) => !u.pw_changed_at).map((u) => u.username);
  check("block", !temp.length, "처음 받은 비밀번호 바꿈", "아직 바꾸지 않은 계정: " + temp.join(", "));
  check("warn", users.some((u) => u.username !== "admin"), "직원 1인 1계정", "admin 계정만 있습니다. 직원마다 계정을 만들어 주세요(접속기록에 누가 했는지 남도록).");

  /* 5) 개인정보처리방침 */
  const privacy = fs.readFileSync(path.join(publicDir, "privacy.html"), "utf8");
  check("block", !/data-draft/.test(privacy), "개인정보처리방침 법률 검토", "public/privacy.html에 초안 표시(data-draft)가 있습니다. 검토를 마친 뒤 표시를 지우세요.");
  const blanks = (privacy.match(/<mark data-fill>([^<]*)<\/mark>/g) || []).map((m) => m.replace(/<[^>]+>/g, ""));
  check("block", !blanks.length, "개인정보처리방침 빈칸", "채울 칸이 남아 있습니다: " + blanks.join(", ") + " (public/privacy.html의 <mark data-fill>)");

  /* 6) 백업 */
  const age = ops.lastBackup ? (t - Date.parse(ops.lastBackup)) / 3600000 : null;
  check("block", age !== null && age <= 26, "최근 백업(26시간 안)", age === null ? "백업 기록이 없습니다. npm run backup으로 한 번 만들고 복구 연습(restore --verify)까지 해 보세요." : Math.round(age) + "시간 전이 마지막입니다.");
  return out;
}

function format(results, strict) {
  const mark = { ok: "✓", fail: "✗", warn: "△" };
  const lines = results.map((r) => mark[r.level] + " " + r.title + (r.detail ? " — " + r.detail : ""));
  const fails = results.filter((r) => r.level === "fail").length, warns = results.filter((r) => r.level === "warn").length;
  lines.push("", (strict ? "[운영 기준] " : "[기본 점검] ") + (fails ? "막힘 " + fails + "건" : "통과") + (warns ? " · 확인 " + warns + "건" : ""));
  return { text: lines.join("\n"), fails, warns };
}

module.exports = { runPreflight, format };
