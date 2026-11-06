"use strict";
/*
 * 로컬 테스트 서버 — 명령 하나로 바로 써 볼 수 있게.
 *
 *   npm run local                       예시 데이터가 든 로컬 서버 (data/local.db)
 *   npm run local -- --scenario lunch   점심시간 화면으로
 *   npm run local -- --at "2026-11-10 19:30"   원하는 날짜 · 시각으로 (시계는 그때부터 흘러감)
 *   npm run local:reset                 로컬 데이터를 지우고 새로 시작
 *
 * 실제 운영 데이터(data/wdental.db)와 .env 는 건드리지 않습니다.
 * 문자 · 알림 웹훅은 꺼져 있어 실제로 발송되지 않습니다(관리 → 발송 기록에만 남음).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const core = require("../public/js/core.js");
const { openDb, getSetting, setSetting } = require("../server/db");
const { ensureAdmin } = require("../server/auth");
const { createApp } = require("../server/app");

const ROOT = path.join(__dirname, "..");
const ADMIN_PASSWORD = "local1234";

/* ---------- 옵션 ---------- */
const SCENARIOS = {
  open:     { day: 3, time: "10:40", label: "평일 오전 · 접수 중" },
  lunch:    { day: 3, time: "13:20", label: "평일 점심시간" },
  evening:  { day: 3, time: "17:50", label: "평일 저녁 · 마감 40분 전" },
  night:    { day: 2, time: "19:30", label: "화요일 야간 진료" },
  closed:   { day: 3, time: "19:30", label: "평일 진료 종료 후" },
  before:   { day: 3, time: "08:50", label: "평일 진료 시작 전" },
  saturday: { day: 6, time: "11:00", label: "토요일 오전" },
  sunday:   { day: 0, time: "11:00", label: "일요일 휴진" }
};
function parseArgs(argv) {
  const o = { port: Number(process.env.PORT || 3000), reset: false, empty: false, at: null, scenario: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--reset") o.reset = true;
    else if (a === "--empty") o.empty = true;
    else if (a === "--port" || a === "-p") o.port = Number(next());
    else if (a === "--at") o.at = next();
    else if (a === "--scenario" || a === "-s") o.scenario = next();
    else if (a === "--help" || a === "-h") o.help = true;
    else if (SCENARIOS[a]) o.scenario = a; // npm run local -- lunch
    else { console.error("알 수 없는 옵션: " + a + "  (--help 로 사용법 보기)"); process.exit(1); }
  }
  return o;
}
const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log([
    "사용법: npm run local -- [옵션]",
    "",
    "  --scenario <이름>   시각을 미리 정해 둔 상황으로 (아래 목록)",
    "  --at \"YYYY-MM-DD HH:MM\" | \"HH:MM\"   원하는 날짜 · 시각으로 (서울 시각)",
    "  --reset             로컬 데이터 지우고 예시 데이터로 새로 시작",
    "  --empty             예시 예약 · 상담 요청 없이 시작",
    "  --port <번호>       기본 3000",
    "",
    "상황 목록:",
    ...Object.keys(SCENARIOS).map((k) => "  " + k.padEnd(9) + " " + SCENARIOS[k].label + " (" + core.WEEKDAYS[SCENARIOS[k].day] + " " + SCENARIOS[k].time + ")")
  ].join("\n"));
  process.exit(0);
}

/* ---------- 시계: 정한 시각에서 출발해 실제처럼 흘러감 ---------- */
// 서울은 일광절약시간이 없으므로 UTC+9 고정
function seoulToMs(ds, hhmm) {
  const [y, m, d] = ds.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h - 9, mi);
}
function targetMs() {
  const today = core.seoulNow().date;
  if (opts.scenario) {
    const s = SCENARIOS[opts.scenario];
    if (!s) { console.error("없는 상황입니다: " + opts.scenario + "  (--help 로 목록 보기)"); process.exit(1); }
    let ds = today; while (core.weekdayOf(ds) !== s.day) ds = core.addDays(ds, 1);
    return seoulToMs(ds, s.time);
  }
  if (opts.at) {
    const m = String(opts.at).trim().match(/^(?:(\d{4}-\d{2}-\d{2})[ T])?(\d{1,2}:\d{2})$/);
    const hm = m && m[2].split(":").map(Number);
    if (!m || hm[0] > 23 || hm[1] > 59 || (m[1] && !core.isDate(m[1]))) { console.error("--at 형식: \"2026-11-10 19:30\" 또는 \"19:30\""); process.exit(1); }
    return seoulToMs(m[1] || today, m[2].padStart(5, "0"));
  }
  return null;
}
const target = targetMs();
const offset = target === null ? 0 : target - Date.now();
const clock = () => core.seoulNow(new Date(Date.now() + offset));

