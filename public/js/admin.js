/* W치과 직원용 관리 화면 */
(function () {
  "use strict";
  var C = window.WCore;
  var $ = function (id) { return document.getElementById(id); };
  var S = { user: null, summary: null, timer: null };

  /* ---------- 공통 ---------- */
  function api(method, path, body) {
    var opt = { method: method, credentials: "same-origin", headers: { "x-requested-with": "W-Admin" } };
    if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch("../api/admin/" + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path !== "login") { showLogin(); }
        if (!r.ok) { var e = new Error(j.error || "요청을 처리하지 못했습니다."); e.status = r.status; throw e; }
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
      else if (k === "value") n.value = v == null ? "" : v;
      else if (k === "checked" || k === "disabled" || k === "hidden" || k === "selected") n[k] = !!v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  var toastTimer;
  function toast(msg, warn) {
    var t = $("toast"); t.textContent = msg; t.className = "toast" + (warn ? " warn" : ""); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, warn ? 6000 : 3000);
  }
  function fail(e) { if (e.status !== 401) toast(e.message, true); }
  function field(label, input, help) {
    if (!input.id) input.id = "f" + Math.random().toString(36).slice(2, 9);
    return el("div", { class: "field" }, [el("label", { for: input.id, text: label }), input, help ? el("span", { class: "help", text: help }) : null]);
  }
  function input(attrs) { return el("input", attrs); }
  function select(options, value, attrs) {
    var s = el("select", attrs);
    options.forEach(function (o) { s.appendChild(el("option", { value: o.key, text: o.label, selected: o.key === value })); });
    return s;
  }
  function pill(status) { return el("span", { class: "pill " + status, text: C.labelOf(C.STATUSES, status) }); }
  function armButton(label, armedLabel, cls, onConfirm) {
    var armed = false;
    var b = el("button", { type: "button", class: "btn btn-sm " + (cls || "btn-danger"), text: label });
    b.addEventListener("click", function () {
      if (!armed) { armed = true; b.textContent = armedLabel; setTimeout(function () { armed = false; b.textContent = label; }, 4000); return; }
      onConfirm(b);
    });
    return b;
  }
  function head(title, desc, actions) {
    return el("div", { class: "v-head" }, [el("div", null, [el("h1", { text: title }), desc ? el("p", { text: desc }) : null]), actions ? el("div", { class: "v-actions" }, actions) : null]);
  }
  function isAdmin() { return S.user && S.user.role === "admin"; }

  /* ---------- 로그인 ---------- */
  function showLogin() {
    stopPolling();
    $("app").hidden = true; $("loginView").hidden = false;
    setTimeout(function () { $("lgUser").focus(); }, 0);
  }
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("lgErr"); err.hidden = true;
    api("POST", "login", { username: $("lgUser").value, password: $("lgPw").value })
      .then(function (u) { $("lgPw").value = ""; start(u); })
      .catch(function (x) { err.textContent = x.message; err.hidden = false; });
  });
  $("logoutBtn").addEventListener("click", function () { api("POST", "logout").then(showLogin, showLogin); });

  function start(user) {
    S.user = user;
    $("loginView").hidden = true; $("app").hidden = false;
    $("whoami").textContent = user.name + " (" + (user.role === "admin" ? "관리자" : "직원") + ")";
    document.querySelectorAll("[data-role=admin]").forEach(function (a) { a.hidden = !isAdmin(); });
    route();
    startPolling();
  }

  /* ---------- 새 예약 알림 (30초마다 확인) ---------- */
  function poll(first) {
    return api("GET", "summary").then(function (s) {
      var prev = S.summary;
      S.summary = s;
      var b = $("pendingBadge"); b.textContent = s.pending; b.hidden = !s.pending;
      document.title = (s.pending ? "(" + s.pending + ") " : "") + "W치과 관리";
      var db = $("deskBadge"); db.textContent = s.inquiriesNew; db.hidden = !s.inquiriesNew;
      if (!first && prev && s.latestId > prev.latestId) {
        toast("새 예약이 들어왔습니다. 확인 대기 " + s.pending + "건");
        if (current === "dashboard" || current === "reservations") route();
      }
      if (!first && prev && s.latestInquiryId > prev.latestInquiryId) {
        toast("센터 데스크에 새 상담 요청이 들어왔습니다. 처리 대기 " + s.inquiriesOpen + "건");
        if (current === "dashboard" || current === "desk") route();
      }
      return s;
    }).catch(function () {});
  }
  function startPolling() { stopPolling(); poll(true); S.timer = setInterval(poll, 30000); }
  function stopPolling() { if (S.timer) clearInterval(S.timer); S.timer = null; }

  /* ---------- 화면 전환 ---------- */
  var VIEWS = {};
  var current = null;
  function route() {
    var name = (location.hash || "#dashboard").slice(1);
    if (!VIEWS[name]) name = "dashboard";
    var link = document.querySelector('#sideNav [data-view="' + name + '"]');
    if (link && link.hidden) name = "dashboard";
    current = name;
    document.querySelectorAll("#sideNav a").forEach(function (a) { a.setAttribute("aria-current", a.getAttribute("data-view") === name ? "page" : "false"); });
    var v = $("view"); v.textContent = "";
    v.appendChild(el("p", { class: "muted", text: "불러오는 중…" }));
    Promise.resolve(VIEWS[name](v)).catch(fail);
  }
  window.addEventListener("hashchange", function () { if (S.user) { route(); $("view").focus({ preventScroll: true }); } });

  /* ---------- 대시보드 ---------- */
  VIEWS.dashboard = function (v) {
    var now = C.seoulNow();
    return Promise.all([
      poll(true),
      api("GET", "reservations?from=" + now.date + "&to=" + now.date),
      api("GET", "reservations?status=requested&from=" + now.date + "&to=" + C.addDays(now.date, 180)),
      api("GET", "live")
    ]).then(function (r) {
      var s = r[0] || S.summary || {}, today = r[1].items, pending = r[2].items;
      v.textContent = "";
      v.appendChild(head("오늘 " + C.formatDate(now.date), "새 예약은 30초마다 자동으로 확인합니다.", [
        el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "새로고침", onclick: route }),
        el("button", { class: "btn btn-primary btn-sm", type: "button", text: "예약 추가", onclick: function () { openReservation(null, now.date); } })
      ]));
      var kp = el("div", { class: "kpis" });
      [
        ["오늘 예약", s.todayCount, "취소 제외"],
        ["확인 대기", s.pending, "확정 문자 발송 전", s.pending > 0],
        ["상담 요청 대기", s.inquiriesOpen, "센터 데스크 전화 상담", s.inquiriesNew > 0],
        ["7일 내 예약", s.week, "확인 대기 + 확정"],
        ["30일 미내원율", s.noShowRate == null ? "–" : s.noShowRate + "%", s.noShowBase ? "내원·미내원 " + s.noShowBase + "건 기준" : "기록 없음"]
      ].forEach(function (k) {
        kp.appendChild(el("div", { class: "kpi" + (k[3] ? " alert" : "") }, [el("span", { text: k[0] }), el("b", { text: String(k[1] == null ? 0 : k[1]) }), el("small", { text: k[2] })]));
      });
      v.appendChild(kp);
      v.appendChild(livePanel(r[3]));

      var pendPanel = el("section", { class: "panel" }, [el("h2", null, ["확인 대기", el("span", { class: "muted small", text: pending.length + "건" })])]);
      var pl = el("ul", { class: "agenda" });
      pending.forEach(function (x) {
        pl.appendChild(el("li", null, [
          el("span", { class: "t", text: x.time }),
          el("span", { class: "who" }, [el("b", { text: x.name }), " ", el("span", { class: "muted small", text: C.formatDate(x.date) + " · " + C.labelOf(C.TREATMENTS, x.treatment) }), el("small", { text: C.formatPhone(x.phone) + (x.memo ? " · " + x.memo : "") })]),
          el("span", { class: "acts" }, [
            el("button", { type: "button", class: "btn btn-primary btn-sm", text: "확정", onclick: function () { setStatus(x, "confirmed"); } }),
            el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "변경", onclick: function () { openReservation(x); } }),
            armButton("취소", "취소 확인", "btn-danger", function () { setStatus(x, "cancelled"); })
          ])
        ]));
      });
      pendPanel.appendChild(pending.length ? pl : el("p", { class: "empty", text: "확인할 예약이 없습니다." }));

      var todayPanel = el("section", { class: "panel" }, [el("h2", null, ["오늘 일정", el("span", { class: "muted small", text: today.filter(function (x) { return x.status !== "cancelled"; }).length + "명" })])]);
      var tl = el("ul", { class: "agenda" });
      var nextMarked = false;
      today.forEach(function (x) {
        var isNow = !nextMarked && C.ACTIVE.indexOf(x.status) >= 0 && C.toMin(x.time) + 30 >= now.minutes;
        if (isNow) nextMarked = true;
        var acts = [];
        if (C.ACTIVE.indexOf(x.status) >= 0) {
          acts.push(el("button", { type: "button", class: "btn btn-primary btn-sm", text: "내원", onclick: function () { setStatus(x, "visited", false); } }));
          acts.push(el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "미내원", onclick: function () { setStatus(x, "no_show", false); } }));
        }
        acts.push(el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "열기", onclick: function () { openReservation(x); } }));
        tl.appendChild(el("li", { class: isNow ? "now" : null }, [
          el("span", { class: "t", text: x.time }),
          el("span", { class: "who" }, [el("b", { text: x.name }), " ", pill(x.status), el("small", { text: C.labelOf(C.TREATMENTS, x.treatment) + (x.staff_memo ? " · " + x.staff_memo : x.memo ? " · " + x.memo : "") })]),
          el("span", { class: "acts" }, acts)
        ]));
      });
      todayPanel.appendChild(today.length ? tl : el("p", { class: "empty", text: "오늘 예약이 없습니다." }));
      v.appendChild(el("div", { class: "cols" }, [pendPanel, todayPanel]));
    });
  };

  /* 홈페이지 상단에 바로 뜨는 '지금 병원 상황' */
  var WAITS = [{ v: null, t: "표시 안 함" }, { v: 0, t: "바로 진료" }, { v: 10, t: "약 10분" }, { v: 20, t: "약 20분" }, { v: 30, t: "약 30분" }, { v: 45, t: "45분 이상" }];
  function livePanel(cur) {
    var chosen = cur.updatedAt ? cur.wait : null;
    var btns = el("div", { class: "wait-btns", role: "group", "aria-label": "현재 대기 시간" });
    WAITS.forEach(function (w) {
      var b = el("button", { type: "button", class: "btn btn-sm " + (w.v === chosen ? "btn-primary" : "btn-ghost"), text: w.t, "aria-pressed": w.v === chosen ? "true" : "false" });
      b.addEventListener("click", function () {
        chosen = w.v;
        btns.querySelectorAll("button").forEach(function (x) { x.className = "btn btn-sm btn-ghost"; x.setAttribute("aria-pressed", "false"); });
        b.className = "btn btn-sm btn-primary"; b.setAttribute("aria-pressed", "true");
      });
      btns.appendChild(b);
    });
    var msg = input({ type: "text", id: "liveMsgIn", maxlength: 120, value: cur.message || "", placeholder: "예: 오후 2–3시는 원장님 수술로 대기가 길 수 있습니다" });
    var age = cur.updatedAt ? Math.round((Date.now() - Date.parse(cur.updatedAt)) / 60000) : null;
    var stateText = cur.updatedAt ? (age < 180 ? "홈페이지에 표시 중 · " + (age < 1 ? "방금" : age + "분 전") + " " + (cur.updatedBy || "") + " 입력" : "3시간이 지나 홈페이지에서 자동으로 내려갔습니다") : "아직 입력한 안내가 없습니다";
    var save = el("button", { type: "button", class: "btn btn-primary btn-sm", text: "홈페이지에 바로 반영", onclick: function () {
      api("PUT", "live", { wait: chosen, message: msg.value }).then(function () { toast("홈페이지에 반영했습니다. 지금 보고 있는 환자 화면에도 바로 바뀝니다."); route(); }).catch(fail);
    } });
    return el("section", { class: "panel live-panel" }, [
      el("h2", null, ["홈페이지 실시간 안내", el("span", { class: "muted small", text: stateText })]),
      el("div", { class: "field" }, [el("span", { class: "small", text: "현재 대기 시간 (진료 중일 때만 표시)" }), btns]),
      field("오늘의 안내 문구", msg, "비워두면 표시하지 않습니다. 입력 후 3시간이 지나면 자동으로 내려갑니다."),
      el("div", null, [save])
    ]);
  }

  function setStatus(x, status, notify) {
    return api("PATCH", "reservations/" + x.id, { status: status, notify: notify !== false })
      .then(function () { toast(x.name + " · " + C.labelOf(C.STATUSES, status)); poll(true); route(); })
      .catch(fail);
  }

  /* ---------- 예약 관리 ---------- */
  var resFilter = null;
  VIEWS.reservations = function (v) {
    var now = C.seoulNow();
    if (!resFilter) resFilter = { from: now.date, to: C.addDays(now.date, 14), status: "", q: "" };
    var f = resFilter;
    var fFrom = input({ type: "date", value: f.from, id: "fltFrom" }), fTo = input({ type: "date", value: f.to, id: "fltTo" });
    var fStatus = select([{ key: "", label: "전체" }].concat(C.STATUSES), f.status, { id: "fltStatus" });
    var fQ = input({ type: "search", value: f.q, id: "fltQ", placeholder: "성함 · 연락처 · 예약번호" });
    var qs = function () { return "from=" + f.from + "&to=" + f.to + (f.status ? "&status=" + f.status : "") + (f.q ? "&q=" + encodeURIComponent(f.q) : ""); };
    var csv = el("a", { class: "btn btn-ghost btn-sm", href: "../api/admin/reservations.csv?" + qs(), text: "엑셀(CSV) 내려받기" });
    var form = el("form", { class: "filters" }, [
      field("시작일", fFrom), field("종료일", fTo), field("상태", fStatus),
      el("div", { class: "field grow" }, [el("label", { for: "fltQ", text: "검색" }), fQ]),
      el("button", { class: "btn btn-primary btn-sm", type: "submit", text: "조회" })
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      resFilter = { from: fFrom.value || now.date, to: fTo.value || fFrom.value || now.date, status: fStatus.value, q: fQ.value.trim() };
      route();
    });
    return api("GET", "reservations?" + qs()).then(function (r) {
      v.textContent = "";
      v.appendChild(head("예약 관리", "행을 누르면 예약을 수정할 수 있습니다. 전화로 받은 예약은 '예약 추가'로 등록하세요.", [
        csv, el("button", { class: "btn btn-primary btn-sm", type: "button", text: "예약 추가", onclick: function () { openReservation(null, f.from >= now.date ? f.from : now.date); } })
      ]));
      v.appendChild(form);
      var tb = el("tbody");
      var lastDate = null;
      r.items.forEach(function (x) {
        if (x.date !== lastDate) { lastDate = x.date; tb.appendChild(el("tr", { class: "day-sep" }, [el("td", { colspan: 7, text: C.formatDate(x.date) })])); }
        var tr = el("tr", { class: "click", tabindex: 0 }, [
          el("td", { class: "mono nowrap", text: x.time }),
          el("td", { class: "nowrap" }, [el("b", { text: x.name })]),
          el("td", { class: "mono nowrap", text: x.purged ? "" : C.formatPhone(x.phone) }),
          el("td", { class: "nowrap", text: C.labelOf(C.TREATMENTS, x.treatment) }),
          el("td", null, [pill(x.status)]),
          el("td", { class: "nowrap muted", text: x.source === "web" ? "홈페이지" : "직원 등록" }),
          el("td", { class: "clip", text: [x.memo, x.staff_memo].filter(Boolean).join(" / ") })
        ]);
        tr.addEventListener("click", function () { openReservation(x); });
        tr.addEventListener("keydown", function (e) { if (e.key === "Enter") openReservation(x); });
        tb.appendChild(tr);
      });
      var table = el("table", { class: "tbl" }, [
        el("thead", null, [el("tr", null, ["시간", "성함", "연락처", "진료", "상태", "경로", "메모"].map(function (h) { return el("th", { scope: "col", text: h }); }))]), tb
      ]);
      v.appendChild(r.items.length ? el("div", { class: "tbl-box" }, [table]) : el("p", { class: "empty", text: "조건에 맞는 예약이 없습니다." }));
      v.appendChild(el("p", { class: "muted small", text: "총 " + r.items.length + "건 · 내려받은 파일에는 개인정보가 들어 있으니 업무용 PC에만 보관하세요." }));
    });
  };

  /* 예약 상세 / 추가 대화상자 */
  var editing = null;
  (function initDialog() {
    var t = $("rdTreatment"); C.TREATMENTS.forEach(function (x) { t.appendChild(el("option", { value: x.key, text: x.label })); });
    var s = $("rdStatus"); C.STATUSES.forEach(function (x) { s.appendChild(el("option", { value: x.key, text: x.label })); });
    $("rdClose").addEventListener("click", function () { $("resDialog").close(); });
    $("rdDate").addEventListener("change", function () { loadTimes($("rdDate").value, $("rdTime").value); });
    $("resForm").addEventListener("submit", function (e) { e.preventDefault(); saveReservation(); });
  })();

  function loadTimes(date, keep) {
    var sel = $("rdTime"), hint = $("rdSlotHint");
    sel.textContent = ""; hint.textContent = "";
    if (!C.isDate(date)) return Promise.resolve();
    return api("GET", "slots?date=" + date).then(function (r) {
      var seen = {};
      if (r.closed) hint.textContent = "이 날은 " + (r.reason || "휴진") + "입니다. 그래도 시간을 지정해 등록할 수 있습니다.";
      r.slots.forEach(function (s) {
        seen[s.time] = true;
        sel.appendChild(el("option", { value: s.time, text: s.time + (s.remaining > 0 ? "  (남은 " + s.remaining + ")" : "  (마감)"), selected: s.time === keep }));
      });
      // 진료시간 밖이거나 휴진일이어도 직원은 지정 가능
      var extra = keep && !seen[keep] ? [keep] : [];
      if (r.closed || !r.slots.length) for (var m = 9 * 60; m <= 21 * 60; m += 30) extra.push(C.toHHMM(m));
      extra.forEach(function (t) { if (!seen[t]) { seen[t] = true; sel.appendChild(el("option", { value: t, text: t + "  (진료시간 외)", selected: t === keep })); } });
    }).catch(fail);
  }

  function openReservation(x, date) {
    editing = x;
    $("rdTitle").textContent = x ? "예약 수정" : "예약 추가";
    $("rdCode").textContent = x ? x.code : "";
    $("rdName").value = x ? x.name : ""; $("rdPhone").value = x ? C.formatPhone(x.phone) : "";
    $("rdTreatment").value = x ? x.treatment : "checkup";
    $("rdStatus").value = x ? x.status : "confirmed";
    $("rdStatus").disabled = !x;
    $("rdDate").value = x ? x.date : date;
    $("rdMemo").value = x ? x.memo || "" : ""; $("rdStaffMemo").value = x ? x.staff_memo || "" : "";
    $("rdNotify").checked = true;
    $("rdErr").hidden = true;
    var disabled = !!(x && x.purged);
    ["rdName", "rdPhone", "rdSave"].forEach(function (id) { $(id).disabled = disabled; });
    $("rdMeta").textContent = x ? (x.source === "web" ? "홈페이지 신청" : "직원 등록") + " · 신청 " + x.created_at.slice(0, 16).replace("T", " ") + " (UTC)" + (x.consent_at ? " · 개인정보 동의 기록 있음" : "") + (disabled ? " · 개인정보 파기됨" : "") : "직원이 등록한 예약은 바로 '예약 확정' 상태가 됩니다.";
    loadTimes($("rdDate").value, x ? x.time : null).then(function () { $("resDialog").showModal(); $("rdName").focus(); });
  }

  function saveReservation() {
    var body = {
      name: $("rdName").value, phone: $("rdPhone").value, treatment: $("rdTreatment").value,
      date: $("rdDate").value, time: $("rdTime").value, memo: $("rdMemo").value, staff_memo: $("rdStaffMemo").value,
      notify: $("rdNotify").checked
    };
    if (editing) body.status = $("rdStatus").value;
    var err = $("rdErr"); err.hidden = true;
    if (!body.time) { err.textContent = "시간을 선택해 주세요."; err.hidden = false; return; }
    var p = editing ? api("PATCH", "reservations/" + editing.id, body) : api("POST", "reservations", body);
    p.then(function (r) {
      $("resDialog").close();
      if (r.warning) toast("저장했습니다. " + r.warning, true); else toast(editing ? "예약을 저장했습니다." : "예약을 추가했습니다.");
      poll(true); route();
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; });
  }

  /* ---------- 센터 데스크 ---------- */
  var TOPIC = function (k) { return C.labelOf(C.TOPICS, k); }, PREF = function (k) { return C.labelOf(C.PREFERS, k); };
  function minutesAgo(iso) { var m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "방금" : m < 60 ? m + "분 전" : Math.floor(m / 60) + "시간 전"; }
  VIEWS.desk = function (v) {
    return Promise.all([
      api("GET", "inquiries"), api("GET", "inquiries?status=done"), api("GET", "centers"),
      fetch("../api/live").then(function (r) { return r.json(); })
    ]).then(function (r) {
      var open = r[0].items, done = r[1].items.slice(0, 15), centers = r[2].items, liveC = {};
      (r[3].centers || []).forEach(function (c) { liveC[c.key] = c; });
      var cname = {}; centers.forEach(function (c) { cname[c.key] = c.name; });
      v.textContent = "";
      v.appendChild(head("센터 데스크", "센터별 접수 상태와 전화 상담 요청을 처리합니다. 여기서 바꾸면 환자가 보는 센터 데스크 화면에 바로 반영됩니다."));

      var inbox = el("section", { class: "panel" }, [el("h2", null, ["상담 요청함", el("span", { class: "muted small", text: "처리 중 " + open.length + "건 · 오래된 순" })])]);
      var ul = el("ul", { class: "agenda" });
      open.forEach(function (q) {
        var memo = input({ type: "text", value: q.staff_memo || "", placeholder: "통화 메모", "aria-label": "통화 메모", class: "memo-in" });
        var next = q.status === "new"
          ? el("button", { type: "button", class: "btn btn-primary btn-sm", text: "확인했어요", onclick: function () { setInq(q, "seen", memo.value); } })
          : el("button", { type: "button", class: "btn btn-primary btn-sm", text: "연락 완료", onclick: function () { setInq(q, "done", memo.value); } });
        ul.appendChild(el("li", { class: "inq" }, [
          el("span", { class: "t small", text: minutesAgo(q.created_at) }),
          el("span", { class: "who" }, [
            el("b", { text: q.name }), " ", el("span", { class: "pill " + (q.status === "new" ? "requested" : "confirmed"), text: C.labelOf(C.INQ_STATUSES, q.status) }), " ",
            el("span", { class: "muted small", text: (cname[q.center] || q.center) + " · " + TOPIC(q.topic) + " · " + PREF(q.prefer) + " 연락 희망" }),
            el("small", { text: C.formatPhone(q.phone) + (q.message ? " · " + q.message : "") + (q.handled_by ? " · 담당 " + q.handled_by : "") }),
            memo
          ]),
          el("span", { class: "acts" }, [next, armButton("취소", "취소 확인", "btn-danger", function () { setInq(q, "cancelled", memo.value); })])
        ]));
      });
      inbox.appendChild(open.length ? ul : el("p", { class: "empty", text: "처리할 상담 요청이 없습니다." }));
      if (done.length) {
        var dl = el("ul", { class: "agenda" });
        done.forEach(function (q) { dl.appendChild(el("li", null, [el("span", { class: "t small", text: minutesAgo(q.updated_at) }), el("span", { class: "who" }, [el("b", { text: q.name }), " ", el("span", { class: "muted small", text: (cname[q.center] || q.center) + " · " + TOPIC(q.topic) + " · 담당 " + (q.handled_by || "") }), el("small", { text: q.staff_memo || "" })]), el("span")])); });
        inbox.appendChild(el("details", { class: "done-list" }, [el("summary", { class: "small", text: "최근 연락 완료 " + done.length + "건" }), dl]));
      }
      v.appendChild(inbox);

      var grid = el("div", { class: "desk-grid" });
      centers.forEach(function (c) {
        var lc = liveC[c.key], d = lc && lc.desk;
        var accepting = input({ type: "checkbox", checked: !c.desk_paused });
        var chosen = c.desk_updated_at ? c.desk_wait : null;
        var waits = el("div", { class: "wait-btns" });
        WAITS.forEach(function (w) {
          var b = el("button", { type: "button", class: "btn btn-sm " + (w.v === chosen ? "btn-primary" : "btn-ghost"), text: w.t });
          b.addEventListener("click", function () { chosen = w.v; waits.querySelectorAll("button").forEach(function (x) { x.className = "btn btn-sm btn-ghost"; }); b.className = "btn btn-sm btn-primary"; });
          waits.appendChild(b);
        });
        var staff = input({ type: "text", value: c.desk_staff || "", maxlength: 30, placeholder: "예: 김OO 실장" });
        var msg = input({ type: "text", value: c.desk_message || "", maxlength: 120, placeholder: "비우면 상황에 맞는 기본 인사말이 나갑니다" });
        var photo = input({ type: "text", value: c.desk_photo || "", maxlength: 80, placeholder: "예: /img/desk/" + c.key + ".jpg (비우면 그림 카운터)" });
        var save = el("button", { type: "button", class: "btn btn-primary btn-sm", text: "데스크에 반영", onclick: function () {
          api("PUT", "centers/" + c.key + "/desk", { paused: !accepting.checked, wait: chosen, staff: staff.value, message: msg.value, photo: photo.value })
            .then(function () { toast(c.name + " 데스크 화면에 반영했습니다."); route(); }).catch(fail);
        } });
        grid.appendChild(el("section", { class: "panel desk-card" }, [
          el("h2", null, [c.name, el("span", { class: "pill " + (d && d.status === "open" ? "confirmed" : d && (d.status === "paused" || d.status === "lunch") ? "requested" : "cancelled"), text: d ? d.label : "–" })]),
          el("p", { class: "muted small", text: "상담 요청 대기 " + (d ? d.pending : 0) + "건 · 진료 요일 " + (lc && lc.days ? lc.days : "모두") + (c.desk_updated_at ? " · " + minutesAgo(c.desk_updated_at) + " " + (c.desk_updated_by || "") + " 수정" : "") }),
          el("label", { class: "chk" }, [accepting, "온라인 상담 요청 받기"]),
          el("div", { class: "field" }, [el("span", { class: "small", text: "현재 대기 (접수 중일 때만 표시, 3시간 뒤 자동 해제)" }), waits]),
          field("담당 코디네이터", staff), field("데스크 인사말", msg), field("접수 데스크 사진 (선택)", photo),
          el("div", null, [save])
        ]));
      });
      v.appendChild(el("h2", { class: "sub-h", text: "센터별 데스크 설정" }));
      v.appendChild(grid);
    });
  };
  function setInq(q, status, memo) {
    api("PATCH", "inquiries/" + q.id, { status: status, staff_memo: memo })
      .then(function () { toast(q.name + " · " + C.labelOf(C.INQ_STATUSES, status) + " (환자 화면에 바로 표시됩니다)"); poll(true); route(); })
      .catch(fail);
  }

  /* ---------- 진료시간 · 휴진일 ---------- */
  VIEWS.hours = function (v) {
    return Promise.all([api("GET", "settings"), api("GET", "holidays")]).then(function (r) {
      v.textContent = "";
      v.appendChild(head("진료시간 · 휴진일", "저장하면 홈페이지 진료시간표와 예약 가능한 시간에 바로 반영됩니다."));
      var hours = r[0].hours.slice().sort(function (a, b) { return ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7); });
      var tb = el("tbody");
      var rows = hours.map(function (h) {
        var closed = input({ type: "checkbox", checked: !!h.closed, "aria-label": C.WEEKDAYS[h.weekday] + "요일 휴진" });
        var o = input({ type: "time", value: h.open || "09:30", step: 600, "aria-label": "시작" }), c = input({ type: "time", value: h.close || "18:30", step: 600, "aria-label": "종료" });
        var ls = input({ type: "time", value: h.lunch_start || "", step: 600, "aria-label": "점심 시작" }), le = input({ type: "time", value: h.lunch_end || "", step: 600, "aria-label": "점심 종료" });
        var note = input({ type: "text", value: h.note || "", maxlength: 30, placeholder: "예: 야간", "aria-label": "표시 문구" });
        var tr = el("tr", { class: h.closed ? "off" : null }, [el("th", { scope: "row", text: C.WEEKDAYS[h.weekday] }), el("td", { class: "c" }, [closed]), el("td", null, [o]), el("td", null, [c]), el("td", null, [ls]), el("td", null, [le]), el("td", null, [note])]);
        closed.addEventListener("change", function () { tr.className = closed.checked ? "off" : ""; });
        tb.appendChild(tr);
        return function () { return { weekday: h.weekday, closed: closed.checked, open: o.value, close: c.value, lunch_start: ls.value, lunch_end: le.value, note: note.value }; };
      });
      var save = el("button", { class: "btn btn-primary btn-sm", type: "button", text: "진료시간 저장", onclick: function () {
        api("PUT", "hours", { hours: rows.map(function (f) { return f(); }) }).then(function () { toast("진료시간을 저장했습니다."); }).catch(fail);
      } });
      v.appendChild(el("section", { class: "panel" }, [
        el("h2", null, ["요일별 진료시간"]),
        el("div", { class: "tbl-box" }, [el("table", { class: "hours-edit" }, [el("thead", null, [el("tr", null, ["요일", "휴진", "시작", "종료", "점심 시작", "점심 종료", "표시 문구"].map(function (x) { return el("th", { scope: "col", class: "muted small", text: x }); }))]), tb])]),
        el("p", { class: "muted small", text: "점심시간이 없는 요일은 비워두세요. 점심시간과 겹치는 시간에는 예약을 받지 않습니다." }),
        el("div", null, [save])
      ]));

      var hd = input({ type: "date", id: "holDate", value: C.seoulNow().date }), hl = input({ type: "text", id: "holLabel", maxlength: 40, placeholder: "예: 원장 학회 참석" });
      var add = el("form", { class: "filters" }, [field("날짜", hd), el("div", { class: "field grow" }, [el("label", { for: "holLabel", text: "사유 (홈페이지에 표시)" }), hl]), el("button", { class: "btn btn-primary btn-sm", type: "submit", text: "휴진일 추가" })]);
      add.addEventListener("submit", function (e) {
        e.preventDefault();
        api("POST", "holidays", { date: hd.value, label: hl.value }).then(function (x) {
          toast(x.affected ? "휴진일을 추가했습니다. 이 날 잡힌 예약 " + x.affected + "건은 따로 연락해 옮겨주세요." : "휴진일을 추가했습니다.", !!x.affected);
          route();
        }).catch(fail);
      });
      var today = C.seoulNow().date;
      var list = el("ul", { class: "agenda" });
      r[1].items.forEach(function (h) {
        list.appendChild(el("li", null, [
          el("span", { class: "t small", text: h.date.slice(5) }),
          el("span", { class: "who" }, [el("b", { text: h.label }), el("small", { text: C.formatDate(h.date) + (h.date < today ? " · 지남" : "") })]),
          el("span", { class: "acts" }, [armButton("삭제", "삭제 확인", "btn-danger", function () { api("DELETE", "holidays/" + h.date).then(function () { toast("삭제했습니다."); route(); }).catch(fail); })])
        ]));
      });
      v.appendChild(el("section", { class: "panel" }, [el("h2", null, ["휴진일 · 공휴일"]), add, r[1].items.length ? list : el("p", { class: "empty", text: "등록된 휴진일이 없습니다." })]));
    });
  };

  /* ---------- 병원 정보 · 예약 규칙 ---------- */
  VIEWS.clinic = function (v) {
    return api("GET", "settings").then(function (r) {
      v.textContent = "";
      v.appendChild(head("병원 정보 · 예약 규칙", "홈페이지 하단, 오시는 길, 문자 메시지에 쓰이는 정보입니다."));
      var c = r.clinic, b = r.booking, inputs = {};
      var cf = [
        ["name", "병원 이름 (정식 명칭)"], ["shortName", "짧은 이름 (문자 머리글)"], ["phone", "대표 전화"], ["director", "대표원장"],
        ["address", "주소", true], ["subway", "지하철 안내", true], ["parking", "주차 안내", true], ["bizNo", "사업자등록번호"],
        ["naverBookingUrl", "네이버 예약 주소"], ["kakaoUrl", "카카오톡 채널 주소"], ["naverMapUrl", "네이버 지도 주소"], ["kakaoMapUrl", "카카오맵 주소"]
      ];
      var form1 = el("form", { class: "grid-form" });
      cf.forEach(function (x) {
        var i = input({ type: /Url$/.test(x[0]) ? "url" : "text", value: c[x[0]] || "", placeholder: /Url$/.test(x[0]) ? "https://" : "" });
        inputs[x[0]] = i;
        var f = field(x[1], i); if (x[2]) f.classList.add("wide"); form1.appendChild(f);
      });
      form1.appendChild(el("div", { class: "wide" }, [el("button", { class: "btn btn-primary btn-sm", type: "submit", text: "병원 정보 저장" })]));
      form1.addEventListener("submit", function (e) {
        e.preventDefault();
        var body = {}; Object.keys(inputs).forEach(function (k) { body[k] = inputs[k].value; });
        api("PUT", "settings/clinic", body).then(function () { toast("병원 정보를 저장했습니다."); }).catch(fail);
      });

      var bf = [
        ["slotMinutes", "예약 단위 (분)", "30분 단위면 09:30, 10:00 … 으로 표시"], ["capacity", "시간대당 온라인 예약 수", "체어 수·의료진 수에 맞추세요"],
        ["leadMinutes", "최소 예약 여유 (분)", "지금부터 이 시간 이후만 예약 가능"], ["windowDays", "예약 가능 기간 (일)", "오늘부터 며칠 뒤까지"],
        ["lastEntryMinutes", "마감 전 접수 종료 (분)", "진료 종료 몇 분 전까지 예약"], ["maxActivePerPhone", "연락처당 예약 수", "장난 예약 방지"],
        ["retentionDays", "개인정보 보관 기간 (일)", "지난 예약의 성함·연락처를 자동 파기"]
      ];
      var bi = {};
      var form2 = el("form", { class: "grid-form" });
      bf.forEach(function (x) { var i = input({ type: "number", value: b[x[0]], min: 0 }); bi[x[0]] = i; form2.appendChild(field(x[1], i, x[2])); });
      form2.appendChild(el("div", { class: "wide" }, [el("button", { class: "btn btn-primary btn-sm", type: "submit", text: "예약 규칙 저장" })]));
      form2.addEventListener("submit", function (e) {
        e.preventDefault();
        var body = {}; Object.keys(bi).forEach(function (k) { body[k] = Number(bi[k].value); });
        api("PUT", "settings/booking", body).then(function () { toast("예약 규칙을 저장했습니다."); }).catch(fail);
      });
      v.appendChild(el("section", { class: "panel" }, [el("h2", null, ["병원 정보"]), form1]));
      v.appendChild(el("section", { class: "panel" }, [el("h2", null, ["온라인 예약 규칙"]), form2]));
    });
  };

  /* ---------- 진료비 · 의료진 · 공지 (목록 편집) ---------- */
  function listEditor(resource, title, desc, cols, blank, opts) {
    opts = opts || {};
    return function (v) {
      return api("GET", resource).then(function (r) {
        v.textContent = "";
        v.appendChild(head(title, desc));
        var box = el("div", { class: "items" });
        (opts.fixed ? r.items : r.items.concat([Object.assign({ _new: true }, blank)])).forEach(function (item) {
          var get = {};
          var fields = el("div", { class: "item-fields" });
          cols.forEach(function (c) {
            var i;
            if (c.type === "checkbox") {
              i = input({ type: "checkbox", checked: item[c.key] == null ? c.def : !!item[c.key] });
              get[c.key] = function () { return i.checked; };
              fields.appendChild(el("label", { class: "chk" + (c.wide ? " wide" : "") }, [i, c.label]));
              return;
            }
            if (c.type === "multi") {
              var chosen = String(item[c.key] || "").split(",").filter(Boolean), boxes = [];
              var grp = el("div", { class: "multi" });
              c.options.forEach(function (o) {
                var cb = input({ type: "checkbox", checked: chosen.indexOf(o.key) >= 0, value: o.key });
                boxes.push(cb); grp.appendChild(el("label", { class: "chk" }, [cb, o.label]));
              });
              get[c.key] = function () { return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }).join(","); };
              fields.appendChild(el("div", { class: "field" + (c.wide ? " wide" : "") }, [el("span", { class: "small", text: c.label }), grp]));
              return;
            }
            if (c.type === "select") {
              i = select(c.options, item[c.key] || "");
              get[c.key] = function () { return i.value || null; };
              fields.appendChild(field(c.label, i));
              return;
            }
            i = c.type === "textarea" ? el("textarea", { value: item[c.key] == null ? "" : item[c.key], rows: c.rows || 3, placeholder: c.ph || "" })
              : input({ type: c.type || "text", value: item[c.key] == null ? "" : item[c.key], placeholder: c.ph || "" });
            get[c.key] = function () { return c.type === "number" ? (i.value === "" ? null : Number(i.value)) : i.value; };
            var f = field(c.label, i); if (c.wide) f.classList.add("wide"); fields.appendChild(f);
          });
          var collect = function () { var o = {}; Object.keys(get).forEach(function (k) { o[k] = get[k](); }); return o; };
          var acts = el("div", { class: "item-acts" });
          if (opts.fixed) {
            acts.appendChild(el("button", { class: "btn btn-primary btn-sm", type: "button", text: "저장", onclick: function () {
              api("PUT", resource + "/" + item.id, collect()).then(function () { toast("저장했습니다. 홈페이지에 바로 반영됩니다."); }).catch(fail);
            } }));
          } else if (item._new) {
            acts.appendChild(el("button", { class: "btn btn-primary btn-sm", type: "button", text: "추가", onclick: function () {
              api("POST", resource, collect()).then(function () { toast("추가했습니다."); route(); }).catch(fail);
            } }));
          } else {
            acts.appendChild(armButton("삭제", "삭제 확인", "btn-danger", function () { api("DELETE", resource + "/" + item.id).then(function () { toast("삭제했습니다."); route(); }).catch(fail); }));
            acts.appendChild(el("button", { class: "btn btn-primary btn-sm", type: "button", text: "저장", onclick: function () {
              api("PUT", resource + "/" + item.id, collect()).then(function () { toast("저장했습니다."); }).catch(fail);
            } }));
          }
          box.appendChild(el("div", { class: "item" + (item._new ? " new" : "") }, [item._new ? el("b", { class: "small", text: "새 항목" }) : opts.titleKey ? el("b", { text: item[opts.titleKey] }) : null, fields, acts]));
        });
        v.appendChild(box);
      });
    };
  }
  var CENTER_OPTS = C.TREATMENTS.filter(function (t) { return t.key !== "checkup"; }).map(function (t) { return { key: t.key, label: t.label }; });
  VIEWS.centers = listEditor("centers", "진료센터", "홈페이지 첫 메뉴(1 depth)와 센터 페이지 내용입니다. 진료 과정·자주 묻는 질문은 한 줄에 하나씩 '제목|설명' 형식으로 적습니다. 센터 진료 요일은 '의료진'의 담당 센터와 진료 요일로 자동 계산됩니다.", [
    { key: "name", label: "센터 이름" }, { key: "en", label: "영문 표기" }, { key: "sort", label: "표시 순서", type: "number" },
    { key: "summary", label: "한 줄 소개 (카드에 표시)", wide: true }, { key: "tags", label: "태그 (쉼표로 구분)", wide: true },
    { key: "description", label: "센터 소개 (문단은 줄바꿈)", type: "textarea", wide: true, rows: 4 },
    { key: "process", label: "진료 과정 (제목|설명)", type: "textarea", wide: true, rows: 5 },
    { key: "faq", label: "자주 묻는 질문 (질문|답변)", type: "textarea", wide: true, rows: 4 },
    { key: "prep", label: "첫 방문 준비물 (한 줄에 하나, 데스크 '첫 방문 준비물'에 표시)", type: "textarea", wide: true, rows: 4 },
    { key: "published", label: "홈페이지에 공개", type: "checkbox", def: true }
  ], {}, { fixed: true, titleKey: "key" });
  VIEWS.fees = listEditor("fees", "비급여 진료비", "의료법에 따라 비급여 진료비는 환자가 볼 수 있게 고지해야 합니다. 저장하면 홈페이지 진료비 표가 바뀝니다.", [
    { key: "name", label: "항목" }, { key: "unit", label: "단위", ph: "1개 / 1치아" }, { key: "price", label: "금액 (원)", type: "number", ph: "비우면 '상담 후 안내'" },
    { key: "sort", label: "표시 순서", type: "number" }, { key: "center", label: "진료센터", type: "select", options: [{ key: "", label: "공통" }].concat(CENTER_OPTS) }, { key: "note", label: "비고", wide: true }
  ], { sort: 99 });
  VIEWS.doctors = listEditor("doctors", "의료진", "확인 가능한 학력·자격만 적으세요. 진료 요일은 홈페이지 '오늘 진료 의료진'에 쓰입니다.", [
    { key: "name", label: "성함" }, { key: "role", label: "직함 · 전문의" }, { key: "days", label: "진료 요일", ph: "월화수목금토" }, { key: "sort", label: "표시 순서", type: "number" },
    { key: "centers", label: "담당 진료센터 (이 센터 예약은 담당 원장 진료 요일에만 열림)", type: "multi", options: CENTER_OPTS, wide: true },
    { key: "career", label: "이력 (한 줄에 하나)", type: "textarea", wide: true }, { key: "quote", label: "한마디", wide: true }
  ], { sort: 99 });
  VIEWS.notices = listEditor("notices", "공지사항", "'상단 고정'을 켠 공지는 홈페이지 맨 위 띠에 표시됩니다.", [
    { key: "title", label: "제목", wide: true }, { key: "body", label: "내용", type: "textarea", wide: true, rows: 4 },
    { key: "pinned", label: "상단 고정", type: "checkbox", def: false }, { key: "published", label: "홈페이지에 공개", type: "checkbox", def: true }
  ], {});

  /* ---------- 계정 ---------- */
  VIEWS.accounts = function (v) {
    v.textContent = "";
    v.appendChild(head("계정", isAdmin() ? "직원 계정은 예약 관리와 공지만, 관리자 계정은 모든 설정을 바꿀 수 있습니다." : "내 비밀번호를 바꿀 수 있습니다."));
    var cur = input({ type: "password", autocomplete: "current-password" }), nx = input({ type: "password", autocomplete: "new-password", minlength: 10 });
    var pw = el("form", { class: "grid-form" }, [field("현재 비밀번호", cur), field("새 비밀번호", nx, "10자 이상"), el("div", { class: "wide" }, [el("button", { class: "btn btn-primary btn-sm", type: "submit", text: "비밀번호 변경" })])]);
    pw.addEventListener("submit", function (e) {
      e.preventDefault();
      api("POST", "password", { current: cur.value, next: nx.value }).then(function () { cur.value = nx.value = ""; toast("비밀번호를 바꿨습니다. 다른 기기의 로그인은 해제됩니다."); }).catch(fail);
    });
    v.appendChild(el("section", { class: "panel" }, [el("h2", null, ["내 비밀번호 · " + S.user.username]), pw]));
    if (!isAdmin()) return;
    return api("GET", "users").then(function (r) {
      var list = el("ul", { class: "agenda" });
      r.items.forEach(function (u) {
        list.appendChild(el("li", null, [
          el("span", { class: "t small", text: u.role === "admin" ? "관리자" : "직원" }),
          el("span", { class: "who" }, [el("b", { text: u.name }), " ", el("span", { class: "muted small mono", text: u.username })]),
          el("span", { class: "acts" }, [u.id === S.user.id ? el("span", { class: "muted small", text: "로그인 중" }) : armButton("삭제", "삭제 확인", "btn-danger", function () { api("DELETE", "users/" + u.id).then(function () { toast("계정을 삭제했습니다."); route(); }).catch(fail); })])
        ]));
      });
      var un = input({ type: "text", autocomplete: "off", placeholder: "영문·숫자" }), nm = input({ type: "text" }), rp = input({ type: "password", autocomplete: "new-password" });
      var rl = select([{ key: "staff", label: "직원" }, { key: "admin", label: "관리자" }], "staff");
      var add = el("form", { class: "grid-form" }, [field("아이디", un), field("이름", nm), field("임시 비밀번호", rp, "10자 이상, 첫 로그인 후 바꾸게 하세요"), field("권한", rl), el("div", { class: "wide" }, [el("button", { class: "btn btn-primary btn-sm", type: "submit", text: "계정 추가" })])]);
      add.addEventListener("submit", function (e) {
        e.preventDefault();
        api("POST", "users", { username: un.value, name: nm.value, password: rp.value, role: rl.value }).then(function () { toast("계정을 추가했습니다."); route(); }).catch(fail);
      });
      v.appendChild(el("section", { class: "panel" }, [el("h2", null, ["직원 계정"]), list]));
      v.appendChild(el("section", { class: "panel" }, [el("h2", null, ["계정 추가"]), add]));
    });
  };

  /* ---------- 기록 ---------- */
  var ACTIONS = {
    "login": "로그인", "reservation.create": "예약 추가", "reservation.update": "예약 수정", "reservation.cancel": "환자 예약 취소", "reservation.export": "예약 내려받기",
    "settings.clinic": "병원 정보 변경", "settings.booking": "예약 규칙 변경", "settings.hours": "진료시간 변경", "holiday.set": "휴진일 등록", "holiday.delete": "휴진일 삭제",
    "fees.create": "진료비 추가", "fees.update": "진료비 수정", "fees.delete": "진료비 삭제", "doctors.create": "의료진 추가", "doctors.update": "의료진 수정", "doctors.delete": "의료진 삭제",
    "notices.create": "공지 추가", "notices.update": "공지 수정", "notices.delete": "공지 삭제", "user.create": "계정 추가", "user.delete": "계정 삭제", "user.password": "비밀번호 변경",
    "privacy.purge": "개인정보 자동 파기", "live.update": "홈페이지 실시간 안내 변경", "centers.update": "진료센터 수정", "desk.update": "센터 데스크 변경", "inquiry.update": "상담 요청 처리"
  };
  var OUT = { sent: "발송", failed: "실패", skipped: "미발송 (연동 전)", sending: "발송 중" };
  function when(iso) { var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  VIEWS.logs = function (v) {
    return Promise.all([api("GET", "outbox"), isAdmin() ? api("GET", "audit") : Promise.resolve(null)]).then(function (r) {
      v.textContent = "";
      v.appendChild(head("기록", "문자·알림 발송 내역과 누가 무엇을 바꿨는지 남습니다."));
      var ob = el("tbody");
      r[0].items.forEach(function (m) {
        ob.appendChild(el("tr", null, [
          el("td", { class: "mono nowrap", text: when(m.at) }), el("td", { class: "nowrap", text: m.channel === "sms" ? "환자 문자" : "직원 알림" }),
          el("td", { class: "mono nowrap", text: m.recipient ? C.formatPhone(m.recipient) : "" }), el("td", { text: m.body }),
          el("td", { class: "nowrap", text: (OUT[m.status] || m.status) + (m.error ? " · " + m.error : "") })
        ]));
      });
      v.appendChild(el("section", { class: "panel" }, [
        el("h2", null, ["문자 · 알림 발송"]),
        r[0].items.length ? el("div", { class: "tbl-box" }, [el("table", { class: "tbl" }, [el("thead", null, [el("tr", null, ["시각", "종류", "받는 사람", "내용", "결과"].map(function (h) { return el("th", { text: h }); }))]), ob])]) : el("p", { class: "empty", text: "발송 기록이 없습니다." }),
        el("p", { class: "muted small", text: "'미발송 (연동 전)'은 문자 발송 업체가 아직 연결되지 않았다는 뜻입니다. 설치 안내서의 SMS_WEBHOOK_URL 설정을 참고하세요." })
      ]));
      if (!r[1]) return;
      var ab = el("tbody");
      r[1].items.forEach(function (a) {
        ab.appendChild(el("tr", null, [el("td", { class: "mono nowrap", text: when(a.at) }), el("td", { class: "nowrap", text: a.username }), el("td", { class: "nowrap", text: ACTIONS[a.action] || a.action }), el("td", { class: "clip", text: [a.target, a.detail].filter(Boolean).join(" ") })]));
      });
      v.appendChild(el("section", { class: "panel" }, [el("h2", null, ["활동 기록 (최근 300건)"]), el("div", { class: "tbl-box" }, [el("table", { class: "tbl" }, [el("thead", null, [el("tr", null, ["시각", "계정", "작업", "대상"].map(function (h) { return el("th", { text: h }); }))]), ab])])]));
    });
  };

  /* ---------- 시작 ---------- */
  api("GET", "me").then(start).catch(function () { showLogin(); });
})();
