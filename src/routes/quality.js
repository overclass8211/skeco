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
const upload = require('../middleware/upload');

const TYPES = ['VOC', 'NCR', 'Audit', 'PCN', 'CoA'];
const SEVERITIES = ['high', 'medium', 'low'];
// 워크플로우 — 고객지원(A/S) 동일: 접수→등록→할당→처리중→보류→조치완료/드롭
const STATUSES = [
  'received',
  'registered',
  'assigned',
  'in_progress',
  'on_hold',
  'resolved',
  'dropped',
];
// 종결(미해결 집계에서 제외) 상태
const CLOSED_STATUSES = ['resolved', 'dropped'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const CHANNELS = ['audit', 'email', 'visit', 'phone', 'portal', 'etc']; // 접수경로
const DOC_TYPES = ['CoA', 'MSDS', 'CoC', '기타'];

// SLA 정책 — 심각도별 처리 기한(일). 명시적 due_date 가 있으면 우선.
const SLA_DAYS = { high: 7, medium: 14, low: 30 };
// SQL: 심각도 기반 SLA 기한 (qc 별칭 기준)
const SLA_BY_SEV_SQL =
  "DATE_ADD(qc.opened_at, INTERVAL CASE qc.severity WHEN 'high' THEN 7 WHEN 'low' THEN 30 ELSE 14 END DAY)";
// SQL: 유효 처리기한 = 명시적 due_date 우선, 없으면 심각도 SLA (qc 별칭 기준)
const SLA_DUE_SQL = `COALESCE(qc.due_date, ${SLA_BY_SEV_SQL})`;
// SQL: 별칭 없는 quality_cases 직접 집계용 (유효 기한)
const SLA_DUE_RAW =
  "COALESCE(due_date, DATE_ADD(opened_at, INTERVAL CASE severity WHEN 'high' THEN 7 WHEN 'low' THEN 30 ELSE 14 END DAY))";
// 문서 만료 임박 기준(일)
const DOC_SOON_DAYS = 30;

// 미해결 조건 SQL (qc 별칭) — resolved/dropped 제외
const UNRESOLVED_SQL = `qc.status NOT IN ('resolved','dropped')`;

function handleError(res, err) {
  console.error('[quality]', err);
  res.status(500).json({ success: false, error: err.message || '서버 오류' });
}
// 현재 사용자 레벨 (test 환경은 검사 우회)
function userLevel(req) {
  if (process.env.NODE_ENV === 'test') return 99;
  return req.user ? getRoleInfo(req.user.role).level || 1 : 1;
}

// 변경 이력 기록 (상태·이관 감사추적) — 실패해도 본 작업에 영향 없음
async function addQHistory(caseId, field, from, to, userId, note) {
  try {
    await pool.query(
      `INSERT INTO quality_history (case_id, field, from_value, to_value, changed_by, note)
       VALUES (?,?,?,?,?,?)`,
      [
        caseId,
        field,
        from === null || from === undefined ? null : String(from).slice(0, 100),
        to === null || to === undefined ? null : String(to).slice(0, 100),
        userId || null,
        note ? String(note).slice(0, 300) : null,
      ]
    );
  } catch (_) {
    /* 이력 실패 무시 */
  }
}

// 인앱 알림 생성 — 수신자 없음/본인이면 skip, 실패해도 본 작업 무영향
async function addQNotification(userId, caseId, eventType, message) {
  const uid = Number(userId);
  if (!uid) return;
  try {
    await pool.query(
      'INSERT INTO quality_notifications (user_id, case_id, event_type, message) VALUES (?,?,?,?)',
      [uid, caseId, eventType, String(message || '').slice(0, 300)]
    );
  } catch (_) {
    /* 알림 실패 무시 */
  }
}

// ── 전사 목록 (필터·정렬·에이징) ─────────────────────────────
router.get('/cases', requireLevel(1), async (req, res) => {
  try {
    const { status, type, severity, customer_id, owner_id, q, from, to, mine, sla, priority } =
      req.query;
    const where = [];
    const params = [];
    if (status === 'unresolved') where.push(UNRESOLVED_SQL);
    else if (STATUSES.includes(status)) {
      where.push('qc.status = ?');
      params.push(status);
    }
    if (PRIORITIES.includes(priority)) {
      where.push('qc.priority = ?');
      params.push(priority);
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
      where.push(`${UNRESOLVED_SQL} AND qc.opened_at IS NOT NULL AND CURDATE() > ${SLA_DUE_SQL}`);
    }
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT qc.id, qc.case_no, qc.customer_id, c.name AS customer_name,
              qc.customer_material_id, m.material_name, qc.type, qc.severity, qc.status,
              qc.priority, qc.channel, qc.title, qc.description,
              DATE_FORMAT(qc.opened_at, '%Y-%m-%d') AS opened_at,
              DATE_FORMAT(qc.resolved_at, '%Y-%m-%d') AS resolved_at,
              qc.owner_id, t.name AS owner_name,
              qc.created_by, cb.name AS created_by_name,
              qc.resolution, qc.notes,
              qc.root_cause, qc.correction, qc.preventive_action, qc.verification,
              DATE_FORMAT(qc.verified_at, '%Y-%m-%d') AS verified_at,
              qc.defect_code, qc.lot_no, qc.defect_qty, qc.defect_unit,
              qc.customer_ref_no, qc.is_recurring,
              DATE_FORMAT(qc.due_date, '%Y-%m-%d') AS due_date_set,
              DATEDIFF(COALESCE(qc.resolved_at, CURDATE()), qc.opened_at) AS age_days,
              DATE_FORMAT(${SLA_DUE_SQL}, '%Y-%m-%d') AS due_date,
              CASE WHEN ${UNRESOLVED_SQL} AND qc.opened_at IS NOT NULL
                   THEN DATEDIFF(${SLA_DUE_SQL}, CURDATE()) END AS days_left,
              (${UNRESOLVED_SQL} AND qc.opened_at IS NOT NULL AND CURDATE() > ${SLA_DUE_SQL}) AS overdue
         FROM quality_cases qc
         JOIN customers c ON c.id = qc.customer_id
         LEFT JOIN customer_materials m ON m.id = qc.customer_material_id
         LEFT JOIN team_members t ON t.id = qc.owner_id
         LEFT JOIN team_members cb ON cb.id = qc.created_by
         ${wsql}
        ORDER BY (${UNRESOLVED_SQL}) DESC,
                 FIELD(qc.severity, 'high', 'medium', 'low'),
                 qc.opened_at ASC, qc.id DESC
        LIMIT 500`,
      params
    );
    // 상세 비고(notes)는 team_lead+ 에게만 (처리내용 resolution 은 전원 공개)
    const restricted = userLevel(req) < 2;
    if (restricted) rows.forEach(r => (r.notes = null));
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
         SUM(status NOT IN ('resolved','dropped')) AS open_total,
         SUM(status NOT IN ('resolved','dropped') AND severity = 'high') AS high_open,
         SUM(status = 'in_progress') AS in_progress,
         SUM(opened_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS new_this_month,
         SUM(status NOT IN ('resolved','dropped') AND opened_at IS NOT NULL AND CURDATE() > ${SLA_DUE_RAW}) AS overdue,
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
    const status = STATUSES.includes(b.status) ? b.status : 'received';
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
    const channel = CHANNELS.includes(b.channel) ? b.channel : null;
    const uid = getUserId(req);
    const createdBy = b.created_by || uid; // 접수자(기본=현재 사용자)
    const [r] = await pool.query(
      `INSERT INTO quality_cases
         (case_no, customer_id, customer_material_id, type, severity, status, priority, channel,
          title, description, opened_at, due_date, owner_id, created_by, notes, resolution)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        caseNo,
        Number(b.customer_id),
        b.customer_material_id || null,
        type,
        severity,
        status,
        priority,
        channel,
        b.title,
        b.description || null,
        b.opened_at || null,
        b.due_date || null,
        b.owner_id || null,
        createdBy,
        b.notes || null,
        b.resolution || null,
      ]
    );
    await addQHistory(r.insertId, 'created', null, caseNo, uid, '접수');
    if (b.owner_id) await addQHistory(r.insertId, 'owner_id', null, b.owner_id, uid, '담당 지정');
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
    const [[cur]] = await pool.query('SELECT * FROM quality_cases WHERE id=?', [id]);
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
      'priority',
      'channel',
      'title',
      'description',
      'opened_at',
      'due_date',
      'resolved_at',
      'owner_id',
      'created_by',
      'notes',
      'resolution',
      // 8D/CAPA 도메인
      'root_cause',
      'correction',
      'preventive_action',
      'verification',
      'verified_at',
      'defect_code',
      'lot_no',
      'defect_qty',
      'defect_unit',
      'customer_ref_no',
      'is_recurring',
    ];
    const fields = [];
    const vals = [];
    for (const key of allow) {
      if (b[key] === undefined) continue;
      if (key === 'type' && !TYPES.includes(b[key])) continue;
      if (key === 'severity' && !SEVERITIES.includes(b[key])) continue;
      if (key === 'status' && !STATUSES.includes(b[key])) continue;
      if (key === 'priority' && !PRIORITIES.includes(b[key])) continue;
      if (key === 'channel' && b[key] && !CHANNELS.includes(b[key])) continue;
      if (key === 'is_recurring') {
        fields.push('is_recurring=?');
        vals.push(b[key] ? 1 : 0);
        continue;
      }
      fields.push(`${key}=?`);
      vals.push(b[key] === '' ? null : b[key]);
    }
    const statusChanged = b.status !== undefined && b.status !== cur.status;
    const ownerChanged =
      b.owner_id !== undefined && Number(b.owner_id || 0) !== (cur.owner_id || 0);
    // 완료 처리 시 resolved_at 자동 기록(미지정 시)
    if (b.status === 'resolved' && b.resolved_at === undefined) {
      fields.push('resolved_at=CURDATE()');
    }
    // 종결(resolved/dropped) 진입 시 closed_at 기록
    if (statusChanged && CLOSED_STATUSES.includes(b.status)) {
      fields.push('closed_at=COALESCE(closed_at, NOW())');
    }
    // 최초 응답: received → 그 외 첫 전환 시 first_response_at 기록
    if (
      statusChanged &&
      cur.status === 'received' &&
      b.status !== 'received' &&
      !cur.first_response_at
    ) {
      fields.push('first_response_at=NOW()');
    }
    if (!fields.length) return res.status(400).json({ success: false, error: '수정할 필드 없음' });
    vals.push(id);
    await pool.query(`UPDATE quality_cases SET ${fields.join(', ')} WHERE id=?`, vals);
    // 감사추적 이력
    if (statusChanged) await addQHistory(id, 'status', cur.status, b.status, uid);
    if (ownerChanged) {
      const to = Number(b.owner_id) || null;
      await addQHistory(id, 'owner_id', cur.owner_id, to, uid, b.transfer_note);
      // 인앱 알림 — 새 담당자에게(본인/셀프할당 제외)
      if (to && to !== uid) {
        await addQNotification(
          to,
          id,
          cur.owner_id ? 'reassigned' : 'assigned',
          `${cur.case_no || '품질 케이스'}가 회원님께 ${cur.owner_id ? '재' : ''}할당되었습니다`
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 이관 (담당 변경 + 사유 + 이력) — 고객지원 assign 패턴 ──────
router.patch('/cases/:id/transfer', requireLevel(1), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const [[cur]] = await pool.query('SELECT owner_id, case_no FROM quality_cases WHERE id=?', [
      id,
    ]);
    if (!cur) return res.status(404).json({ success: false, error: '품질 케이스 없음' });
    const uid = getUserId(req);
    const canEdit = userLevel(req) >= 2 || cur.owner_id === null || cur.owner_id === uid;
    if (!canEdit)
      return res
        .status(403)
        .json({ success: false, error: '담당자 또는 팀장 이상만 이관할 수 있습니다.' });
    const to = req.body && req.body.owner_id ? Number(req.body.owner_id) : null;
    const note = req.body && req.body.note ? String(req.body.note).slice(0, 300) : null;
    await pool.query('UPDATE quality_cases SET owner_id=? WHERE id=?', [to, id]);
    await addQHistory(id, 'owner_id', cur.owner_id, to, uid, note || '이관');
    // 인앱 알림 — 새 담당자에게(본인 제외)
    if (to && to !== uid) {
      await addQNotification(
        to,
        id,
        cur.owner_id ? 'reassigned' : 'transferred',
        `${cur.case_no || '품질 케이스'}가 회원님께 이관되었습니다${note ? ' — ' + note : ''}`
      );
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 변경 이력 (상태·이관 감사추적 타임라인) ──────────────────
router.get('/cases/:id/history', requireLevel(1), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT h.id, h.field, h.from_value, h.to_value, h.note,
              h.changed_by, COALESCE(u.full_name, t.name) AS changed_by_name,
              DATE_FORMAT(h.changed_at, '%Y-%m-%d %H:%i') AS changed_at
         FROM quality_history h
         LEFT JOIN users u ON u.id = h.changed_by
         LEFT JOIN team_members t ON t.id = h.changed_by
        WHERE h.case_id=? ORDER BY h.id ASC`,
      [id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 첨부 (불량사진/8D/분석리포트/CoA) — 고객지원 files 패턴 ────
const decodeName = n => {
  try {
    return Buffer.from(n, 'latin1').toString('utf8');
  } catch (_) {
    return n;
  }
};
router.get('/cases/:id/files', requireLevel(1), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.id, f.file_name, f.file_size,
              DATE_FORMAT(f.created_at, '%Y-%m-%d %H:%i') AS created_at,
              COALESCE(u.full_name, t.name) AS uploaded_by_name
         FROM quality_files f
         LEFT JOIN users u ON u.id = f.uploaded_by
         LEFT JOIN team_members t ON t.id = f.uploaded_by
        WHERE f.case_id=? ORDER BY f.id ASC`,
      [Number(req.params.id)]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});
router.post('/cases/:id/files', requireLevel(1), upload.array('files', 10), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, error: '업로드할 파일 없음' });
    for (const f of files) {
      await pool.query(
        `INSERT INTO quality_files (case_id, file_path, file_name, file_size, uploaded_by)
         VALUES (?,?,?,?,?)`,
        [id, f.path, decodeName(f.originalname), f.size || null, getUserId(req)]
      );
    }
    await addQHistory(id, 'file', null, `${files.length}건`, getUserId(req), '첨부 추가');
    res.json({ success: true, count: files.length });
  } catch (err) {
    handleError(res, err);
  }
});
router.get('/cases/:id/files/:fileId', requireLevel(1), async (req, res) => {
  try {
    const [[f]] = await pool.query(
      'SELECT file_path, file_name FROM quality_files WHERE id=? AND case_id=?',
      [Number(req.params.fileId), Number(req.params.id)]
    );
    if (!f || !f.file_path) return res.status(404).json({ success: false, error: '파일 없음' });
    res.download(f.file_path, f.file_name || 'file');
  } catch (err) {
    handleError(res, err);
  }
});
router.delete('/cases/:id/files/:fileId', requireLevel(1), async (req, res) => {
  try {
    const [[f]] = await pool.query(
      'SELECT id, file_path FROM quality_files WHERE id=? AND case_id=?',
      [Number(req.params.fileId), Number(req.params.id)]
    );
    if (!f) return res.status(404).json({ success: false, error: '파일 없음' });
    await pool.query('DELETE FROM quality_files WHERE id=?', [f.id]);
    if (f.file_path) {
      try {
        require('node:fs').unlinkSync(f.file_path);
      } catch (_) {
        /* 이미 삭제됨 */
      }
    }
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

// ── 인앱 알림 (이관·할당 → 내 알림 조회/읽음) ─────────────────
router.get('/notifications', requireLevel(1), async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.json({ success: true, data: [], unread: 0 });
    const [rows] = await pool.query(
      `SELECT n.id, n.case_id, n.event_type, n.message, n.is_read,
              DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i') AS created_at, qc.case_no
         FROM quality_notifications n
         LEFT JOIN quality_cases qc ON qc.id = n.case_id
        WHERE n.user_id=? ORDER BY n.is_read ASC, n.id DESC LIMIT 30`,
      [uid]
    );
    const [[c]] = await pool.query(
      'SELECT COUNT(*) AS unread FROM quality_notifications WHERE user_id=? AND is_read=0',
      [uid]
    );
    res.json({ success: true, data: rows, unread: Number(c.unread) || 0 });
  } catch (err) {
    handleError(res, err);
  }
});
router.post('/notifications/:id/read', requireLevel(1), async (req, res) => {
  try {
    const uid = getUserId(req);
    await pool.query('UPDATE quality_notifications SET is_read=1 WHERE id=? AND user_id=?', [
      Number(req.params.id),
      uid,
    ]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});
router.post('/notifications/read-all', requireLevel(1), async (req, res) => {
  try {
    const uid = getUserId(req);
    await pool.query('UPDATE quality_notifications SET is_read=1 WHERE user_id=? AND is_read=0', [
      uid,
    ]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
