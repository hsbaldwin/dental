/*
 * 쉬운 예약 — 어르신을 위한 한 화면 한 질문 예약 안내.
 * 진료 → 날짜 → 때(오전/오후/저녁) → 시간 → 성함 → 전화번호(큰 숫자판) → 확인.
 * 예약은 홈페이지 예약과 같은 API로 들어갑니다.
 */
(function () {
  "use strict";
  var A = window.WApp, C = window.WCore;
  if (!A) return;
  var $ = function (id) { return document.getElementById(id); };
  var el = A.el;
  var box = $("easyBook"), body = $("ebBody"), stepTxt = $("ebStep"), title = $("ebTitle"), back = $("ebBack");
  var STEPS = ["진료", "날짜", "때", "시간", "성함", "전화번호", "확인"];
  var st = {}, history = [], lastFocus = null;

  function open(treatment) {
    st = { treatment: treatment || null }; history = [];
    lastFocus = document.activeElement;
    box.hidden = false; document.documentElement.classList.add("eb-open");
    if (treatment) go(1); else go(0);
  }
  function close() {
    box.hidden = true; document.documentElement.classList.remove("eb-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function go(i, fromBack) {
    if (!fromBack && st.step !== undefined && st.step !== i) history.push(st.step);
    st.step = i;
    stepTxt.textContent = (i + 1) + " / " + STEPS.length + " 단계";
    var bar = $("ebBar"); bar.textContent = "";
    STEPS.forEach(function (s, k) { bar.appendChild(el("li", { class: k < i ? "done" : k === i ? "now" : null, text: s })); });
    back.hidden = i === 0 && !history.length;
    body.textContent = ""; body.onkeydown = null;
    [stepCenter, stepDay, stepPart, stepTime, stepName, stepPhone, stepConfirm][i]();
    body.focus({ preventScroll: true });
    body.scrollTop = 0;
  }
  $("ebCall").addEventListener("click", function () {
    var s = A.site(), n = s ? s.clinic.phone : "";
    title.textContent = "전화로 예약하셔도 됩니다."; body.textContent = ""; body.onkeydown = null;
    body.appendChild(el("p", { class: "eb-code", text: n }));
    body.appendChild(el("p", { class: "eb-hint", text: "직원이 받아서 예약까지 도와드려요." }));
    body.appendChild(el("a", { class: "eb-next", href: "tel:" + C.normalizePhone(n), text: "전화 걸기" }));
    back.hidden = false; if (st.step !== undefined) history.push(st.step);
  });
  back.addEventListener("click", function () { if (history.length) go(history.pop(), true); });
  $("ebClose").addEventListener("click", close);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) close(); });

  function ask(q, hint) { title.textContent = q; if (hint) body.appendChild(el("p", { class: "eb-hint", text: hint })); }
  function choice(label, sub, onClick, opts) {
    opts = opts || {};
    var b = el("button", { type: "button", class: "eb-choice" + (opts.primary ? " primary" : "") + (opts.off ? " off" : ""), disabled: !!opts.off }, [
      el("b", { text: label }), sub ? el("small", { text: sub }) : null
    ]);
    b.addEventListener("click", onClick);
    return b;
  }
  function list(items) { var g = el("div", { class: "eb-list" }); items.forEach(function (x) { g.appendChild(x); }); body.appendChild(g); return g; }
  function loading(text) { body.appendChild(el("p", { class: "eb-hint", text: text || "병원 예약 장부에서 확인하고 있어요…" })); }
  function errorMsg(t) { body.appendChild(el("p", { class: "eb-error", role: "alert", text: t })); }

  /* 1. 진료 */
  function stepCenter() {
    ask("어떤 진료를 받으시겠어요?", "잘 모르시면 맨 위 '검진 · 상담'을 누르세요. 원장님이 보고 알려드립니다.");
    var s = A.site();
    var items = [choice("검진 · 상담", "어디가 아픈지 잘 모를 때", function () { st.treatment = "checkup"; go(1); }, { primary: true })];
    (s ? s.centers : []).forEach(function (c) {
      var cl = A.centerLive(c.key), d = A.deskOf(cl);
      items.push(choice(c.name, (c.summary || "") + (cl && !cl.today.open ? " · 오늘은 진료 없음" : d.status === "open" ? " · 오늘 진료" : ""), function () { st.treatment = c.key; go(1); }));
    });
    list(items);
  }
  function tLabel() { return st.treatment === "checkup" ? "검진 · 상담" : (A.site().centers.filter(function (c) { return c.key === st.treatment; })[0] || {}).name || C.labelOf(C.TREATMENTS, st.treatment); }

  /* 2. 날짜 */
  function stepDay() {
    ask("언제 오시겠어요?", tLabel() + " 예약이 가능한 날이에요. 자리가 남은 날만 누를 수 있어요.");
    loading();
    A.api("days?treatment=" + st.treatment).then(function (d) {
      body.lastChild.remove();
      var open = d.days.filter(function (x) { return !x.closed && x.available > 0; }).slice(0, 8);
      if (!open.length) { errorMsg("지금은 온라인으로 예약할 수 있는 날이 없어요. 전화로 문의해 주세요."); return; }
      list(open.map(function (x) {
        return choice(A.relDay(x.date) === C.formatDate(x.date) ? C.formatDate(x.date) : A.relDay(x.date) + " · " + C.formatDate(x.date), "남은 자리 " + x.available + "개", function () { st.date = x.date; go(2); });
      }));
    }).catch(function (e) { body.textContent = ""; errorMsg(e.message); });
  }

  /* 3. 때 (오전 · 오후 · 저녁) */
  function stepPart() {
    ask("몇 시쯤이 편하세요?", C.formatDate(st.date) + "에 남은 시간이에요.");
    loading();
    A.api("slots?date=" + st.date + "&treatment=" + st.treatment).then(function (r) {
      body.lastChild.remove();
      st.slots = r.slots.filter(function (s) { return s.remaining > 0; });
      var parts = C.PARTS.map(function (p) {
        var inP = st.slots.filter(function (s) { var m = C.toMin(s.time); return m >= p.from && m < p.to; });
        var range = p.key === "am" ? "낮 12시 전" : p.key === "pm" ? "낮 12시 ~ 저녁 6시" : "저녁 6시 이후";
        return choice(p.label, inP.length ? range + " · 자리 " + inP.length + "개" : range + " · 자리 없음", function () { st.part = p; go(3); }, { off: !inP.length });
      });
      list(parts);
    }).catch(function (e) { body.textContent = ""; errorMsg(e.message); });
  }

  /* 4. 시간 */
  function stepTime() {
    ask("시간을 골라 주세요.", C.formatDate(st.date) + " " + st.part.label);
    var inP = st.slots.filter(function (s) { var m = C.toMin(s.time); return m >= st.part.from && m < st.part.to; });
    var g = el("div", { class: "eb-grid" });
    inP.forEach(function (s) {
      var b = el("button", { type: "button", class: "eb-time", text: C.koTime(s.time) });
      b.addEventListener("click", function () { st.time = s.time; go(4); });
      g.appendChild(b);
    });
    body.appendChild(g);
  }

  /* 5. 성함 */
  function stepName() {
    ask("예약하실 분 성함을 적어 주세요.");
    var inp = el("input", { id: "ebName", class: "eb-input", maxlength: "30", autocomplete: "name", "aria-label": "성함" });
    inp.value = st.name || "";
    var err = el("p", { class: "eb-error", role: "alert", hidden: true });
    var next = el("button", { type: "button", class: "eb-next", text: "다음" });
    next.addEventListener("click", function () {
      var v = inp.value.trim();
      if (!v) { err.textContent = "성함을 적어 주세요."; err.hidden = false; inp.focus(); return; }
      st.name = v; go(5);
    });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") next.click(); });
    body.appendChild(inp); body.appendChild(err); body.appendChild(next);
    setTimeout(function () { inp.focus(); }, 50);
  }

  /* 6. 전화번호 — 큰 숫자판 */
  function stepPhone() {
    ask("휴대폰 번호를 눌러 주세요.", "예약이 확정되면 이 번호로 문자를 보내드려요.");
    var digits = st.phone || "010";
    var shown = el("output", { class: "eb-phone", "aria-live": "polite" });
    var err = el("p", { class: "eb-error", role: "alert", hidden: true });
    function render() { shown.textContent = C.formatPhone(digits) || "번호를 눌러 주세요"; }
    var pad = el("div", { class: "eb-pad", role: "group", "aria-label": "숫자판" });
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "지우기", "0", "다음"].forEach(function (k) {
      var b = el("button", { type: "button", class: "eb-key" + (k === "다음" ? " primary" : k === "지우기" ? " sub" : ""), text: k });
      b.addEventListener("click", function () {
        err.hidden = true;
        if (k === "지우기") digits = digits.slice(0, -1);
        else if (k === "다음") {
          if (!C.isPhone(digits)) { err.textContent = "번호가 덜 눌렸어요. 010으로 시작하는 11자리를 확인해 주세요."; err.hidden = false; return; }
          st.phone = digits; return go(6);
        } else if (digits.length < 11) digits += k;
        render();
      });
      pad.appendChild(b);
    });
    // 키보드로도 입력 가능
    body.onkeydown = function (e) {
      if (/^\d$/.test(e.key) && digits.length < 11) { digits += e.key; render(); }
      else if (e.key === "Backspace") { digits = digits.slice(0, -1); render(); }
    };
    render();
    body.appendChild(shown); body.appendChild(err); body.appendChild(pad);
  }

  /* 7. 확인 */
  function stepConfirm() {
    ask("이대로 예약할까요?");
    var days = A.site() ? A.site().booking.retentionDays : 180;
    var rows = [["진료", tLabel()], ["날짜", C.formatDate(st.date)], ["시간", C.koTime(st.time, true)], ["성함", st.name], ["전화", C.formatPhone(st.phone)]];
    var dl = el("dl", { class: "eb-summary" });
    rows.forEach(function (r, i) {
      var fix = el("button", { type: "button", class: "eb-fix", text: "고치기" });
      fix.addEventListener("click", function () { go([0, 1, 3, 4, 5][i]); });
      dl.appendChild(el("div", null, [el("dt", { text: r[0] }), el("dd", { text: r[1] }), fix]));
    });
    body.appendChild(dl);
    var agree = el("label", { class: "eb-agree", for: "ebAgree" }, [el("input", { type: "checkbox", id: "ebAgree" }), el("span", { text: "예약 연락을 위해 성함과 전화번호를 쓰는 데 동의합니다. 예약일로부터 " + days + "일 뒤 지웁니다." })]);
    var err = el("p", { class: "eb-error", role: "alert", hidden: true });
    var ok = el("button", { type: "button", class: "eb-next", text: "이대로 예약하기" });
    ok.addEventListener("click", function () {
      if (!$("ebAgree").checked) { err.textContent = "동의에 표시해 주셔야 예약할 수 있어요."; err.hidden = false; return; }
      ok.disabled = true; ok.textContent = "예약하는 중…";
      A.api("reservations", { name: st.name, phone: st.phone, treatment: st.treatment, date: st.date, time: st.time, memo: "쉬운 예약", consent: true }).then(function (r) {
        A.trackBooking(r, st.phone);
        done(r);
      }).catch(function (e) {
        err.textContent = e.message; err.hidden = false; ok.disabled = false; ok.textContent = "이대로 예약하기";
        if (e.status === 409) { var again = el("button", { type: "button", class: "eb-fix", text: "다른 시간 고르기" }); again.addEventListener("click", function () { go(2); }); body.appendChild(again); }
      });
    });
    body.appendChild(agree); body.appendChild(err); body.appendChild(ok);
  }
  function done(r) {
    stepTxt.textContent = "예약 신청 완료"; back.hidden = true;
    $("ebBar").querySelectorAll("li").forEach(function (li) { li.className = "done"; });
    title.textContent = "예약 신청이 접수되었어요.";
    body.textContent = "";
    body.appendChild(el("p", { class: "eb-hint", text: "병원에서 확인하면 문자로 확정 안내를 드려요. 예약번호를 적어 두세요." }));
    body.appendChild(el("p", { class: "eb-code", text: r.code }));
    var dl = el("dl", { class: "eb-summary" });
    [["날짜", C.formatDate(r.date)], ["시간", C.koTime(r.time, true)], ["진료", r.treatmentLabel], ["지금 상태", r.statusLabel]].forEach(function (x) { dl.appendChild(el("div", null, [el("dt", { text: x[0] }), el("dd", { text: x[1] })])); });
    body.appendChild(dl);
    var fin = el("button", { type: "button", class: "eb-next", text: "닫기" });
    fin.addEventListener("click", close);
    body.appendChild(fin);
  }

  // 여는 곳: 큰 '진료 예약하기' 버튼, 하단 '예약하기', 센터 데스크의 '진료 예약'(크게 보기일 때)
  function shouldUse() { return document.documentElement.classList.contains("easy") || window.innerWidth <= 760; }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".qt-book, [data-easybook]");
    var dockBook = e.target.closest && e.target.closest("#dockReserve");
    if (a || (dockBook && shouldUse())) { e.preventDefault(); open(a && a.getAttribute("data-easybook") || null); }
  });
  window.WEasyBook = { open: open, close: close };
})();
