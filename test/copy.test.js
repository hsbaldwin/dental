"use strict";
// 문구 규칙(design/brand-book.md '문구와 조판')을 환자 화면 원본에서 확인한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pub = path.join(__dirname, "..", "public");
const read = (f) => fs.readFileSync(path.join(pub, f), "utf8");
// 환자에게 보이는 글: index.html의 태그 밖 글자 + 환자 화면 스크립트의 문자열
function htmlText(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
}
function jsStrings(src) { return (src.match(/"(?:[^"\\\n]|\\.)*"/g) || []).map((s) => s.slice(1, -1)).filter((s) => /[가-힣]/.test(s)); }
const PAGE = htmlText(read("index.html"));
const SCRIPTS = ["js/site.js", "js/chat.js", "js/easybook.js", "js/core.js", "js/seed.js"];
const ALL = [...PAGE.map((t) => ["index.html", t]), ...SCRIPTS.flatMap((f) => jsStrings(read(f)).map((t) => [f, t]))];
const hits = (re) => ALL.filter(([, t]) => re.test(t)).map(([f, t]) => f + ": " + t.slice(0, 60));

test("auxiliary verbs are spaced: 알려 드립니다 · 보내 드려요 · 알려 주세요 (명사 + 드리다는 붙임: 전화드릴게요)", () => {
  assert.deepEqual(hits(/[가-힣](려|여|겨|내)(드(립|릴|려|리)|주(세요|시|신|셔))|[가-힣]와드(립|릴|려|리)|해(드(립|릴|려|리)|주(세요|시면|신))/), []);
});

test("one spelling per term: 진료 시간 (띄어 씀), 검진·상담 · 충치·신경치료 · 심미·미백 (낱말 나열은 붙인 가운뎃점)", () => {
  assert.deepEqual(hits(/진료시간(?!표)/), []);
  assert.deepEqual(hits(/(검진|충치|심미) · (상담|신경치료|미백)/), []);
});

test("page text uses 합니다체; 해요체 is for chat and desk bubbles only", () => {
  // 버튼 · 예시(마침표 없음)는 사용자 말투라 그대로 둔다
  assert.deepEqual(PAGE.filter((t) => /[가-힣](어요|아요|예요|에요|해요|워요|봐요|드려요)\./.test(t)), []);
});

test("times on the page are written 오전·오후, never 24-hour", () => {
  assert.deepEqual(PAGE.filter((t) => /(^|[^\d])([01]\d|2[0-3]):[0-5]\d/.test(t)), []);
});
