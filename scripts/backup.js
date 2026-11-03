"use strict";
/* 운영 중에도 안전하게 DB 사본을 만듭니다.  npm run backup  →  backups/wdental-YYYYMMDD-HHMM.db */
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const dbFile = process.env.DB_FILE || path.join(__dirname, "..", "data", "wdental.db");
const dir = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
const target = path.join(dir, "wdental-" + stamp + ".db");
const db = new DatabaseSync(dbFile);
db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'");
db.close();
console.log("백업 완료:", target);
