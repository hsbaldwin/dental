"use strict";
const http = require("node:http");
const path = require("node:path");
const { openDb } = require("./db");
const { ensureAdmin } = require("./auth");
const { createApp } = require("./app");

const env = process.env;
const PORT = Number(env.PORT || 3000);
const DB_FILE = env.DB_FILE || path.join(__dirname, "..", "data", "wdental.db");

const db = openDb(DB_FILE);
ensureAdmin(db, env, console.log);
const app = createApp({ db, env });

function jobs() {
  try {
    const r = app.runJobs();
    if (r.purged || r.reminded) console.log("[W치과] 정기 작업:", JSON.stringify(r));
  } catch (e) { console.error("[W치과] 정기 작업 실패", e); }
}
jobs();
const timer = setInterval(jobs, 10 * 60 * 1000);

const server = http.createServer(app.handler);
server.listen(PORT, () => console.log("[W치과] http://localhost:" + PORT + "  (관리자: /admin/)"));

function shutdown() {
  clearInterval(timer);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
