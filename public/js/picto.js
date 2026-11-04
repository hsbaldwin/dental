/*
 * 그림 안내 — 글자를 그림으로 '바꾸지' 않고, 글자 옆에 그림을 '붙인다'.
 *  - icon(id): 증상 그림(언제나 글자 이름과 함께 씀)
 *  - toothMap(): 거울을 볼 때처럼 보이는 입 그림에서 아픈 곳을 눌러 고르기(여러 곳 가능)
 *  - 비교 시험용: 주소에 ?picto=0 을 붙이면 그림 없이 글자만(이 탭에서 유지), ?picto=1 로 되돌림
 * 그림은 모두 장식(aria-hidden)이고, 뜻은 버튼 글자와 aria-label 이 전한다.
 */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var root = document.documentElement;

  // 비교 시험(그림 있음 / 글자만)
  try {
    var q = new URLSearchParams(location.search).get("picto");
    if (q === "0") sessionStorage.setItem("w-picto", "off");
    if (q === "1") sessionStorage.removeItem("w-picto");
    if (sessionStorage.getItem("w-picto") === "off") root.classList.add("no-picto");
  } catch (e) { /* 저장소를 못 써도 그림은 그대로 */ }

  function svg(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  }
  function icon(id, cls) {
    var s = svg("svg", { class: "picto" + (cls ? " " + cls : ""), viewBox: "0 0 32 32", "aria-hidden": "true", focusable: "false", "data-p": id });
    s.appendChild(svg("use", { href: "#p-" + id }));
    return s;
  }

  /* ---------- 아픈 곳 짚기 ---------- */
  // 화면 오른쪽 = 내 오른쪽 (거울을 볼 때처럼)
  var ROWS = [{ key: "u", name: "윗니" }, { key: "d", name: "아랫니" }];
  var COLS = [{ key: "l", name: "왼쪽 어금니", short: "왼쪽" }, { key: "f", name: "앞니", short: "앞니" }, { key: "r", name: "오른쪽 어금니", short: "오른쪽" }];
  function zoneName(z) {
    var r = ROWS.filter(function (x) { return x.key === z[0]; })[0], c = COLS.filter(function (x) { return x.key === z[1]; })[0];
    return r && c ? r.name + " " + c.name : "";
  }
  function describe(list) {
    if (!list || !list.length) return "";
    if (list.indexOf("?") >= 0) return "어딘지 잘 모름";
    return list.map(zoneName).filter(Boolean).join(", ");
  }
  // 한 구역의 치아 그림: 어금니 3개(넓게) 또는 앞니 4개(좁게), 잇몸 띠는 윗니는 위 · 아랫니는 아래
  function teeth(row, col) {
    var s = svg("svg", { class: "tm-teeth", viewBox: "0 0 60 30", "aria-hidden": "true", focusable: "false" });
    var up = row === "u";
    s.appendChild(svg("path", { class: "tm-gum", d: up ? "M2 6 Q30 0 58 6 L58 11 L2 11 Z" : "M2 19 L58 19 L58 24 Q30 30 2 24 Z" }));
    var n = col === "f" ? 4 : 3, gap = 2, w = (56 - gap * (n - 1)) / n;
    for (var i = 0; i < n; i++) {
      var x = 2 + i * (w + gap), y = up ? 9 : 5, h = col === "f" ? 16 : 14;
      if (col !== "f") { y = up ? 9 : 7; }
      var r = col === "f" ? 3.5 : 5;
      // 윗니는 아래쪽이, 아랫니는 위쪽이 씹는 면(둥글게)
      var d = up
        ? "M" + x + " " + y + " h" + w + " v" + (h - r) + " q0 " + r + " -" + r + " " + r + " h-" + (w - 2 * r) + " q-" + r + " 0 -" + r + " -" + r + " Z"
        : "M" + x + " " + (y + h) + " h" + w + " v-" + (h - r) + " q0 -" + r + " -" + r + " -" + r + " h-" + (w - 2 * r) + " q-" + r + " 0 -" + r + " " + r + " Z";
      s.appendChild(svg("path", { class: "tm-tooth", d: d }));
    }
    return s;
  }
  /*
   * opts: { onChange(list), value: [] }
   * 반환: { el, get(), text(), clear() }
   */
  function toothMap(opts) {
    opts = opts || {};
    var sel = (opts.value || []).slice();
    var box = document.createElement("div");
    box.className = "tooth-map";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "아픈 곳 고르기. 거울을 볼 때처럼, 화면 오른쪽이 내 오른쪽입니다. 여러 곳을 고를 수 있습니다.");
    var cap = document.createElement("p");
    cap.className = "tm-cap";
    cap.textContent = "거울을 볼 때처럼 보여요. 아픈 곳을 눌러 주세요 (여러 곳 가능).";
    box.appendChild(cap);
    var head = document.createElement("div");
    head.className = "tm-head"; head.setAttribute("aria-hidden", "true");
    ["내 왼쪽", "앞", "내 오른쪽"].forEach(function (t) { var s = document.createElement("span"); s.textContent = t; head.appendChild(s); });
    box.appendChild(head);
    var btns = [];
    ROWS.forEach(function (r) {
      var rowEl = document.createElement("div");
      rowEl.className = "tm-row tm-" + r.key;
      var lab = document.createElement("span"); lab.className = "tm-rowname"; lab.textContent = r.name; lab.setAttribute("aria-hidden", "true");
      rowEl.appendChild(lab);
      var arch = document.createElement("div"); arch.className = "tm-arch";
      COLS.forEach(function (c) {
        var z = r.key + c.key;
        var b = document.createElement("button");
        b.type = "button"; b.className = "tm-btn tm-" + c.key; b.setAttribute("data-zone", z);
        b.setAttribute("aria-label", zoneName(z)); b.setAttribute("data-say", zoneName(z));
        var pic = teeth(r.key, c.key); pic.classList.add("picto");
        var t = document.createElement("span"); t.className = "tm-t"; t.textContent = c.name;
        var mark = document.createElement("span"); mark.className = "tm-mark"; mark.setAttribute("aria-hidden", "true"); mark.textContent = "아파요";
        b.appendChild(pic); b.appendChild(t); b.appendChild(mark);
        b.addEventListener("click", function () { toggle(z); });
        arch.appendChild(b); btns.push(b);
      });
      rowEl.appendChild(arch);
      box.appendChild(rowEl);
    });
    var unsure = document.createElement("button");
    unsure.type = "button"; unsure.className = "tm-unsure"; unsure.setAttribute("data-say", "어딘지 잘 모르겠어요");
    unsure.textContent = "어딘지 잘 모르겠어요";
    unsure.addEventListener("click", function () { sel = sel.indexOf("?") >= 0 ? [] : ["?"]; paint(); });
    box.appendChild(unsure);
    var out = document.createElement("p");
    out.className = "tm-out"; out.setAttribute("aria-live", "polite");
    box.appendChild(out);

    function toggle(z) {
      sel = sel.filter(function (x) { return x !== "?"; });
      var i = sel.indexOf(z);
      if (i >= 0) sel.splice(i, 1); else sel.push(z);
      paint();
    }
    function paint() {
      btns.forEach(function (b) { b.setAttribute("aria-pressed", sel.indexOf(b.getAttribute("data-zone")) >= 0 ? "true" : "false"); });
      unsure.setAttribute("aria-pressed", sel.indexOf("?") >= 0 ? "true" : "false");
      out.textContent = sel.length ? "고른 곳: " + describe(sel) : "";
      if (opts.onChange) opts.onChange(sel.slice());
    }
    paint();
    return {
      el: box,
      get: function () { return sel.slice(); },
      text: function () { return describe(sel); },
      clear: function () { sel = []; paint(); }
    };
  }

  window.WPicto = { icon: icon, toothMap: toothMap, describe: describe, zoneName: zoneName };
})();
