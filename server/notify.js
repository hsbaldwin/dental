"use strict";
/*
 * 알림 발송. 모든 메시지는 outbox 테이블에 기록되고, 관리자 화면 '활동 기록'에서 볼 수 있습니다.
 *  - 직원 알림: NOTIFY_WEBHOOK_URL 로 {"text": "..."} 를 POST (Slack·잔디·카카오워크 등 수신 웹훅)
 *  - 환자 문자: SMS_WEBHOOK_URL 로 {"to": "01012345678", "text": "..."} 를 POST
 *    (문자 발송 업체 API 앞에 둔 중계 서버나 자동화 도구 주소). 설정하지 않으면 '미발송'으로 기록만 됩니다.
 */
const { nowIso } = require("./db");

function createNotifier(db, env, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  const insert = db.prepare("INSERT INTO outbox (at, channel, recipient, body, status) VALUES (?, ?, ?, ?, ?)");
  const update = db.prepare("UPDATE outbox SET status = ?, error = ? WHERE id = ?");

  async function deliver(channel, recipient, body, url, payload) {
    const id = Number(insert.run(nowIso(), channel, recipient, body, url ? "sending" : "skipped").lastInsertRowid);
    if (!url || !doFetch) return;
    try {
      const headers = { "content-type": "application/json" };
      if (env.WEBHOOK_TOKEN) headers.authorization = "Bearer " + env.WEBHOOK_TOKEN;
      const r = await doFetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
      update.run(r.ok ? "sent" : "failed", r.ok ? null : "HTTP " + r.status, id);
    } catch (e) {
      update.run("failed", String(e && e.message || e).slice(0, 300), id);
    }
  }

  return {
    staff(text) { return deliver("staff", null, text, env.NOTIFY_WEBHOOK_URL, { text }); },
    patient(phone, text) { return deliver("sms", phone, text, env.SMS_WEBHOOK_URL, { to: phone, text }); }
  };
}

module.exports = { createNotifier };
