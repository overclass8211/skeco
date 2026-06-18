'use strict';
// =============================================================
// leadNotifier — 영업리드 댓글 알림 발송 서비스 (v6.0.0)
//
// 책임:
//   1. 댓글 작성 시 → 영업담당자 + 이전 댓글 작성자 전원에게 메일 (30초 디바운싱)
//
// 메일 발송:
//   - Gmail API 우선 (작성자 OAuth 연결 시)
//   - 미연결 시 콘솔 로그만 (큐 테이블 미생성 — 단순화)
//
// 디바운싱: 같은 리드에 30초 내 여러 댓글 → 1개 알림으로 통합
//
// 패턴 참고: src/services/contractNotifier.js
// =============================================================

const pool = require('../db');

let gmailSvc = null;
try {
  gmailSvc = require('./gmail');
} catch (_) {
  /* gmail 서비스 없으면 skip — 알림은 로그만 */
}

// 디바운싱: 리드 ID 별로 pending 댓글 모음
const _commentDebounce = new Map(); // leadId → { timer, comments[], authorEmail }
const DEBOUNCE_MS = 30 * 1000;

/**
 * 관련자 이메일 목록 조회
 * - 영업담당자 (leads.assigned_to → team_members.email)
 * - 협업자 (leads.collaborator_ids JSON → team_members.email) ← v6.0.0 Phase B
 * - 이전 댓글 작성자 (lead_comments.user_id → team_members.email)
 * - 등록자 (leads.created_by → team_members.email, 있으면)
 */
async function _getStakeholderEmails(leadId, excludeEmail = null) {
  const emails = new Set();

  // 1. 영업담당자 + 등록자 + 협업자 (JSON)
  let collaboratorIds = [];
  try {
    const [[l]] = await pool.query(
      `SELECT l.assigned_to, l.created_by, l.collaborator_ids,
              tmA.email AS assignee_email,
              tmC.email AS creator_email
         FROM leads l
         LEFT JOIN team_members tmA ON tmA.id = l.assigned_to
         LEFT JOIN team_members tmC ON tmC.id = l.created_by
        WHERE l.id = ?`,
      [leadId]
    );
    if (l?.assignee_email) emails.add(l.assignee_email.toLowerCase());
    if (l?.creator_email) emails.add(l.creator_email.toLowerCase());
    // 협업자 ID 추출 (JSON 또는 string)
    if (l?.collaborator_ids) {
      let raw = l.collaborator_ids;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch (_) {
          raw = [];
        }
      }
      if (Array.isArray(raw)) {
        collaboratorIds = raw.map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x > 0);
      }
    }
  } catch (_) {
    /* skip */
  }

  // 2. 협업자 이메일 join
  if (collaboratorIds.length) {
    try {
      const placeholders = collaboratorIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT email FROM team_members WHERE id IN (${placeholders}) AND email IS NOT NULL`,
        collaboratorIds
      );
      for (const r of rows) {
        if (r.email) emails.add(r.email.toLowerCase());
      }
    } catch (_) {
      /* skip */
    }
  }

  // 3. 이전 댓글 작성자 (DISTINCT)
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT tm.email
         FROM lead_comments lc
         JOIN team_members tm ON tm.id = lc.user_id
        WHERE lc.lead_id = ? AND tm.email IS NOT NULL`,
      [leadId]
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
 * Gmail 발송 시도 (실패해도 best-effort)
 */
async function _sendOne({ to, subject, bodyText, senderUserId }) {
  if (!to || !gmailSvc?.sendMessageWithAttachments || !senderUserId) {
    console.log(`[leadNotifier] skip send: to=${to} (gmail 미연결 또는 sender 없음)`);
    return;
  }
  try {
    await gmailSvc.sendMessageWithAttachments(senderUserId, {
      to,
      subject,
      bodyText,
      attachments: [],
    });
  } catch (err) {
    console.warn('[leadNotifier] Gmail send failed:', err?.message);
  }
}

/**
 * 댓글 알림 (30초 디바운싱)
 */
function notifyComment({ leadId, commentId, authorEmail, authorName, body, authorUserId }) {
  if (!leadId) return;
  let entry = _commentDebounce.get(leadId);
  if (!entry) {
    entry = { comments: [], timer: null, authorEmail, authorUserId };
    _commentDebounce.set(leadId, entry);
  }
  entry.comments.push({
    id: commentId,
    author: authorName || authorEmail || '내부 작성자',
    body: String(body || '').slice(0, 200),
    at: new Date().toISOString(),
  });
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    _commentDebounce.delete(leadId);
    _flushComments(leadId, entry).catch(e => console.warn('[leadNotifier] flush err:', e.message));
  }, DEBOUNCE_MS);
}

