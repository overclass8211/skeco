'use strict';
// =============================================================
// /api/read-receipts — 통합 읽음 표시 라우터
//
// POST /mark               — 단일 항목 읽음 처리
// POST /mark-many          — 일괄 읽음 처리 (entityIds)
// GET  /unread-counts      — 모듈별 안 읽은 건수 (사이드바 배지)
// =============================================================

const router = require('express').Router();
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const rs = require('../services/readReceipts');

// 서버 부팅 시 1회 자가 마이그레이션
rs.ensureSchema().catch(e => console.warn('[readReceipts:routes] 마이그레이션 실패:', e.message));

// POST /mark — 단일
router.post('/mark', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    const { entity_type, entity_id } = req.body || {};
    if (!entity_type || !entity_id) {
      return res.status(400).json({ success: false, error: 'entity_type, entity_id 필수' });
    }
    if (!rs.ALLOWED_ENTITY_TYPES.includes(entity_type)) {
      return res.status(400).json({ success: false, error: '유효하지 않은 entity_type' });
    }
    await rs.markRead(userId, entity_type, parseInt(entity_id, 10));
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /mark-many — 일괄
router.post('/mark-many', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    const { entity_type, entity_ids } = req.body || {};
    if (!entity_type || !Array.isArray(entity_ids)) {
      return res.status(400).json({ success: false, error: 'entity_type, entity_ids 필수' });
    }
    const result = await rs.markManyRead(userId, entity_type, entity_ids);
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /unread-counts — 모듈별 안 읽은 건수
router.get('/unread-counts', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    const counts = await rs.getUnreadCounts(userId);
    res.json({ success: true, data: counts });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
