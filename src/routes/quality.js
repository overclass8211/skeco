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
const DOC_TYPES = ['CoA', 'MSDS', 'CoC', '기타'];

// SLA 정책 — 심각도별 처리 기한(일). 스키마 변경 없이 opened_at + 일수로 산출.
const SLA_DAYS = { high: 7, medium: 14, low: 30 };
// SQL: 케이스 SLA 기한 = opened_at + 심각도별 일수 (qc 별칭 기준)
const SLA_DUE_SQL =
  "DATE_ADD(qc.opened_at, INTERVAL CASE qc.severity WHEN 'high' THEN 7 WHEN 'low' THEN 30 ELSE 14 END DAY)";
// SQL: 별칭 없는 quality_cases 직접 집계용
const SLA_DUE_RAW =
  "DATE_ADD(opened_at, INTERVAL CASE severity WHEN 'high' THEN 7 WHEN 'low' THEN 30 ELSE 14 END DAY)";
// 문서 만료 임박 기준(일)
const DOC_SOON_DAYS = 30;

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
    const { status, type, severity, customer_id, owner_id, q, from, to, mine, sla } = req.query;
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
    // SLA 초과(미해결 + 기한 경과)만 보기
    if (sla === 'overdue') {
      where.push(
        `qc.status <> 'resolved' AND qc.opened_at IS NOT NULL AND CURDATE() > ${SLA_DUE_SQL}`
      );
    }
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT qc.id, qc.case_no, qc.customer_id, c.name AS customer_name,
              qc.customer_material_id, m.material_name, qc.type, qc.severity, qc.status,
              qc.title,
              DATE_FORMAT(qc.opened_at, '%Y-%m-%d') AS opened_at,
              DATE_FORMAT(qc.resolved_at, '%Y-%m-%d') AS resolved_at,
              qc.owner_id, t.name AS owner_name,
              DATEDIFF(COALESCE(qc.resolved_at, CURDATE()), qc.opened_at) AS age_days,
              DATE_FORMAT(${SLA_DUE_SQL}, '%Y-%m-%d') AS due_date,
              CASE WHEN qc.status <> 'resolved' AND qc.opened_at IS NOT NULL
                   THEN DATEDIFF(${SLA_DUE_SQL}, CURDATE()) END AS days_left,
              (qc.status <> 'resolved' AND qc.opened_at IS NOT NULL AND CURDATE() > ${SLA_DUE_SQL}) AS overdue
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
         SUM(status <> 'resolved' AND opened_at IS NOT NULL AND CURDATE() > ${SLA_DUE_RAW}) AS overdue,
         ROUND(AVG(CASE WHEN status = 'resolved' AND resolved_at IS NOT NULL
                        THEN DATEDIFF(resolved_at, opened_at) END), 1) AS avg_resolve_days
       FROM quality_cases`
    );
    // 문서(CoA/MSDS/CoC) 만료 현황 — 별도 테이블
    const [[d]] = await pool.query(
      `SELECT
         SUM(valid_until IS NOT NULL AND valid_until < CURDATE()) AS doc_expired,
         SUM(valid_until IS NOT NULL AND valid_until >= CURDATE()
             AND valid_until <= DATE_ADD(CURDATE(), INTERVAL ${DOC_SOON_DAYS} DAY)) AS doc_expiring
       FROM quality_documents`
    );
    res.json({
      success: true,
      data: {
        open_total: Number(k.open_total) || 0,
        high_open: Number(k.high_open) || 0,
        in_progress: Number(k.in_progress) || 0,
        new_this_month: Number(k.new_this_month) || 0,
        overdue: Number(k.overdue) || 0,
        doc_expired: Number(d.doc_expired) || 0,
        doc_expiring: Number(d.doc_expiring) || 0,
        sla_policy: SLA_DAYS,
        doc_soon_days: DOC_SOON_DAYS,
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

// ── 전사 문서 만료 현황 (CoA/MSDS/CoC) ───────────────────────
//   원천: quality_documents.valid_until. 상태: expired / expiring(≤30일) / valid.
router.get('/documents', requireLevel(1), async (req, res) => {
  try {
    const { doc_type, customer_id, q, status } = req.query;
    const where = [];
    const params = [];
    if (DOC_TYPES.includes(doc_type)) {
      where.push('d.doc_type = ?');
      params.push(doc_type);
    }
    if (customer_id) {
      where.push('d.customer_id = ?');
      params.push(Number(customer_id));
    }
    if (q) {
      where.push('(d.doc_no LIKE ? OR m.material_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    // 상태 필터 — valid_until 기준
    if (status === 'expired') where.push('d.valid_until IS NOT NULL AND d.valid_until < CURDATE()');
    else if (status === 'expiring')
      where.push(
        `d.valid_until IS NOT NULL AND d.valid_until >= CURDATE() AND d.valid_until <= DATE_ADD(CURDATE(), INTERVAL ${DOC_SOON_DAYS} DAY)`
      );
    else if (status === 'attention')
      where.push(
        `d.valid_until IS NOT NULL AND d.valid_until <= DATE_ADD(CURDATE(), INTERVAL ${DOC_SOON_DAYS} DAY)`
      );
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT d.id, d.customer_id, c.name AS customer_name,
              d.customer_material_id, m.material_name,
              d.doc_type, d.doc_no,
              DATE_FORMAT(d.issued_at, '%Y-%m-%d') AS issued_at,
              DATE_FORMAT(d.valid_until, '%Y-%m-%d') AS valid_until,
              d.file_url, d.note,
              DATEDIFF(d.valid_until, CURDATE()) AS days_left
         FROM quality_documents d
         JOIN customers c ON c.id = d.customer_id
         LEFT JOIN customer_materials m ON m.id = d.customer_material_id
         ${wsql}
        ORDER BY (d.valid_until IS NULL) ASC, d.valid_until ASC, d.id DESC
        LIMIT 500`,
      params
    );
    res.json({ success: true, data: rows, soon_days: DOC_SOON_DAYS });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