async function _flushComments(leadId, entry) {
  try {
    const [[l]] = await pool.query(`SELECT customer_name, project_name FROM leads WHERE id = ?`, [
      leadId,
    ]);
    if (!l) return;
    const emails = await _getStakeholderEmails(leadId, entry.authorEmail);
    if (emails.length === 0) {
      console.log(`[leadNotifier] no stakeholders for lead=${leadId}`);
      return;
    }

    const count = entry.comments.length;
    const title = `${l.customer_name || '리드'} — ${l.project_name || ''}`;
    const subject = `[OCI CRM] 영업리드 새 코멘트 ${count}건 — ${title}`;
    const preview = entry.comments
      .slice(0, 5)
      .map((co, i) => `${i + 1}. [${co.author}] ${co.body}`)
      .join('\n');
    const bodyText = `영업리드 [${title}] 에 ${count}건의 새 코멘트가 등록되었습니다.

${preview}
${count > 5 ? `\n…외 ${count - 5}건` : ''}

🔗 리드 상세: ${process.env.APP_BASE_URL || 'https://oci-crm.duckdns.org'}/#leads

--
본 메일은 자동 발송되었습니다.`;

    for (const email of emails) {
      await _sendOne({
        to: email,
        subject,
        bodyText,
        senderUserId: entry.authorUserId,
      });
    }
    console.log(
      `[leadNotifier] comment 알림: lead=${leadId} 수신자=${emails.length}명 댓글=${count}건`
    );
  } catch (e) {
    console.warn('[leadNotifier] flushComments failed:', e.message);
  }
}

/**
 * 주 담당자 변경 알림 (즉시 발송 — 디바운싱 없음)
 * - 이전 담당자: "리드가 다른 담당자에게 인계됩니다"
 * - 신규 담당자: "새 리드가 당신에게 배정되었습니다"
 *
 * notifyOptions (향후 확장용, Phase 3에서 notifyTeamLead 활성화 예정):
 *   { notifyPrimary=true, notifyCollaborators=false, notifyTeamLead=false }
 */
async function notifyOwnerChange({
  leadId,
  oldOwnerId,
  newOwnerId,
  actorName,
  senderUserId,
  notifyOptions = {},
}) {
  if (!leadId) return;
  const {
    notifyPrimary = true,
    notifyCollaborators = false,
    notifyTeamLead = false, // TODO Phase 3: 영업팀장 자동 식별 구현 후 활성화
  } = notifyOptions;
  void notifyCollaborators; // 향후 사용 예정
  void notifyTeamLead; // Phase 3 placeholder

  try {
    const [[l]] = await pool.query('SELECT customer_name, project_name FROM leads WHERE id = ?', [
      leadId,
    ]);
    if (!l) return;
    const title = `${l.customer_name || '리드'} — ${l.project_name || ''}`;
    const appUrl = process.env.APP_BASE_URL || 'https://oci-crm.duckdns.org';
    const actor = actorName || '(시스템)';

    // 이전 담당자 알림
    if (notifyPrimary && oldOwnerId) {
      const [[oldOwner]] = await pool.query('SELECT name, email FROM team_members WHERE id = ?', [
        oldOwnerId,
      ]);
      if (oldOwner?.email) {
        await _sendOne({
          to: oldOwner.email,
          subject: `[OCI CRM] 영업리드 담당자 변경 알림 — ${title}`,
          bodyText: `안녕하세요, ${oldOwner.name || '담당자'}님.\n\n영업리드 [${title}]의 주 담당자가 변경되었습니다.\n\n변경자: ${actor}\n\n🔗 리드 상세: ${appUrl}/#leads\n\n--\n본 메일은 자동 발송되었습니다.`,
          senderUserId,
        });
      }
    }

    // 신규 담당자 알림 (항상)
    if (newOwnerId) {
      const [[newOwner]] = await pool.query('SELECT name, email FROM team_members WHERE id = ?', [
        newOwnerId,
      ]);
      if (newOwner?.email) {
        await _sendOne({
          to: newOwner.email,
          subject: `[OCI CRM] 새 영업리드 배정 알림 — ${title}`,
          bodyText: `안녕하세요, ${newOwner.name || '담당자'}님.\n\n영업리드 [${title}]의 주 담당자로 배정되었습니다.\n\n배정자: ${actor}\n\n🔗 리드 상세: ${appUrl}/#leads\n\n--\n본 메일은 자동 발송되었습니다.`,
          senderUserId,
        });
      }
    }

    console.log(
      `[leadNotifier] owner_change 알림: lead=${leadId} ${oldOwnerId || '미지정'}→${newOwnerId}`
    );
  } catch (e) {
    console.warn('[leadNotifier] notifyOwnerChange err:', e.message);
  }
}

module.exports = {
  notifyComment,
  notifyOwnerChange,
};
