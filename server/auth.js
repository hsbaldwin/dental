"use strict";
const crypto = require("node:crypto");
const { nowIso } = require("./db");

const SESSION_HOURS = 12;
const COOKIE = "wsid";

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return "scrypt$" + salt.toString("base64") + "$" + hash.toString("base64");
}
function verifyPassword(pw, stored) {
  const [alg, saltB64, hashB64] = String(stored || "").split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltB64, "base64"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

function ensureAdmin(db, env, log) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (n) return null;
  const password = env.ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  db.prepare("INSERT INTO users (username, name, role, pw, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("admin", "관리자", "admin", hashPassword(password), nowIso());
  if (!env.ADMIN_PASSWORD) log("[W치과] 관리자 계정을 만들었습니다. 아이디: admin / 임시 비밀번호: " + password + " (로그인 후 바로 변경하세요)");
  return password;
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sha(token), userId, Date.now() + SESSION_HOURS * 3600 * 1000);
  return token;
}
function destroySession(db, token) { if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(sha(token)); }

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function sessionToken(req) { return parseCookies(req)[COOKIE] || null; }

function currentUser(db, req) {
  const token = sessionToken(req);
  if (!token) return null;
  const row = db.prepare(
    "SELECT u.id, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?"
  ).get(sha(token), Date.now());
  return row || null;
}

function sessionCookie(token, secure) {
  const parts = [COOKIE + "=" + (token || ""), "Path=/", "HttpOnly", "SameSite=Strict"];
  parts.push(token ? "Max-Age=" + SESSION_HOURS * 3600 : "Max-Age=0");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

module.exports = { hashPassword, verifyPassword, ensureAdmin, createSession, destroySession, currentUser, sessionToken, sessionCookie };
