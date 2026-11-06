"use strict";
/*
 * 오픈 전 · 배포 전 점검
 *   npm run preflight              기본 점검(스테이징 · 개발): 꼭 필요한 것만 막고 나머지는 알림
 *   npm run preflight -- --strict  운영 기준(오픈 · 운영 배포): 예시 값 · 빈 설정 · 임시 비밀번호 · 초안 방침 · 오래된 백업이 있으면 실패
 * 운영 서버에서는 deploy/deploy.sh가 배포 전에 자동으로 실행합니다.
 */
const path = require("node:path");
const { openDb } = require("../server/db");
const { runPreflight, format } = require("../server/preflight");

const strict = process.argv.includes("--strict");
const dbFile = process.env.DB_FILE || path.join(__dirname, "..", "data", "wdental.db");
const db = openDb(dbFile);
try {
  const r = format(runPreflight({ db, env: process.env, publicDir: path.join(__dirname, "..", "public"), strict }), strict);
  console.log(r.text);
  process.exitCode = r.fails ? 1 : 0;
} finally { db.close(); }
