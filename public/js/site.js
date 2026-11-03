/* W치과 홈페이지 — 서버 API에서 병원 정보·진료시간·진료비를 읽고 온라인 예약을 처리합니다. */
(function () {
  "use strict";
  var C = window.WCore;
  var $ = function (id) { return document.getElementById(id); };
  var site = null;

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
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  function won(n) { return n == null ? "상담 후 안내" : n.toLocaleString("ko-KR") + "원"; }
  function copy(btn, text) {
    var label = btn.textContent;
    var done = function (msg) { btn.textContent = msg; setTimeout(function () { btn.textContent = label; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done("복사했어요"); }, function () { done(text); });
    else done(text);
  }

  /* ---------- 글자 크게 / 테마 ---------- */
  var root = document.documentElement, textBtn = $("textBtn");
  function setLarge(on) { root.classList.toggle("large-text", on); textBtn.setAttribute("aria-pressed", on ? "true" : "false"); }
  setLarge(store.get("w-large") === "1");
  textBtn.addEventListener("click", function () { var on = !root.classList.contains("large-text"); setLarge(on); store.set("w-large", on ? "1" : "0"); });
  var savedTheme = store.get("w-theme"); if (savedTheme) root.setAttribute("data-theme", savedTheme);
  $("themeBtn").addEventListener("click", function () {
    var cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next); store.set("w-theme", next);
  });

  /* ---------- 증상으로 진료 찾기 ---------- */
  var SYMPTOMS = [
    { id: "cold", label: "이가 시려요", t: "endo", time: "약 40분", tip: "찬물·단 음식에 반응하는 치아 위치를 기억해 오세요.", ins: "검사와 기본 치료는 건강보험 적용" },
    { id: "bite", label: "씹을 때 아파요", t: "endo", time: "약 50분", tip: "금 간 치아인지 확인하려면 X-ray와 교합 검사를 합니다.", ins: "신경치료는 건강보험 적용" },
    { id: "gum", label: "잇몸에서 피가 나요", t: "perio", time: "약 60분", tip: "스케일링 후 잇몸 염증 정도를 측정합니다.", ins: "만 19세 이상 스케일링 연 1회 보험" },
    { id: "lost", label: "이가 빠졌어요", t: "implant", time: "60 – 90분 (CT 포함)", tip: "복용 중인 약(특히 혈액 응고제·골다공증 약)을 알려주세요.", ins: "만 65세 이상 평생 2개 보험" },
    { id: "crooked", label: "치아가 삐뚤어요", t: "ortho", time: "약 60분 (정밀 진단)", tip: "투명교정과 고정식 교정의 기간·비용을 비교해 드립니다.", ins: "비급여 (진료비 안내 참고)" },
    { id: "jaw", label: "턱에서 소리가 나요", t: "tmj", time: "약 60분", tip: "입 벌릴 때 아픈 쪽과 이 갈이 여부를 확인합니다.", ins: "검사 일부 건강보험 적용" },
    { id: "kid", label: "아이 첫 검진", t: "kids", time: "약 30분", tip: "아이가 평소 쓰는 칫솔을 가져오시면 칫솔질을 같이 연습합니다.", ins: "만 18세 이하 실란트 보험" },
    { id: "color", label: "치아 색이 누래요", t: "esthetic", time: "약 40분", tip: "셰이드 가이드로 현재 치아 색을 기록해 둡니다.", ins: "비급여 (진료비 안내 참고)" }
  ];
  var chips = $("chips"), out = $("finderResult");
  SYMPTOMS.forEach(function (s, i) {
    var input = el("input", { type: "radio", name: "sym", id: "sym-" + s.id, value: s.id, checked: i === 0 });
    chips.appendChild(el("label", { class: "chip", for: "sym-" + s.id }, [input, el("span", { text: s.label })]));
  });
  function showSymptom(id) {
    var s = SYMPTOMS.filter(function (x) { return x.id === id; })[0]; if (!s) return;
    out.textContent = "";
    [["추천 진료", C.labelOf(C.TREATMENTS, s.t)], ["첫 방문", s.time], ["미리 알아두세요", s.tip], ["보험", s.ins]].forEach(function (p, i) {
      out.appendChild(el("dt", { text: p[0] }));
      out.appendChild(el("dd", null, [i === 0 ? el("b", { text: p[1] }) : p[1]]));
    });
    out.appendChild(el("a", { class: "btn btn-primary go", href: "#reserve", text: "이 진료로 예약하기", onclick: function () {
      $("rClinic").value = s.t;
      if (!$("rMemo").value) $("rMemo").value = s.label;
    } }));
  }
  chips.addEventListener("change", function (e) { if (e.target.name === "sym") showSymptom(e.target.value); });
  showSymptom(SYMPTOMS[0].id);

  /* ---------- 병원 정보 렌더링 ---------- */
  function renderClinic(c) {
    document.querySelectorAll("[data-bind]").forEach(function (n) { var v = c[n.getAttribute("data-bind")]; if (v) n.textContent = v; });
    document.querySelectorAll("[data-href]").forEach(function (n) {
      var v = c[n.getAttribute("data-href")];
      if (v) n.setAttribute("href", v); else n.hidden = true;
    });
    $("dockTel").setAttribute("href", "tel:" + C.normalizePhone(c.phone));
    document.title = c.shortName + " | 치료 계획부터 보여드리는 치과";
  }

  function renderHours(hours, holidays) {
    var tb = $("hoursRows"); tb.textContent = "";
    var order = [1, 2, 3, 4, 5, 6, 0], lunch = {}, lateDays = [];
    order.forEach(function (w) {
      var h = hours.filter(function (x) { return x.weekday === w; })[0] || { closed: 1 };
      var tr = el("tr", { "data-day": w, class: w === site.now.weekday ? "today" : null });
      var label = w === 0 ? "일 · 공휴일" : C.WEEKDAYS[w] + "요일";
      var td = el("td", null, [h.closed ? "휴진" : h.open + " – " + h.close]);
      if (!h.closed && h.note) td.appendChild(el("span", { class: "tag", text: h.note }));
      if (!h.closed && h.lunch_start) lunch[h.lunch_start + " – " + h.lunch_end] = true;
      if (!h.closed && C.toMin(h.close) >= 20 * 60) lateDays.push(C.WEEKDAYS[w]);
      tr.appendChild(el("th", { scope: "row", text: label }));
      tr.appendChild(td);
      tb.appendChild(tr);
    });
    var notes = [];
    var l = Object.keys(lunch); if (l.length) notes.push("점심시간 " + l.join(", "));
    notes.push("접수는 진료 종료 " + site.booking.lastEntryMinutes + "분 전까지 받습니다.");
    $("hoursNote").textContent = notes.join(" · ");
    if (lateDays.length) $("hoursLead").textContent = lateDays.join("·") + "요일은 저녁까지 진료합니다. 퇴근 후에도 예약하고 오세요.";

    var list = $("holidayList"); list.textContent = "";
    holidays.slice(0, 8).forEach(function (h) { list.appendChild(el("li", { text: C.formatDate(h.date) + " " + h.label })); });
    $("holidayBox").hidden = !holidays.length;
  }

  function renderFees(fees, updatedAt) {
    var tb = $("feeRows"); tb.textContent = "";
    if (!fees.length) { tb.appendChild(el("tr", null, [el("td", { colspan: 3, text: "등록된 비급여 항목이 없습니다." })])); return; }
    fees.forEach(function (f) {
      var name = el("td", null, [f.name]);
      if (f.note) name.appendChild(el("span", { class: "fee-note", text: f.note }));
      tb.appendChild(el("tr", null, [name, el("td", { text: f.unit || "" }), el("td", { class: "num", text: won(f.price) })]));
    });
    if (updatedAt) $("feeCaption").textContent = "비급여 진료비 · " + updatedAt.slice(0, 10) + " 기준";
  }

  function renderDoctors(docs) {
    var box = $("doctorList"); box.textContent = "";
    docs.forEach(function (d) {
      var portrait = el("div", { class: "portrait" });
      portrait.innerHTML = '<svg viewBox="0 0 64 40" aria-hidden="true"><use href="#w-mark"/></svg>';
      var career = el("ul");
      String(d.career || "").split("\n").filter(Boolean).forEach(function (c) { career.appendChild(el("li", { text: c })); });
      box.appendChild(el("article", { class: "doctor" }, [
        portrait, el("p", { class: "role", text: d.role || "" }), el("h3", { text: d.name }), career,
        d.quote ? el("blockquote", { text: d.quote }) : null
      ]));
    });
  }

  function renderNotices(notices) {
    var list = $("noticeList"); list.textContent = "";
    notices.forEach(function (n) {
      list.appendChild(el("li", null, [el("details", null, [
        el("summary", null, [el("span", { class: "t", text: n.title }), el("time", { datetime: n.created_at, text: n.created_at.slice(0, 10) })]),
        n.body ? el("p", { text: n.body }) : null
      ])]));
    });
    $("notices").hidden = !notices.length;
    var pinned = notices.filter(function (n) { return n.pinned; })[0];
    if (pinned) { $("noticeBarText").textContent = pinned.title; $("noticeBar").hidden = false; }
  }

  function renderStatus(s) {
    $("status").setAttribute("data-open", s.open ? "true" : "false");
    $("statusText").textContent = s.text;
  }
  function refreshStatus() {
    if (!site) return;
    var hm = {}; site.holidays.forEach(function (h) { hm[h.date] = h.label; });
    site.now = C.seoulNow();
    renderStatus(C.openStatus(site.hours, hm, site.now));
  }

  /* ---------- 온라인 예약 ---------- */
  var pick = { date: null, time: null };
  var sel = $("rClinic");

  function loadDays() {
    return api("days").then(function (d) {
      var strip = $("dayStrip"); strip.textContent = "";
      var first = null;
      d.days.forEach(function (day) {
        var p = day.date.split("-");
        var disabled = day.closed || day.available === 0;
        var btn = el("button", {
          type: "button", class: "day" + (day.weekday === 0 ? " sun" : ""), "data-date": day.date, disabled: disabled,
          "aria-pressed": "false", "aria-label": C.formatDate(day.date) + (disabled ? " 예약 불가" + (day.reason ? " (" + day.reason + ")" : "") : " 예약 가능 " + day.available + "개"),
          title: day.reason || null
        }, [
          el("span", { class: "dw", text: day.date === site.now.date ? "오늘" : C.WEEKDAYS[day.weekday] }),
          el("span", { class: "dd", text: String(parseInt(p[2], 10)) }),
          el("span", { class: "da", text: day.closed ? (day.reason === "정기 휴진" ? "휴진" : day.reason.length <= 4 ? day.reason : "휴진") : day.available ? "예약 가능" : "마감" })
        ]);
        btn.addEventListener("click", function () { chooseDate(day.date); });
        strip.appendChild(btn);
        if (!disabled && !first) first = day.date;
      });
      if (pick.date && strip.querySelector('[data-date="' + pick.date + '"]:not(:disabled)')) chooseDate(pick.date, true);
      else if (first) chooseDate(first, true);
    });
  }

  function chooseDate(ds, keepScroll) {
    pick.date = ds;
    document.querySelectorAll("#dayStrip .day").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-date") === ds ? "true" : "false"); });
    var box = $("slotBox");
    box.textContent = ""; box.appendChild(el("div", { class: "slot-empty", text: "예약 가능한 시간을 확인하는 중입니다." }));
    return api("slots?date=" + ds).then(function (r) {
      box.textContent = "";
      if (r.closed || !r.slots.length) { box.appendChild(el("div", { class: "slot-empty", text: r.reason || "이 날은 예약할 수 있는 시간이 없습니다." })); setTime(null); return; }
      var grid = el("div", { class: "slots", role: "group", "aria-label": C.formatDate(ds) + " 예약 시간" });
      var stillOk = false;
      r.slots.forEach(function (s) {
        var full = s.remaining <= 0;
        if (s.time === pick.time && !full) stillOk = true;
        grid.appendChild(el("button", {
          type: "button", class: "slot", disabled: full, "aria-pressed": s.time === pick.time && !full ? "true" : "false",
          "aria-label": s.time + (full ? " 마감" : " 예약 가능"), "data-time": s.time, text: s.time,
          onclick: function () { setTime(s.time); }
        }));
      });
      box.appendChild(grid);
      if (!stillOk) setTime(null);
      if (!keepScroll) grid.querySelector(".slot:not(:disabled)") && grid.querySelector(".slot:not(:disabled)").focus({ preventScroll: true });
    }).catch(function (e) { box.textContent = ""; box.appendChild(el("div", { class: "slot-empty", text: e.message })); });
  }

  function setTime(t) {
    pick.time = t;
    document.querySelectorAll("#slotBox .slot").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-time") === t ? "true" : "false"); });
    var p = $("picked"); p.textContent = "선택한 시간: ";
    p.appendChild(el("b", { text: t && pick.date ? C.formatDate(pick.date) + " " + t : "없음" }));
  }

  function showError(msg, fieldId) {
    var fe = $("formError"); fe.textContent = msg; fe.hidden = !msg;
    ["fName", "fPhone"].forEach(function (id) { $(id).classList.toggle("invalid", id === fieldId); });
  }

  $("reserveForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var payload = {
      name: $("rName").value, phone: $("rTel").value, treatment: sel.value, memo: $("rMemo").value,
      date: pick.date, time: pick.time, consent: $("rAgree").checked, website: $("rWebsite").value
    };
    var v = C.validateReservation(payload);
    if (!v.ok) {
      var order = ["treatment", "date", "time", "name", "phone", "memo", "consent"];
      var k = order.filter(function (x) { return v.errors[x]; })[0];
      showError(v.errors[k], k === "name" ? "fName" : k === "phone" ? "fPhone" : null);
      if (k === "name") $("rName").focus(); else if (k === "phone") $("rTel").focus();
      return;
    }
    showError("");
    var btn = $("submitBtn"); btn.disabled = true; btn.textContent = "신청하는 중…";
    api("reservations", payload).then(function (r) {
      $("reserveForm").hidden = true;
      $("doneCode").textContent = r.code;
      var dl = $("doneInfo"); dl.textContent = "";
      [["일시", C.formatDate(r.date) + " " + r.time], ["진료", r.treatmentLabel], ["예약자", r.name], ["상태", r.statusLabel]].forEach(function (p) {
        dl.appendChild(el("dt", { text: p[0] })); dl.appendChild(el("dd", { text: p[1] }));
      });
      $("bookDone").hidden = false; $("bookDone").focus();
      $("lCode").value = r.code; $("lTel").value = payload.phone;
    }).catch(function (err) {
      showError(err.message, err.data && err.data.fields && err.data.fields.phone ? "fPhone" : null);
      if (err.status === 409) loadDays();
    }).then(function () { btn.disabled = false; btn.textContent = "예약 신청하기"; });
  });

  $("newBooking").addEventListener("click", function () {
    $("bookDone").hidden = true; $("reserveForm").hidden = false;
    $("rMemo").value = ""; $("rAgree").checked = false; pick.time = null;
    loadDays();
  });

  /* ---------- 예약 확인 · 취소 ---------- */
  function renderLookup(r) {
    var box = $("lookupResult"); box.textContent = "";
    var card = el("div", { class: "lookup-result" }, [
      el("div", null, [el("span", { class: "pill " + r.status, text: r.statusLabel }), " ", el("b", { text: C.formatDate(r.date) + " " + r.time })]),
      el("div", { text: r.treatmentLabel + " · " + r.name + " · 예약번호 " + r.code })
    ]);
    if (r.canCancel) {
      var armed = false;
      var cancel = el("button", { class: "btn btn-ghost", type: "button", text: "예약 취소" });
      cancel.addEventListener("click", function () {
        if (!armed) { armed = true; cancel.textContent = "한 번 더 누르면 취소됩니다"; return; }
        cancel.disabled = true;
        api("reservations/cancel", { code: r.code, phone: $("lTel").value }).then(function (x) { renderLookup(x); loadDays(); })
          .catch(function (e) { box.appendChild(el("p", { class: "form-error", text: e.message })); });
      });
      card.appendChild(cancel);
    }
    box.appendChild(card);
  }
  $("lookupForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var box = $("lookupResult");
    api("reservations/lookup", { code: $("lCode").value, phone: $("lTel").value })
      .then(renderLookup)
      .catch(function (err) { box.textContent = ""; box.appendChild(el("p", { class: "form-error", text: err.message })); });
  });

  /* ---------- 시작 ---------- */
  $("copyAddr").addEventListener("click", function (e) { copy(e.currentTarget, site ? site.clinic.address : ""); });
  $("copyTel").addEventListener("click", function (e) { copy(e.currentTarget, site ? site.clinic.phone : ""); });

  api("site").then(function (s) {
    site = s; site.now = C.seoulNow();
    sel.textContent = "";
    s.treatments.forEach(function (t) { sel.appendChild(el("option", { value: t.key, text: t.label })); });
    renderClinic(s.clinic);
    renderHours(s.hours, s.holidays);
    renderFees(s.fees, s.feesUpdatedAt);
    renderDoctors(s.doctors);
    renderNotices(s.notices);
    renderStatus(s.status);
    if (s.booking.retentionDays) $("retention").textContent = s.booking.retentionDays;
    setInterval(refreshStatus, 60000);
    return loadDays();
  }).catch(function (e) {
    renderStatus({ open: false, text: "정보를 불러오지 못했습니다" });
    $("slotBox").textContent = e.message + " 전화로 예약해 주세요.";
  });
})();
