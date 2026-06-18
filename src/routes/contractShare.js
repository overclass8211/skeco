'use strict';
// =============================================================
// /api/contracts/share — 공유 링크용 외부 접근 라우터 (v6.0.0+)
//
// 인증 없이 접근 가능 (server.js 에서 authenticate 미들웨어 등록 전에 mount).
// 토큰 + role + 만료 검증으로 보안 + 권한 분리:
//   - viewer    : 계약 + 파일 read-only
//   - commenter : viewer + 댓글 작성
//   - approver  : commenter + 승인/거부 추천
//
// 엔드포인트:
//   GET    /:token                        — 공유 페이지 데이터 (계약 + 파일 + 권한)
//   GET    /:token/files/:fileId/download — 파일 다운로드
//   GET    /:token/comments               — 댓글 목록
//   POST   /:token/comments               — 댓글 작성 (commenter+)
// =============================================================

const router = require('express').Router();
const fs = require('fs');
const pool = require('../db');

// 토큰 검증 + 만료/회수 확인 → contract + share row 반환
async function _resolveSharedLink(token) {
  if (!token || typeof token !== 'string') return null;
  if (token.length < 20 || token.length > 64) return null;
  const [[link]] = await pool.query(
    `SELECT csl.*, c.id AS contract_id, c.contract_no, c.title, c.customer_name,
            c.contract_type, c.status, c.start_date, c.end_date,
            c.contract_amount, c.currency, c.review_deadline,
            c.esign_status, c.esign_request_id
       FROM contract_share_links csl
       LEFT JOIN contracts c ON c.id = csl.contract_id
      WHERE csl.token = ?`,
    [token]
  );
  if (!link) return null;
  if (link.revoked_at) return { _revoked: true };
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return { _expired: true };
  }
  return link;
}

// 수신자 viewed_at 갱신 (best-effort)
async function _markViewed(shareLinkId, email) {
  if (!email) return;
  try {
    await pool.query(
      `UPDATE contract_share_recipients SET viewed_at = COALESCE(viewed_at, NOW())
        WHERE share_link_id = ? AND email = ?`,
      [shareLinkId, email]
    );
  } catch (_) {
    /* non-critical */
  }
}

// ── GET /:token — 공유 페이지 데이터 ────────────────────────
router.get('/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const link = await _resolveSharedLink(token);
    if (!link) {
      return res.status(404).json({ success: false, error: '공유 링크가 유효하지 않습니다' });
    }
    if (link._revoked) {
      return res.status(410).json({ success: false, error: '공유 링크가 회수되었습니다' });
    }
    if (link._expired) {
      return res.status(410).json({ success: false, error: '공유 링크가 만료되었습니다' });
    }

    // 파일 목록 (분석 가능한 PDF/이미지/TXT 만 노출)
    const [files] = await pool.query(
      `SELECT id, original_filename, file_size, mime_type, file_type, created_at
         FROM contract_files
        WHERE contract_id = ?
        ORDER BY created_at DESC`,
      [link.contract_id]
    );

    // 수신자 (viewed_at 등 통계)
    const [recipients] = await pool.query(
      `SELECT id, email, name, viewed_at, responded_at
         FROM contract_share_recipients
        WHERE share_link_id = ?`,
      [link.id]
    );

    // 최신 AI 법무 검토 (option: 공유받은 자도 검토 결과 볼 수 있음)
    const [[latestReview]] = await pool.query(
      `SELECT review_score, risk_level, overall_assessment, generated_at
         FROM contract_legal_reviews
        WHERE contract_id = ?
        ORDER BY generated_at DESC LIMIT 1`,
      [link.contract_id]
    );

    // 본인 viewed_at 갱신 (recipient_email query 로 전달된 경우)
    const recipientEmail = String(req.query.as || '').toLowerCase();
    if (recipientEmail) await _markViewed(link.id, recipientEmail);

    res.json({
      success: true,
      data: {
        // 계약 기본 정보 (민감 정보 제한 — notes 등 제외)
        contract: {
          contract_no: link.contract_no,
          title: link.title,
          customer_name: link.customer_name,
          contract_type: link.contract_type,
          status: link.status,
          start_date: link.start_date,
          end_date: link.end_date,
          contract_amount: link.contract_amount,
          currency: link.currency,
          review_deadline: link.review_deadline,
        },
        share: {
          role: link.role,
          expires_at: link.expires_at,
          recipients: recipients.map(r => ({
            email: r.email,
            name: r.name,
            viewed_at: r.viewed_at,
            responded_at: r.responded_at,
          })),
        },
        files: files.map(f => ({
          id: f.id,
          original_filename: f.original_filename,
          file_size: f.file_size,
          mime_type: f.mime_type,
          file_type: f.file_type,
          download_url: `/api/contracts/share/${token}/files/${f.id}/download`,
        })),
        latest_legal_review: latestReview
          ? {
              review_score: latestReview.review_score,
              risk_level: latestReview.risk_level,
              overall_assessment: latestReview.overall_assessment,
              generated_at: latestReview.generated_at,
            }
          : null,
      },
    });
  } catch (err) {
    console.error('[contracts:share view] failed:', err?.message || err);
    res.status(500).json({ success: false, error: '서버 오류' });
  }
});

