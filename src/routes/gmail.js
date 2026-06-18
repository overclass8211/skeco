'use strict';
// =============================================================
// /api/gmail — Gmail 읽기 + 리드/고객 매칭 (Phase G1)
//
// 엔드포인트:
//   GET /scope-status              — 현재 사용자 Google 연결 + gmail.readonly 보유 여부
//   GET /messages?email=...&limit= — 특정 이메일 주소와의 송수신 메시지 N건
//   GET /match/lead/:id            — 리드의 contact_email 로 자동 매칭
//   GET /match/customer/:id        — 고객의 contact_email 로 자동 매칭
//
// 인증: 기존 /api/google 의 requireAuth 재사용 (JWT Bearer)
// =============================================================

const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireAuth } = require('./google');
const { requireFeature } = require('../middleware/featureGuard');
const gmailSvc = require('../services/gmail');

// 모든 라우트 인증 필요
router.use(requireAuth);

// ── scope 보유 여부 — 프론트가 UI 결정 시 사용 ─────────────────
router.get('/scope-status', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId)
      return res.json({ success: true, data: { connected: false, hasGmailScope: false } });

    const [[row]] = await pool.query(
      'SELECT google_email, gmail_sync_error FROM google_oauth_tokens WHERE user_id = ?',
      [userId]
    );
    if (!row) return res.json({ success: true, data: { connected: false, hasGmailScope: false } });

    // 실제 scope 보유 여부는 Gmail API 호출로 확인 (low-cost: getProfile)
    let hasGmailScope = false;
    let email = null;
    try {
      email = await gmailSvc.getOwnEmail(userId);
      hasGmailScope = true;
    } catch (_) {
      hasGmailScope = false;
    }

    // OAuth 정상 동작 확인됐는데 invalid_grant 잔존 에러 있으면 stale — 자동 클리어
    // (재연결 직후 상태에서 사용자에게 stale 에러가 계속 보이는 것 방지)
    if (hasGmailScope && row.gmail_sync_error) {
      const isStaleAuthErr = /invalid_grant|인증이 만료|권한이 회수|재연결/i.test(
        row.gmail_sync_error
      );
      if (isStaleAuthErr) {
        await pool
          .query(`UPDATE google_oauth_tokens SET gmail_sync_error = NULL WHERE user_id = ?`, [
            userId,
          ])
          .catch(() => {});
      }
    }

    res.json({
      success: true,
      data: { connected: true, hasGmailScope, google_email: email || row.google_email },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 특정 이메일 주소로 메시지 조회 ─────────────────────────────
router.get('/messages', requireFeature('gmail.read'), async (req, res) => {
  try {
    const userId = getUserId(req);
    const email = (req.query.email || '').trim().toLowerCase();
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    if (!email || !/@/.test(email)) {
      return res.status(400).json({ success: false, error: '유효한 email 쿼리가 필요합니다' });
    }
    const messages = await gmailSvc.listByEmail(userId, email, { limit });
    res.json({ success: true, data: messages, count: messages.length, email });
  } catch (err) {
    const c = gmailSvc.classifyError(err);
    if (c.status !== 500) return res.status(c.status).json(c.body);
    handleError(res, err);
  }
});

// ── 리드 자동 매칭 ────────────────────────────────────────────
router.get('/match/lead/:id', requireFeature('gmail.read'), async (req, res) => {
  try {
    const userId = getUserId(req);
    const leadId = parseInt(req.params.id);
    if (!leadId || isNaN(leadId)) {
      return res.status(400).json({ success: false, error: '유효한 리드 ID 필요' });
    }
    // 리드의 고객사 email (leads 자체에 email 컬럼 없음 — customers.email 만 사용)
    const [[lead]] = await pool.query(
      `SELECT l.id, l.customer_id, l.customer_name,
              COALESCE(NULLIF(c.email, ''), '') AS contact_email
         FROM leads l
         LEFT JOIN customers c ON c.id = l.customer_id
        WHERE l.id = ?`,
      [leadId]
    );
    if (!lead) return res.status(404).json({ success: false, error: '리드를 찾을 수 없음' });
    if (!lead.contact_email) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        reason: 'no_contact_email',
        message: '고객 담당자 이메일이 등록되어 있지 않습니다 — 고객사 정보에 이메일을 추가하세요.',
      });
    }
    const messages = await gmailSvc.listByEmail(userId, lead.contact_email, {
      limit: Math.min(50, parseInt(req.query.limit) || 10),
    });
    res.json({
      success: true,
      data: messages,
      count: messages.length,
      email: lead.contact_email,
    });
  } catch (err) {
    const c = gmailSvc.classifyError(err);
    if (c.status !== 500) return res.status(c.status).json(c.body);
    handleError(res, err);
  }
});

