// =============================================================
// Webhooks API — 외부 통합 등록 CRUD + 테스트 발송 + 발송 이력
//
//   GET    /api/webhooks                — 목록
//   GET    /api/webhooks/:id             — 단건
//   POST   /api/webhooks                 — 신규
//   PUT    /api/webhooks/:id             — 수정
//   DELETE /api/webhooks/:id             — 삭제
//   POST   /api/webhooks/:id/test        — 테스트 발송
//   GET    /api/webhooks/:id/deliveries  — 최근 발송 이력
//   GET    /api/webhooks/events          — 지원 이벤트 목록
//
// 권한: 모든 인증 사용자 (RBAC 별도 적용 가능)
// =============================================================

const router = require('express').Router();
const crypto = require('crypto');
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const dispatcher = require('../services/webhookDispatcher');

// Webhook 시스템 전체에 feature flag 적용
router.use(requireFeature('webhook.system'));

const MAX_URL = 500;
const MAX_NAME = 150;
const ALLOW_HTTP =
  process.env.WEBHOOK_ALLOW_HTTP === 'true' || process.env.NODE_ENV !== 'production';

function sanitize(value, maxLen) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLen);
}

function validateUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch (_) {
    return { ok: false, error: '잘못된 URL 형식' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'http:// 또는 https:// 만 허용' };
  }
  if (u.protocol === 'http:' && !ALLOW_HTTP) {
    return { ok: false, error: 'HTTPS URL 만 허용됩니다 (운영 모드)' };
  }
  return { ok: true, url: u.toString() };
}

function validateEvents(rawTypes) {
  if (!Array.isArray(rawTypes)) return { ok: false, error: 'event_types 는 배열이어야 합니다.' };
  if (rawTypes.length === 0) return { ok: false, error: '최소 1개 이상의 이벤트를 선택하세요.' };
  const allowed = new Set(dispatcher.listAllowedEvents());
  const filtered = rawTypes.filter(t => typeof t === 'string' && allowed.has(t));
  if (filtered.length === 0) {
    return { ok: false, error: '지원되지 않는 이벤트만 포함되어 있습니다.' };
  }
  return { ok: true, events: filtered };
}

// 지원 이벤트 목록
router.get('/events', (_req, res) => {
  res.json({ success: true, data: dispatcher.listAllowedEvents() });
});

// 목록
router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, url, event_types, is_active, failure_count,
              last_status, last_sent_at, created_by, created_at, updated_at
         FROM webhooks
        ORDER BY id DESC`
    );
    // event_types JSON 파싱
    const data = rows.map(r => {
      let parsed = [];
      try {
        parsed = JSON.parse(r.event_types || '[]');
      } catch (_) {
        /* ignore */
      }
      return { ...r, event_types: parsed };
    });
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

// 단건 (secret 마스킹 — 한 번만 노출)
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const [[row]] = await pool.query(
      `SELECT id, name, url, event_types, is_active, failure_count,
              last_status, last_sent_at, created_by, created_at, updated_at,
              CASE WHEN secret IS NULL OR secret = '' THEN 0 ELSE 1 END AS has_secret
         FROM webhooks WHERE id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ success: false, error: 'Webhook 없음' });
    try {
      row.event_types = JSON.parse(row.event_types || '[]');
    } catch (_) {
      row.event_types = [];
    }
    res.json({ success: true, data: row });
  } catch (err) {
    handleError(res, err);
  }
});

// 신규
router.post('/', async (req, res) => {
  try {
    const name = sanitize(req.body.name, MAX_NAME);
    const url = sanitize(req.body.url, MAX_URL);
    const rawSecret =
      req.body.secret !== null && req.body.secret !== undefined
        ? String(req.body.secret).trim()
        : '';
    const events = req.body.event_types;

    if (!name)
      return res
        .status(400)
        .json({ success: false, code: 'VALIDATION_ERROR', error: 'name 은 필수입니다.' });
    if (!url)
      return res
        .status(400)
        .json({ success: false, code: 'VALIDATION_ERROR', error: 'url 은 필수입니다.' });

    const urlCheck = validateUrl(url);
    if (!urlCheck.ok) {
      return res
        .status(400)
        .json({ success: false, code: 'VALIDATION_ERROR', error: urlCheck.error });
    }
    const eventCheck = validateEvents(events);
    if (!eventCheck.ok) {
      return res
        .status(400)
        .json({ success: false, code: 'VALIDATION_ERROR', error: eventCheck.error });
    }

    // 시크릿: 사용자 제공이 없으면 자동 생성 (32 byte hex)
    const secret = rawSecret || crypto.randomBytes(32).toString('hex');

    const userId = getUserId(req);
    const [r] = await pool.query(
      `INSERT INTO webhooks (name, url, event_types, secret, is_active, created_by)
         VALUES (?, ?, ?, ?, 1, ?)`,
      [name, urlCheck.url, JSON.stringify(eventCheck.events), secret, userId]
    );
    // 신규 생성 시 한 번만 secret 노출 — 저장 권장
    res.json({ success: true, id: r.insertId, secret });
  } catch (err) {
    handleError(res, err);
  }
});

// 수정
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });

    const fields = [];
    const params = [];

    if (req.body.name !== undefined) {
      const v = sanitize(req.body.name, MAX_NAME);
      if (!v)
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'name 은 비어있을 수 없습니다.',
        });
      fields.push('name = ?');
      params.push(v);
    }
    if (req.body.url !== undefined) {
      const v = sanitize(req.body.url, MAX_URL);
      const c = validateUrl(v);
      if (!c.ok)
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: c.error });
      fields.push('url = ?');
      params.push(c.url);
    }
    if (req.body.event_types !== undefined) {
      const c = validateEvents(req.body.event_types);
      if (!c.ok)
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: c.error });
      fields.push('event_types = ?');
      params.push(JSON.stringify(c.events));
    }
    if (req.body.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(req.body.is_active ? 1 : 0);
    }
    if (req.body.secret !== undefined) {
      // 시크릿 변경 — 빈 문자열이면 새로 자동 생성
      const newSecret =
        String(req.body.secret || '').trim() || crypto.randomBytes(32).toString('hex');
      fields.push('secret = ?');
      params.push(newSecret);
    }

    if (!fields.length) return res.json({ success: true, updated: 0 });

    params.push(id);
    const [r] = await pool.query(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`, params);
    if (r.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Webhook 없음' });
    }
    res.json({ success: true, updated: r.affectedRows });
  } catch (err) {
    handleError(res, err);
  }
});

// 삭제
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const [r] = await pool.query(`DELETE FROM webhooks WHERE id = ?`, [id]);
    if (r.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Webhook 없음' });
    }
    // 발송 이력도 정리
    await pool.query(`DELETE FROM webhook_deliveries WHERE webhook_id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// 테스트 발송
router.post('/:id/test', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const result = await dispatcher.testDispatch(id, req.body?.event || 'lead.won');
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'webhook not found') {
      return res.status(404).json({ success: false, error: 'Webhook 없음' });
    }
    handleError(res, err);
  }
});

// 최근 발송 이력
router.get('/:id/deliveries', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const [rows] = await pool.query(
      `SELECT id, event_type, delivery_id, status, http_status,
              response_ms, attempt, error_message, created_at
         FROM webhook_deliveries
        WHERE webhook_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [id, limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
