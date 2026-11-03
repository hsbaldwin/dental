/*
 * 음성 안내 — 브라우저 내장 음성 합성(speechSynthesis)으로 화면 문구를 읽어 드리고,
 * 지원하는 브라우저에서는 음성 인식으로 챗봇에 말로 물을 수 있게 합니다.
 * 켜고 끈 상태는 이 기기에만 기억합니다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WVoice = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var DIG = "공일이삼사오육칠팔구";

  // 읽기 쉬운 말로 바꾸기 (서버 테스트에서도 씀)
  function speakable(text) {
    var t = String(text || "");
    // 전화번호: 010-1234-5678 → 공일공, 일이삼사, 오육칠팔
    t = t.replace(/\b0\d{1,2}(-\d{3,4}){1,2}\b|\b0\d{1,2}-\*{4}-\d{4}\b/g, function (m) {
      return m.split("-").map(function (g) { return g.replace(/\d/g, function (d) { return DIG[+d]; }).replace(/\*+/g, "별표"); }).join(", ");
    });
    // 오후 2:30 → 오후 2시 30분, 오전 9:00 → 오전 9시
    t = t.replace(/(오전|오후) (\d{1,2}):(\d{2})/g, function (m, ap, h, mi) { return ap + " " + h + "시" + (mi === "00" ? "" : " " + (+mi) + "분"); });
    // 시간 범위 ~
    t = t.replace(/\s*~\s*/g, "부터 ");
    // 예약번호(대문자·숫자 6자리)는 한 글자씩
    t = t.replace(/\b(?=[A-Z0-9]{6}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6}\b/g, function (m) { return m.split("").join(" "); });
    t = t.replace(/(\d+) \/ (\d+) 단계/g, "$2단계 중 $1단계");
    var DAYS = { 월: "월요일", 화: "화요일", 수: "수요일", 목: "목요일", 금: "금요일", 토: "토요일", 일: "일요일" };
    t = t.replace(/\(([월화수목금토일])\)/g, function (m, d) { return DAYS[d]; });
    t = t.replace(/(\S)·(\S)/g, "$1 $2").replace(/\s+·\s+/g, ", ").replace(/[|→←]/g, ", ");
    t = t.replace(/#(\d{2})/g, "$1번 치아");
    return t.replace(/\s+/g, " ").trim();
  }

  if (typeof window === "undefined") return { speakable: speakable };

  var synth = window.speechSynthesis;
  var Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
  var KEY = "w-voice";
  var on = false, voice = null;
  try { on = localStorage.getItem(KEY) === "1"; } catch (e) {}

  function pickVoice() {
    if (!synth) return;
    var vs = synth.getVoices() || [];
    voice = vs.filter(function (v) { return /^ko/i.test(v.lang); })[0] || null;
  }
  if (synth) { pickVoice(); if ("onvoiceschanged" in synth) synth.onvoiceschanged = pickVoice; }

  function speak(text, opts) {
    if (!synth || !text) return;
    opts = opts || {};
    if (!on && !opts.force) return;
    if (opts.interrupt !== false) synth.cancel();
    var u = new SpeechSynthesisUtterance(speakable(text));
    u.lang = "ko-KR"; u.rate = 0.9; u.pitch = 1;
    if (voice) u.voice = voice;
    synth.speak(u);
  }
  function stop() { if (synth) synth.cancel(); }
  var listeners = [];
  function set(v) {
    on = !!v;
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
    if (!on) stop();
    listeners.forEach(function (fn) { fn(on); });
  }

  // 말로 묻기 (지원 브라우저만)
  function listen(onText, onState) {
    if (!Recog) return null;
    var r = new Recog();
    r.lang = "ko-KR"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = function (e) { var t = e.results[0][0].transcript; onText(t); };
    r.onerror = function (e) { onState("error", e.error); };
    r.onend = function () { onState("end"); };
    stop();
    try { r.start(); onState("listening"); } catch (e) { onState("error", "start"); return null; }
    return r;
  }

  return {
    speakable: speakable, speak: speak, stop: stop, set: set,
    enabled: function () { return on; },
    canSpeak: !!synth, canListen: !!Recog,
    onChange: function (fn) { listeners.push(fn); },
    listen: listen
  };
});
