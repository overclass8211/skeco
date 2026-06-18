'use strict';
// =============================================================
// paymentNotifier — 연체 미수금 알림 서비스 (수금관리 B1)
//
// 책임:
//   1. 일일 스캔 → due_date 경과 스케줄을 'overdue' 로 동기화
//   2. 신규 연체 건당 1회 인앱 알림 생성 (dedup_key = overdue:<scheduleId>)
//   3. 신규 연체가 있으면 재무팀 메일(설정값)로 요약 1건 발송 (하루 1건 dedup)
//
// 메일 발송:
//   - Gmail API 우선 (신규 연체 스케줄 등록자 OAuth 활용)
//   - 미연결/발송자 없음 → payment_notifications 에 'pending' 으로 큐잉
//
// 발송 이력/감사: payment_notifications 테이블
//   - channel='inapp'  → 사이드바 배지/알림 목록
//   - channel='email'  → 재무팀 요약 메일 (pending|sent|failed)
//
// 재무팀 메일 주소: system_settings.payment_overdue_notify_email (PUT /payments/config)
// =============================================================

const pool = require('../db');

let gmailSvc = null;
try {
  gmailSvc = require('./gmail');
} catch (_) {
  /* gmail 서비스 없으면 skip — 알림은 인앱/큐잉만 */
}

const PAYMENT_NOTIFY_EMAIL_KEY = 'payment_overdue_notify_email';

// 로컬(KST) 기준 오늘 날짜 문자열 (UTC 변환으로 인한 하루 밀림 방지)
function _todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _fmt(n) {
  return Number(n || 0).toLocaleString('ko-KR');
}