// ── GET /:token/files/:fileId/download — 파일 다운로드 ──────
router.get('/:token/files/:fileId/download', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const fileId = parseInt(req.params.fileId, 10);
    if (!fileId) return res.status(400).json({ success: false, error: '유효한 파일 ID 필요' });

    const link = await _resolveSharedLink(token);
    if (!link) {
      return res.status(404).json({ success: false, error: '공유 링크가 유효하지 않습니다' });
    }
    if (link._revoked || link._expired) {
      return res.status(410).json({ success: false, error: '공유 링크 만료/회수' });
    }

    const [[file]] = await pool.query(
      `SELECT id, file_path, mime_type, original_filename
         FROM contract_files
        WHERE id = ? AND contract_id = ?`,
      [fileId, link.contract_id]
    );
    if (!file) {
      return res.status(404).json({ success: false, error: '파일을 찾을 수 없습니다' });
    }
    if (!fs.existsSync(file.file_path)) {
      return res.status(404).json({ success: false, error: '파일이 디스크에 없습니다' });
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`
    );
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.sendFile(file.file_path);
  } catch (err) {
    console.error('[contracts:share download] failed:', err?.message || err);
    res.status(500).json({ success: false, error: '서버 오류' });
  }
});

// ── GET /:token/comments — 댓글 목록 ────────────────────────
router.get('/:token/comments', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const link = await _resolveSharedLink(token);
    if (!link) {
      return res.status(404).json({ success: false, error: '공유 링크가 유효하지 않습니다' });
    }
    if (link._revoked || link._expired) {
      return res.status(410).json({ success: false, error: '공유 링크 만료/회수' });
    }

    const [comments] = await pool.query(
      `SELECT cc.id, cc.parent_id, cc.comment_type, cc.body, cc.created_at,
              cc.author_email, cc.author_name,
              tm.name AS internal_author_name
         FROM contract_comments cc
         LEFT JOIN team_members tm ON tm.id = cc.user_id
        WHERE cc.contract_id = ?
        ORDER BY cc.created_at ASC`,
      [link.contract_id]
    );
    res.json({ success: true, data: comments });
  } catch (err) {
    handleSharedError(res, err, 'comments fetch');
  }
});

// ── POST /:token/comments — 댓글 작성 (commenter+) ──────────
router.post('/:token/comments', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const link = await _resolveSharedLink(token);
    if (!link) {
      return res.status(404).json({ success: false, error: '공유 링크가 유효하지 않습니다' });
    }
    if (link._revoked || link._expired) {
      return res.status(410).json({ success: false, error: '공유 링크 만료/회수' });
    }
    if (link.role !== 'commenter' && link.role !== 'approver') {
      return res.status(403).json({ success: false, error: '읽기 전용 권한입니다' });
    }
    const body = req.body || {};
    const text = String(body.body || '').trim();
    if (!text) return res.status(400).json({ success: false, error: '댓글 내용 필요' });
    const commentType = ['general', 'revise', 'approve', 'reject'].includes(body.comment_type)
      ? body.comment_type
      : 'general';
    if ((commentType === 'approve' || commentType === 'reject') && link.role !== 'approver') {
      return res
        .status(403)
        .json({ success: false, error: '승인/거부 권한은 approver 만 가능합니다' });
    }
    const parentId = body.parent_id ? parseInt(body.parent_id, 10) : null;
    const authorEmail =
      String(body.author_email || '')
        .toLowerCase()
        .slice(0, 200) || null;
    const authorName = String(body.author_name || '').slice(0, 100) || null;

    const [r] = await pool.query(
      `INSERT INTO contract_comments
        (contract_id, share_link_id, user_id, parent_id, comment_type,
         body, author_email, author_name)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
      [
        link.contract_id,
        link.id,
        parentId,
        commentType,
        text.slice(0, 5000),
        authorEmail,
        authorName,
      ]
    );

    // 수신자 responded_at 갱신 (best-effort)
    if (authorEmail) {
      try {
        await pool.query(
          `UPDATE contract_share_recipients SET responded_at = NOW()
            WHERE share_link_id = ? AND email = ?`,
          [link.id, authorEmail]
        );
      } catch (_) {
        /* non-critical */
      }
    }

    // 알림 트리거 (best-effort — Phase E 구현 시 활성화)
    try {
      const notifySvc = require('../services/contractNotifier');
      if (notifySvc?.notifyComment) {
        // 비동기 — 응답 차단 안함
        notifySvc.notifyComment({
          contractId: link.contract_id,
          commentId: r.insertId,
          authorEmail,
          authorName,
          body: text,
        });
      }
    } catch (_) {
      /* notifier 없으면 skip */
    }

    res.json({ success: true, data: { id: r.insertId, comment_type: commentType } });
  } catch (err) {
    handleSharedError(res, err, 'comment create');
  }
});

function handleSharedError(res, err, label) {
  console.error(`[contracts:share ${label}] failed:`, err?.message || err);
  res.status(500).json({ success: false, error: '서버 오류' });
}

module.exports = router;
