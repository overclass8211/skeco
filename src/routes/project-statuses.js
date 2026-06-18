// =============================================================
// /api/projects/statuses — 프로젝트 상태 정의 (관리자 설정)
//
// project-stages.js 패턴 복제 (프로젝트 상태 설정화)
//
// 권한:
//   GET   : 인증된 모든 사용자 (폼/목록 표시용)
//   POST/PUT/DELETE/reorder : admin or superadmin 전용
//
// 설계:
//   - status_key = projects.status 저장값 (기존 한글 값과 일치 → 무손실 호환)
//   - status_key 변경 불가 (projects.status 정합 보호) — 라벨/색/순서/활성/완료여부만 수정
//   - is_final: 마지막 단계 도달 시 자동 동기화 대상 상태 (예: '완료')
//   - color: 배지 색 (blue/green/amber/red/gray 화이트리스트)
//   - 상태 삭제: 사용 중이면 차단 → 비활성화(is_active=0) 안내
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');

const COLORS = ['blue', 'green', 'amber', 'red', 'gray'];
const normColor = c => (COLORS.includes(c) ? c : 'gray');

// ── 권한 가드: admin 또는 superadmin ─────────────────────────
function adminOnly(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      error: '프로젝트 상태 변경은 관리자(admin) 또는 시스템관리자(superadmin)만 가능합니다.',
    });
  }
  next();
}

// ── 캐시 (상태 검증/표시가 매번 조회하지 않도록) ─────────────
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 30_000; // 30초

async function getStatusesCached() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  const [rows] = await pool.query(
    `SELECT id, status_key, label, color, sort_order, is_active, is_final
     FROM project_statuses ORDER BY sort_order ASC, id ASC`
  );
  _cache = rows;
  _cacheAt = Date.now();
  return rows;
}
function invalidate() {
  _cache = null;
  _cacheAt = 0;
}

// 활성 상태 키 유효성 (projects 라우트 INSERT/UPDATE 검증용)
async function isValidStatus(key) {
  if (!key) return false;
  const rows = await getStatusesCached();
  return rows.some(r => r.is_active && r.status_key === key);
}
// 완료류(is_final) 상태 키 — 마지막 단계 도달 시 자동 동기화 (없으면 '완료' 폴백)
async function getFinalStatusKey() {
  const rows = await getStatusesCached();
  const fin = rows.find(r => r.is_active && r.is_final);
  return fin ? fin.status_key : '완료';
}

// ── GET /api/projects/statuses ───────────────────────────────
//   ?include=inactive (기본은 활성만)
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.include === 'inactive' || req.query.include === 'all';
    const rows = await getStatusesCached();
    const data = includeInactive ? rows : rows.filter(r => r.is_active);
    res.json({ success: true, data });
  } catch (e) {
    handleError(res, e);
  }
});

// ── POST /api/projects/statuses ──────────────────────────────
// body: { label, color, sort_order, is_final, status_key? }
//   status_key 미지정 시 label 로 자동 설정(기존 한글 패턴). 생성 후 변경 불가.
router.post('/', adminOnly, async (req, res) => {
  try {
    const { label, color = 'gray', sort_order = 0, is_final = 0, status_key } = req.body || {};
    const lbl = String(label || '').trim();
    if (!lbl) return res.status(400).json({ success: false, error: 'label 필수' });
    const key = String(status_key || lbl)
      .trim()
      .slice(0, 30);
    if (!key) return res.status(400).json({ success: false, error: 'status_key 도출 실패' });

    const [r] = await pool.query(
      `INSERT INTO project_statuses (status_key, label, color, sort_order, is_final)
       VALUES (?,?,?,?,?)`,
      [key, lbl.slice(0, 50), normColor(color), parseInt(sort_order) || 0, is_final ? 1 : 0]
    );
    invalidate();
    res.json({ success: true, id: r.insertId, status_key: key });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, error: '같은 상태가 이미 존재합니다' });
    handleError(res, e);
  }
});

// ── PUT /api/projects/statuses/:id ───────────────────────────
// status_key 변경 불가 (projects.status 정합 보호)
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { label, color, sort_order, is_active, is_final } = req.body || {};
    const updates = [];
    const vals = [];
    if (label !== undefined) {
      updates.push('label=?');
      vals.push(String(label).slice(0, 50));
    }
    if (color !== undefined) {
      updates.push('color=?');
      vals.push(normColor(color));
    }
    if (sort_order !== undefined) {
      updates.push('sort_order=?');
      vals.push(parseInt(sort_order) || 0);
    }
    if (is_active !== undefined) {
      updates.push('is_active=?');
      vals.push(is_active ? 1 : 0);
    }
    if (is_final !== undefined) {
      updates.push('is_final=?');
      vals.push(is_final ? 1 : 0);
    }
    if (!updates.length)
      return res
        .status(400)
        .json({ success: false, error: '수정할 항목 없음 (status_key 는 변경 불가)' });
    vals.push(id);
    await pool.query(`UPDATE project_statuses SET ${updates.join(',')} WHERE id=?`, vals);
    invalidate();
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── POST /api/projects/statuses/reorder ──────────────────────
// body: { order: [{id, sort_order}, ...] }
router.post('/reorder', adminOnly, async (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order) || !order.length)
      return res.status(400).json({ success: false, error: 'order 배열 필요' });
    for (const o of order) {
      if (!Number.isFinite(o.id) || !Number.isFinite(o.sort_order)) continue;
      await pool.query('UPDATE project_statuses SET sort_order=? WHERE id=?', [o.sort_order, o.id]);
    }
    invalidate();
    res.json({ success: true, updated: order.length });
  } catch (e) {
    handleError(res, e);
  }
});

// ── DELETE /api/projects/statuses/:id ────────────────────────
// 사용 중인 상태는 삭제 거부 → is_active=0 로 비활성화 안내
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [[st]] = await pool.query('SELECT status_key FROM project_statuses WHERE id=?', [id]);
    if (!st) return res.status(404).json({ success: false, error: '상태 없음' });

    const [[usage]] = await pool.query('SELECT COUNT(*) AS cnt FROM projects WHERE status=?', [
      st.status_key,
    ]);
    if (usage.cnt > 0) {
      return res.status(409).json({
        success: false,
        error: `이 상태에 ${usage.cnt}건의 프로젝트가 있어 삭제할 수 없습니다. "비활성화"를 사용하세요.`,
        used_count: usage.cnt,
      });
    }
    await pool.query('DELETE FROM project_statuses WHERE id=?', [id]);
    invalidate();
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── 외부 노출 (projects 라우트에서 검증/동기화에 사용) ────────
module.exports = router;
module.exports.getStatusesCached = getStatusesCached;
module.exports.invalidate = invalidate;
module.exports.isValidStatus = isValidStatus;
module.exports.getFinalStatusKey = getFinalStatusKey;
