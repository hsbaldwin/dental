"use strict";
/*
 * 백업에서 되살리기
 *   npm run restore -- <백업 파일>            서버를 멈춘 뒤 실행. 현재 DB는 *.before-restore-<시각>으로 옮겨 둡니다.
 *   npm run restore -- <백업 파일> --verify   현재 DB는 건드리지 않고 풀어서 검사만(분기 복구 연습)
 *   --force                                  서버가 켜져 있어도 진행(권장하지 않음)
 * 암호화된 백업(.enc)은 BACKUP_KEY가 필요합니다.
 * Docker:  docker compose stop app && docker compose run --rm app node scripts/restore.js /data/backups/<파일> && docker compose start app
 */
const path = require("node:path");
const { restore } = require("../server/backup");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const dbFile = process.env.DB_FILE || path.join(__dirname, "..", "data", "wdental.db");
const port = Number(process.env.PORT || 3000);

async function serverRunning() {
  try { const r = await fetch("http://127.0.0.1:" + port + "/api/health", { signal: AbortSignal.timeout(1000) }); return r.ok || r.status === 503; }
  catch (e) { return false; }
}

(async () => {
  if (!file) { console.error("사용법: npm run restore -- <백업 파일> [--verify] [--force]"); process.exit(2); }
  const verifyOnly = args.includes("--verify");
  if (!verifyOnly && !args.includes("--force") && await serverRunning()) {
    console.error("서버가 켜져 있습니다(포트 " + port + "). 먼저 서버를 멈추세요. (Docker: docker compose stop app)");
    process.exit(1);
  }
  try {
    const r = restore({ file: path.resolve(file), key: process.env.BACKUP_KEY || "", dbFile, verifyOnly });
    console.log(verifyOnly ? "검사 통과(현재 DB는 그대로):" : "복구 완료:", path.basename(file), "· 스키마 v" + r.version);
    console.log("  건수:", Object.entries(r.counts).map(([t, n]) => t + " " + n).join(" · "));
    if (r.previous) console.log("  이전 DB:", r.previous, "(확인 후 지워도 됩니다)");
  } catch (e) {
    console.error("복구 실패:", e.message);
    process.exit(1);
  }
})();
