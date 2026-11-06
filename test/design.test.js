"use strict";
// 선명한 레이아웃 규칙(design/brand-book.md)을 숫자로 지킨다: 면 대비 사다리 · 가장자리 · 글자 대비 · 글자 위계 · CSS와 토큰 일치
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const tokens = JSON.parse(fs.readFileSync(path.join(root, "design", "tokens.json"), "utf8"));
const css = fs.readFileSync(path.join(root, "public", "css", "site.css"), "utf8");
const color = Object.fromEntries(tokens.color.tokens.map((t) => [t.name, t.value]));
const THEMES = ["light", "dark"];
const SLABS = ["slab-2", "slab-3", "slab-4", "slab-5"];

function lum(hex) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const c = (name, theme) => { const v = color[name] && color[name][theme]; assert.ok(/^#[0-9A-Fa-f]{6}$/.test(v || ""), name + " (" + theme + ") 값 없음"); return v; };

test("layers: every adjacent surface steps by 1.15:1 or more (floor → slab → card → tray)", () => {
  THEMES.forEach((th) => SLABS.forEach((s) => {
    assert.ok(ratio(c("enamel", th), c(s, th)) >= 1.15, th + " 바탕↔" + s);
    assert.ok(ratio(c(s, th), c("card", th)) >= 1.15, th + " " + s + "↔카드");
  }));
});

test("edges: slabs and cards have a visible 1px edge (1.5:1 or more)", () => {
  THEMES.forEach((th) => {
    SLABS.forEach((s) => {
      assert.ok(ratio(c(s + "-edge", th), c("enamel", th)) >= 1.5, th + " " + s + "-edge↔바탕");
      assert.ok(ratio(c("card-line", th), c(s, th)) >= 1.5, th + " card-line↔" + s);
    });
    assert.ok(ratio(c("card-line", th), c("card", th)) >= 1.5, th + " card-line↔카드");
    assert.ok(ratio(c("line-strong", th), c("enamel-raised", th)) >= 3, th + " 누르는 것의 테두리 3:1");
  });
});

test("text stays 4.5:1 on every slab and card in both themes", () => {
  THEMES.forEach((th) => [...SLABS, "card"].forEach((s) => ["ink", "ink-muted", "teal"].forEach((fg) => {
    const r = ratio(c(fg, th), c(s, th));
    assert.ok(r >= 4.5, th + " " + fg + " on " + s + " = " + r.toFixed(2));
  })));
});

test("type ladder never inverts: display > title > heading > subheading > body", () => {
  const styles = Object.fromEntries(tokens.type.groups.flatMap((g) => g.styles).map((s) => [s.name, s]));
  const order = ["display", "title", "heading", "subheading", "body"];
  const px = (s, k) => parseFloat((s[k] || s.fontSize));
  for (let i = 0; i < order.length - 1; i++) {
    const a = styles[order[i]], b = styles[order[i + 1]];
    assert.ok(a && b, order[i] + "/" + order[i + 1] + " 없음");
    const min = i < 3 ? 1.25 : 1.1;
    assert.ok(px(a, "fontSize") / px(b, "fontSize") >= min, "넓은 화면 " + order[i] + " > " + order[i + 1]);
    assert.ok(px(a, "fontSizeMobile") / px(b, "fontSizeMobile") >= (i < 3 ? 1.15 : 1.05), "휴대폰 " + order[i] + " > " + order[i + 1]);
  }
});

test("site.css uses the same layer colors as design/tokens.json", () => {
  const darkBlock = css.slice(css.indexOf(":root[data-theme=\"dark\"]"));
  ["card", "card-line", ...SLABS, ...SLABS.map((s) => s + "-edge")].forEach((name) => {
    assert.ok(css.includes("--" + name + ": " + c(name, "light")), "밝은 화면 --" + name + " 가 토큰과 다름");
    assert.ok(darkBlock.includes("--" + name + ": " + c(name, "dark")), "어두운 화면 --" + name + " 가 토큰과 다름");
  });
});
