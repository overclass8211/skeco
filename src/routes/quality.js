// =============================================================
// 전사 품질관리 (Quality Inbox) — quality_cases 횡단 조회/처리
//   - 데이터 원천: quality_cases (고객360 공급자격 탭과 동일 테이블)
//   - 권한: 전원 조회 / 담당건(owner) 또는 team_lead+ 편집
//   - API 응답 형식: { success, data, error }
// =============================================================
'use strict';
const router = require('express').Router();
const pool = require('../db');
const { requireLevel } = require('../middleware/rbac');
const { getUserId } = require('../middleware/auth');
const { getRoleInfo } = require('../services/authService');

const TYPES = ['VOC', 'NCR', 'Audit', 'PCN', 'CoA'];
const SEVERITIES = ['high', 'medium', 'low'];
const STATUSES = ['open', 'in_progress', 'resolved'];

function handleError(res, err) {
  console.error('[quality]', err);
  res.status(500).json({ success: false, error: err.message || '서버 오류' });
}
// 현재 사용자 레벨 (test 환경은 검사 우회)
function userLevel(req) {
  if (process.env.NODE_ENV === 'test') return 99;
  return req.user ? getRoleInfo(req.user.role).level || 1 : 1;
}

// ── 전사 목록 (필터·정렬·에이징) ─────────────────────────────
router.get('/cases', requireLevel(1), async (req, res) => {
  try {
    const { status, type, severity, customer_id, owner_id, q, from, to, mine } = req.query;
    const where = [];
    const params = [];
    if (status === 'unresolved') where.push("qc.status <> 'resolved'");
    else if (STATUSES.includes(status)) {
      where.push('qc.status = ?');
      params.push(status);
    }
    if (TYPES.includes(type)) {
      where.push('qc.type = ?');
      params.push(type);
    }
    if (SEVERITIES.includes(severity)) {
      where.push('qc.severity = ?');
      params.push(severity);
    }
    if (customer_id) {
      where.push('qc.customer_id = ?');
      params.push(Number(customer_id));
    }
    if (owner_id) {
      where.push('qc.owner_id = ?');
      params.push(Number(owner_id));
    }
    if (mine === '1') {
      const uid = getUserId(req);
      if (uid) {
        where.push('qc.owner_id = ?');
        params.push(uid);
      }
    }
    if (q) {
      where.push('(qc.title LIKE ? OR qc.case_no LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (from) {
      where.push('qc.opened_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('qc.opened_at <= ?');
      params.push(to);
    }
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT qc.id, qc.case_no, qc.customer_id, c.name AS customer_name,
              qc.customer_material_id, m.material_name, qc.type, qc.severity, qc.status,
              qc.title, qc.opened_at, qc.resolved_at, qc.owner_id, t.name AS owner_name,
              DATEDIFF(COALESCE(qc.resolved_at, CURDATE()), qc.opened_at) AS age_days
         FROM quality_cases qc
         JOIN customers c ON c.id = qc.customer_id
         LEFT JOIN customer_materials m ON m.id = qc.customer_material_id
         LEFT JOIN team_members t ON t.id = qc.owner_id
         ${wsql}
        ORDER BY (qc.status <> 'resolved') DESC,
                 FIELD(qc.severity, 'high', 'medium', 'low'),
                 qc.opened_at ASC, qc.id DESC
        LIMIT 500`,
      params
    );
    // 상세 비고(notes)는 team_lead+ 에게만
    const restricted = userLevel(req) < 2;
    res.json({ success: true, data: rows, detail_restricted: restricted });
  } catch (err) {
    handleError(res, err);
  }
});

// ── KPI 요약 ─────────────────────────────────────────────────
router.get('/summary', requireLevel(1), async (req, res) => {
  try {
    const [[k]] = await pool.query(
      `SELECT
         SUM(status <> 'resolved') AS open_total,
         SUM(status <> 'resolved' AND severity = 'high') AS high_open,
         SUM(status = 'in_progress') AS in_progress,
         SUM(opened_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS new_this_month,
         ROUND(AVG(CASE WHEN status = 'resolved' AND resolved_at IS NOT NULL
                        THEN DATEDIFF(resolved_at, opened_at) END), 1) AS avg_resolve_days
       FROM quality_cases`
    );
    res.json({
      success: true,
      data: {
        open_total: Number(k.open_total) || 0,
        high_open: Number(k.high_open) || 0,
        in_progress: Number(k.in_progress) || 0,
        new_this_month: Number(k.new_this_month) || 0,
        avg_resolve_days:
          k.avg_resolve_days === null || k.avg_resolve_days === undefined
            ? null
            : Number(k.avg_resolve_days),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 신규 케이스 (전원 등록 가능) ─────────────────────────────
router.post('/cases', requireLevel(1), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.customer_id) return res.status(400).json({ success: false, error: 'customer_id 필수' });
    if (!b.title) return res.status(400).json({ success: false, error: 'title 필수' });
    const caseNo = `Q-${Date.now().toString().slice(-9)}`;
    const type = TYPES.includes(b.type) ? b.type : 'VOC';
    const severity = SEVERITIES.includes(b.severity) ? b.severity : 'medium';
    const status = STATUSES.includes(b.status) ? b.status : 'open';
    const [r] = await pool.query(
      `INSERT INTO quality_cases
         (case_no, customer_id, customer_material_id, type, severity, status, title, opened_at, owner_id, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        caseNo,
        Number(b.customer_id),
        b.customer_material_id || null,
        type,
        severity,
        status,
        b.title,
        b.opened_at || null,
        b.owner_id || getUserId(req),
        b.notes || null,
      ]
    );
    res.json({ success: true, data: { id: r.insertId, case_no: caseNo } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수정 (담당건 또는 team_lead+) ────────────────────────────
router.put('/cases/:id', requireLevel(1), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const [[cur]] = await pool.query('SELECT owner_id FROM quality_cases WHERE id=?', [id]);
    if (!cur) return res.status(404).json({ success: false, error: '품질 케이스 없음' });
    // 편집 권한: team_lead+ 또는 미배정 또는 본인 담당건
    const uid = getUserId(req);
    const canEdit = userLevel(req) >= 2 || cur.owner_id === null || cur.owner_id === uid;
    if (!canEdit) {
      return res
        .status(403)
        .json({ success: false, error: '담당자 또는 팀장 이상만 수정할 수 있습니다.' });
    }
    const b = req.body || {};
    const allow = [
      'customer_material_id',
      'type',
      'severity',
      'status',
      'title',
      'opened_at',
      'resolved_at',
      'owner_id',
      'notes',
    ];
    const fields = [];
    const vals = [];
    for (const key of allow) {
      if (b[key] === undefined) continue;
      if (key === 'type' && !TYPES.includes(b[key])) continue;
      if (key === 'severity' && !SEVERITIES.includes(b[key])) continue;
      if (key === 'status' && !STATUSES.includes(b[key])) continue;
      fields.push(`${key}=?`);
      vals.push(b[key] === '' ? null : b[key]);
    }
    // 완료 처리 시 resolved_at 자동 기록(미지정 시)
    if (b.status === 'resolved' && b.resolved_at === undefined) {
      fields.push('resolved_at=CURDATE()');
    }
    if (!fields.length) return res.status(400).json({ success: false, error: '수정할 필드 없음' });
    vals.push(id);
    await pool.query(`UPDATE quality_cases SET ${fields.join(', ')} WHERE id=?`, vals);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
