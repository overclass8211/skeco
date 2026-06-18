// =============================================================
// /api/projects/stages — 프로젝트 단계 정의 (관리자 설정)
//
// pipeline-stages.js 패턴 복제 (Phase 1 — 프로젝트 모듈 개선)
//
// 권한:
//   GET   : 인증된 모든 사용자
//   POST/PUT/DELETE/reorder : admin or superadmin 전용
//
// 보안 제약:
//   - stage_key 변경 불가 (projects.stage 와 정합)
//   - 단계 삭제: 사용 중이면 차단 + soft delete(is_active=0) 권장
//   - requires_file: 해당 단계 도달 시 증빙 파일(검수확인서 등) 필수 여부
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
      error: '프로젝트 단계 변경은 관리자(admin) 또는 시스템관리자(superadmin)만 가능합니다.',
    });
  }
  next();
}

// ── 캐시 (단계 검증/표시가 매번 조회하지 않도록) ─────────────
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 30_000; // 30초

async function getStagesCached() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  const [rows] = await pool.query(
    `SELECT id, stage_key, label, sort_order, color, requires_file, deliverable_guide, is_active
     FROM project_stages ORDER BY sort_order ASC, id ASC`
  );
  _cache = rows;
  _cacheAt = Date.now();
  return rows;
}
function invalidate() {
  _cache = null;
  _cacheAt = 0;
}

// ── GET /api/projects/stages ─────────────────────────────────
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

// ── POST /api/projects/stages ────────────────────────────────
// body: { stage_key, label, sort_order, color, requires_file }
router.post('/', adminOnly, async (req, res) => {
  try {
    const {
      stage_key,
      label,
      sort_order = 0,
      color = '#93B4F9',
      requires_file = 0,
      deliverable_guide,
    } = req.body || {};
    if (!stage_key || !label)
      return res.status(400).json({ success: false, error: 'stage_key, label 필수' });
    if (!/^[a-z0-9_]{1,30}$/.test(stage_key))
      return res
        .status(400)
        .json({ success: false, error: 'stage_key는 소문자/숫자/_만 허용 (30자)' });

    const guide =
      String(deliverable_guide || '')
        .trim()
        .slice(0, 2000) || null;
    const [r] = await pool.query(
      `INSERT INTO project_stages (stage_key, label, sort_order, color, requires_file, deliverable_guide)
       VALUES (?,?,?,?,?,?)`,
      [
        stage_key,
        String(label).slice(0, 100),
        parseInt(sort_order) || 0,
        color,
        requires_file ? 1 : 0,
        guide,
      ]
    );
    invalidate();
    res.json({ success: true, id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, error: '같은 stage_key가 이미 존재합니다' });
    handleError(res, e);
  }
});

// ── PUT /api/projects/stages/:id ─────────────────────────────
// stage_key 변경 불가 (projects.stage 정합 보호)
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { label, sort_order, color, is_active, requires_file, deliverable_guide } =
      req.body || {};
    const updates = [];
    const vals = [];
    if (label !== undefined) {
      updates.push('label=?');
      vals.push(String(label).slice(0, 100));
    }
    if (deliverable_guide !== undefined) {
      updates.push('deliverable_guide=?');
      vals.push(
        String(deliverable_guide || '')
          .trim()
          .slice(0, 2000) || null
      );
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
    if (requires_file !== undefined) {
      updates.push('requires_file=?');
      vals.push(requires_file ? 1 : 0);
    }
    if (!updates.length)
      return res
        .status(400)
        .json({ success: false, error: '수정할 항목 없음 (stage_key 는 변경 불가)' });
    vals.push(id);
    await pool.query(`UPDATE project_stages SET ${updates.join(',')} WHERE id=?`, vals);
    invalidate();
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── POST /api/projects/stages/reorder ────────────────────────
// body: { order: [{id, sort_order}, ...] }
router.post('/reorder', adminOnly, async (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order) || !order.length)
      return res.status(400).json({ success: false, error: 'order 배열 필요' });
    for (const o of order) {
      if (!Number.isFinite(o.id) || !Number.isFinite(o.sort_order)) continue;
      await pool.query('UPDATE project_stages SET sort_order=? WHERE id=?', [o.sort_order, o.id]);
    }
    invalidate();
    res.json({ success: true, updated: order.length });
  } catch (e) {
    handleError(res, e);
  }
});

// ── DELETE /api/projects/stages/:id ──────────────────────────
// 사용 중인 단계는 삭제 거부 → is_active=0 로 비활성화하도록 안내
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [[stage]] = await pool.query('SELECT stage_key FROM project_stages WHERE id=?', [id]);
    if (!stage) return res.status(404).json({ success: false, error: '단계 없음' });

    const [[usage]] = await pool.query('SELECT COUNT(*) AS cnt FROM projects WHERE stage=?', [
      stage.stage_key,
    ]);
    if (usage.cnt > 0) {
      return res.status(409).json({
        success: false,
        error: `이 단계에 ${usage.cnt}건의 프로젝트가 있어 삭제할 수 없습니다. "비활성화"를 사용하세요.`,
        used_count: usage.cnt,
      });
    }
    await pool.query('DELETE FROM project_stages WHERE id=?', [id]);
    invalidate();
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── 외부 노출 (projects 라우트/단계 전환에서 사용) ───────────
module.exports = router;
module.exports.getStagesCached = getStagesCached;
module.exports.invalidate = invalidate;