// 재무팀 알림 메일 주소 조회 (없으면 null)
async function _getNotifyEmail() {
  try {
    const [[row]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = ?`,
      [PAYMENT_NOTIFY_EMAIL_KEY]
    );
    const v = String(row?.setting_value || '').trim();
    return v || null;
  } catch (_) {
    return null;
  }
}

/**
 * 연체 스캔
 *   1) 연체 상태 동기화
 *   2) 잔여 미수금이 있는 연체 건 → 신규 인앱 알림 생성 (dedup)
 *   3) 신규 연체가 있으면 재무팀 메일 요약 발송/큐잉 (하루 1건)
 * @returns {{overdue_total:number, created_inapp:number, created_email:number, emailed:boolean}}
 */
async function scanOverdue() {
  // 1) 연체 상태 동기화 (due_date 경과 + scheduled|invoiced)
  await pool.query(`
    UPDATE payment_schedules
       SET status = 'overdue'
     WHERE status IN ('scheduled','invoiced')
       AND due_date < CURDATE()
  `);

  // 2) 현재 연체 + 잔여 미수금 계산
  const [overdue] = await pool.query(`
    SELECT ps.id, ps.contract_id, ps.customer_name, ps.contract_name, ps.stage_name,
           ps.scheduled_amount, ps.currency, ps.due_date, ps.created_by,
           DATEDIFF(CURDATE(), ps.due_date)  AS overdue_days,
           COALESCE(SUM(pr.paid_amount), 0)  AS paid_amount
      FROM payment_schedules ps
      LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
     WHERE ps.status = 'overdue'
     GROUP BY ps.id
     ORDER BY ps.due_date ASC
  `);

  let createdInapp = 0;
  const fresh = [];
  for (const s of overdue) {
    const remaining = Number(s.scheduled_amount) - Number(s.paid_amount);
    if (remaining <= 0) continue; // 전액 수금된 잔여 케이스 제외
    const dedupKey = `overdue:${s.id}`;
    try {
      const [r] = await pool.query(
        `INSERT IGNORE INTO payment_notifications
           (schedule_id, contract_id, customer_name, kind, overdue_days, amount,
            channel, status, dedup_key, payload_json)
         VALUES (?, ?, ?, 'overdue', ?, ?, 'inapp', 'unread', ?, ?)`,
        [
          s.id,
          s.contract_id || null,
          s.customer_name || null,
          s.overdue_days,
          remaining,
          dedupKey,
          JSON.stringify({
            stage: s.stage_name,
            contract_name: s.contract_name,
            due_date: String(s.due_date || '').slice(0, 10),
            currency: s.currency || 'KRW',
          }),
        ]
      );
      if (r.affectedRows > 0 && r.insertId) {
        createdInapp++;
        fresh.push({ ...s, remaining });
      }
    } catch (e) {
      console.warn('[paymentNotifier] inapp 알림 생성 실패:', e.message);
    }
  }

  // 3) 재무팀 메일 요약 (신규 연체가 있을 때만, 하루 1건 dedup)
  let createdEmail = 0;
  let emailed = false;
  const notifyEmail = await _getNotifyEmail();
  if (notifyEmail && fresh.length > 0) {
    const dedupKey = `overdue-email:${_todayStr()}`;
    const totalRemain = fresh.reduce((a, s) => a + s.remaining, 0);
    const lines = fresh
      .slice(0, 20)
      .map(
        (s, i) =>
          `${i + 1}. ${s.customer_name || '-'} / ${s.contract_name || '-'} ${s.stage_name || ''} — ${_fmt(
            s.remaining
          )} ${s.currency || 'KRW'} (D+${s.overdue_days}, 예정일 ${String(s.due_date || '').slice(0, 10)})`
      )
      .join('\n');
    const subject = `[OCI CRM] 연체 미수금 알림 — 신규 ${fresh.length}건 (합계 ${_fmt(totalRemain)}원)`;
    const bodyText = `연체된 미수금이 발생했습니다. (신규 ${fresh.length}건)

${lines}${fresh.length > 20 ? `\n…외 ${fresh.length - 20}건` : ''}

신규 연체 합계: ${_fmt(totalRemain)}원

🔗 수금관리: ${process.env.APP_BASE_URL || 'https://oci-crm.duckdns.org'}/#payments

--
본 메일은 자동 발송되었습니다.`;

    let notifId;
    try {
      const [r] = await pool.query(
        `INSERT IGNORE INTO payment_notifications
           (kind, channel, recipient, status, dedup_key, amount, payload_json)
         VALUES ('overdue', 'email', ?, 'pending', ?, ?, ?)`,
        [
          notifyEmail,
          dedupKey,
          totalRemain,
          JSON.stringify({ subject: subject.slice(0, 200), count: fresh.length }),
        ]
      );
      if (r.affectedRows > 0 && r.insertId) {
        createdEmail++;
        notifId = r.insertId;
      }
    } catch (e) {
      console.warn('[paymentNotifier] email 알림 큐잉 실패:', e.message);
    }

    // Gmail 발송 시도 (발송자 = 신규 연체 중 created_by 보유 첫 사용자)
    if (notifId && gmailSvc?.sendMessageWithAttachments) {
      const senderUserId = fresh.find(s => s.created_by)?.created_by || null;
      if (senderUserId) {
        try {
          await gmailSvc.sendMessageWithAttachments(senderUserId, {
            to: notifyEmail,
            subject,
            bodyText,
            attachments: [],
          });
          await pool.query(
            `UPDATE payment_notifications
                SET status='sent', sent_at=NOW(), attempts=attempts+1
              WHERE id = ?`,
            [notifId]
          );
          emailed = true;
        } catch (err) {
          await pool.query(
            `UPDATE payment_notifications
                SET status='failed', attempts=attempts+1, last_error=?
              WHERE id = ?`,
            [String(err?.message || err).slice(0, 500), notifId]
          );
          console.warn('[paymentNotifier] Gmail 발송 실패:', err?.message);
        }
      }
      // senderUserId 없으면 'pending' 유지 (추후 처리/수동 발송)
    }
  }

  return {
    overdue_total: overdue.length,
    created_inapp: createdInapp,
    created_email: createdEmail,
    emailed,
  };
}

// ─── 일일 스케줄러 ────────────────────────────────────────────
let _timer = null;
let _bootTimer = null;
function startScheduler() {
  if (_timer || _bootTimer) return; // 중복 시작 방지
  if (process.env.NODE_ENV === 'test') return; // 테스트 환경 미동작
  const DAY = 24 * 60 * 60 * 1000;
  // 부팅 90초 후 첫 스캔(마이그레이션 안정화 대기) → 이후 매일
  _bootTimer = setTimeout(() => {
    scanOverdue()
      .then(r =>
        console.log(
          `[paymentNotifier] 초기 연체 스캔: 연체=${r.overdue_total} 신규알림=${r.created_inapp} 메일=${r.created_email}`
        )
      )
      .catch(e => console.warn('[paymentNotifier] 초기 스캔 오류:', e.message));
    _timer = setInterval(() => {
      scanOverdue()
        .then(r =>
          console.log(
            `[paymentNotifier] 일일 연체 스캔: 연체=${r.overdue_total} 신규알림=${r.created_inapp} 메일=${r.created_email}`
          )
        )
        .catch(e => console.warn('[paymentNotifier] 일일 스캔 오류:', e.message));
    }, DAY);
    if (_timer.unref) _timer.unref();
  }, 90 * 1000);
  if (_bootTimer.unref) _bootTimer.unref();
}

module.exports = { scanOverdue, startScheduler, PAYMENT_NOTIFY_EMAIL_KEY };
