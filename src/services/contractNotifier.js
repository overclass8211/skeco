'use strict';
// =============================================================
// contractNotifier — 계약 알림 발송 서비스 (v6.0.0 Phase E)
//
// 책임:
//   1. 댓글 작성 시 → 관련자 전원에게 메일 (디바운싱 30초)
//   2. 상태 변경 시 → 관련자 전원에게 메일 (즉시)
//   3. 공유 링크 발급 시 → 수신자에게 초대 메일
//   4. 검토 기한 임박 시 → 등록자에게 알림 (별도 cron 권장)
//
// 메일 발송:
//   - Gmail API 우선 (사용자 OAuth 연결 필요)
//   - 미연결 시 contract_notifications 에 'pending' 으로 큐잉 (별도 처리)
//
// 디바운싱:
//   - 같은 계약에 30초 내 여러 댓글 → 1개 알림으로 통합
//   - 메모리 기반 (서버 재시작 시 리셋 — 즉시 발송)
//
// 발송 이력: contract_notifications 테이블 (감사 + 재시도)
// =============================================================

const pool = require('../db');

let gmailSvc = null;
try {
  gmailSvc = require('./gmail');
} catch (_) {
  /* gmail 서비스 없으면 skip — 알림은 큐잉만 */
}

// 디바운싱: 계약 ID 별로 pending 댓글 모음 (30초 후 일괄 발송)
const _commentDebounce = new Map(); // contractId → { timer, comments: [], recipients: Set }
const DEBOUNCE_MS = 30 * 1000;

/**
 * 관련자 이메일 목록 조회 (등록자 + 모든 공유 수신자)
 */
async function _getStakeholderEmails(contractId, excludeEmail = null) {
  const emails = new Set();
  // 1. 계약 등록자
  try {
    const [[c]] = await pool.query(
      `SELECT c.created_by, tm.email AS creator_email
         FROM contracts c
         LEFT JOIN team_members tm ON tm.id = c.created_by
        WHERE c.id = ?`,
      [contractId]
    );
    if (c?.creator_email) emails.add(c.creator_email.toLowerCase());
  } catch (_) {
    /* skip */
  }
  // 2. 모든 활성 공유 링크의 수신자
  try {
    const [rows] = await pool.query(
      `SELECT csr.email
         FROM contract_share_recipients csr
         JOIN contract_share_links csl ON csl.id = csr.share_link_id
        WHERE csl.contract_id = ? AND csl.revoked_at IS NULL
          AND (csl.expires_at IS NULL OR csl.expires_at > NOW())`,
      [contractId]
    );
    for (const r of rows) {
      if (r.email) emails.add(r.email.toLowerCase());
    }
  } catch (_) {
    /* skip */
  }
  if (excludeEmail) emails.delete(excludeEmail.toLowerCase());
  return Array.from(emails);
}

/**
 * contract_notifications 큐 + (Gmail OAuth 연결 시) 실 발송
 */
async function _enqueueAndSend({
  contractId,
  eventType,
  recipientEmail,
  subject,
  bodyText,
  senderUserId,
}) {
  if (!recipientEmail) return;
  let notifId;
  try {
    const [r] = await pool.query(
      `INSERT INTO contract_notifications
        (contract_id, event_type, recipient_email, channel, status, payload_json)
       VALUES (?, ?, ?, 'email', 'pending', ?)`,
      [
        contractId,
        eventType,
        recipientEmail,
        JSON.stringify({ subject: subject.slice(0, 200), preview: bodyText.slice(0, 300) }),
      ]
    );
    notifId = r.insertId;
  } catch (e) {
    console.warn('[contractNotifier] enqueue failed:', e.message);
    return;
  }

  // Gmail API 발송 시도 (senderUserId 가 있고 Gmail OAuth 연결되어 있을 때)
  if (!gmailSvc?.sendMessageWithAttachments || !senderUserId) {
    // mailto fallback — pending 상태로 둠 (UI 에서 사용자가 직접 발송 가능)
    return;
  }
  try {
    await gmailSvc.sendMessageWithAttachments(senderUserId, {
      to: recipientEmail,
      subject,
      bodyText,
      attachments: [],
    });
    await pool.query(
      `UPDATE contract_notifications
          SET status='sent', sent_at=NOW(), attempts=attempts+1
        WHERE id = ?`,
      [notifId]
    );
  } catch (err) {
    await pool.query(
      `UPDATE contract_notifications
          SET status='failed', attempts=attempts+1, last_error=?
        WHERE id = ?`,
      [String(err?.message || err).slice(0, 500), notifId]
    );
    console.warn('[contractNotifier] Gmail send failed:', err?.message);
  }
}

/**
 * 댓글 알림 (디바운싱)
 */
function notifyComment({ contractId, commentId, authorEmail, authorName, body }) {
  if (!contractId) return;
  let entry = _commentDebounce.get(contractId);
  if (!entry) {
    entry = { comments: [], timer: null, authorEmail };
    _commentDebounce.set(contractId, entry);
  }
  entry.comments.push({
    id: commentId,
    author: authorName || authorEmail || '내부 작성자',
    body: String(body || '').slice(0, 200),
    at: new Date().toISOString(),
  });
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    _commentDebounce.delete(contractId);
    _flushComments(contractId, entry).catch(e =>
      console.warn('[contractNotifier] flush err:', e.message)
    );
  }, DEBOUNCE_MS);
}