// ── 고객 자동 매칭 ────────────────────────────────────────────
router.get('/match/customer/:id', requireFeature('gmail.read'), async (req, res) => {
  try {
    const userId = getUserId(req);
    const custId = parseInt(req.params.id);
    if (!custId || isNaN(custId)) {
      return res.status(400).json({ success: false, error: '유효한 고객사 ID 필요' });
    }
    const [[c]] = await pool.query(
      `SELECT id, name, COALESCE(NULLIF(email, ''), '') AS contact_email
         FROM customers WHERE id = ?`,
      [custId]
    );
    if (!c) return res.status(404).json({ success: false, error: '고객사를 찾을 수 없음' });
    if (!c.contact_email) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        reason: 'no_contact_email',
        message: '고객 담당자 이메일이 등록되어 있지 않습니다.',
      });
    }
    const messages = await gmailSvc.listByEmail(userId, c.contact_email, {
      limit: Math.min(50, parseInt(req.query.limit) || 10),
    });
    res.json({
      success: true,
      data: messages,
      count: messages.length,
      email: c.contact_email,
    });
  } catch (err) {
    const cls = gmailSvc.classifyError(err);
    if (cls.status !== 500) return res.status(cls.status).json(cls.body);
    handleError(res, err);
  }
});

// ── 동기화 설정 조회 (Phase G3) ───────────────────────────────
router.get('/sync-settings', async (req, res) => {
  try {
    const userId = getUserId(req);
    const [[row]] = await pool.query(
      `SELECT google_email, gmail_sync_enabled, gmail_last_polled_at, gmail_sync_error
         FROM google_oauth_tokens WHERE user_id = ?`,
      [userId]
    );
    if (!row) {
      return res.json({
        success: true,
        data: { connected: false, enabled: false, last_polled_at: null, error: null },
      });
    }

    // stale invalid_grant 에러 자동 클리어 — OAuth 가 현재 동작하는지 확인 후 그렇다면 에러 제거
    // (재연결 후에도 옛 "재연결 필요" 메시지가 계속 보이는 문제 방지)
    let returnedError = row.gmail_sync_error;
    if (returnedError && /invalid_grant|인증이 만료|권한이 회수|재연결/i.test(returnedError)) {
      let oauthHealthy = false;
      try {
        await gmailSvc.getOwnEmail(userId);
        oauthHealthy = true;
      } catch (_) {
        oauthHealthy = false;
      }
      if (oauthHealthy) {
        await pool
          .query(`UPDATE google_oauth_tokens SET gmail_sync_error = NULL WHERE user_id = ?`, [
            userId,
          ])
          .catch(() => {});
        returnedError = null;
      }
    }

    res.json({
      success: true,
      data: {
        connected: true,
        google_email: row.google_email,
        enabled: !!row.gmail_sync_enabled,
        last_polled_at: row.gmail_last_polled_at,
        error: returnedError,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 동기화 토글 (Phase G3) ────────────────────────────────────
router.put('/sync-settings', async (req, res) => {
  try {
    const userId = getUserId(req);
    const enabled = req.body && req.body.enabled === true ? 1 : 0;
    const [[row]] = await pool.query('SELECT user_id FROM google_oauth_tokens WHERE user_id = ?', [
      userId,
    ]);
    if (!row) {
      return res.status(400).json({
        success: false,
        error: 'Google 계정이 연결되지 않았습니다. 먼저 Google 연결 후 동기화를 활성화하세요.',
        notConnected: true,
      });
    }
    await pool.query(
      `UPDATE google_oauth_tokens
          SET gmail_sync_enabled = ?,
              gmail_sync_error   = NULL
        WHERE user_id = ?`,
      [enabled, userId]
    );
    res.json({ success: true, data: { enabled: !!enabled } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수동 동기화 트리거 (Phase G3) ─────────────────────────────
router.post('/sync-now', requireFeature('gmail.sync'), async (req, res) => {
  try {
    const userId = getUserId(req);
    const sync = require('../services/gmailSync');
    const result = await sync.pollOne(userId);
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 메일 발송 (Phase G2) ─────────────────────────────────────
// body: { to, subject, body, cc?, bcc? }
// 응답: { success, data: { message_id, thread_id, from } }
router.post('/send', requireFeature('gmail.send'), async (req, res) => {
  try {
    const userId = getUserId(req);
    const { to, subject, body, cc, bcc } = req.body || {};
    if (!to || !/@/.test(String(to))) {
      return res.status(400).json({ success: false, error: '유효한 수신자(to)가 필요합니다' });
    }
    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ success: false, error: '제목이 필요합니다' });
    }
    const result = await gmailSvc.sendMessage(userId, { to, subject, body, cc, bcc });
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    const cls = gmailSvc.classifyError(err);
    if (cls.status !== 500) return res.status(cls.status).json(cls.body);
    handleError(res, err);
  }
});

module.exports = router;
