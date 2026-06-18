'use strict';
// =============================================================
// /api/proposals/share — 공유 링크용 외부 접근 라우터 (Phase 5-C)
//
// 인증 없이 접근 가능 (server.js 에서 authenticate 미들웨어 등록 전에 mount).
// share_token + shared_until 검증으로 보안.
//
// 노출 정보 (최소 정보 + include_in_email = 1 파일만):
//   - proposal_no, proposal_title, customer_name, proposal_date
//   - rfp_title, rfp_summary
//   - files (include_in_email = 1 만, 원본명/크기/다운로드 URL)
// 미노출: lead/quote, ai_strategy_md, email_logs, expected_amount 등
//
// 엔드포인트:
//   GET /:token                       — 공유 페이지 데이터
//   GET /:token/files/:fileId/download — 공유 파일 다운로드
// =============================================================

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const pool = require('../db');

// share_token 검증 + 만료 확인 — 검증 통과 시 proposal 반환
async function _resolveSharedProposal(token) {
  if (!token || typeof token !== 'string') return null;
  // 토큰은 base64url 43자 — 너무 짧으면 즉시 거부 (timing attack 완화 + 무의미한 쿼리 차단)
  if (token.length < 20 || token.length > 64) return null;
  const [[prop]] = await pool.query(
    `SELECT id, proposal_no, proposal_title, customer_name, proposal_date,
            rfp_title, rfp_summary, share_token, shared_until
       FROM proposals
      WHERE share_token = ?`,
    [token]
  );
  if (!prop) return null;
  // 만료 확인 (shared_until NULL = 무제한)
  if (prop.shared_until && new Date(prop.shared_until).getTime() < Date.now()) {
    return { _expired: true };
  }
  return prop;
}

// 공유 history 기록 (best-effort)
async function _logShareView(proposalId, action, ipAddr) {
  try {
    await pool.query(
      `INSERT INTO proposal_history
        (proposal_id, action_type, description, created_by)
       VALUES (?, ?, ?, NULL)`,
      [proposalId, action, `외부 접근 (${(ipAddr || 'unknown').slice(0, 45)})`]
    );
  } catch (_) {
    /* non-critical */
  }
}

// ── GET /:token — 공유 페이지 데이터 (최소 정보) ─────────────
router.get('/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const prop = await _resolveSharedProposal(token);
    if (!prop) {
      return res.status(404).json({ success: false, error: '공유 링크가 유효하지 않습니다' });
    }
    if (prop._expired) {
      return res.status(410).json({ success: false, error: '공유 링크가 만료되었습니다' });
    }

    // include_in_email = 1 파일만 노출
    const [files] = await pool.query(
      `SELECT id, original_filename, file_size, mime_type, revision_no, file_type, created_at
         FROM proposal_files
        WHERE proposal_id = ? AND include_in_email = 1
        ORDER BY created_at DESC`,
      [prop.id]
    );

    const ipAddr =
      req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'unknown';
    _logShareView(prop.id, 'share_view', ipAddr);

    res.json({
      success: true,
      data: {
        proposal_no: prop.proposal_no,
        proposal_title: prop.proposal_title,
        customer_name: prop.customer_name,
        proposal_date: prop.proposal_date,
        rfp_title: prop.rfp_title,
        rfp_summary: prop.rfp_summary,
        shared_until: prop.shared_until, // 클라이언트 만료 안내용
        files: files.map(f => ({
          id: f.id,
          original_filename: f.original_filename,
          file_size: f.file_size,
          mime_type: f.mime_type,
          revision_no: f.revision_no,
          file_type: f.file_type,
          download_url: `/api/proposals/share/${token}/files/${f.id}/download`,
        })),
      },
    });
  } catch (err) {
    console.error('[proposals:share view] failed:', err?.message || err);
    res.status(500).json({ success: false, error: '서버 오류' });
  }
});

// ── GET /:token/files/:fileId/download — 공유 파일 다운로드
router.get('/:token/files/:fileId/download', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const fileId = parseInt(req.params.fileId, 10);
    if (!fileId) return res.status(400).json({ success: false, error: '유효한 파일 ID 필요' });

    const prop = await _resolveSharedProposal(token);
    if (!prop) {
      return res.status(404).json({ success: false, error: '공유 링크가 유효하지 않습니다' });
    }
    if (prop._expired) {
      return res.status(410).json({ success: false, error: '공유 링크가 만료되었습니다' });
    }

    // include_in_email = 1 + 소유 검증
    const [[file]] = await pool.query(
      `SELECT id, file_path, mime_type, original_filename
         FROM proposal_files
        WHERE id = ? AND proposal_id = ? AND include_in_email = 1`,
      [fileId, prop.id]
    );
    if (!file) {
      return res.status(404).json({ success: false, error: '공유 대상 파일이 아닙니다' });
    }

    const absPath = path.join(__dirname, '..', '..', 'public', file.file_path);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, error: '파일이 디스크에 없습니다' });
    }

    // 다운로드 history (best-effort)
    const ipAddr =
      req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'unknown';
    _logShareView(prop.id, 'share_download', ipAddr);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`
    );
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.sendFile(absPath);
  } catch (err) {
    console.error('[proposals:share download] failed:', err?.message || err);
    res.status(500).json({ success: false, error: '서버 오류' });
  }
});

module.exports = router;
