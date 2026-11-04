/*
 * W치과 안내 챗봇 — 고객과의 첫 만남.
 * 규칙 기반(정해진 대화 흐름 + 단어 인식)으로 동작하며, 진단이나 치료 효과는 말하지 않습니다.
 * 보여주는 시간·접수 상황은 site.js 가 받아온 실시간 데이터(window.WApp)를 그대로 씁니다.
 */
(function () {
  "use strict";
  var A = window.WApp, C = window.WCore;
  if (!A) return;
  var $ = function (id) { return document.getElementById(id); };
  var el = A.el;
  var chat = $("chat"), log = $("chatLog"), chipBox = $("chatChips"), form = $("chatForm"), input = $("chatInput");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pending = null;     // 입력을 기다리는 질문 { handler, type }
  var started = false;

  /* ---------- 말풍선 ---------- */
  function scroll() { log.scrollTop = log.scrollHeight; }
  function nodeOf(x) { return typeof x === "string" ? el("p", { text: x }) : x; }
  function bubble(who, parts) {
    var m = el("div", { class: "msg " + who }, [el("div", { class: "msg-b" }, parts.filter(Boolean).map(nodeOf))]);
    log.appendChild(m); scroll(); return m;
  }
  var queue = Promise.resolve();
  function bot(parts) {
    parts = Array.isArray(parts) ? parts : [parts];
    queue = queue.then(function () {
      return new Promise(function (res) {
        if (reduce) { sayBot(bubble("bot", parts)); return res(); }
        var t = el("div", { class: "typing", "aria-hidden": "true" }, [el("i"), el("i"), el("i")]);
        log.appendChild(t); scroll();
        setTimeout(function () { t.remove(); var m = bubble("bot", parts); sayBot(m); res(); }, 350 + Math.min(500, parts.length * 120));
      });
    });
    return queue;
  }
  function me(text) { bubble("me", [text]); }
  var V = window.WVoice;
  function sayBot(m) {
    if (!V || !V.enabled()) return;
    var c = m.cloneNode(true); c.querySelectorAll("[data-nosay]").forEach(function (n) { n.remove(); }); // 그림 고르기 판은 읽지 않음(안내 문장만)
    V.speak((c.textContent || "").replace(/\s+/g, " ").trim(), { interrupt: false });
  }
  // 말로 묻기
  var mic = $("chatMic");
  if (V && V.canListen) {
    mic.hidden = false;
    var rec = null;
    mic.addEventListener("click", function () {
      if (rec) { rec.stop(); return; }
      rec = V.listen(function (text) {
        input.value = text;
        if (typeof form.requestSubmit === "function") form.requestSubmit(); else form.dispatchEvent(new Event("submit", { cancelable: true }));
      }, function (state, err) {
        if (state === "listening") { mic.classList.add("on"); mic.textContent = "듣는 중…"; input.placeholder = "말씀해 주세요. 예: 이가 시려요"; }
        else { mic.classList.remove("on"); mic.textContent = "말하기"; resetInput(); rec = null;
          if (state === "error" && err !== "no-speech" && err !== "aborted") bubble("bot", ["말소리를 듣지 못했어요. 마이크 사용을 허락하셨는지 확인하시거나, 아래 버튼을 눌러 주세요."]); }
      });
    });
  }
  function liveLine(items) { return el("div", { class: "live" }, items.filter(Boolean).map(function (t) { return el("span", { text: t }); })); }
  function chips(list) {
    queue.then(function () {
      chipBox.textContent = "";
      list.filter(Boolean).forEach(function (c) {
        var b;
        if (c.href) b = el("a", { href: c.href, target: c.ext && !/^tel:/.test(c.href) ? "_blank" : null, rel: c.ext ? "noopener" : null, text: c.label });
        else b = el("button", { type: "button", class: c.primary ? "primary" : null, text: c.label });
        if (c.icon && window.WPicto) { b.classList.add("has-picto"); b.insertBefore(window.WPicto.icon(c.icon), b.firstChild); }
        b.addEventListener("click", function (e) {
          if (c.href && !c.ext) { e.preventDefault(); }
          me(c.label); chipBox.textContent = ""; pending = null; resetInput();
          if (c.go) c.go();
          if (c.href && !c.ext) { closeSheetOnMobile(); location.hash = c.href.slice(1); }
        });
        chipBox.appendChild(b);
      });
    });
  }
  function ask(placeholder, type, handler) {
    queue.then(function () {
      pending = { handler: handler, type: type };
      input.placeholder = placeholder; input.type = type === "phone" ? "tel" : "text";
      input.setAttribute("inputmode", type === "phone" ? "tel" : "text");
      if (!isTouch()) input.focus({ preventScroll: true });
    });
  }
  function resetInput() { input.placeholder = "예: 이가 시려요 · 오늘 진료해요? · 임플란트 비용"; input.type = "text"; input.removeAttribute("inputmode"); }
  function isTouch() { return window.matchMedia && matchMedia("(pointer: coarse)").matches; }

  /* ---------- 데이터 ---------- */
  function site() { return A.site(); }
  function live() { return A.live(); }
  function center(key) { return (site() ? site().centers : []).filter(function (c) { return c.key === key; })[0]; }
  function centerChips(go, extra) {
    return (site() ? site().centers : []).map(function (c) { return { label: c.name, go: function () { go(c.key); } }; }).concat(extra || []);
  }
  function deskInfo(key) {
    var cl = A.centerLive(key), d = A.deskOf(cl);
    return liveLine([center(key).name + " 데스크: " + A.deskLine(cl), cl && cl.doctorsToday.length ? "오늘 진료 " + cl.doctorsToday.join(", ") : null, "가장 빠른 예약 " + A.nextText(cl)]);
  }
  var HOME = { label: "처음으로", go: function () { menu(); } };

  /* ---------- 첫 인사 ---------- */
  function greet() {
    if (started) return; started = true;
    var lv = live();
    var parts = ["안녕하세요, W치과 안내 챗봇입니다."];
    if (lv) parts.push(liveLine([lv.status.text, lv.notice.wait !== null ? "현재 " + C.waitLabel(lv.notice.wait) : null, lv.next ? "가장 빠른 예약 " + A.relDay(lv.next.date) + " " + C.koTime(lv.next.time) : "예약 가능한 시간 확인 중"]));
    if (lv && lv.notice.message) parts.push("병원 안내: " + lv.notice.message);
    parts.push("증상이나 궁금한 것을 편하게 적어 주시거나, 아래에서 골라 주세요.");
    parts.push(el("p", { class: "muted", text: "저는 자동 안내 챗봇이라 진단은 하지 않아요. 사람과 이야기하시려면 '상담원과 통화'를 눌러 주세요." }));
    bot(parts);
    if (A.myBooking()) {
      A.api("reservations/lookup", A.myBooking()).then(function (r) {
        bot(["이 기기로 예약하신 내역이 있어요.", liveLine([C.formatDate(r.date) + " " + C.koTime(r.time), r.treatmentLabel, r.statusLabel])]);
        menu(null, true);
      }).catch(function () { menu(null, true); });
    } else menu(null, true);
  }
  function menu(text, silent) {
    if (!silent) bot(text || "더 도와드릴 일이 있을까요?");
    chips([
      { label: "예약하기", primary: true, go: function () { flowBook(); } },
      { label: "아픈 곳이 있어요", go: function () { flowSymptom(); } },
      { label: "오늘 진료하나요?", go: flowToday },
      { label: "비용이 궁금해요", go: function () { flowCost(); } },
      { label: "내 예약 확인", go: flowMine },
      { label: "오시는 길", go: flowWay },
      { label: "상담원과 통화", go: function () { flowCall(); } },
      { label: "전화번호 알려줘요", go: flowPhone }
    ]);
  }

  function flowPhone() {
    var c = site() && site().clinic, lv = live();
    if (!c) return menu("병원 정보를 불러오는 중이에요.");
    bot([el("p", { class: "code", text: c.phone }), lv ? liveLine([lv.status.open ? "지금 전화 받을 수 있어요" : lv.status.text]) : null, "전화 주시면 직원이 예약까지 도와드립니다."]);
    chips([{ label: "전화 걸기", href: "tel:" + C.normalizePhone(c.phone), ext: true }, HOME]);
  }

  /* ---------- 증상 → 센터 안내 ---------- */
  function flowSymptom(text) {
    bot(text || "어디가 불편하세요? 가장 가까운 것을 골라 주세요.");
    chips(C.SYMPTOMS.map(function (s) { return { label: s.label, icon: s.id, go: function () { recommend(s); } }; }).concat([HOME]));
  }
  // 아픈 곳 짚기(선택) → 예약 메모로
  function flowWhere(s) {
    var P = window.WPicto; if (!P) return recommend(s);
    var map = P.toothMap();
    map.el.setAttribute("data-nosay", "");
    bot(["아픈 곳을 그림에서 눌러 주세요. 거울을 볼 때처럼, 화면 오른쪽이 내 오른쪽이에요. 다 고르시면 '다 골랐어요'를 눌러 주세요.", map.el]);
    chips([
      { label: "다 골랐어요", primary: true, go: function () { var t = map.text(); map.el.querySelectorAll("button").forEach(function (b) { b.disabled = true; }); recommend(s, t || ""); } },
      { label: "건너뛰기", go: function () { recommend(s, ""); } }
    ]);
  }
  function recommend(s, where) {
    var c = center(s.t);
    if (!c) return menu("죄송해요, 지금은 센터 정보를 불러오지 못했어요.");
    var memo = s.label + (where ? " · 아픈 곳: " + where : "");
    bot([where ? "고르신 곳(" + where + ")은 예약에 적어 원장님께 미리 전해 드릴게요." : null, c.name + "에서 봐 드려요.", "첫 방문은 " + s.time + " 정도 걸리고, " + s.ins + "이에요.", deskInfo(c.key),
      el("p", { class: "muted", text: "정확한 진단은 검사 후 원장님이 직접 설명해 드립니다." })]);
    chips([
      { label: "이 센터로 예약", primary: true, go: function () { pickSlot(c.key, memo); } },
      s.where && where === undefined ? { label: "아픈 곳 그림으로 짚기", icon: "bite", go: function () { flowWhere(s); } } : null,
      { label: c.name + " 데스크 보기", href: "#center-" + c.key },
      { label: "상담원과 통화", go: function () { flowCall(c.key, "pain"); } },
      { label: "다른 증상", go: function () { flowSymptom(); } }
    ]);
  }

  /* ---------- 대화로 예약 ---------- */
  var booking = null;
  function flowBook(key, memo) {
    if (key) return pickSlot(key, memo);
    bot("어떤 진료로 예약할까요?");
    chips(centerChips(function (k) { pickSlot(k, memo); }, [
      { label: "잘 모르겠어요", go: function () { flowSymptom("증상을 알려주시면 맞는 센터를 찾아 드릴게요."); } },
      { label: "검진 · 상담", go: function () { pickSlot("checkup", memo); } }
    ]));
  }
  function pickSlot(t, memo) {
    var label = t === "checkup" ? "검진 · 상담" : (center(t) || {}).name;
    bot(label + " 예약 장부에서 남은 시간을 확인할게요.");
    A.api("days?treatment=" + t).then(function (d) {
      var days = d.days.filter(function (x) { return !x.closed && x.available > 0; }).slice(0, 3);
      return Promise.all(days.map(function (x) { return A.api("slots?date=" + x.date + "&treatment=" + t); }));
    }).then(function (list) {
      var picks = [];
      list.forEach(function (r) { r.slots.forEach(function (s) { if (s.remaining > 0 && picks.length < 6) picks.push({ date: r.date, time: s.time }); }); });
      if (!picks.length) {
        bot("지금 온라인으로 잡을 수 있는 시간이 없어요. 전화 상담을 요청하시면 데스크에서 시간을 찾아 드릴게요.");
        return chips([{ label: "상담원과 통화", go: function () { flowCall(t === "checkup" ? null : t, "schedule"); } }, HOME]);
      }
      bot(["가장 빠른 시간이에요. 고르시면 바로 잡아 드릴게요.", el("p", { class: "muted", text: "다른 분이 먼저 예약하면 마감될 수 있어요." })]);
      chips(picks.map(function (p) {
        return { label: A.relDay(p.date) + " " + C.koTime(p.time), go: function () { booking = { treatment: t, date: p.date, time: p.time, memo: memo || "" }; askName(); } };
      }).concat([
        { label: "다른 날짜 보기", go: function () { bot("아래 예약 화면에서 날짜와 시간을 골라 주세요."); closeSheetOnMobile(); A.goBook(null, null, t); } },
        HOME
      ]));
    }).catch(function (e) { bot(e.message); menu(null, true); });
  }
  function askName() {
    bot("예약하실 분 성함을 알려주세요.");
    ask("성함", "name", function (v) {
      v = v.trim();
      if (!v || v.length > 30) { bot("성함을 30자 이내로 다시 적어 주세요."); return askName(); }
      booking.name = v; askPhone(function (ph) { booking.phone = ph; confirmBooking(); });
    });
  }
  function askPhone(next) {
    bot("연락받으실 휴대폰 번호를 알려주세요. 확정되면 문자로도 알려드려요.");
    ask("010-0000-0000", "phone", function (v) {
      var d = C.normalizePhone(v);
      if (!C.isPhone(d)) { bot("번호를 다시 확인해 주세요. 010-1234-5678 형식으로 적어 주시면 돼요."); return askPhone(next); }
      next(d);
    });
  }
  function confirmBooking() {
    var b = booking, days = site() ? site().booking.retentionDays : 180;
    bot([
      "이렇게 예약을 신청할까요?",
      el("ul", null, [
        el("li", { text: "진료: " + C.labelOf(C.TREATMENTS, b.treatment) }), el("li", { text: "일시: " + C.formatDate(b.date) + " " + C.koTime(b.time) }),
        el("li", { text: "성함: " + b.name }), el("li", { text: "연락처: " + C.maskPhone(b.phone) })
      ]),
      el("p", { class: "muted", text: "예약 연락을 위해 성함·연락처를 수집·이용하고, 예약일로부터 " + days + "일 뒤 파기합니다." })
    ]);
    chips([
      { label: "동의하고 예약 신청", primary: true, go: submitBooking },
      { label: "시간 다시 고르기", go: function () { pickSlot(b.treatment, b.memo); } },
      { label: "그만할게요", go: function () { booking = null; menu(); } }
    ]);
  }
  function submitBooking() {
    var b = booking;
    A.api("reservations", { name: b.name, phone: b.phone, treatment: b.treatment, date: b.date, time: b.time, memo: b.memo, consent: true }).then(function (r) {
      A.trackBooking(r, b.phone);
      bot(["예약 신청이 접수됐어요. 예약번호를 메모해 두세요.", el("p", { class: "code", text: r.code }),
        liveLine([C.formatDate(r.date) + " " + C.koTime(r.time), r.treatmentLabel, r.statusLabel]),
        "병원에서 확인하면 이 대화창과 문자로 바로 알려드릴게요."]);
      chips([{ label: "내 예약 화면 보기", go: function () { closeSheetOnMobile(); var t = $("tracker"); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); } }, HOME]);
      booking = null;
    }).catch(function (e) {
      bot(e.message);
      if (e.status === 409) pickSlot(b.treatment, b.memo); else menu(null, true);
    });
  }

  /* ---------- 오늘 진료 ---------- */
  function flowToday() {
    var lv = live();
    if (!lv) return menu("지금 병원 정보를 불러오는 중이에요. 잠시 후 다시 물어봐 주세요.");
    var open = (lv.centers || []).filter(function (c) { return c.today.open; });
    var off = (lv.centers || []).filter(function (c) { return !c.today.open; });
    bot([
      liveLine([lv.status.text, lv.notice.wait !== null ? "현재 " + C.waitLabel(lv.notice.wait) : null, "오늘 남은 예약 " + lv.today.openSlots + "자리"]),
      open.length ? "오늘 진료하는 센터: " + open.map(function (c) { return c.name; }).join(", ") : "오늘은 진료하는 센터가 없어요.",
      off.length ? el("p", { class: "muted", text: "오늘 진료 없음: " + off.map(function (c) { return c.name + "(" + (c.days ? c.days.split("").join("·") : "") + ")"; }).join(", ") }) : null,
      lv.next ? "가장 빠른 예약은 " + A.relDay(lv.next.date) + " " + C.koTime(lv.next.time) + "이에요." : null
    ]);
    chips([{ label: "예약하기", primary: true, go: function () { flowBook(); } }, { label: "요일별 진료시간 보기", href: "#visit" }, HOME]);
  }

  /* ---------- 비용 ---------- */
  function flowCost(key) {
    if (!key) { bot("어느 센터 비용이 궁금하세요?"); return chips(centerChips(flowCost, [HOME])); }
    var c = center(key), fees = (site() ? site().fees : []).filter(function (f) { return f.center === key; });
    bot([
      c.name + " 비급여 진료비예요.",
      fees.length ? el("ul", null, fees.map(function (f) { return el("li", { text: f.name + (f.unit ? " (" + f.unit + ")" : "") + " · " + (f.price == null ? "상담 후 안내" : f.price.toLocaleString("ko-KR") + "원") }); }))
        : "이 센터 비급여 항목은 검사 후 치료계획서로 안내해 드려요.",
      el("p", { class: "muted", text: "건강보험이 되는 진료는 보험 기준에 따릅니다. 정확한 비용은 검사 후 치료계획서에 적어 드려요." })
    ]);
    chips([
      { label: "이 센터로 예약", primary: true, go: function () { pickSlot(key); } },
      { label: "상담원과 통화", go: function () { flowCall(key, "cost"); } },
      { label: "다른 센터 비용", go: function () { flowCost(); } }, HOME
    ]);
  }

  /* ---------- 내 예약 확인 ---------- */
  function flowMine() {
    var mb = A.myBooking(), mq = A.myInquiry();
    if (mb || mq) {
      var jobs = [];
      if (mb) jobs.push(A.api("reservations/lookup", mb).then(function (r) { return liveLine(["예약 " + r.code, C.formatDate(r.date) + " " + C.koTime(r.time), r.treatmentLabel, r.statusLabel]); }).catch(function () { return null; }));
      if (mq) jobs.push(A.api("inquiries/lookup", mq).then(function (q) { return liveLine(["상담 요청 " + q.code, q.centerName, q.statusLabel + (q.ahead ? " · 앞에 " + q.ahead + "건" : "")]); }).catch(function () { return null; }));
      return Promise.all(jobs).then(function (lines) {
        bot(["이 기기에 저장된 내역이에요. 지금 병원 장부 기준입니다."].concat(lines));
        chips([{ label: "예약 화면 보기", go: function () { closeSheetOnMobile(); var t = $("tracker"); if (t && !t.hidden) t.scrollIntoView({ behavior: "smooth" }); else location.hash = "reserve"; } }, { label: "다른 번호로 조회", go: lookupByCode }, HOME]);
      });
    }
    lookupByCode();
  }
  function lookupByCode() {
    bot("예약번호나 상담 접수번호 6자리를 알려주세요.");
    ask("6자리 번호", "code", function (code) {
      askPhone(function (ph) {
        var body = { code: code.trim(), phone: ph };
        A.api("reservations/lookup", body).then(function (r) {
          A.trackBooking(r, ph);
          bot(["예약을 찾았어요.", liveLine([C.formatDate(r.date) + " " + C.koTime(r.time), r.treatmentLabel, r.statusLabel])]);
          menu(null, true);
        }).catch(function () {
          return A.api("inquiries/lookup", body).then(function (q) {
            A.setInquiry(q, ph);
            bot(["상담 요청을 찾았어요.", liveLine([q.centerName, q.topicLabel, q.statusLabel + (q.ahead ? " · 앞에 " + q.ahead + "건" : "")])]);
            menu(null, true);
          });
        }).catch(function () { bot("일치하는 예약이나 상담 요청이 없어요. 번호를 다시 확인해 주세요."); menu(null, true); });
      });
    });
  }

  /* ---------- 오시는 길 ---------- */
  function flowWay() {
    var c = site() && site().clinic;
    if (!c) return menu("병원 정보를 불러오는 중이에요.");
    bot([c.address, el("ul", null, [c.subway ? el("li", { text: "지하철: " + c.subway }) : null, c.parking ? el("li", { text: "주차: " + c.parking }) : null, el("li", { text: "전화: " + c.phone })].filter(Boolean))]);
    var list = [];
    if (c.naverMapUrl) list.push({ label: "네이버 지도", href: c.naverMapUrl, ext: true });
    if (c.kakaoMapUrl) list.push({ label: "카카오맵", href: c.kakaoMapUrl, ext: true });
    list.push({ label: "진료시간 보기", href: "#visit" }, HOME);
    chips(list);
  }

  /* ---------- 상담원(센터 데스크)과 통화 ---------- */
  var call = null;
  function flowCall(key, topic) {
    if (!key) {
      bot("어느 센터 코디네이터와 통화하시겠어요?");
      return chips(centerChips(function (k) { flowCall(k, topic); }, [{ label: "잘 모르겠어요", go: function () { flowSymptom("증상을 알려주시면 맞는 센터로 연결해 드릴게요."); } }]));
    }
    var c = center(key), cl = A.centerLive(key), d = A.deskOf(cl);
    if (!d.accepting) {
      bot([c.name + " 데스크가 지금 온라인 상담 요청을 잠시 받지 않고 있어요.", "대표 전화 " + site().clinic.phone + "로 연락 주세요."]);
      return chips([HOME]);
    }
    call = { center: key, topic: topic || "first" };
    bot([(d.staff ? d.staff + " 코디네이터" : c.name + " 코디네이터") + "에게 전화 요청을 남길게요.",
      liveLine([A.deskLine(cl), "앞선 요청 " + (d.pending || 0) + "건"]),
      "언제 연락드리면 좋을까요?"]);
    chips(C.PREFERS.map(function (p) { return { label: p.label, go: function () { call.prefer = p.key; askCallName(); } }; }));
  }
  function askCallName() {
    bot("성함을 알려주세요.");
    ask("성함", "name", function (v) {
      v = v.trim();
      if (!v || v.length > 30) { bot("성함을 30자 이내로 다시 적어 주세요."); return askCallName(); }
      call.name = v;
      askPhone(function (ph) {
        call.phone = ph;
        bot([center(call.center).name + "로 " + C.labelOf(C.PREFERS, call.prefer) + "에 " + C.maskPhone(ph) + " 번호로 연락드릴게요.",
          el("p", { class: "muted", text: "상담 연락을 위해 성함·연락처를 수집·이용하는 데 동의하시면 요청을 보낼게요." })]);
        chips([{ label: "동의하고 요청 보내기", primary: true, go: submitCall }, { label: "그만할게요", go: function () { call = null; menu(); } }]);
      });
    });
  }
  function submitCall() {
    var q0 = call;
    A.api("inquiries", { center: q0.center, topic: q0.topic, prefer: q0.prefer, name: q0.name, phone: q0.phone, message: "챗봇 상담 요청", consent: true }).then(function (q) {
      A.setInquiry(q, q0.phone);
      bot(["상담 요청이 " + q.centerName + " 데스크에 접수됐어요.", el("p", { class: "code", text: q.code }),
        liveLine([q.statusLabel, q.ahead ? "앞에 " + q.ahead + "건" : "다음 순서", q.preferLabel + " 연락"]),
        "데스크에서 확인하면 이 대화창에서 바로 알려드릴게요."]);
      chips([{ label: q.centerName + " 데스크 보기", href: "#center-" + q.center }, HOME]);
      call = null;
    }).catch(function (e) { bot(e.message); menu(null, true); });
  }

  /* ---------- 자유 입력 ---------- */
  var URGENT = /응급|안 ?멈|멈추지|많이 붓|얼굴이 붓|열이 나|사고|부러졌|깨졌/;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim(); if (!text) return;
    input.value = "";
    if (pending) {
      var p = pending; pending = null; chipBox.textContent = ""; resetInput();
      me(p.type === "phone" ? C.maskPhone(text) : text);
      p.handler(text);
      return;
    }
    me(text); chipBox.textContent = "";
    if (URGENT.test(text)) {
      bot(["많이 아프시거나 출혈·붓기가 심하면 바로 전화 주세요: " + (site() ? site().clinic.phone : ""),
        "진료 시간이 아니거나 숨쉬기 어려울 정도로 붓는다면 가까운 응급실을 이용하세요."]);
      return chips([{ label: "상담원과 통화", go: function () { flowCall(null, "pain"); } }, HOME]);
    }
    var r = C.chatIntent(text);
    var key = r.symptom ? r.symptom.t : null;
    if (r.intent === "symptom") return recommend(r.symptom);
    if (r.intent === "pain") return flowSymptom("어디가 어떻게 불편하세요? 가까운 것을 골라 주세요.");
    if (r.intent === "book") return flowBook();
    if (r.intent === "cost") return flowCost(key);
    if (r.intent === "today") return flowToday();
    if (r.intent === "way") return flowWay();
    if (r.intent === "mine") return flowMine();
    if (r.intent === "call") return flowCall(key);
    if (r.intent === "hello") return menu("반가워요. 무엇을 도와드릴까요?");
    menu("제가 이해하지 못했어요. 아래에서 골라 주시거나, 상담원과 통화를 요청해 주세요.");
  });

  /* ---------- 실시간 알림을 대화로 ---------- */
  window.addEventListener("w-status", function (e) {
    var d = e.detail, x = d.item;
    if (d.kind === "booking") {
      bot(x.status === "confirmed" ? ["병원에서 예약을 확정했어요.", liveLine([C.formatDate(x.date) + " " + C.koTime(x.time), x.treatmentLabel, "예약 확정"]), "전날 안내 문자를 보내드릴게요."]
        : ["예약 상태가 바뀌었어요.", liveLine([C.formatDate(x.date) + " " + C.koTime(x.time), x.statusLabel])]);
    } else if (d.kind === "inquiry") {
      bot(x.status === "seen" ? [x.centerName + " 데스크에서 상담 요청을 확인했어요.", (x.handledBy ? x.handledBy + "님이 " : "") + x.preferLabel + "에 전화드릴게요."]
        : x.status === "done" ? [x.centerName + " 상담 연락을 마쳤어요. 더 궁금한 점이 있으면 언제든 물어봐 주세요."]
        : ["상담 요청이 '" + x.statusLabel + "'(으)로 바뀌었어요."]);
    }
    if (sheet.hidden && !inView) fab.classList.add("ping");
  });
  window.addEventListener("w-live", function () { if (!started) greet(); });
  if (A.live()) greet();

  /* ---------- 화면 배치: 첫 화면에 크게, 다른 곳에서는 떠 있는 버튼 ---------- */
  var home = $("chatHome"), sheet = $("chatSheet"), fab = $("chatFab"), closeBtn = $("chatClose");
  var inView = true;
  function updateFab() { fab.hidden = !sheet.hidden || (inView && A.view() === "home"); }
  function openSheet() {
    if (A.view() === "home" && window.innerWidth > 760) { chat.scrollIntoView({ behavior: "smooth", block: "center" }); input.focus({ preventScroll: true }); return; }
    sheet.appendChild(chat); sheet.hidden = false; closeBtn.hidden = false; fab.classList.remove("ping"); updateFab(); scroll();
    if (!isTouch()) input.focus();
  }
  function closeSheet() { home.appendChild(chat); sheet.hidden = true; closeBtn.hidden = true; updateFab(); }
  function closeSheetOnMobile() { if (!sheet.hidden && window.innerWidth <= 760) closeSheet(); }
  fab.addEventListener("click", openSheet);
  closeBtn.addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });
  var dock = $("dockChat");
  if (dock) dock.addEventListener("click", function (e) { e.preventDefault(); if (A.view() === "home" && inView && window.innerWidth > 760) return; openSheet(); });
  if (window.IntersectionObserver) new IntersectionObserver(function (en) { inView = en[0].isIntersecting; updateFab(); }, { threshold: 0.2 }).observe(home);
  window.addEventListener("hashchange", function () { setTimeout(updateFab, 0); });
  updateFab();
})();
