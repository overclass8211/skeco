// =============================================================
// /api/pipeline/stages — 파이프라인 단계 정의 (사용자 정의)
//
// 권한:
//   GET   : 인증된 모든 사용자
//   POST/PUT/DELETE : admin or superadmin 전용
//
// 보안 제약:
//   - role 변경은 모든 사용자에게 차단 (시스템 통계 무결성 보호)
//   - stage_key 변경 불가 (기존 leads.stage 와 정합)
//   - 단계 삭제: 사용 중이면 차단 + soft delete(is_active=0) 권장
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');

// ── 권한 가드: admin 또는 superadmin ─────────────────────────
function adminOnly(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      error: '파이프라인 단계 변경은 관리자(admin) 또는 시스템관리자(superadmin)만 가능합니다.',
    });
  }
  next();
}

// ── 캐시 (성능 — validate 미들웨어가 매번 조회하지 않도록) ──
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 30_000; // 30초

async function getStagesCached() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  const [rows] = await pool.query(
    `SELECT id, stage_key, label, role, sort_order, color, is_active
     FROM pipeline_stages ORDER BY sort_order ASC, id ASC`
  );
  _cache = rows;
  _cacheAt = Date.now();
  return rows;
}
function invalidate() {
  _cache = null;
  _cacheAt = 0;
}

// 외부에서 stage 유효성 검사용 (활성 단계 + 비활성도 포함 — 기존 데이터 호환)
async function getValidKeys(opts = {}) {
  const rows = await getStagesCached();
  return opts.activeOnly
    ? rows.filter(r => r.is_active).map(r => r.stage_key)
    : rows.map(r => r.stage_key);
}

// ── GET /api/pipeline/stages ─────────────────────────────────
//   ?include=inactive (기본은 활성만)
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.include === 'inactive' || req.query.include === 'all';
    const rows = await getStagesCached();
    const data = includeInactive ? rows : rows.filter(r => r.is_active);
    res.json({ success: true, data });
  } catch (e) {
    handleError(res, e);
  }
});

// ── POST /api/pipeline/stages ────────────────────────────────
// body: { stage_key, label, role, sort_order, color }
router.post('/', adminOnly, async (req, res) => {
  try {
    const { stage_key, label, role = 'active', sort_order = 0, color = '#93B4F9' } = req.body || {};
    if (!stage_key || !label)
      return res.status(400).json({ success: false, error: 'stage_key, label 필수' });
    if (!/^[a-z0-9_]{1,30}$/.test(stage_key))
      return res
        .status(400)
        .json({ success: false, error: 'stage_key는 소문자/숫자/_만 허용 (30자)' });
    if (!['active', 'won', 'lost', 'dropped'].includes(role))
      return res
        .status(400)
        .json({ success: false, error: 'role은 active/won/lost/dropped 중 하나' });

    const [r] = await pool.query(
      `INSERT INTO pipeline_stages (stage_key, label, role, sort_order, color)
       VALUES (?,?,?,?,?)`,
      [stage_key, String(label).slice(0, 100), role, parseInt(sort_order) || 0, color]
    );
    invalidate();
    res.json({ success: true, id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, error: '같은 stage_key가 이미 존재합니다' });
    handleError(res, e);
  }
});

// ── PUT /api/pipeline/stages/:id ─────────────────────────────
// stage_key/role 변경 불가 (시스템 안전)
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { label, sort_order, color, is_active } = req.body || {};
    const updates = [];
    const vals = [];
    if (label !== undefined) {
      updates.push('label=?');
      vals.push(String(label).slice(0, 100));
    }
    if (sort_order !== undefined) {
      updates.push('sort_order=?');
      vals.push(parseInt(sort_order) || 0);
    }
    if (color !== undefined) {
      updates.push('color=?');
      vals.push(color);
    }
    if (is_active !== undefined) {
      updates.push('is_active=?');
      vals.push(is_active ? 1 : 0);
    }
    if (!updates.length)
      return res
        .status(400)
        .json({ success: false, error: '수정할 항목 없음 (stage_key/role 은 변경 불가)' });
    vals.push(id);
    await pool.query(`UPDATE pipeline_stages SET ${updates.join(',')} WHERE id=?`, vals);
    invalidate();
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── POST /api/pipeline/stages/reorder ────────────────────────
// body: { order: [{id, sort_order}, ...] }
router.post('/reorder', adminOnly, async (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order) || !order.length)
      return res.status(400).json({ success: false, error: 'order 배열 필요' });
    for (const o of order) {
      if (!Number.isFinite(o.id) || !Number.isFinite(o.sort_order)) continue;
      await pool.query('UPDATE pipeline_stages SET sort_order=? WHERE id=?', [o.sort_order, o.id]);
    }
    invalidate();
    res.json({ success: true, updated: order.length });
  } catch (e) {
    handleError(res, e);
  }
});

// ── DELETE /api/pipeline/stages/:id ──────────────────────────
// 사용 중인 단계는 삭제 거부 → is_active=0 로 비활성화하도록 안내
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [[stage]] = await pool.query('SELECT stage_key FROM pipeline_stages WHERE id=?', [id]);
    if (!stage) return res.status(404).json({ success: false, error: '단계 없음' });

    const [[usage]] = await pool.query('SELECT COUNT(*) AS cnt FROM leads WHERE stage=?', [
      stage.stage_key,
    ]);
    if (usage.cnt > 0) {
      return res.status(409).json({
        success: false,
        error: `이 단계에 ${usage.cnt}건의 딜이 있어 삭제할 수 없습니다. "비활성화"를 사용하세요.`,
        used_count: usage.cnt,
      });
    }
    await pool.query('DELETE FROM pipeline_stages WHERE id=?', [id]);
    invalidate();
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── 외부 노출 (다른 모듈에서 사용) ──────────────────────────
module.exports = router;
module.exports.getStagesCached = getStagesCached;
module.exports.getValidKeys = getValidKeys;
module.exports.invalidate = invalidate;