/* ---------- DB ---------- */
const DB_FILE = path.join(ROOT, "data", "local.db");
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
if (opts.reset) for (const f of [DB_FILE, DB_FILE + "-wal", DB_FILE + "-shm"]) fs.rmSync(f, { force: true });
const fresh = !fs.existsSync(DB_FILE);
const db = openDb(DB_FILE);
ensureAdmin(db, { ADMIN_PASSWORD }, () => {});

const env = { RESERVE_LIMIT_PER_HOUR: "1000", INQUIRY_LIMIT_PER_HOUR: "1000" }; // 웹훅 · Secure 쿠키 없음
const app = createApp({ db, env, now: clock });

/* ---------- 예시 데이터 (처음 만들 때 한 번) ---------- */
function call(port, method, url, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port, method, path: url, headers: Object.assign(
      { "X-Requested-With": "W-Admin", Origin: "http://127.0.0.1:" + port },
      data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {},
      cookie ? { Cookie: cookie } : {}) }, (res) => {
      let t = ""; res.setEncoding("utf8"); res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* 본문 없음 */ }
        resolve({ status: res.statusCode, json: j, cookie: (res.headers["set-cookie"] || [])[0] }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
const NAMES = ["김순자", "이영호", "박정희", "최민수", "정미경", "강동원", "윤서연", "임재현", "한지민", "오세훈", "서은영", "신동철"];
const MEMOS = ["", "", "틀니가 불편해요", "아래 어금니가 시려요", "", "보호자 동행", "", "스케일링 원해요"];
async function seed(port) {
  const login = await call(port, "POST", "/api/admin/login", { username: "admin", password: ADMIN_PASSWORD });
  const ck = login.cookie && login.cookie.split(";")[0];
  if (!ck) throw new Error("관리자 로그인 실패");
  const now = clock();
  let n = 0, k = 0;
  // 오늘부터 6일: 예약 가능한 시간 중 일부를 채움(오늘은 지난 시간도 내원/미내원으로)
  for (let d = 0; d < 7; d++) {
    const ds = core.addDays(now.date, d);
    const sl = await call(port, "GET", "/api/slots?date=" + ds);
    let times = (sl.json && sl.json.slots || []).map((s) => s.time);
    if (d === 0) {
      const plan = core.dayPlan(ds, db.prepare("SELECT * FROM hours").all(), {});
      const past = [];
      if (!plan.closed) for (let t = plan.open; t < now.minutes && t < plan.close; t += 30)
        if (plan.lunchStart === null || t < plan.lunchStart || t >= plan.lunchEnd) past.push(core.toHHMM(t));
      times = past.concat(times);
    }
    times = times.filter((_, i) => i % 2 === 0).slice(0, d === 0 ? 10 : 6);
    for (const time of times) {
      const past = d === 0 && core.toMin(time) < now.minutes;
      const status = past ? (k % 5 === 4 ? "no_show" : "visited") : (k % 4 === 0 ? "requested" : "confirmed");
      const t = core.TREATMENTS[k % core.TREATMENTS.length].key;
      const body = { name: NAMES[k % NAMES.length], phone: "010-" + String(1000 + k * 37).slice(-4) + "-" + String(5000 + k * 91).slice(-4), treatment: t, date: ds, time, memo: MEMOS[k % MEMOS.length], status, notify: false };
      const r = await call(port, "POST", "/api/admin/reservations", body, ck);
      if (r.status === 201) n++;
      // 새로 만들 때는 확인 대기 · 확정만 되므로, 지난 시간은 내원 · 미내원으로 바꿔 둠
      if (r.status === 201 && past) await call(port, "PATCH", "/api/admin/reservations/" + r.json.item.id, { status, notify: false }, ck);
      k++;
    }
  }
  // 센터 데스크: 담당자 · 대기 · 인사말
  await call(port, "PUT", "/api/admin/centers/implant/desk", { paused: false, wait: 10, staff: "김예시 실장", message: "" }, ck);
  await call(port, "PUT", "/api/admin/centers/ortho/desk", { paused: false, wait: null, staff: "이예시 코디", message: "" }, ck);
  await call(port, "PUT", "/api/admin/centers/kids/desk", { paused: false, wait: 20, staff: "박예시 팀장", message: "안녕하세요, 소아치과센터입니다. 오늘은 아이들 첫 검진 예약에 여유가 있어요." }, ck);
  await call(port, "PUT", "/api/admin/live", { wait: 15, message: "오늘 오후 임플란트 상담 자리가 남아 있습니다." }, ck);
  // 상담 요청(전화 상담) 몇 건: 새 요청 · 확인함
  const inq = [
    { center: "implant", name: "조예시", phone: "010-2222-3333", topic: "cost", prefer: "am", message: "임플란트 두 개 비용이 궁금해요" },
    { center: "ortho", name: "문예시", phone: "010-4444-5555", topic: "first", prefer: "pm", message: "" },
    { center: "kids", name: "백예시", phone: "010-6666-7777", topic: "schedule", prefer: "asap", message: "아이가 무서워해요" }
  ];
  let q = 0;
  for (const b of inq) {
    const r = await call(port, "POST", "/api/inquiries", Object.assign({ consent: true }, b));
    if (r.status === 201) q++;
  }
  await call(port, "POST", "/api/admin/logout", null, ck);
  return { reservations: n, inquiries: q };
}

/* ---------- 실행 ---------- */
function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || [])
    if (a.family === "IPv4" && !a.internal) out.push("http://" + a.address + ":" + port);
  return out;
}
const server = http.createServer(app.handler);
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error("\n" + opts.port + "번 포트를 이미 쓰고 있습니다. 다른 번호로: npm run local -- --port " + (opts.port + 1) + "\n");
  else console.error(e);
  process.exit(1);
});
server.listen(opts.port, async () => {
  let seeded = null;
  const hasData = db.prepare("SELECT COUNT(*) AS n FROM reservations").get().n > 0;
  if (fresh && !opts.empty && !hasData) {
    try { seeded = await seed(opts.port); } catch (e) { console.error("예시 데이터를 넣지 못했습니다:", e.message); }
    // 이 DB에 예시 데이터가 들어갔다는 표시 — 실수로 운영에 쓰면 오픈 전 점검(preflight)이 막음
    if (seeded) setSetting(db, "ops", Object.assign({}, getSetting(db, "ops"), { localSample: true }));
  }
  const now = clock(), st = core.openStatus(db.prepare("SELECT * FROM hours").all(), {}, now);
  const home = "http://localhost:" + opts.port;
  const lines = [
    "",
    "  W치과 로컬 테스트 서버",
    "  ────────────────────────────────────────────",
    "  홈페이지      " + home,
    "  관리 화면     " + home + "/admin/   (아이디 admin / 비밀번호 " + ADMIN_PASSWORD + ")",
    "  센터 데스크   " + home + "/#center-implant",
    ...lanUrls(opts.port).slice(0, 2).map((u) => "  휴대폰에서    " + u + "   (같은 와이파이)"),
    "",
    "  병원 시각     " + core.formatDate(now.date) + " " + core.koTime(core.toHHMM(now.minutes)) +
      (offset ? "  ← 시간 이동 중" + (opts.scenario ? " (" + SCENARIOS[opts.scenario].label + ")" : "") : "  (실제 시각)") + " · " + st.text,
    "  데이터        data/local.db" + (seeded ? "  (예시 예약 " + seeded.reservations + "건 · 상담 요청 " + seeded.inquiries + "건 넣음)" : fresh ? "  (빈 상태)" : "  (이전 데이터 이어서)"),
    "  문자 · 알림   실제 발송 없음 (관리 → 발송 기록에서 확인)",
    "",
    "  다른 상황 보기: npm run local -- lunch | evening | night | closed | before | saturday | sunday",
    "  처음부터 다시: npm run local:reset      도움말: npm run local -- --help",
    "  끝내기: Ctrl + C",
    ""
  ];
  console.log(lines.join("\n"));
});
function shutdown() { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 2000).unref(); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
