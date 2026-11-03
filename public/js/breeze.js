/*
 * 민트 숨결 — 첫 화면(1 지금) 뒤로 반투명 민트 잎과 기포가 아주 천천히 떠오르는 장식.
 * 실제 향은 낼 수 없으니, 갓 양치한 뒤의 시원한 숨결을 눈으로 느끼게 하는 연출이다.
 * 움직임 줄이기 설정 · '크게 보기' · 화면 밖 · 탭 숨김에서는 멈춘다(정지 그림 한 장).
 */
(function () {
  "use strict";
  var host = document.getElementById("now");
  var cv = document.getElementById("breeze");
  if (!host || !cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");
  var W = 0, H = 0, dpr = 1, items = [], running = false, visible = true, last = 0, raf = 0;
  var reduce = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function still() { return reduce.matches || document.documentElement.classList.contains("easy"); }
  function colors() {
    var cs = getComputedStyle(document.documentElement);
    return { leaf: cs.getPropertyValue("--mint").trim() || "#2BA884", leaf2: cs.getPropertyValue("--aqua").trim() || "#38C6C0", foam: "#ffffff" };
  }
  var C = colors();
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function make(kind, anyY) {
    return {
      kind: kind,
      x: rnd(0, W), y: anyY ? rnd(0, H) : H + rnd(10, 80),
      s: kind === "leaf" ? rnd(18, 36) : rnd(3, 8),           // 크기
      vy: kind === "leaf" ? rnd(6, 12) : rnd(10, 18),          // 초당 떠오르는 속도(px)
      sway: rnd(8, 22), phase: rnd(0, Math.PI * 2), spin: rnd(-.25, .25), rot: rnd(-1, 1),
      tint: Math.random() < .6 ? "leaf" : "leaf2", a: kind === "leaf" ? rnd(.12, .22) : rnd(.35, .6)
    };
  }
  function resize() {
    var r = host.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var leaves = W < 600 ? 7 : 12, bubbles = W < 600 ? 6 : 10;
    items = [];
    for (var i = 0; i < leaves; i++) items.push(make("leaf", true));
    for (var j = 0; j < bubbles; j++) items.push(make("bubble", true));
    draw(0);
  }
  function leaf(p, x, y) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(p.rot);
    ctx.globalAlpha = p.a;
    ctx.fillStyle = p.tint === "leaf" ? C.leaf : C.leaf2;
    var s = p.s;
    ctx.beginPath();                                   // 민트 잎: 끝이 뾰족한 타원
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * .75, -s * .55, s * .7, s * .55, 0, s);
    ctx.bezierCurveTo(-s * .7, s * .55, -s * .75, -s * .55, 0, -s);
    ctx.fill();
    ctx.globalAlpha = p.a * 1.6;                       // 잎맥
    ctx.strokeStyle = C.foam; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -s * .85); ctx.lineTo(0, s * .85);
    [-.5, -.15, .2].forEach(function (f) {             // 양쪽 곁맥
      var yy = f * s; ctx.moveTo(0, yy); ctx.lineTo(s * .4, yy - s * .2); ctx.moveTo(0, yy); ctx.lineTo(-s * .4, yy - s * .2);
    });
    ctx.stroke();
    ctx.restore();
  }
  function bubble(p, x, y) {
    ctx.save();
    ctx.globalAlpha = p.a;
    ctx.strokeStyle = C.foam; ctx.lineWidth = 1.5;
    ctx.fillStyle = "rgba(255,255,255,.25)";
    ctx.beginPath(); ctx.arc(x, y, p.s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function draw(dt) {
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < items.length; i++) {
      var p = items[i];
      if (dt) {
        p.y -= p.vy * dt; p.phase += dt * .6; p.rot += p.spin * dt;
        if (p.y < -40) { items[i] = p = make(p.kind, false); }
      }
      var x = p.x + Math.sin(p.phase) * p.sway;
      if (p.kind === "leaf") leaf(p, x, p.y); else bubble(p, x, p.y);
    }
  }
  function frame(t) {
    raf = 0;
    if (!running) return;
    var dt = last ? Math.min(.05, (t - last) / 1000) : 0;
    last = t; draw(dt);
    raf = requestAnimationFrame(frame);
  }
  function update() {
    var go = visible && !document.hidden && !still();
    if (go && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
    if (!go && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; draw(0); }
  }
  if (window.IntersectionObserver) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; update(); }).observe(host);
  document.addEventListener("visibilitychange", update);
  if (reduce.addEventListener) reduce.addEventListener("change", update);
  new MutationObserver(function () { C = colors(); update(); if (!running) draw(0); }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
  var rt = 0;
  function soon() { clearTimeout(rt); rt = setTimeout(resize, 150); }
  window.addEventListener("resize", soon);
  if (window.ResizeObserver) new ResizeObserver(function () { if (Math.abs(host.getBoundingClientRect().height - H) > 4) soon(); }).observe(host);
  resize(); update();
})();