async function _flushComments(contractId, entry) {
  try {
    const [[c]] = await pool.query(
      `SELECT contract_no, title, created_by FROM contracts WHERE id = ?`,
      [contractId]
    );
    if (!c) return;
    const emails = await _getStakeholderEmails(contractId, entry.authorEmail);
    if (emails.length === 0) return;

    const count = entry.comments.length;
    const subject = `[OCI CRM] ${c.contract_no} — 새 검토 의견 ${count}건`;
    const preview = entry.comments
      .slice(0, 5)
      .map((co, i) => `${i + 1}. [${co.author}] ${co.body}`)
      .join('\n');
    const bodyText = `계약 [${c.contract_no} — ${c.title}] 에 ${count}건의 새로운 검토 의견이 등록되었습니다.

${preview}
${count > 5 ? `\n…외 ${count - 5}건` : ''}

🔗 계약 상세: ${process.env.APP_BASE_URL || 'https://oci-crm.duckdns.org'}/#contracts/${contractId}

--
본 메일은 자동 발송되었습니다.`;

    for (const email of emails) {
      await _enqueueAndSend({
        contractId,
        eventType: 'comment',
        recipientEmail: email,
        subject,
        bodyText,
        senderUserId: c.created_by,
      });
    }
    console.log(
      `[contractNotifier] comment 알림: contract=${contractId} 수신자=${emails.length}명 댓글=${count}건`
    );
  } catch (e) {
    console.warn('[contractNotifier] flushComments failed:', e.message);
  }
}

/**
 * 상태 변경 알림 (즉시)
 */
async function notifyStatusChange({ contractId, fromStatus, toStatus, changedByUserId }) {
  if (!contractId) return;
  try {
    const [[c]] = await pool.query(
      `SELECT contract_no, title, created_by FROM contracts WHERE id = ?`,
      [contractId]
    );
    if (!c) return;
    const emails = await _getStakeholderEmails(contractId);
    if (emails.length === 0) return;

    const STATUS_LABELS = {
      draft: '초안',
      review: '검토',
      approved: '승인',
      completed: '계약완료',
    };
    const NEXT_ACTION = {
      review: '법무/관련자 검토 진행',
      approved: '서명 단계로 진행 가능 (전자서명 요청)',
      completed: '계약이 완료되었습니다',
      draft: '내용 수정 후 재검토 요청',
    };
    const fromLabel = STATUS_LABELS[fromStatus] || fromStatus;
    const toLabel = STATUS_LABELS[toStatus] || toStatus;
    const nextAction = NEXT_ACTION[toStatus] || '-';

    const subject = `[OCI CRM] ${c.contract_no} — 상태 변경: ${toLabel}`;
    const bodyText = `계약 [${c.contract_no} — ${c.title}] 의 상태가 변경되었습니다.

전 상태: ${fromLabel}
새 상태: ${toLabel}

🎯 다음 액션: ${nextAction}

🔗 계약 상세: ${process.env.APP_BASE_URL || 'https://oci-crm.duckdns.org'}/#contracts/${contractId}

--
본 메일은 자동 발송되었습니다.`;

    for (const email of emails) {
      await _enqueueAndSend({
        contractId,
        eventType: 'status_change',
        recipientEmail: email,
        subject,
        bodyText,
        senderUserId: changedByUserId || c.created_by,
      });
    }
    console.log(
      `[contractNotifier] status_change 알림: contract=${contractId} ${fromStatus}→${toStatus} 수신자=${emails.length}명`
    );
  } catch (e) {
    console.warn('[contractNotifier] notifyStatusChange failed:', e.message);
  }
}

/**
 * 공유 링크 발급 시 수신자에게 초대 메일
 */
async function notifyShareInvite({ contractId, token, role, recipients }) {
  if (!contractId || !token || !Array.isArray(recipients) || recipients.length === 0) return;
  try {
    const [[c]] = await pool.query(
      `SELECT contract_no, title, created_by, review_deadline FROM contracts WHERE id = ?`,
      [contractId]
    );
    if (!c) return;

    const ROLE_DESC = {
      viewer: '읽기 전용 (열람만 가능)',
      commenter: '댓글 작성 가능',
      approver: '승인/거부 추천 가능',
    };
    const shareUrl = (email, name) => {
      const base = process.env.APP_BASE_URL || 'https://oci-crm.duckdns.org';
      const qs = new URLSearchParams({ token, as: email });
      if (name) qs.set('name', name);
      return `${base}/contract-share.html?${qs.toString()}`;
    };

    for (const r of recipients) {
      if (!r.email) continue;
      const link = shareUrl(r.email, r.name);
      const subject = `[OCI CRM] ${c.contract_no} — 계약 검토 요청 (${ROLE_DESC[role] || role})`;
      const deadlineText = c.review_deadline ? `\n📅 검토 기한: ${c.review_deadline}` : '';
      const bodyText = `안녕하세요${r.name ? ' ' + r.name : ''}님,

계약 [${c.contract_no} — ${c.title}] 검토를 요청드립니다.

권한: ${ROLE_DESC[role] || role}${deadlineText}

🔗 검토 링크 (만료 전 접속):
${link}

본 링크는 본인 전용으로 발급되었으며, 만료 기간 이후 접근이 차단됩니다.

--
OCI CRM`;

      await _enqueueAndSend({
        contractId,
        eventType: 'share_invite',
        recipientEmail: r.email,
        subject,
        bodyText,
        senderUserId: c.created_by,
      });

      // notified_at 갱신
      try {
        await pool.query(
          `UPDATE contract_share_recipients SET notified_at = NOW()
            WHERE email = ? AND share_link_id IN
              (SELECT id FROM contract_share_links WHERE token = ?)`,
          [r.email.toLowerCase(), token]
        );
      } catch (_) {
        /* skip */
      }
    }
    console.log(
      `[contractNotifier] share_invite 알림: contract=${contractId} 수신자=${recipients.length}명`
    );
  } catch (e) {
    console.warn('[contractNotifier] notifyShareInvite failed:', e.message);
  }
}

module.exports = {
  notifyComment,
  notifyStatusChange,
  notifyShareInvite,
};
