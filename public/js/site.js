/* W치과 홈페이지 — 병원 예약 시스템과 실시간으로 연결된 화면 */
(function () {
  "use strict";
  var C = window.WCore;
  var $ = function (id) { return document.getElementById(id); };
  var site = null;          // 병원 정보·진료비 등 (자주 안 바뀜)
  var live = null;          // 예약 현황·진료 상태 (실시간)
  var liveAt = 0;           // 마지막으로 받은 시각(ms)
  var mode = "connecting";  // live | poll | off

  /* ---------- 공통 ---------- */
  function api(path, body) {
    var opt = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    return fetch("api/" + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."); e.data = j; e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function won(n) { return n == null ? "상담 후 안내" : n.toLocaleString("ko-KR") + "원"; }
  function hhmm(d) { return d.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  // 시각 범위: 오전·오후가 같으면 뒤쪽은 줄임 — "오후 1:00 ~ 2:00", 다르면 "오전 9:30 ~ 오후 6:30"
  function koRange(a, b) { var x = C.koTime(a), y = C.koTime(b); return x.slice(0, 2) === y.slice(0, 2) ? x + " ~ " + y.slice(3) : x + " ~ " + y; }
  // 날짜: 올해면 "11월 6일", 아니면 "2025년 11월 6일"
  function koDate(iso) { var p = String(iso || "").slice(0, 10).split("-"); if (p.length < 3) return String(iso || ""); var y = live && live.now ? live.now.date.slice(0, 4) : String(new Date().getFullYear()); return (p[0] === y ? "" : p[0] + "년 ") + parseInt(p[1], 10) + "월 " + parseInt(p[2], 10) + "일"; }
  // 줄이 바뀌어도 한 덩어리("대기 약 10분", "오후 6:30까지")는 쪼개지지 않게: 덩어리 안 띄어쓰기를 줄바꿈 없는 공백으로
  function keep(t) { return String(t).split(" · ").map(function (c) { return c.replace(/ /g, "\u00a0"); }).join("\u00a0· "); }
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 10) return "방금";
    if (s < 60) return s + "초 전";
    if (s < 3600) return Math.floor(s / 60) + "분 전";
    return Math.floor(s / 3600) + "시간 전";
  }
  function relDay(ds) {
    var d = C.diffDays(live ? live.now.date : C.seoulNow().date, ds);
    return d === 0 ? "오늘" : d === 1 ? "내일" : d === 2 ? "모레" : C.formatDate(ds);
  }
  function copy(btn, text) {
    var label = btn.textContent;
    var done = function (msg) { btn.textContent = msg; setTimeout(function () { btn.textContent = label; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done("복사했어요"); }, function () { done(text); });
    else done(text);
  }
  var toastTimer;
  function toast(msg) {
    var t = $("liveToast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 8000);
  }
  function flash(node) { if (!node) return; node.classList.remove("flash"); void node.offsetWidth; node.classList.add("flash"); }

  /* ---------- 글자 크게 / 테마 ---------- */
  /* '크게 보기' 쉬운 화면: 글씨·버튼을 키우고 복잡한 표를 숨김 */
  var root = document.documentElement, textBtn = $("textBtn");
  function setEasy(on, save) {
    root.classList.toggle("easy", on);
    textBtn.setAttribute("aria-pressed", on ? "true" : "false");
    $("textBtnLabel").textContent = on ? "보통 크기로" : "크게 보기";
    if (save) { store.set("w-easy", on ? "1" : "0"); store.set("w-easy-asked", "1"); $("easyAsk").hidden = true; }
    setTimeout(function () { if (typeof setHeadHeight === "function") setHeadHeight(); }, 0);
  }
  setEasy(store.get("w-easy") === "1" || store.get("w-large") === "1", false);
  textBtn.addEventListener("click", function () { setEasy(!root.classList.contains("easy"), true); });
  /* 소리로 듣기 (음성 안내) */
  var V = window.WVoice, voiceBtn = $("voiceBtn");
  function voiceSummary() {
    var parts = ["소리 안내를 켰어요. 쉬운 예약과 챗봇의 말을 읽어 드릴게요."];
    if (live) {
      parts.push("지금 " + (site ? site.clinic.shortName : "병원") + "는 " + live.status.text + "입니다.");
      if (live.next) parts.push("가장 빠른 예약은 " + relDay(live.next.date) + " " + C.koTime(live.next.time, true) + "입니다.");
    }
    if (site) parts.push("전화는 " + site.clinic.phone + "입니다.");
    return parts.join(" ");
  }
  function setVoiceUi(onNow) {
    voiceBtn.setAttribute("aria-pressed", onNow ? "true" : "false");
    $("voiceBtnLabel").textContent = onNow ? "소리 끄기" : "소리로 듣기"; voiceBtn.setAttribute("aria-label", onNow ? "소리 끄기" : "소리로 듣기");
  }
  if (V && V.canSpeak) {
    voiceBtn.hidden = false;
    setVoiceUi(V.enabled());
    V.onChange(setVoiceUi);
    voiceBtn.addEventListener("click", function () {
      var next = !V.enabled(); V.set(next);
      if (next) V.speak(voiceSummary()); 
    });
  }

  // 처음 오신 분께 한 번만 물어보기
  if (!store.get("w-easy-asked") && store.get("w-easy") === null) $("easyAsk").hidden = false;
  $("easyYes").addEventListener("click", function () { setEasy(true, true); window.scrollTo(0, 0); });
  $("easyNo").addEventListener("click", function () { setEasy(false, true); });
  var savedTheme = store.get("w-theme"); if (savedTheme) root.setAttribute("data-theme", savedTheme);
  $("themeBtn").addEventListener("click", function () {
    var cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next); store.set("w-theme", next);
  });

  /* =========================================================
   * 1. 실시간 현황 (상단 띠 · 현황판 · 오늘의 병원)
   * ========================================================= */
  function renderLivebar() {
    var conn = $("lvConn");
    conn.setAttribute("data-mode", mode);
    $("lvConnText").textContent = mode === "live" ? "실시간 연결" : mode === "poll" ? "자동 갱신 중" : mode === "off" ? "연결 끊김" : "연결 중";
    if (!live) return;
    $("lvStatus").setAttribute("data-open", live.status.open ? "true" : "false");
    $("lvStatusText").textContent = live.status.text;
    var w = $("lvWait");
    w.hidden = live.notice.wait === null;
    if (!w.hidden) w.textContent = "현재 " + C.waitLabel(live.notice.wait);
    renderQuick();
    $("lvToday").textContent = live.today.openSlots ? "오늘 남은 예약 " + live.today.openSlots + "자리" : "오늘 예약 마감";
    var n = $("lvNext");
    n.hidden = !live.next;
    if (live.next) n.textContent = "가장 빠른 예약 " + relDay(live.next.date) + " " + C.koTime(live.next.time) + " →";
    tickClock();
  }
  function renderQuick() {
    if (!live) return;
  }
  function tickClock() {
    if (!liveAt) return;
    var d = new Date(liveAt);
    $("lvTime").textContent = C.koTime(hhmm(d)) + " 기준 · " + ago(liveAt);
    if ($("boardTime")) $("boardTime").textContent = "실시간 · " + ago(liveAt) + " 확인";
    if (live && live.notice.updatedAt) $("liveMsgAt").textContent = "병원에서 " + ago(Date.parse(live.notice.updatedAt)) + " 업데이트";
    if (view !== "home") { var cc = currentCenter(), cl = cc && centerLive(cc.key); if (cl) renderCounterProps(cc, deskOf(cl)); }
  }

  function level(p) {
    if (!p.total) return "off";
    if (!p.available) return "full";
    return p.available / p.total <= 0.34 ? "few" : "ok";
  }
  /* 7일 × 오전/오후/저녁 예약 현황표 */
  function renderHeat(table, week, onPick) {
    var headRow = table.tHead.rows[0], body = table.tBodies[0];
    while (headRow.cells.length > 1) headRow.deleteCell(1);
    body.textContent = "";
    week.forEach(function (d, i) {
      var p = d.date.split("-");
      headRow.appendChild(el("th", { scope: "col", class: d.weekday === 0 ? "sun" : null }, [
        i === 0 ? "오늘" : i === 1 ? "내일" : C.WEEKDAYS[d.weekday], el("b", { text: parseInt(p[2], 10) + "" })
      ]));
    });
    C.PARTS.forEach(function (part, pi) {
      var tr = el("tr", null, [el("th", { scope: "row", text: part.label })]);
      week.forEach(function (d) {
        var cell = d.parts[pi], lv = d.closed ? "off" : level(cell);
        var label = d.closed ? (pi === 1 ? (/진료일이 아닙니다/.test(d.reason) ? "진료 없음" : "휴진") : "") : lv === "off" ? "–" : lv === "full" ? "마감" : cell.available + "";
        var title = C.formatDate(d.date) + " " + part.label + ": " + (d.closed ? (d.reason || "휴진") : lv === "off" ? "진료 없음" : lv === "full" ? "마감" : "예약 가능 " + cell.available + "자리");
        var btn = el("button", { type: "button", class: lv, title: title, "aria-label": title, text: label, disabled: lv === "off" || lv === "full" });
        btn.addEventListener("click", function () { onPick(d.date); });
        tr.appendChild(el("td", null, [btn]));
      });
      body.appendChild(tr);
    });
  }

  /* ---------- 진료센터 (1 depth) ---------- */
  function centerLive(key) { return live && live.centers ? live.centers.filter(function (c) { return c.key === key; })[0] : null; }
  function shortName(c) { return c.name.replace(/센터$/, ""); }
  function daysText(days) { return days ? days.split("").join("·") + " 진료" : "진료일 모두"; }
  function deskOf(cl) { return cl && cl.desk ? cl.desk : { status: "closed", label: "확인 중", wait: null, pending: 0, staff: "", message: "", accepting: true }; }
  function deskLine(cl) {
    var d = deskOf(cl);
    var t = d.label;
    if (d.status === "off") t += " · " + daysText(cl && cl.days);
    if (d.wait !== null) t += " · " + C.waitLabel(d.wait);
    return t;
  }
  function nextText(cl) { return cl && cl.next ? relDay(cl.next.date) + " " + C.koTime(cl.next.time) : "예약 가능한 시간 없음"; }
  function centerCard(c, compact) {
    var cl = centerLive(c.key), d = deskOf(cl);
    return el("a", { class: "ccard", href: "#center-" + c.key, "data-center": c.key }, [
      el("span", { class: "cc-en", text: "접수 데스크" }),
      el("h3", null, [el("span", { class: "cc-name" }, [el("span", { class: "cc-swatch", "aria-hidden": "true" }), " ", c.name])]),
      compact ? null : el("p", { text: c.summary || "" }),
      el("div", { class: "cc-live" }, [
        el("span", { class: "cc-desk", "data-s": d.status, text: keep(deskLine(cl)) }),
        !compact && (d.staff || (cl && cl.doctorsToday.length)) ? el("span", { class: "cc-staff", text: [d.staff ? "코디네이터 " + d.staff : "", cl && cl.doctorsToday.length ? "진료 " + cl.doctorsToday.join(", ") : ""].filter(Boolean).join(" · ") }) : null,
        el("span", { class: "cc-next" }, ["가장 빠른 예약 ", el("b", { text: keep(nextText(cl)) })])
      ])
    ]);
  }
  function renderCenters(changed) {
    if (!site) return;
    var centers = site.centers;
    var grid = $("centerGrid"); grid.textContent = "";
    centers.forEach(function (c) { grid.appendChild(centerCard(c)); });
    grid.appendChild(el("a", { class: "ccard general", href: "#reserve", "data-general": "1" }, [
      el("span", { class: "cc-en", text: "안내 데스크" }), el("h3", { text: "어느 센터인지 모르겠어요" }),
      el("p", { text: "증상을 고르시면 맞는 센터를 알려 드립니다. 검진·상담으로 예약하셔도 됩니다." }),
      el("div", { class: "cc-live" }, [el("span", { class: "cc-next" }, ["가장 빠른 상담 ", el("b", { text: live && live.next ? keep(relDay(live.next.date) + " " + C.koTime(live.next.time)) : "–" })])])
    ]));
    if (changed) flash(grid);
    var nav = $("centerNav"); nav.textContent = "";
    centers.forEach(function (c) {
      var cl = centerLive(c.key), d = deskOf(cl);
      nav.appendChild(el("a", { href: "#center-" + c.key, "data-center": c.key, "aria-current": view === c.key ? "page" : null, title: c.name + " 데스크: " + deskLine(cl) }, [
        el("span", { class: "on-dot" + (d.status === "open" ? "" : d.status === "lunch" ? " lunch" : " off"), "aria-hidden": "true" }), shortName(c)
      ]));
    });
    var mc = $("menuCenters"); mc.textContent = "";
    centers.forEach(function (c) {
      var cl = centerLive(c.key), d = deskOf(cl);
      mc.appendChild(el("li", null, [el("a", { href: "#center-" + c.key, "data-center": c.key }, [
        el("b", { text: c.name }), el("span", { class: "st" + (d.status === "open" ? "" : " off"), text: d.status === "open" ? "접수 중" : d.label }),
        el("small", { text: "가장 빠른 예약 " + nextText(cl) + (d.wait !== null ? " · " + C.waitLabel(d.wait) : "") })
      ])]));
    });
    if (view !== "home") renderCenterLive();
  }

  /* ---------- 진료센터 페이지 = 센터 프론트 데스크 (2 depth) ---------- */
  var view = "home";
  function currentCenter() { return site && site.centers.filter(function (c) { return c.key === view; })[0]; }
  function renderCenterPage(c) {
    $("cvCrumb").textContent = c.name;
    $("cvEn").textContent = "W치과 진료센터";
    $("cvName").textContent = c.name;
    $("counterName").textContent = c.name;
    var ph = $("scenePhoto"), src = C.isDeskPhoto(c.desk_photo) ? c.desk_photo : "";
    $("centerView").classList.toggle("has-photo", false);
    if (src) { ph.onload = function () { ph.hidden = false; $("centerView").classList.add("has-photo"); }; ph.onerror = function () { ph.hidden = true; }; ph.src = src; }
    else { ph.hidden = true; ph.removeAttribute("src"); }
    $("cvSummary").textContent = c.summary || "";
    var tags = $("cvTags"); tags.textContent = "";
    String(c.tags || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean).forEach(function (t) { tags.appendChild(el("li", { text: t })); });
    var desc = $("cvDesc"); desc.textContent = "";
    String(c.description || "").split("\n").filter(Boolean).forEach(function (para) { desc.appendChild(el("p", { text: para })); });
    var pr = $("cvProcess"); pr.textContent = "";
    C.parseLines(c.process).forEach(function (st) { pr.appendChild(el("li", null, [el("h3", { text: st.title }), st.body ? el("p", { text: st.body }) : null])); });
    var docs = site.doctors.filter(function (d) { return C.inCenter(d, c.key); });
    renderDoctorCards($("cvDoctors"), docs.length ? docs : site.doctors);
    var fb = $("cvFees"); fb.textContent = ""; fb.appendChild(feeTable(c)); 
    fb.appendChild(el("p", { class: "muted small" }, ["건강보험 적용 진료는 보험 기준에 따릅니다. ", el("a", { href: "#price", text: "전체 진료비 보기" })]));
    var fq = $("cvFaq"); fq.textContent = "";
    C.parseLines(c.faq).forEach(function (q) { fq.appendChild(el("li", null, [el("details", null, [el("summary", null, [el("span", { class: "t", text: q.title })]), q.body ? el("p", { text: q.body }) : null])])); });
    var others = $("cvOthers"); others.textContent = "";
    site.centers.filter(function (x) { return x.key !== c.key; }).forEach(function (x) { others.appendChild(centerCard(x, true)); });
    renderCenterLive();
  }
  function feeTable(c) {
    var fees = site.fees.filter(function (f) { return f.center === c.key; });
    if (!fees.length) return el("p", { class: "muted", text: "이 센터의 비급여 항목은 검사 후 치료계획서로 안내합니다." });
    var tb = el("tbody");
    fees.forEach(function (f) { tb.appendChild(el("tr", null, [el("td", null, [f.name, f.note ? el("span", { class: "fee-note", text: f.note }) : null]), el("td", { class: "muted", text: f.unit || "" }), el("td", { class: "num", text: won(f.price) })])); });
    return el("table", { class: "cv-fee-table" }, [tb]);
  }
  function greeting(c, d) {
    if (d.message) return d.message;
    var base = "안녕하세요, " + c.name + " 데스크입니다.";
    if (d.status === "open") return base + " 무엇을 도와 드릴까요?";
    if (d.status === "lunch") return base + " 지금은 점심시간이에요. 예약과 상담 요청을 남겨 주시면 오후에 바로 확인할게요.";
    if (d.status === "off") return base + " 오늘은 이 센터 진료가 없는 날이에요. 예약과 상담 요청을 남겨 주시면 다음 진료일에 확인할게요.";
    if (d.status === "paused") return base + " 지금은 온라인 상담 요청을 잠시 받지 않고 있어요. 예약은 그대로 하실 수 있고, 급하시면 전화해 주세요.";
    return base + " 지금은 접수 시간이 아니에요. 남겨 주신 예약과 상담 요청은 접수가 시작되면 순서대로 확인할게요.";
  }
  function renderCenterLive() {
    var c = currentCenter(); if (!c) return;
    var cl = centerLive(c.key); if (!cl) return;
    var d = deskOf(cl);
    $("deskGreeting").textContent = greeting(c, d);
    $("deskStaff").textContent = keep([d.staff ? "담당 코디네이터 " + d.staff : c.name + " 데스크", d.updatedAt ? ago(Date.parse(d.updatedAt)) + " 업데이트" : ""].filter(Boolean).join(" · "));
    var ds = $("deskState"); ds.setAttribute("data-s", d.status); ds.textContent = d.label;
    $("deskWait").textContent = d.wait !== null ? C.waitLabel(d.wait) : d.status === "open" ? "안내 없음" : "–";
    $("deskPending").textContent = d.accepting ? d.pending + "건" : "접수 중단";
    renderCounterProps(c, d);
    $("cvDays").textContent = cl.days ? cl.days.split("").join(" · ") : "진료일 모두";
    $("cvDocs").textContent = cl.doctorsToday.length ? cl.doctorsToday.join(", ") : "없음";
    var nx = $("cvNext"); nx.classList.remove("skeleton"); nx.textContent = nextText(cl);
    $("cvNextBtn").disabled = !cl.next;
    $("dmBook").textContent = cl.next ? keep("가장 빠른 예약 · " + nextText(cl)) : "예약 가능한 시간 없음";
    $("dmCall").textContent = keep(!d.accepting ? "지금은 전화로 문의해 주세요" : d.pending ? "앞선 요청 " + d.pending + "건 · 순서대로 연락" : "지금 요청하면 바로 확인합니다");
    var callBtn = document.querySelector('#deskMenu [data-desk="call"]'), dot = callBtn.querySelector(".badge-dot");
    if (myInquiry && myInquiry.center === c.key && !dot) callBtn.appendChild(el("span", { class: "badge-dot", title: "내 상담 요청 진행 중" }));
    if (!(myInquiry && myInquiry.center === c.key) && dot) dot.remove();
    renderHeat($("cvHeat"), cl.week, function (date) { goBook(date, null, c.key); });
    $("cvTime").textContent = "실시간 · " + ago(liveAt) + " 확인";
    markDoctors();
  }

  /* 카운터 위 소품: 모두 지금의 운영 정보 그대로 (상태등 · 대기 표시기 · 담당 명패 · 시계 · 팻말) */
  var SIGN = { lunch: "점심시간 · 잠시 자리 비움", off: "오늘은 이 센터 휴진", paused: "온라인 접수 잠시 중단" };
  function renderCounterProps(c, d) {
    var lamp = $("propLamp"); lamp.setAttribute("data-s", d.status);
    $("propQueue").hidden = d.status !== "open";
    $("propQueueVal").textContent = d.wait !== null ? C.waitLabel(d.wait) : d.pending ? "요청 " + d.pending + "건" : "바로 안내";
    $("propPlate").hidden = !d.staff; $("propPlateName").textContent = d.staff || "";
    var mins = live && live.now ? live.now.minutes + Math.floor((Date.now() - liveAt) / 60000) : new Date().getHours() * 60 + new Date().getMinutes();
    mins = mins % 1440;
    $("propLampText").textContent = d.status === "open" ? "접수 중" : d.status === "lunch" ? "점심시간" : d.status === "paused" ? "온라인 중단" : d.status === "off" ? "휴진" : mins < 12 * 60 ? "접수 시작 전" : "오늘 접수 마감";
    $("propClock").textContent = C.koTime(pad2(Math.floor(mins / 60)) + ":" + pad2(mins % 60));
    var sign = $("propSign"); sign.hidden = !SIGN[d.status]; sign.textContent = SIGN[d.status] || "";
    $("centerView").setAttribute("data-light", C.deskLight(mins, d.status));
    $("centerView").setAttribute("data-desk", d.status);
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ---------- 데스크 응답 창 ---------- */
  var deskMode = null, inquiryShown = false;
  var INQ_KEY = "w-my-inquiry";
  var myInquiry = null; // { code, phone, center }
  try { myInquiry = JSON.parse(store.get(INQ_KEY) || "null"); } catch (e) { myInquiry = null; }
  var lastInqStatus = null;
  function say(text) { return el("p", { class: "say", text: text }); }
  function radios(name, list, checked) {
    return el("div", { class: "opts", role: "radiogroup" }, list.map(function (o) {
      var id = name + "-" + o.key;
      return el("label", { for: id }, [el("input", { type: "radio", name: name, id: id, value: o.key, checked: o.key === checked }), el("span", { text: o.label })]);
    }));
  }
  function openDesk(mode, quiet) {
    var c = currentCenter(); if (!c) return;
    var cl = centerLive(c.key), d = deskOf(cl), box = $("deskReply");
    deskMode = mode; inquiryShown = false;
    document.querySelectorAll("#deskMenu button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-desk") === mode ? "true" : "false"); });
    if (mode === "book") { box.hidden = true; if (window.WEasyBook && (root.classList.contains("easy") || window.innerWidth <= 760)) window.WEasyBook.open(c.key); else goBook(null, null, c.key); return; }
    if (mode === "cost") { box.hidden = true; document.getElementById("c-fees").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    box.textContent = ""; box.hidden = false;
    if (mode === "call") {
      if (myInquiry && myInquiry.center === c.key) { box.appendChild(say("요청하신 상담은 지금 이렇게 진행되고 있어요.")); box.appendChild(el("div", { id: "inqTicket" })); inquiryShown = true; refreshInquiry(false); }
      else if (!d.accepting) {
        box.appendChild(say(c.name + " 데스크가 지금 온라인 상담 요청을 잠시 받지 않고 있어요. 대표 전화로 연락해 주세요."));
        box.appendChild(el("p", { class: "mono", text: site.clinic.phone }));
      } else {
        box.appendChild(say(d.pending ? "연락처를 남겨 주시면 " + (d.staff ? d.staff + " 코디네이터가 " : "코디네이터가 ") + "순서대로 전화드릴게요. 지금 앞에 " + d.pending + "건이 있어요."
          : "연락처를 남겨 주시면 " + (d.staff ? d.staff + " 코디네이터가 " : "코디네이터가 ") + "바로 확인하고 전화드릴게요."));
        if (d.status !== "open") box.appendChild(el("p", { class: "muted small", text: "지금은 " + d.label + "이라서, 접수가 시작되면 순서대로 연락드릴게요." }));
        box.appendChild(inquiryForm(c));
      }
    } else if (mode === "mine") {
      box.appendChild(say("예약번호나 상담 접수번호, 연락처를 알려 주시면 지금 진행 상황을 바로 확인해 드릴게요."));
      var f = el("form", { novalidate: true }, [
        el("div", { class: "row" }, [
          el("div", { class: "field" }, [el("label", { for: "dmCode", text: "예약번호 또는 접수번호" }), el("input", { id: "dmCode", maxlength: "6", autocomplete: "off", placeholder: "6자리" })]),
          el("div", { class: "field" }, [el("label", { for: "dmTel", text: "연락처" }), el("input", { id: "dmTel", type: "tel", inputmode: "tel", autocomplete: "tel", placeholder: "010-0000-0000" })])
        ]),
        el("button", { class: "btn btn-ghost", type: "submit", text: "확인" }), el("p", { class: "form-error", id: "dmErr", hidden: true })
      ]);
      if (mine) { f.querySelector("#dmCode").value = mine.code; f.querySelector("#dmTel").value = C.formatPhone(mine.phone); }
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var body = { code: $("dmCode").value, phone: $("dmTel").value }, err = $("dmErr"); err.hidden = true;
        api("reservations/lookup", body).then(function (r) {
          track(r.code, body.phone, true); lastStatus = null; renderTracker(r, false); $("reserveForm").hidden = true;
          box.appendChild(say(r.treatmentLabel + " 예약을 찾았어요. 아래 '내 예약'에서 실시간 진행 상황을 보실 수 있습니다."));
          $("tracker").scrollIntoView({ behavior: "smooth", block: "start" });
        }).catch(function () {
          return api("inquiries/lookup", body).then(function (q) {
            myInquiry = { code: q.code, phone: C.normalizePhone(body.phone), center: q.center }; store.set(INQ_KEY, JSON.stringify(myInquiry));
            if (q.center !== view) { location.hash = "center-" + q.center; return; }
            openDesk("call");
          });
        }).catch(function (x) { err.textContent = "일치하는 예약이나 상담 요청이 없습니다. 번호를 다시 확인해 주세요."; err.hidden = false; });
      });
      box.appendChild(f);
    } else if (mode === "prep") {
      var items = String(c.prep || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
      box.appendChild(say(items.length ? "첫 방문 전에 이것만 챙겨 오시면 됩니다. 체크하면서 준비해 보세요." : "첫 방문 때 신분증과 복용 중인 약 목록만 챙겨 오시면 됩니다."));
      var key = "w-prep-" + c.key, done = {};
      try { done = JSON.parse(store.get(key) || "{}"); } catch (e) { done = {}; }
      var ul = el("ul", { class: "checklist" });
      items.concat(["신분증 (건강보험 확인용)"]).forEach(function (t, i) {
        var cb = el("input", { type: "checkbox", id: "prep-" + i, checked: !!done[t] });
        cb.addEventListener("change", function () { done[t] = cb.checked; store.set(key, JSON.stringify(done)); });
        ul.appendChild(el("li", null, [el("label", { for: "prep-" + i }, [cb, el("span", { text: t })])]));
      });
      box.appendChild(ul);
      box.appendChild(el("button", { class: "btn btn-primary", type: "button", text: "준비됐어요, 예약할게요", onclick: function () { openDesk("book"); } }));
    } else if (mode === "way") {
      var cc = site.clinic;
      box.appendChild(say(c.name + "는 " + cc.address + "에 있습니다. 1층 안내 데스크를 거치지 않고 바로 올라오시면 됩니다."));
      box.appendChild(el("ul", { class: "ways" }, [
        el("li", null, [el("b", { text: "지하철" }), cc.subway || ""]), el("li", null, [el("b", { text: "주차" }), cc.parking || ""]),
        el("li", null, [el("b", { text: "전화" }), el("span", { class: "mono", text: cc.phone })]),
        el("li", null, [el("b", { text: "오늘" }), deskOf(cl).label])
      ]));
      box.appendChild(el("div", { class: "map-links" }, [
        cc.naverMapUrl ? el("a", { class: "btn btn-ghost", href: cc.naverMapUrl, target: "_blank", rel: "noopener", text: "네이버 지도" }) : null,
        cc.kakaoMapUrl ? el("a", { class: "btn btn-ghost", href: cc.kakaoMapUrl, target: "_blank", rel: "noopener", text: "카카오맵" }) : null,
        el("button", { class: "btn btn-ghost", type: "button", text: "주소 복사", onclick: function (e) { copy(e.currentTarget, cc.address); } })
      ]));
    }
    if (!quiet) { box.focus({ preventScroll: true }); box.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }
  function inquiryForm(c) {
    var f = el("form", { novalidate: true }, [
      el("span", { class: "fieldset-label", text: "어떤 상담인가요?" }), radios("iqTopic", C.TOPICS, "first"),
      el("span", { class: "fieldset-label", text: "언제 연락드릴까요?" }), radios("iqPrefer", C.PREFERS, "asap"),
      el("div", { class: "row" }, [
        el("div", { class: "field" }, [el("label", { for: "iqName", text: "성함" }), el("input", { id: "iqName", maxlength: "30", autocomplete: "name" })]),
        el("div", { class: "field" }, [el("label", { for: "iqTel", text: "연락처" }), el("input", { id: "iqTel", type: "tel", inputmode: "tel", autocomplete: "tel", placeholder: "010-0000-0000" })])
      ]),
      el("div", { class: "field" }, [el("label", { for: "iqMsg", text: "미리 남길 말씀 (선택)" }), el("textarea", { id: "iqMsg", maxlength: "300", rows: "2", placeholder: "예: 투명교정 기간과 비용이 궁금해요" })]),
      el("div", { class: "vh", "aria-hidden": "true" }, [el("input", { id: "iqWebsite", tabindex: "-1", autocomplete: "off" })]),
      el("label", { class: "consent", for: "iqAgree" }, [el("input", { type: "checkbox", id: "iqAgree" }), el("span", { text: "상담 연락을 위해 성함과 연락처를 수집·이용하는 데 동의합니다." })]),
      el("label", { class: "consent consent-health", for: "iqHealth", id: "iqHealthRow", hidden: true }, [el("input", { type: "checkbox", id: "iqHealth" }), el("span", { text: "남긴 말씀에 건강 정보가 있을 수 있어, 상담 준비에만 쓰는 데 동의합니다." })]),
      el("p", { class: "form-error", id: "iqErr", hidden: true }),
      el("button", { class: "btn btn-primary", type: "submit", text: c.name + " 데스크에 상담 요청" })
    ]);
    f.querySelector("#iqMsg").addEventListener("input", function () { var has = !!this.value.trim(), row = f.querySelector("#iqHealthRow"); row.hidden = !has; if (!has) f.querySelector("#iqHealth").checked = false; });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var pickR = function (n) { var x = f.querySelector('input[name="' + n + '"]:checked'); return x ? x.value : null; };
      var body = { center: c.key, topic: pickR("iqTopic"), prefer: pickR("iqPrefer"), name: $("iqName").value, phone: $("iqTel").value, message: $("iqMsg").value, consent: $("iqAgree").checked, healthConsent: $("iqHealth").checked, website: $("iqWebsite").value };
      var v = C.validateInquiry(body), err = $("iqErr");
      if (!v.ok) { err.textContent = Object.values(v.errors)[0]; err.hidden = false; return; }
      var btn = f.querySelector('button[type="submit"]'); btn.disabled = true;
      api("inquiries", body).then(function (q) {
        myInquiry = { code: q.code, phone: v.value.phone, center: q.center }; store.set(INQ_KEY, JSON.stringify(myInquiry));
        lastInqStatus = null; openDesk("call"); refreshLive("tick");
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; });
    });
    return f;
  }
  function renderTicket(q) {
    var box = $("inqTicket"); if (!box) return;
    box.textContent = "";
    var idx = { new: 0, seen: 1, done: 2 }[q.status], stopped = q.status === "cancelled";
    var steps = el("ol", { class: "track-steps" + (stopped ? " stopped" : "") });
    ["접수", "데스크 확인", "연락 완료"].forEach(function (label, i) {
      steps.appendChild(el("li", { class: stopped ? null : i < idx || (i === idx && q.status === "done") ? "st-done" : i === idx ? "st-now" : null, text: label }));
    });
    var msg = {
      new: q.ahead ? "데스크 확인을 기다리고 있어요. 앞에 " + q.ahead + "건이 있어요." : "데스크 확인을 기다리고 있어요. 다음 순서예요.",
      seen: (q.handledBy ? q.handledBy + "님이" : "데스크에서") + " 확인했어요. " + q.preferLabel + "에 전화드릴게요.",
      done: "상담 연락을 마쳤어요. 더 궁금한 점은 언제든 다시 요청해 주세요.",
      cancelled: "취소된 상담 요청이에요."
    }[q.status];
    var t = el("div", { class: "ticket" }, [
      el("div", { class: "ticket-head" }, [el("span", null, [el("span", { class: "live-tag sm" }, [el("i", { "aria-hidden": "true" }), "실시간"]), " ", el("b", { text: q.centerName + " · " + q.topicLabel })]), el("span", { class: "ticket-code", text: q.code })]),
      steps, el("p", { text: msg }),
      el("p", { class: "muted small", text: q.name + " · " + q.preferLabel + " 연락 희망 · 접수 " + new Date(q.createdAt).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }) })
    ]);
    var acts = el("div", { class: "track-acts" });
    if (q.canCancel) acts.appendChild(el("button", { class: "btn btn-ghost", type: "button", text: "요청 취소", onclick: function () {
      api("inquiries/cancel", { code: myInquiry.code, phone: myInquiry.phone }).then(function (x) { renderTicket(x); }).catch(function (e) { toast(e.message); });
    } }));
    if (q.status === "done" || stopped) acts.appendChild(el("button", { class: "btn btn-ghost", type: "button", text: "새 상담 요청", onclick: function () { myInquiry = null; store.del(INQ_KEY); openDesk("call"); } }));
    t.appendChild(acts);
    box.appendChild(t);
  }
  function refreshInquiry(announce) {
    if (!myInquiry) return;
    api("inquiries/lookup", myInquiry).then(function (q) {
      if (announce && lastInqStatus && lastInqStatus !== q.status) window.dispatchEvent(new CustomEvent("w-status", { detail: { kind: "inquiry", item: q } }));
      if (announce && lastInqStatus && lastInqStatus !== q.status) {
        toast(q.status === "seen" ? q.centerName + " 데스크에서 상담 요청을 확인했습니다" : q.status === "done" ? q.centerName + " 상담 연락이 완료되었습니다" : "상담 요청이 '" + q.statusLabel + "'(으)로 바뀌었습니다");
        var tk = $("inqTicket"); if (tk) flash(tk);
      }
      lastInqStatus = q.status;
      renderTicket(q);
    }).catch(function (e) { if (e.status === 404) { myInquiry = null; store.del(INQ_KEY); } });
  }
  $("deskMenu").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-desk]"); if (b) openDesk(b.getAttribute("data-desk"));
  });

  var reserveSec = $("reserve");
  function setHeadHeight() { document.documentElement.style.setProperty("--head-h", document.querySelector(".site-header").offsetHeight + "px"); }
  window.addEventListener("resize", setHeadHeight);
  function showView(key) {
    var toCenter = key !== "home";
    view = key;
    $("homeView").hidden = toCenter; $("centerView").hidden = !toCenter;
    var form = $("reserveForm");
    if (toCenter) $("centerView").setAttribute("data-center", key); else $("centerView").removeAttribute("data-center");
    if (toCenter) {
      $("centerReserveSlot").appendChild(reserveSec);
      form.classList.add("in-center");
      $("step1Title").textContent = "어떤 진료를 받으세요?";
      if ($("rClinic").value !== key) { $("rClinic").value = key; pick.time = null; }
      $("deskReply").hidden = true; deskMode = null;
      document.querySelectorAll("#deskMenu button").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      renderCenterPage(currentCenter());
      if (myInquiry && myInquiry.center === key) openDesk("call", true);
      loadDays(null);
    } else {
      $("homeReserveSlot").appendChild(reserveSec);
      form.classList.remove("in-center");
      $("step1Title").textContent = "어디가 불편하세요?";
    }
    document.querySelectorAll("#centerNav a").forEach(function (a) { a.setAttribute("aria-current", a.getAttribute("data-center") === key ? "page" : "false"); });
    $("menuPanel").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false");
    setHeadHeight();
  }
  function route() {
    var h = decodeURIComponent((location.hash || "").slice(1));
    var m = /^center-([a-z]+)$/.exec(h);
    if (m && site && site.centers.some(function (c) { return c.key === m[1]; })) {
      if (view !== m[1]) { showView(m[1]); window.scrollTo(0, 0); }
      return;
    }
    if (view !== "home") showView("home");
    var target = h && document.getElementById(h);
    if (target) { openFold(target); setTimeout(function () { target.scrollIntoView({ block: "start" }); }, 0); }
    else if (!h || h === "top") window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  (function () {
    var now = $("now"); if (!now || !window.IntersectionObserver) return;
    new IntersectionObserver(function (es) { document.documentElement.classList.toggle("at-now", es[0].isIntersecting && es[0].intersectionRatio > .35 && view === "home"); }, { threshold: [0, .35, .6] }).observe(now);
  })();

  /* ---------- 펼쳐 보기: 긴 안내는 제목 + 한 줄만 보이고 '자세히 보기'로 펼침 ---------- */
  function openFold(t) {
    var sec = t && t.closest && t.closest("section[data-fold]");
    if (sec && sec._fold) sec._fold(true);
  }
  document.querySelectorAll("section[data-fold]").forEach(function (sec) {
    // 홈 단락 카드: .sec-head(+ 구성 미리보기) 뒤를 접음 / 센터 페이지 구역: 제목(h2) 뒤를 접음
    var head = sec.querySelector(".sec-head") || sec.querySelector("h2");
    if (!head) return;
    var box = head.parentNode, map = box.querySelector(":scope > .part-map");
    var body = el("div", { class: "fold-body", id: sec.id + "-more", hidden: true });
    [].slice.call(box.children).forEach(function (n) { if (n !== head && n !== map && !n.classList.contains("next-step")) body.appendChild(n); });
    var title = (sec.querySelector("h2") || {}).textContent || "";
    var btn = el("button", { type: "button", class: "fold-btn", "aria-expanded": "false", "aria-controls": body.id }, [el("span", { class: "fold-t", text: "자세히 보기" }), el("span", { class: "vh", text: " · " + title }), el("span", { class: "fold-arrow", "aria-hidden": "true", text: "▾" })]);
    var group = sec.closest(".parts");
    sec._fold = function (on) {
      body.hidden = !on; btn.setAttribute("aria-expanded", on ? "true" : "false");
      btn.querySelector(".fold-t").textContent = on ? "접기" : "자세히 보기";
      sec.classList.toggle("folded", !on);
      // 한 단락을 펼치면 그 단계의 카드들은 한 줄씩(읽는 자리), 모두 접으면 다시 한눈에 보는 판으로
      if (group) group.classList.toggle("has-open", !!group.querySelector(".part[data-fold]:not(.folded)"));
    };
    btn.addEventListener("click", function () { sec._fold(body.hidden); });
    // 구성 미리보기를 눌러도 펼침(손가락으로 넓게 누를 수 있게). 키보드는 '자세히 보기' 버튼으로.
    if (map) map.addEventListener("click", function () { if (body.hidden) { sec._fold(true); btn.focus({ preventScroll: true }); } });
    (map || head).after(btn); btn.after(body);
    sec._fold(false);
  });
  // 같은 주소를 다시 눌러 hashchange가 없어도 펼침
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
    var t = document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
    if (t) openFold(t);
  }, true);
  // 센터 화면 안에 있는 대상(#reserve, #lookup 등)으로 가는 링크는 화면을 바꾸지 않고 스크롤만
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute("href").slice(1);
    if (a.hasAttribute("data-general")) { e.preventDefault(); $("rClinic").value = "checkup"; if (view !== "home") location.hash = "reserve"; else goBook(null, null, "checkup"); return; }
    if (view !== "home") {
      var t = document.getElementById(id);
      if (t && $("centerView").contains(t)) { e.preventDefault(); t.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }
  });
  $("menuBtn").addEventListener("click", function () {
    var p = $("menuPanel"), open = p.hidden;
    p.hidden = !open; this.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.querySelectorAll("#menuPanel a, #moreMenu a").forEach(function (a) { a.addEventListener("click", function () { $("menuPanel").hidden = true; $("moreMenu").open = false; }); });
  $("menuCenters").addEventListener("click", function () { $("menuPanel").hidden = true; });
  // 2 depth 하위 메뉴
  $("subNav").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-go]"); if (!b) return;
    var t = document.getElementById(b.getAttribute("data-go")); if (t) { openFold(t); t.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        document.querySelectorAll("#subNav button[data-go]").forEach(function (b) { b.setAttribute("aria-current", b.getAttribute("data-go") === en.target.id ? "true" : "false"); });
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    ["c-about", "c-process", "c-doctors", "c-fees", "c-faq", "reserve"].forEach(function (id) { io.observe(document.getElementById(id)); });
  }
  $("cvNextBtn").addEventListener("click", function () { var cl = centerLive(view); if (cl && cl.next) goBook(cl.next.date, cl.next.time, view); });

  function pct(m, plan) { return ((m - plan.open) / (plan.close - plan.open)) * 100; }
  function renderToday() {
    if (!live) return;
    $("todayLabel").textContent = C.formatDate(live.now.date);
    var plan = live.today.plan, box = $("timeline");
    box.textContent = "";
    if (plan.closed) {
      $("tlHours").textContent = plan.reason;
      box.appendChild(el("div", { class: "tl-closed", text: "오늘은 " + plan.reason + "입니다." + (live.next ? " 가장 빠른 예약은 " + relDay(live.next.date) + " " + C.koTime(live.next.time) + "입니다." : "") }));
    } else {
      $("tlHours").textContent = keep(koRange(plan.open, plan.close) + (plan.lunchStart !== null ? " · 점심시간 " + koRange(plan.lunchStart, plan.lunchEnd) : ""));
      var track = el("div", { class: "tl-track" });
      var nowM = live.now.minutes;
      if (nowM > plan.open) { var past = el("div", { class: "tl-past" }); past.style.width = Math.min(100, pct(nowM, plan)) + "%"; track.appendChild(past); }
      if (plan.lunchStart !== null) { var l = el("div", { class: "tl-lunch", title: "점심시간" }); l.style.left = pct(plan.lunchStart, plan) + "%"; l.style.width = (pct(plan.lunchEnd, plan) - pct(plan.lunchStart, plan)) + "%"; track.appendChild(l); }
      var step = (site && site.booking.slotMinutes) || 30;
      live.today.slots.forEach(function (s) {
        var m = C.toMin(s.time), seg = el("div", { class: "tl-slot" + (s.remaining > 0 ? "" : " full"), title: C.koTime(s.time) + (s.remaining > 0 ? " 예약 가능" : " 마감") });
        seg.style.left = "calc(" + pct(m, plan) + "% + 1px)"; seg.style.width = "calc(" + (pct(m + step, plan) - pct(m, plan)) + "% - 2px)";
        track.appendChild(seg);
      });
      box.appendChild(track);
      for (var h = Math.ceil(plan.open / 60) * 60; h <= plan.close; h += 60) {
        var t = el("span", { class: "tl-tick", text: ((h / 60) % 12 || 12) + "시" }); t.style.left = pct(h, plan) + "%"; box.appendChild(t);
      }
      if (nowM >= plan.open && nowM <= plan.close) {
        var nw = el("div", { class: "tl-now" }, [el("span", { text: "지금 " + C.koTime(nowM) })]); nw.style.left = pct(nowM, plan) + "%"; box.appendChild(nw);
      }
    }
    var wb = $("waitBig");
    if (live.notice.wait !== null) { wb.textContent = C.waitLabel(live.notice.wait); wb.className = "wait-big" + (live.notice.wait <= 10 ? " ok" : ""); }
    else { wb.textContent = live.status.open ? "진료 중" : live.status.text; wb.className = "wait-big"; }
    $("liveMsg").textContent = live.notice.message || "오늘은 별도 안내가 없습니다.";
    if (!live.notice.updatedAt) $("liveMsgAt").textContent = "";
    var dl = $("docToday"); dl.textContent = "";
    if (live.doctorsToday.length) live.doctorsToday.forEach(function (d) { dl.appendChild(el("li", null, [el("b", { text: d.name }), el("small", { text: d.role || "" })])); });
    else dl.appendChild(el("li", { class: "none", text: "오늘은 진료하는 의료진이 없습니다." }));
    markDoctors();
  }

  /* 실시간 데이터 읽기 */
  var refreshing = null;
  function refreshLive(reason) {
    if (refreshing) return refreshing;
    var prevNext = live && live.next ? live.next.date + live.next.time : null;
    refreshing = api("live").then(function (d) {
      var changed = live && (live.v !== d.v || (d.next ? d.next.date + d.next.time : null) !== prevNext);
      live = d; liveAt = Date.now();
      window.dispatchEvent(new CustomEvent("w-live", { detail: d }));
      renderLivebar(); renderCenters(changed); renderToday();
      if (reason === "event") {
        refreshSlots();
        if (tracked()) refreshTracker(true);
        if (myInquiry) refreshInquiry(true);
      }
      return d;
    }).catch(function () { if (mode !== "live") setMode("off"); })
      .then(function (d) { refreshing = null; return d; });
    return refreshing;
  }
  function setMode(m) { mode = m; renderLivebar(); }

  /* 병원 서버의 실시간 신호(SSE) 연결. 안 되면 20초마다 다시 읽기 */
  var pollTimer = null;
  function schedulePoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { refreshLive(mode === "live" ? "tick" : "event"); }, mode === "live" ? 60000 : 20000);
  }
  var debounce = null, siteTimer = null;
  function onSignal(e) {
    clearTimeout(debounce); debounce = setTimeout(function () { refreshLive("event"); }, 250);
    // 관리자 화면에서 공지·진료비·의료진 등을 바꾼 경우 그 내용도 다시 읽음
    var kind = e && e.data ? (function () { try { return JSON.parse(e.data).kind; } catch (x) { return null; } })() : "admin";
    if (kind === "admin") { clearTimeout(siteTimer); siteTimer = setTimeout(function () { loadSite().catch(function () {}); }, 400); }
  }
  function connect() {
    if (!window.EventSource) { setMode("poll"); schedulePoll(); return; }
    var es;
    try { es = new EventSource("api/live/stream"); } catch (e) { setMode("poll"); schedulePoll(); return; }
    es.addEventListener("hello", function () { if (mode !== "live") { setMode("live"); schedulePoll(); refreshLive("event"); } });
    es.addEventListener("update", onSignal);
    es.onerror = function () { if (mode !== "poll") { setMode("poll"); schedulePoll(); } };
  }
  window.addEventListener("w-live-update", onSignal); // 체험판: 다른 탭(관리 화면)에서 바뀐 경우
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshLive("event"); });
  setInterval(tickClock, 5000);

  /* =========================================================
   * 2. 병원 정보 (진료시간표 · 진료비 · 의료진 · 공지)
   * ========================================================= */
  function renderClinic(c) {
    document.querySelectorAll("[data-bind]").forEach(function (n) { var v = c[n.getAttribute("data-bind")]; if (v) n.textContent = v; });
    document.querySelectorAll("[data-href]").forEach(function (n) { var v = c[n.getAttribute("data-href")]; if (v) n.setAttribute("href", v); else n.hidden = true; });
    $("dockTel").setAttribute("href", "tel:" + C.normalizePhone(c.phone));
    $("headTel").setAttribute("href", "tel:" + C.normalizePhone(c.phone));
    document.title = c.shortName + " | 실시간 예약";
  }
  function renderHours(hours, holidays) {
    var tb = $("hoursRows"); tb.textContent = "";
    var today = live && live.now ? live.now.weekday : C.seoulNow().weekday, lunch = {}, lateDays = [];
    [1, 2, 3, 4, 5, 6, 0].forEach(function (w) {
      var h = hours.filter(function (x) { return x.weekday === w; })[0] || { closed: 1 };
      var td = el("td", null, [h.closed ? "휴진" : koRange(h.open, h.close)]);
      if (!h.closed && h.note) td.appendChild(el("span", { class: "tag", text: h.note }));
      if (!h.closed && h.lunch_start) lunch[koRange(h.lunch_start, h.lunch_end)] = true;
      if (!h.closed && C.toMin(h.close) >= 20 * 60) lateDays.push(C.WEEKDAYS[w]);
      tb.appendChild(el("tr", { class: w === today ? "today" : null }, [el("th", { scope: "row", text: w === 0 ? "일 · 공휴일" : C.WEEKDAYS[w] + "요일" }), td]));
    });
    var notes = [], l = Object.keys(lunch);
    if (l.length) notes.push("점심시간 " + l.join(", "));
    notes.push("접수는 진료가 끝나기 " + site.booking.lastEntryMinutes + "분 전까지 받습니다.");
    $("hoursNote").textContent = notes.join(" · ");
    if (lateDays.length) $("hoursLead").textContent = lateDays.join("·") + "요일은 저녁까지 진료합니다.";
    var list = $("holidayList"); list.textContent = "";
    holidays.slice(0, 5).forEach(function (h) { list.appendChild(el("li", null, [el("span", { text: h.label }), el("span", { class: "mono small", text: C.formatDate(h.date) })])); });
    if (!holidays.length) list.appendChild(el("li", null, [el("small", { text: "예정된 휴진일이 없습니다." })]));
  }
  function renderFees(fees, updatedAt) {
    var tb = $("feeRows"); tb.textContent = "";
    var fm = $("feeMapCount"); if (fm) fm.textContent = fees.length ? "비급여 " + fees.length + "가지" : "비급여 진료비표";
    if (!fees.length) { tb.appendChild(el("tr", null, [el("td", { colspan: 3, text: "등록된 비급여 항목이 없습니다." })])); return; }
    fees.forEach(function (f) {
      var name = el("td", null, [f.name]);
      if (f.note) name.appendChild(el("span", { class: "fee-note", text: f.note }));
      tb.appendChild(el("tr", null, [name, el("td", { text: f.unit || "" }), el("td", { class: "num", text: won(f.price) })]));
    });
    $("feeCaption").textContent = "비급여 진료비 · " + (updatedAt ? koDate(updatedAt) + " 기준" : "병원 고지 금액");
  }
  function renderDoctors(docs) {
    renderDoctorCards($("doctorList"), docs);
    // 접힌 의료진 카드의 구성 미리보기: 원장님 이름 + 오늘 진료 점
    var map = $("doctorMap"); if (!map) return;
    map.textContent = "";
    docs.forEach(function (d) {
      map.appendChild(el("li", { "data-days": d.days || "" }, [el("span", { class: "pm-face", "aria-hidden": "true", text: String(d.name || "").charAt(0) }), d.name, el("span", { class: "pm-today", hidden: true, text: " · 오늘 진료" })]));
    });
    markDoctors();
  }
  function renderDoctorCards(box, docs) {
    box.textContent = "";
    docs.forEach(function (d) {
      var portrait = el("div", { class: "portrait" });
      portrait.innerHTML = '<svg viewBox="0 0 64 40" aria-hidden="true"><use href="#w-mark"/></svg>';
      var career = el("ul");
      String(d.career || "").split("\n").filter(Boolean).forEach(function (c) { career.appendChild(el("li", { text: c })); });
      box.appendChild(el("article", { class: "doctor", "data-days": d.days || "" }, [
        portrait, el("p", { class: "role" }, [d.role || "", " ", el("span", { class: "today-mark", hidden: true, text: "오늘 진료" })]),
        el("h3", { text: d.name }), d.days ? el("p", { class: "days", text: "진료 요일 " + d.days.split("").join(" · ") }) : null,
        career, d.quote ? el("blockquote", { text: d.quote }) : null
      ]));
    });
    markDoctors();
  }
  function markDoctors() {
    if (!live) return;
    var closed = live.today.plan.closed;
    document.querySelectorAll(".doctor[data-days]").forEach(function (a) {
      var on = !closed && C.worksOn(a.getAttribute("data-days"), live.now.weekday);
      a.classList.toggle("off", !on);
      a.querySelector(".today-mark").hidden = !on;
    });
    document.querySelectorAll("#doctorMap li[data-days]").forEach(function (li) {
      var on = !closed && C.worksOn(li.getAttribute("data-days"), live.now.weekday);
      li.classList.toggle("on", on);
      li.querySelector(".pm-today").hidden = !on;
    });
  }
  function renderNotices(notices) {
    var list = $("noticeList"); list.textContent = "";
    notices.forEach(function (n) {
      list.appendChild(el("li", null, [el("details", null, [
        el("summary", null, [el("span", { class: "t", text: n.title }), el("time", { datetime: n.created_at, text: koDate(n.created_at) })]),
        n.body ? el("p", { text: n.body }) : null
      ])]));
    });
    $("notices").hidden = !notices.length;
    var pinned = notices.filter(function (n) { return n.pinned; })[0];
    $("noticeBar").hidden = !pinned;
    $("lvNotice").hidden = !pinned; if (pinned) $("lvNotice").setAttribute("title", pinned.title);
    if (pinned) $("noticeBarText").textContent = pinned.title;
  }
  function loadSite() {
    return api("site").then(function (s) {
      var first = !site;
      site = s;
      if (first) {
        var sel = $("rClinic"); sel.textContent = "";
        s.treatments.forEach(function (t) { sel.appendChild(el("option", { value: t.key, text: t.label })); });
      }
      renderClinic(s.clinic); renderHours(s.hours, s.holidays); renderFees(s.fees, s.feesUpdatedAt);
      renderDoctors(s.doctors); renderNotices(s.notices);
      if (live) renderCenters(false);
      if (!first && view !== "home" && currentCenter()) renderCenterPage(currentCenter());
      if (s.booking.retentionDays) { $("retention").textContent = s.booking.retentionDays; document.querySelectorAll(".retention-days").forEach(function (n) { n.textContent = s.booking.retentionDays; }); }
    });
  }

  /* =========================================================
   * 3. 예약
   * ========================================================= */
  var SYMPTOMS = C.SYMPTOMS;
  var chips = $("symChips");
  var P = window.WPicto;
  chips.classList.add("sym-tiles");
  SYMPTOMS.forEach(function (s) {
    chips.appendChild(el("label", { class: "chip sym-tile", for: "sym-" + s.id }, [el("input", { type: "radio", name: "sym", id: "sym-" + s.id, value: s.id }),
      el("span", null, [P ? P.icon(s.id) : null, el("b", { text: s.label })])]));
  });
  // 아픈 곳 짚기(선택): 고른 곳은 예약 메모에 "아픈 곳: 윗니 오른쪽 어금니"처럼 붙음
  var symNow = null, autoMemo = "", where = null;
  function syncMemo() {
    if (!symNow) return;
    var m = $("rMemo"), txt = symNow.label + (where && where.text() ? " · 아픈 곳: " + where.text() : "");
    if (!m.value || m.value === autoMemo) { m.value = txt; autoMemo = txt; }
    syncHealthRow();
  }
  if (P) {
    where = P.toothMap({ onChange: syncMemo });
    var wbox = el("div", { class: "sym-where", id: "symWhere", hidden: true }, [el("p", { class: "sym-where-h" }, [el("b", { text: "아픈 곳을 짚어 주세요" }), el("span", { class: "muted", text: " (선택 · 원장님이 미리 보고 준비합니다)" })]), where.el]);
    $("symHint").after(wbox);
  }
  chips.addEventListener("change", function (e) {
    var s = SYMPTOMS.filter(function (x) { return x.id === e.target.value; })[0]; if (!s) return;
    symNow = s;
    $("rClinic").value = s.t;
    if (where) { if (!s.where) where.clear(); $("symWhere").hidden = !s.where; }
    syncMemo();
    var h = $("symHint"); h.hidden = false;
    h.textContent = C.labelOf(C.TREATMENTS, s.t) + " · 첫 방문 " + s.time + " · " + s.ins;
  });

  var pick = { date: null, time: null };
  // 휴대폰 · 크게 보기에서 홈의 긴 예약 폼은 접어 두고 '쉬운 예약'을 먼저 권함
  function setFormOpen(on) {
    $("reserve").classList.toggle("form-closed", !on);
    var b = $("formFoldBtn"); b.setAttribute("aria-expanded", on ? "true" : "false"); b.firstChild.textContent = on ? "예약 폼 접기" : "한 화면에서 예약하기";
  }
  $("formFoldBtn").addEventListener("click", function () { setFormOpen($("reserve").classList.contains("form-closed")); });
  function goBook(date, time, treatment) {
    setFormOpen(true);
    pick.time = time || null;
    if (treatment) $("rClinic").value = treatment;
    if (!$("tracker").hidden) $("reserveForm").hidden = false;
    $("reserveForm").scrollIntoView({ behavior: "smooth", block: "start" });
    loadDays(date);
  }
  $("lvNext").addEventListener("click", function (e) { if (live && live.next) { e.preventDefault(); goBook(live.next.date, live.next.time, view === "home" ? "checkup" : null); } });
  $("rClinic").addEventListener("change", function () { pick.time = null; loadDays(pick.date); });
  var tq = function () { return "treatment=" + encodeURIComponent($("rClinic").value || ""); };

  function loadDays(want) {
    return api("days?" + tq()).then(function (d) {
      var strip = $("dayStrip"); strip.textContent = "";
      var first = null, wantOk = false;
      d.days.forEach(function (day) {
        var p = day.date.split("-"), disabled = day.closed || day.available === 0;
        var btn = el("button", {
          type: "button", class: "day" + (day.weekday === 0 ? " sun" : ""), "data-date": day.date, disabled: disabled, "aria-pressed": "false",
          "aria-label": C.formatDate(day.date) + (disabled ? " 예약 불가" + (day.reason ? " (" + day.reason + ")" : "") : " 예약 가능 " + day.available + "자리"),
          title: day.reason || null
        }, [
          el("span", { class: "dw", text: C.diffDays(d.days[0].date, day.date) === 0 ? "오늘" : C.WEEKDAYS[day.weekday] }),
          el("span", { class: "dd", text: String(parseInt(p[2], 10)) }),
          el("span", { class: "da", text: day.closed ? (/진료일이 아닙니다/.test(day.reason) ? "진료 없음" : day.reason.length <= 4 ? day.reason.replace("정기 휴진", "휴진") : "휴진") : day.available ? day.available + "자리" : "마감" })
        ]);
        btn.addEventListener("click", function () { pick.time = null; chooseDate(day.date); });
        strip.appendChild(btn);
        if (!disabled && !first) first = day.date;
        if (!disabled && day.date === (want || pick.date)) wantOk = true;
      });
      var target = wantOk ? (want || pick.date) : first;
      if (target) {
        chooseDate(target, true);
        var b = strip.querySelector('[data-date="' + target + '"]'); if (b) strip.scrollLeft = b.offsetLeft - strip.offsetLeft - 8;
      } else { $("slotBox").textContent = ""; $("slotBox").appendChild(el("div", { class: "slot-empty", text: "예약 가능한 날짜가 없습니다. 전화로 문의해 주세요." })); }
    });
  }

  function chooseDate(ds, keepFocus) {
    pick.date = ds;
    document.querySelectorAll("#dayStrip .day").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-date") === ds ? "true" : "false"); });
    return renderSlots(ds, !keepFocus, false);
  }
  function renderSlots(ds, focus, fromLive) {
    var box = $("slotBox");
    if (!fromLive) { box.textContent = ""; box.appendChild(el("div", { class: "slot-empty", text: "병원 예약 장부에서 남은 시간을 확인하는 중입니다." })); }
    return api("slots?date=" + ds + "&" + tq()).then(function (r) {
      if (pick.date !== ds) return;
      box.textContent = "";
      if (r.closed || !r.slots.length) { box.appendChild(el("div", { class: "slot-empty", text: r.reason || "이 날은 예약할 수 있는 시간이 없습니다." })); setTime(null); return; }
      var grid = el("div", { class: "slots", role: "group", "aria-label": C.formatDate(ds) + " 예약 시간" });
      var stillOk = false;
      r.slots.forEach(function (s) {
        var full = s.remaining <= 0;
        if (s.time === pick.time && !full) stillOk = true;
        grid.appendChild(el("button", {
          type: "button", class: "slot", disabled: full, "aria-pressed": s.time === pick.time && !full ? "true" : "false",
          "aria-label": C.koTime(s.time, true) + (full ? " 마감" : " 예약 가능"), "data-time": s.time, text: C.koTime(s.time), onclick: function () { setTime(s.time); }
        }));
      });
      box.appendChild(grid);
      if (pick.time && !stillOk) { toast("선택하신 " + C.formatDate(ds) + " " + C.koTime(pick.time) + "이 방금 마감되었습니다. 다른 시간을 골라주세요."); setTime(null); }
      else setTime(pick.time);
      if (focus) { var f = grid.querySelector(".slot:not(:disabled)"); if (f) f.focus({ preventScroll: true }); }
    }).catch(function (e) { box.textContent = ""; box.appendChild(el("div", { class: "slot-empty", text: e.message })); });
  }
  function refreshSlots() {
    if (!pick.date || $("reserveForm").hidden) return;
    api("days?" + tq()).then(function (d) {
      d.days.forEach(function (day) {
        var b = document.querySelector('#dayStrip [data-date="' + day.date + '"]'); if (!b) return;
        var disabled = day.closed || day.available === 0;
        b.disabled = disabled;
        b.querySelector(".da").textContent = day.closed ? (/진료일이 아닙니다/.test(day.reason) ? "진료 없음" : day.reason.length <= 4 ? day.reason.replace("정기 휴진", "휴진") : "휴진") : day.available ? day.available + "자리" : "마감";
      });
    }).catch(function () {});
    renderSlots(pick.date, false, true);
    flash($("slotTag"));
  }
  function setTime(t) {
    pick.time = t;
    document.querySelectorAll("#slotBox .slot").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-time") === t ? "true" : "false"); });
    var p = $("picked"); p.textContent = "선택한 시간: ";
    p.appendChild(el("b", { text: t && pick.date ? C.formatDate(pick.date) + " " + C.koTime(t) : "없음" }));
  }
  function showError(msg, fieldId) {
    var fe = $("formError"); fe.textContent = msg; fe.hidden = !msg;
    ["fName", "fPhone"].forEach(function (id) { $(id).classList.toggle("invalid", id === fieldId); });
  }

  // 증상 메모(건강 정보)가 있을 때만 별도 동의 칸을 보여 줌 — 증상 칩이 메모를 채울 때도 같이
  function syncHealthRow() { var has = !!$("rMemo").value.trim(); $("rHealthRow").hidden = !has; if (!has) $("rHealth").checked = false; }
  $("rMemo").addEventListener("input", syncHealthRow);

  $("reserveForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var payload = {
      name: $("rName").value, phone: $("rTel").value, treatment: $("rClinic").value, memo: $("rMemo").value,
      date: pick.date, time: pick.time, consent: $("rAgree").checked, healthConsent: $("rHealth").checked, website: $("rWebsite").value
    };
    var v = C.validateReservation(payload);
    if (!v.ok) {
      var k = ["treatment", "date", "time", "name", "phone", "memo", "consent", "healthConsent"].filter(function (x) { return v.errors[x]; })[0];
      showError(v.errors[k], k === "name" ? "fName" : k === "phone" ? "fPhone" : null);
      if (k === "name") $("rName").focus(); else if (k === "phone") $("rTel").focus();
      return;
    }
    showError("");
    var btn = $("submitBtn"); btn.disabled = true; btn.textContent = "병원 예약 장부에 등록하는 중…";
    api("reservations", payload).then(function (r) {
      track(r.code, payload.phone, $("rRemember").checked);
      renderTracker(r, false);
      $("rName").value = ""; $("rTel").value = ""; $("rMemo").value = ""; $("rAgree").checked = false; $("rHealth").checked = false; syncHealthRow(); pick.time = null;
      $("symHint").hidden = true; document.querySelectorAll("#symChips input").forEach(function (i) { i.checked = false; });
      $("reserveForm").hidden = true;
      var tr = $("tracker"); tr.scrollIntoView({ behavior: "smooth", block: "start" }); tr.focus({ preventScroll: true });
      refreshLive("tick");
    }).catch(function (err) {
      showError(err.message, err.data && err.data.fields && err.data.fields.phone ? "fPhone" : null);
      if (err.status === 409) { pick.time = null; loadDays(pick.date); }
    }).then(function () { btn.disabled = false; btn.textContent = "예약 신청하기"; });
  });

  /* =========================================================
   * 4. 내 예약 진행 상황 (직원이 확정하면 바로 바뀜)
   * ========================================================= */
  var TRACK_KEY = "w-my-booking";
  var mine = null;      // { code, phone }
  var lastStatus = null;
  function tracked() { return mine; }
  function track(code, phone, remember) {
    mine = { code: code, phone: C.normalizePhone(phone) };
    if (remember) store.set(TRACK_KEY, JSON.stringify(mine)); else store.del(TRACK_KEY);
  }
  function untrack() { mine = null; lastStatus = null; store.del(TRACK_KEY); $("tracker").hidden = true; $("minePill").hidden = true; $("reserveForm").hidden = false; }

  var STEP_INDEX = { requested: 1, confirmed: 2, visited: 4, no_show: -1, cancelled: -1 };
  function renderTracker(r, announce) {
    var t = $("tracker"); t.hidden = false;
    $("trCode").textContent = r.code;
    var steps = $("trSteps"); steps.textContent = "";
    var idx = STEP_INDEX[r.status], stopped = idx < 0;
    steps.className = "track-steps" + (stopped ? " stopped" : "");
    ["신청 접수", "병원 확인", "예약 확정", "내원"].forEach(function (label, i) {
      var cls = stopped ? "" : i < idx ? "st-done" : i === idx && r.status === "requested" ? "st-now" : i === idx ? "st-done" : "";
      if (r.status === "confirmed" && i === 3) cls = "";
      steps.appendChild(el("li", { class: cls || null, text: label }));
    });
    var when = C.formatDate(r.date) + " " + C.koTime(r.time);
    var msg = {
      requested: "병원에서 예약을 확인하고 있습니다. 직원이 확정하면 이 화면이 바로 바뀌고 문자로도 알려 드립니다.",
      confirmed: "예약이 확정되었습니다. " + when + "에 뵙겠습니다. 전날 안내 문자를 보내 드립니다.",
      visited: "내원해 주셔서 감사합니다. 다음 정기검진 일정은 병원에서 안내해 드립니다.",
      no_show: "예약 시간에 오시지 않은 것으로 기록되었습니다. 다시 예약해 주세요.",
      cancelled: "취소된 예약입니다."
    }[r.status];
    var m = $("trMsg"); m.textContent = msg; m.className = "track-msg" + (stopped ? " bad" : "");
    var info = $("trInfo"); info.textContent = "";
    [["일시", when], ["진료", r.treatmentLabel], ["예약자", r.name], ["상태", r.statusLabel]].forEach(function (p) { info.appendChild(el("dt", { text: p[0] })); info.appendChild(el("dd", { text: p[1] })); });
    var acts = $("trActs"); acts.textContent = "";
    if (r.canCancel) {
      var armed = false, cancel = el("button", { class: "btn btn-ghost", type: "button", text: "예약 취소" });
      cancel.addEventListener("click", function () {
        if (!armed) { armed = true; cancel.textContent = "한 번 더 누르면 취소됩니다"; return; }
        cancel.disabled = true;
        api("reservations/cancel", { code: mine.code, phone: mine.phone }).then(function (x) { renderTracker(x, false); refreshLive("event"); }).catch(function (e) { toast(e.message); cancel.disabled = false; });
      });
      acts.appendChild(cancel);
    }
    acts.appendChild(el("button", { class: "btn btn-ghost", type: "button", text: "새 예약 하기", onclick: function () { $("reserveForm").hidden = false; loadDays(pick.date); $("reserveForm").scrollIntoView({ behavior: "smooth" }); } }));
    acts.appendChild(el("button", { class: "btn btn-ghost", type: "button", text: "이 기기에서 지우기", onclick: untrack }));
    var pill = $("minePill"); pill.hidden = false;
    $("mineText").textContent = "내 예약 · " + r.statusLabel;
    pill.setAttribute("href", "#tracker");
    if (announce && lastStatus && lastStatus !== r.status) window.dispatchEvent(new CustomEvent("w-status", { detail: { kind: "booking", item: r } }));
    if (announce && lastStatus && lastStatus !== r.status) {
      toast(r.status === "confirmed" ? "병원에서 예약을 확정했습니다 · " + when : "내 예약이 '" + r.statusLabel + "'(으)로 바뀌었습니다");
      flash(t);
    } else if (announce && lastStatus === r.status && r.status === "confirmed") { /* 변경 없음 */ }
    lastStatus = r.status;
  }
  function refreshTracker(announce) {
    if (!mine) return Promise.resolve();
    return api("reservations/lookup", mine).then(function (r) { renderTracker(r, announce); }).catch(function (e) { if (e.status === 404) untrack(); });
  }
  $("lookupForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("lookupErr"); err.hidden = true;
    api("reservations/lookup", { code: $("lCode").value, phone: $("lTel").value }).then(function (r) {
      track(r.code, $("lTel").value, true);
      lastStatus = null; renderTracker(r, false);
      $("tracker").scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
  });

  /* ---------- 시작 ---------- */
  $("copyAddr").addEventListener("click", function (e) { copy(e.currentTarget, site ? site.clinic.address : ""); });
  $("copyTel").addEventListener("click", function (e) { copy(e.currentTarget, site ? site.clinic.phone : ""); });

  try { mine = JSON.parse(store.get(TRACK_KEY) || "null"); } catch (e) { mine = null; }
  renderLivebar();
  loadSite().then(function () { return refreshLive("tick"); }).then(function () {
    connect();
    setHeadHeight();
    route();
    if (mine) refreshTracker(false).then(function () { if (mine) $("reserveForm").hidden = true; });
    return view === "home" ? loadDays() : null;
  }).then(function () {
    // 예약 시간 등이 채워져 화면 높이가 바뀐 뒤, 주소의 #위치로 다시 맞춤
    var h = (location.hash || "").slice(1), t = h && !/^center-/.test(h) && document.getElementById(h);
    if (t) t.scrollIntoView({ block: "start" });
  }).catch(function (e) {
    setMode("off");
    $("slotBox").textContent = (e && e.message ? e.message + " " : "") + "전화로 예약해 주세요.";
  });
  /* ---------- 챗봇(chat.js)에 화면 기능을 빌려주는 연결부 ---------- */
  window.WApp = {
    api: api, el: el, toast: toast,
    site: function () { return site; }, live: function () { return live; }, view: function () { return view; },
    relDay: relDay, nextText: nextText, centerLive: centerLive, deskOf: deskOf, deskLine: deskLine,
    goBook: goBook,
    trackBooking: function (r, phone) { track(r.code, phone, true); lastStatus = r.status; renderTracker(r, false); },
    myBooking: function () { return mine; },
    setInquiry: function (q, phone) { myInquiry = { code: q.code, phone: C.normalizePhone(phone), center: q.center }; store.set(INQ_KEY, JSON.stringify(myInquiry)); lastInqStatus = q.status; },
    myInquiry: function () { return myInquiry; }
  };
  /* ---------- 고객 여정 표시: 지금 보고 있는 단계 ---------- */
  (function () {
    var rail = $("journey"); if (!rail || !window.IntersectionObserver) return;
    var links = [].slice.call(rail.querySelectorAll("a"));
    var stages = [].slice.call(document.querySelectorAll("#homeView .stage"));
    function mark(no) {
      links.forEach(function (a) {
        var n = +a.getAttribute("data-stage");
        a.setAttribute("aria-current", n === no ? "step" : "false");
        a.classList.toggle("done", n < no);
      });
      // 지금 보고 있는 단계 판은 한 층 더 떠오름(CSS .is-here)
      stages.forEach(function (st) { st.classList.toggle("is-here", +st.getAttribute("data-stage") === no); });
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) mark(+e.target.getAttribute("data-stage")); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("#homeView .stage").forEach(function (st) { io.observe(st); });
    function vis() { rail.classList.toggle("on", view === "home"); }
    window.addEventListener("hashchange", function () { setTimeout(vis, 0); });
    vis(); mark(1);
    // 주소로 센터 페이지에 바로 들어온 경우(첫 화면 전환 뒤)에도 숨김
    var mo = new MutationObserver(vis); mo.observe($("homeView"), { attributes: true, attributeFilter: ["hidden"] });
  })();
})();
