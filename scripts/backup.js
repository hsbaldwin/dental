"use strict";
/*
 * 운영 중에도 안전한 DB 사본을 만듭니다.
 *   npm run backup                         → $BACKUP_DIR/wdental-YYYYMMDD-HHMM.db(.enc)
 *   node scripts/backup.js --tag pre-deploy-v1.2.0   배포 전 사본(따로 최근 10개 보관)
 *   node scripts/backup.js --no-rotate     오래된 사본 정리를 건너뜀
 * BACKUP_KEY가 있으면 AES-256-GCM으로 암호화합니다(운영에서는 필수). 키는 서버 밖에도 따로 보관하세요.
 * 사본 보관: 48시간 안은 모두 · 14일은 하루 1개 · 8주는 한 주 1개 · 개인정보 보관 기간(기본 180일)을 넘는 사본은 삭제.
 */
const path = require("node:path");
const { createBackup, rotate, retentionDays } = require("../server/backup");

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dbFile = process.env.DB_FILE || path.join(__dirname, "..", "data", "wdental.db");
const dir = process.env.BACKUP_DIR || path.join(path.dirname(dbFile), "backups");

try {
  const info = createBackup({ dbFile, dir, key: process.env.BACKUP_KEY || "", tag: opt("--tag") });
  console.log("백업 완료:", info.file, "(" + Math.round(info.bytes / 1024) + "KB" + (info.encrypted ? ", 암호화" : ", 암호화 안 함 — 운영에서는 BACKUP_KEY를 지정하세요") + ")");
  console.log("  건수:", Object.entries(info.counts).filter(([t]) => ["reservations", "inquiries", "audit", "users"].includes(t)).map(([t, n]) => t + " " + n).join(" · "));
  if (!args.includes("--no-rotate")) {
    const dropped = rotate(dir, Date.now(), retentionDays(dbFile));
    if (dropped.length) console.log("오래된 사본 " + dropped.length + "개 정리:", dropped.map((f) => path.basename(f)).join(", "));
  }
} catch (e) {
  console.error("백업 실패:", e.message);
  process.exit(1);
}
