"use strict";
/*
 * 서버 없이 브라우저만으로 동작하는 체험판을 dist/demo 에 만듭니다.
 *   node scripts/build-demo.js
 * public/ 을 복사한 뒤 demo-backend.js(가짜 API)를 끼워 넣습니다. 실제 운영에는 쓰지 마세요.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = path.join(root, "public");
const out = path.join(root, "dist", "demo");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

function patch(file, fn) {
  const p = path.join(out, file);
  fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
}
const must = (s, find, repl) => {
  if (!s.includes(find)) throw new Error("build-demo: '" + find + "' not found");
  return s.replace(find, repl);
};

patch("index.html", (s) => {
  s = must(s, '<script src="js/core.js"></script>', '<script src="js/core.js"></script>\n<script src="js/demo-backend.js"></script>');
  s = must(s, '<a href="admin/">직원 로그인</a>', '<a href="admin/index.html">직원 로그인 (체험)</a>');
  return s;
});
patch("privacy.html", (s) => must(s, '<script src="js/privacy.js"></script>', '<script src="js/core.js"></script>\n<script src="js/demo-backend.js"></script>\n<script src="js/privacy.js"></script>'));
patch("admin/index.html", (s) => {
  s = must(s, '<script src="../js/core.js"></script>', '<script src="../js/core.js"></script>\n<script src="../js/demo-backend.js"></script>');
  s = must(s, '<p class="muted">직원 계정으로 로그인하세요.</p>', '<p class="muted">체험판 계정: 아이디 <b>admin</b> / 비밀번호 <b>demo1234</b></p>');
  s = must(s, "</head>", '<style>a[href*="reservations.csv"]{display:none}</style>\n</head>');
  return s;
});

// Artifact 게시용: 첫 페이지는 문서 골격(doctype/html/head/body) 없이 내용만 필요
const page = fs.readFileSync(path.join(out, "index.html"), "utf8")
  .split("\n")
  .filter((l) => !/^(<!doctype html>|<html lang="ko">|<head>|<\/head>|<body>|<\/body>|<\/html>|<meta charset|<meta name="viewport")/.test(l.trim()))
  .join("\n");
fs.writeFileSync(path.join(out, "artifact-page.html"), page.replace("<title>W치과</title>", "<title>W치과 웹사이트 시안</title>"));
console.log("체험판을 만들었습니다:", path.relative(root, out));
