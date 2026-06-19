const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { parsePage, pageResult } = require('../utils/routeHelper');
const upload = require('../middleware/upload');
const { fromExcelBuffer } = require('../utils/excelHelper');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');
const readReceipts = require('../services/readReceipts');
const projectStatuses = require('./project-statuses'); // 상태 검증/완료 동기화 헬퍼
const {
  MAX_ROWS_PER_REQUEST: BULK_MAX_ROWS,
  sanitizeRow,
  validateRequest: validateBulkRequest,
  buildResponse: buildBulkResponse,
} = require('../utils/bulkPasteHelper');

// ─── 자가 마이그레이션 (프로젝트 모듈 개선 Phase 1 — 사용자 승인 스키마) ───
//   기존 컬럼/의미 보존(status ENUM 유지), idempotent (IF NOT EXISTS)
async function runMigrations() {
  // ① projects 메타 확장 컬럼 10개
  await pool.query(`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS project_code VARCHAR(20) NULL COMMENT '프로젝트 코드 (PRJ-YYYY-NNNN)',
      ADD COLUMN IF NOT EXISTS start_date DATE NULL COMMENT '착수일',
      ADD COLUMN IF NOT EXISTS end_date DATE NULL COMMENT '종료(예정)일',
      ADD COLUMN IF NOT EXISTS stage VARCHAR(30) NULL COMMENT '프로젝트 단계 (project_stages.stage_key)',
      ADD COLUMN IF NOT EXISTS pm_user_id INT NULL COMMENT '프로젝트 PM (team_members.id)',
      ADD COLUMN IF NOT EXISTS collaborators TEXT NULL COMMENT '협업담당 JSON [{id,name}]',
      ADD COLUMN IF NOT EXISTS headcount INT NULL COMMENT '투입인원 수',
      ADD COLUMN IF NOT EXISTS customer_contact VARCHAR(100) NULL COMMENT '담당고객(고객측 담당자)',
      ADD COLUMN IF NOT EXISTS contract_id INT NULL COMMENT '연결 계약 (수금 연계)',
      ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'KRW' COMMENT '통화'
  `);
  await pool.query(
    'ALTER TABLE projects ADD UNIQUE INDEX IF NOT EXISTS uq_project_code (project_code)'
  );

  // ② 프로젝트 단계 정의 (관리자 설정 — pipeline_stages 패턴)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_stages (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      stage_key     VARCHAR(30) NOT NULL UNIQUE,
      label         VARCHAR(100) NOT NULL,
      sort_order    INT DEFAULT 0,
      color         VARCHAR(20) DEFAULT '#93B4F9',
      requires_file TINYINT(1) DEFAULT 0 COMMENT '도달 시 증빙 파일 필수 (검수확인서 등)',
      is_active     TINYINT(1) DEFAULT 1,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM project_stages');
  if (cnt === 0) {
    await pool.query(`
      INSERT INTO project_stages (stage_key, label, sort_order, color, requires_file) VALUES
        ('kickoff',    '착수', 10, '#93B4F9', 0),
        ('execution',  '수행', 20, '#7F77DD', 0),
        ('delivery',   '납품', 30, '#5DCAA5', 0),
        ('install',    '설치', 40, '#F59C00', 0),
        ('training',   '교육', 50, '#FBBF24', 0),
        ('inspection', '검수', 60, '#E63329', 1),
        ('done',       '완료', 70, '#0F7A3F', 0)
    `);
    console.log('[projects:migration] 기본 단계 7개 시드 완료');
  }
  // ②-b 단계별 예상 산출물 가이드 (음영 안내) — 관리자 설정. 줄당 1개.
  await pool.query(
    "ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS deliverable_guide TEXT NULL COMMENT '단계별 예상 산출물 가이드(줄당 1개)'"
  );
  // 기존 행에 가이드 시드 — NULL 인 것만 갱신(관리자 편집 보존, idempotent)
  const STAGE_DELIVERABLE_GUIDE = {
    kickoff: '계약서\n착수보고서\nWBS',
    execution: '중간보고서\n중간검수확인서',
    delivery: '납품확인서\n라이센스증명서',
    install: '설치확인서\n트러블슈팅가이드',
    training: '교육자료',
    inspection: '검수확인서',
    done: '종료보고서',
  };
  for (const [k, g] of Object.entries(STAGE_DELIVERABLE_GUIDE)) {
    await pool.query(
      'UPDATE project_stages SET deliverable_guide = ? WHERE stage_key = ? AND deliverable_guide IS NULL',
      [g, k]
    );
  }

  // ③ 단계 전환 이력 — 마일스톤(plan_date 목표 vs actual_date 실제) + 검수확인서 수취 기록
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_stage_history (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      project_id  INT NOT NULL,
      from_stage  VARCHAR(30) NULL,
      to_stage    VARCHAR(30) NOT NULL,
      plan_date   DATE NULL COMMENT '단계 목표일 (마일스톤)',
      actual_date DATE NULL COMMENT '단계 실제 도달일 (일정 gap 분석 기준)',
      note        VARCHAR(500) NULL,
      file_path   VARCHAR(500) NULL COMMENT '증빙 파일 경로 (검수확인서 등)',
      file_name   VARCHAR(255) NULL,
      moved_by    INT NULL,
      moved_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_to_stage (to_stage)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 기존 설치 호환 — actual_date 컬럼 보강 (moved_at=기록시각과 분리된 실제 도달일)
  await pool.query(
    "ALTER TABLE project_stage_history ADD COLUMN IF NOT EXISTS actual_date DATE NULL COMMENT '단계 실제 도달일 (일정 gap 분석 기준)' AFTER plan_date"
  );

  // ③-b 마일스톤 (단계별 목표일·실제 도달일 — 직접 편집형). 단계당 1행, 상시 수정.
  //   history(전환 이벤트 로그)와 분리 → 미도달 단계도 목표일 보유 가능 + 언제든 편집
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_milestones (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      project_id  INT NOT NULL,
      stage_key   VARCHAR(30) NOT NULL,
      plan_date   DATE NULL COMMENT '단계 목표일',
      actual_date DATE NULL COMMENT '단계 실제 도달일 (입력 시 = 도달)',
      note        VARCHAR(500) NULL,
      file_path   VARCHAR(500) NULL COMMENT '증빙 파일 경로 (검수확인서 등)',
      file_name   VARCHAR(255) NULL,
      updated_by  INT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_proj_stage (project_id, stage_key),
      INDEX idx_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 기존 전환 이력 → 마일스톤 1회 백필 (단계별 최신 기록, 무손실 데이터 연속성)
  //   actual_date 없던 과거 도달은 moved_at(기록일)을 실제 도달일로 승계
  const [[{ mcnt }]] = await pool.query('SELECT COUNT(*) AS mcnt FROM project_milestones');
  if (mcnt === 0) {
    await pool.query(`
      INSERT IGNORE INTO project_milestones
        (project_id, stage_key, plan_date, actual_date, note, file_path, file_name, updated_by)
      SELECT h.project_id, h.to_stage, h.plan_date,
             COALESCE(h.actual_date, DATE(h.moved_at)), h.note, h.file_path, h.file_name, h.moved_by
        FROM project_stage_history h
        INNER JOIN (
          SELECT project_id, to_stage, MAX(id) AS max_id
            FROM project_stage_history GROUP BY project_id, to_stage
        ) latest ON h.id = latest.max_id
    `);
    console.log('[projects:migration] 마일스톤 백필 완료 (history → project_milestones)');
  }

  // ③-c 마일스톤 산출물 파일 (단계별 다중 — contract_files/proposal_files 패턴)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_milestone_files (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      project_id  INT NOT NULL,
      stage_key   VARCHAR(30) NOT NULL,
      file_path   VARCHAR(500) NOT NULL,
      file_name   VARCHAR(255) NOT NULL,
      file_size   INT NULL,
      uploaded_by INT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_proj_stage (project_id, stage_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 기존 단일 파일(project_milestones.file_path) → 다중 파일 테이블 1회 백필 (무손실)
  const [[{ fcnt }]] = await pool.query('SELECT COUNT(*) AS fcnt FROM project_milestone_files');
  if (fcnt === 0) {
    await pool.query(`
      INSERT INTO project_milestone_files (project_id, stage_key, file_path, file_name, uploaded_by)
      SELECT project_id, stage_key, file_path, file_name, updated_by
        FROM project_milestones
       WHERE file_path IS NOT NULL AND file_name IS NOT NULL
    `);
    console.log(
      '[projects:migration] 산출물 파일 백필 완료 (project_milestones → project_milestone_files)'
    );
  }
  // ④ 프로젝트 상태 정의 (관리자 설정 — project_stages 와 동일 패턴)
  //    status_key = 기존 projects.status 저장값(한글) → 데이터 무손실 호환
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_statuses (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      status_key VARCHAR(30) NOT NULL UNIQUE,
      label      VARCHAR(50) NOT NULL,
      color      VARCHAR(20) NOT NULL DEFAULT 'gray' COMMENT '배지 색 (blue/green/amber/red/gray)',
      sort_order INT DEFAULT 0,
      is_active  TINYINT(1) DEFAULT 1,
      is_final   TINYINT(1) DEFAULT 0 COMMENT '완료류 — 마지막 단계 도달 시 자동 동기화 대상',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [[{ scnt }]] = await pool.query('SELECT COUNT(*) AS scnt FROM project_statuses');
  if (scnt === 0) {
    await pool.query(`
      INSERT INTO project_statuses (status_key, label, color, sort_order, is_final) VALUES
        ('진행중',   '진행중',   'blue',  10, 0),
        ('제조중',   '제조중',   'blue',  20, 0),
        ('납기지연', '납기지연', 'amber', 30, 0),
        ('완료',     '완료',     'green', 40, 1),
        ('취소',     '취소',     'gray',  50, 0)
    `);
    console.log('[projects:migration] 기본 상태 5개 시드 완료');
  }

  // ⑤ status ENUM → VARCHAR (사용자 정의 상태 허용). 최초 1회만 — 기존 한글 값 무손실 보존.
  const [statusCol] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'status'`
  );
  if (statusCol[0] && /^enum/i.test(statusCol[0].COLUMN_TYPE)) {
    await pool.query(
      "ALTER TABLE projects MODIFY COLUMN status VARCHAR(30) NOT NULL DEFAULT '진행중'"
    );
    console.log('[projects:migration] projects.status ENUM → VARCHAR(30) 변환 완료');
  }

  console.log('[projects:migration] 자가 마이그레이션 완료 (컬럼 11 + 테이블 5)');
}
runMigrations().catch(err => console.error('[projects:migration] 오류:', err));

// ─── 프로젝트 코드 자동채번 — PRJ-YYYY-NNNN (quotes 채번 패턴) ───
async function generateProjectCode() {
  const yyyy = new Date().getFullYear();
  const prefix = `PRJ-${yyyy}-`;
  const [[row]] = await pool.query(
    `SELECT project_code FROM projects
      WHERE project_code LIKE ?
      ORDER BY project_code DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let next = 1;
  if (row && row.project_code) {
    const m = row.project_code.match(/PRJ-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

// 협업담당: 배열/객체로 오면 JSON 문자열로 저장
function normalizeCollaborators(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

const PROJ_COLS = [
  { key: 'project_code', label: '프로젝트코드' },
  { key: 'name', label: '프로젝트명' },
  { key: 'customer_name', label: '고객사' },
  { key: 'project_type', label: '유형' },
  { key: 'contract_amount', label: '계약금액(억)' },
  { key: 'estimated_cost', label: '산정원가(억)' },
  { key: 'margin_pct', label: '마진율(%)' },
  { key: 'status', label: '상태' },
  { key: 'due_date', label: '납기일' },
  { key: 'assigned_name', label: '담당자' },
  { key: 'notes', label: '메모' },
];

router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    let where = 'WHERE 1=1';
    const params = [];
    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }
    if (search) {
      where += ' AND (p.name LIKE ? OR p.customer_name LIKE ? OR p.project_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM projects p ${where}`, params),
      pool.query(
        `SELECT p.*, t.name AS assigned_name, pm.name AS pm_name, ps.label AS stage_label,
                pst.label AS status_label, pst.color AS status_color,
                l.project_name AS lead_name
           FROM projects p
           LEFT JOIN team_members t ON p.assigned_to = t.id
           LEFT JOIN team_members pm ON p.pm_user_id = pm.id
           LEFT JOIN project_stages ps ON p.stage = ps.stage_key
           LEFT JOIN project_statuses pst ON p.status = pst.status_key
           LEFT JOIN leads l ON p.lead_id = l.id
         ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    // v6.0.0: 읽음 상태 enrich
    await readReceipts.enrichListWithReadStatus(getUserId(req), 'project', rows);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── 일괄 등록 (Copy & Paste import) ──────────────────────────
// ── POST /bulk — 일괄 등록 (v6.0.0 강화: 행 수 제한 + 서버 sanitize + 중복 차단) ──
router.post('/bulk', async (req, res) => {
  const { projects } = req.body;
  // 1) 행 수 / 형식 검증
  const reqErr = validateBulkRequest(projects);
  if (reqErr) {
    return res.status(reqErr.status).json({
      success: false,
      message: reqErr.message,
      code: reqErr.code,
      max: BULK_MAX_ROWS,
    });
  }

  const inserted = [];
  const errors = [];
  const duplicates = [];
  for (const rawRow of projects) {
    // 2) 서버 sanitize
    let row;
    try {
      row = sanitizeRow(rawRow);
    } catch (e) {
      errors.push({ row: rawRow, reason: e.message || '보안 검증 실패' });
      continue;
    }
    if (!row.name) {
      errors.push({ row, reason: '프로젝트명 누락' });
      continue;
    }
    try {
      // 3) 중복 체크 (name + customer_name 매칭)
      const [dupRows] = await pool.query(
        `SELECT id, name, customer_name FROM projects
          WHERE name = ? AND (customer_name <=> ?) LIMIT 1`,
        [row.name, row.customer_name || null]
      );
      if (dupRows.length) {
        duplicates.push({
          row,
          existingId: dupRows[0].id,
          reason: `중복 (기존 ID:${dupRows[0].id} — ${dupRows[0].name} / ${dupRows[0].customer_name || '-'})`,
        });
        continue;
      }
      const margin =
        row.contract_amount && row.estimated_cost
          ? (((row.contract_amount - row.estimated_cost) / row.contract_amount) * 100).toFixed(2)
          : null;
      const [r] = await pool.query(
        `INSERT INTO projects
         (name, customer_name, project_type, contract_amount, estimated_cost,
          margin_pct, status, due_date, assigned_to, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          row.name,
          row.customer_name || null,
          row.project_type || '식각가스',
          row.contract_amount || null,
          row.estimated_cost || null,
          margin,
          row.status || '진행중',
          row.due_date || null,
          row.assigned_to || null,
          row.notes || null,
        ]
      );
      inserted.push(r.insertId);
    } catch (e) {
      errors.push({ row, reason: e.message });
    }
  }
  res.json(buildBulkResponse({ inserted, duplicates, errors }));
});

router.post('/', async (req, res) => {
  try {
    const {
      name,
      customer_name,
      project_type,
      contract_amount,
      estimated_cost,
      status,
      due_date,
      assigned_to,
      notes,
      // ── Phase 1 확장 메타 ──
      project_code,
      customer_id,
      lead_id,
      contract_id,
      start_date,
      end_date,
      stage,
      pm_user_id,
      collaborators,
      headcount,
      customer_contact,
      currency,
    } = req.body;
    if (!name || !String(name).trim())
      return res.status(400).json({ success: false, error: '프로젝트명 필수' });
    const margin =
      contract_amount && estimated_cost
        ? (((contract_amount - estimated_cost) / contract_amount) * 100).toFixed(2)
        : null;

    // 코드: 수동 입력 없으면 자동채번 (PRJ-YYYY-NNNN)
    const code = String(project_code || '').trim() || (await generateProjectCode());
    // 단계: 미지정 시 첫 활성 단계
    let stageKey = String(stage || '').trim() || null;
    if (!stageKey) {
      const [[first]] = await pool.query(
        'SELECT stage_key FROM project_stages WHERE is_active=1 ORDER BY sort_order ASC LIMIT 1'
      );
      stageKey = first ? first.stage_key : null;
    }

    const [result] = await pool.query(
      `INSERT INTO projects
       (name, customer_name, project_type, contract_amount, estimated_cost, margin_pct,
        status, due_date, assigned_to, notes,
        project_code, customer_id, lead_id, contract_id, start_date, end_date,
        stage, pm_user_id, collaborators, headcount, customer_contact, currency)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        name,
        customer_name,
        project_type,
        contract_amount,
        estimated_cost,
        margin,
        status || '진행중',
        due_date || null,
        assigned_to || null,
        notes || null,
        code,
        customer_id || null,
        lead_id || null,
        contract_id || null,
        start_date || null,
        end_date || null,
        stageKey,
        pm_user_id || null,
        normalizeCollaborators(collaborators) ?? null,
        headcount || null,
        customer_contact || null,
        currency || 'KRW',
      ]
    );
    res.json({ success: true, id: result.insertId, project_code: code });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({
        success: false,
        error: '이미 존재하는 프로젝트 코드입니다. 다른 코드를 사용하세요.',
      });
    handleError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const fields = [
      'name',
      'customer_name',
      'project_type',
      'contract_amount',
      'estimated_cost',
      'status',
      'due_date',
      'assigned_to',
      'notes',
      // ── Phase 1 확장 메타 ──
      'project_code',
      'customer_id',
      'lead_id',
      'contract_id',
      'start_date',
      'end_date',
      'stage',
      'pm_user_id',
      'headcount',
      'customer_contact',
      'currency',
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    });
    // 협업담당 — 배열/객체는 JSON 문자열로 저장
    const collab = normalizeCollaborators(req.body.collaborators);
    if (collab !== undefined) {
      updates.push('collaborators = ?');
      values.push(collab);
    }
    if (req.body.contract_amount && req.body.estimated_cost) {
      const m = (
        ((req.body.contract_amount - req.body.estimated_cost) / req.body.contract_amount) *
        100
      ).toFixed(2);
      updates.push('margin_pct = ?');
      values.push(m);
    }
    if (!updates.length) return res.json({ success: true });

    // 이전 status 조회 — 완료 전환 감지용
    let prevStatus = null;
    if (req.body.status !== undefined) {
      const [[curr]] = await pool.query('SELECT status FROM projects WHERE id = ?', [
        req.params.id,
      ]);
      prevStatus = curr?.status;
    }

    values.push(req.params.id);
    await pool.query(`UPDATE projects SET ${updates.join(',')} WHERE id = ?`, values);

    // Webhook — 완료(is_final) 전환 시
    const finalKey = await projectStatuses.getFinalStatusKey();
    if (req.body.status === finalKey && prevStatus !== finalKey) {
      try {
        const wh = require('../services/webhookDispatcher');
        const [[p]] = await pool.query(
          `SELECT id, name, customer_name, project_type, contract_amount, margin_pct
             FROM projects WHERE id = ?`,
          [req.params.id]
        );
        if (p) wh.emit('project.completed', p);
      } catch (_) {
        /* 무시 */
      }
    }

    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({
        success: false,
        error: '이미 존재하는 프로젝트 코드입니다. 다른 코드를 사용하세요.',
      });
    handleError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// v6.0.0: GET /:id — 단건 조회 + 모달 오픈 시 읽음 처리
// ⚠️ /export 보다 *뒤*에 등록 (id="export" 가 잡히는 충돌 방지)
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [[row]] = await pool.query(
      `SELECT p.*, t.name AS assigned_name, pm.name AS pm_name, ps.label AS stage_label,
              pst.label AS status_label, pst.color AS status_color,
              l.project_name AS lead_name
         FROM projects p
         LEFT JOIN team_members t ON p.assigned_to = t.id
         LEFT JOIN team_members pm ON p.pm_user_id = pm.id
         LEFT JOIN project_stages ps ON p.stage = ps.stage_key
         LEFT JOIN project_statuses pst ON p.status = pst.status_key
         LEFT JOIN leads l ON p.lead_id = l.id
        WHERE p.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ success: false, error: '프로젝트를 찾을 수 없음' });
    readReceipts.markRead(getUserId(req), 'project', id).catch(() => {});
    res.json({ success: true, data: row });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 엑셀 내보내기 ────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { status, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }
    if (search) {
      where += ' AND (p.name LIKE ? OR p.customer_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await pool.query(
      `SELECT p.*, t.name AS assigned_name FROM projects p
       LEFT JOIN team_members t ON p.assigned_to = t.id
       ${where} ORDER BY p.created_at DESC`,
      params
    );
    await sendExport(res, {
      columns: PROJ_COLS,
      rows,
      sheetName: '프로젝트',
      filename: '프로젝트_' + new Date().toISOString().slice(0, 10),
      format: normalizeFormat(req.query.format),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 엑셀 가져오기 ────────────────────────────────────────────
router.post('/import', upload.memory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });
    const rows = await fromExcelBuffer(req.file.buffer);
    if (!rows.length)
      return res.status(400).json({ success: false, message: '데이터가 없습니다.' });

    // 팀원 이름 → ID 맵
    const [team] = await pool.query('SELECT id, name FROM team_members');
    const teamMap = Object.fromEntries(team.map(t => [t.name.trim(), t.id]));

    const inserted = [];
    const errors = [];
    for (const row of rows) {
      const name = String(row['프로젝트명'] || row['name'] || '').trim();
      if (!name) {
        errors.push({ row, reason: '프로젝트명 누락' });
        continue;
      }
      try {
        const contractAmt = parseFloat(row['계약금액(억)'] || row['contract_amount']) || null;
        const estimatedCost = parseFloat(row['산정원가(억)'] || row['estimated_cost']) || null;
        const margin =
          contractAmt && estimatedCost
            ? (((contractAmt - estimatedCost) / contractAmt) * 100).toFixed(2)
            : null;
        const assignedName = String(row['담당자'] || row['assigned_name'] || '').trim();
        const assignedId = teamMap[assignedName] || null;
        const [r] = await pool.query(
          `INSERT INTO projects
           (name, customer_name, project_type, contract_amount, estimated_cost,
            margin_pct, status, due_date, assigned_to, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            name,
            String(row['고객사'] || row['customer_name'] || '').trim() || null,
            String(row['유형'] || row['project_type'] || '식각가스').trim(),
            contractAmt,
            estimatedCost,
            margin,
            String(row['상태'] || row['status'] || '진행중').trim(),
            row['납기일'] || row['due_date'] || null,
            assignedId,
            String(row['메모'] || row['notes'] || '').trim() || null,
          ]
        );
        inserted.push(r.insertId);
      } catch (e) {
        errors.push({ row, reason: e.message });
      }
    }
    res.json({ success: true, inserted: inserted.length, errors });
  } catch (err) {
    handleError(res, err);
  }
});

// multer 는 multipart filename 을 latin1 로 디코딩해 originalname 에 저장 →
// 한글 파일명 보존을 위해 latin1 → utf8 재디코딩 (proposals 와 동일 패턴)
function decodeOriginalName(originalname) {
  if (!originalname) return 'file';
  try {
    return Buffer.from(originalname, 'latin1').toString('utf8');
  } catch (_) {
    return originalname;
  }
}

// ─── Phase 3: 단계 전환 + 이력 + 증빙 파일 (검수확인서) ────────
// 전환은 인증 사용자 누구나 (영업 현장 업데이트 — 입력 마찰 최소화).
// requires_file=1 단계(검수 등)는 증빙 파일 업로드 필수 게이트.
router.post('/:id(\\d+)/stage', upload.single('file'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { to_stage, note, plan_date, actual_date } = req.body || {};
    if (!to_stage) return res.status(400).json({ success: false, error: 'to_stage 필수' });

    const [[proj]] = await pool.query('SELECT id, stage, status FROM projects WHERE id = ?', [id]);
    if (!proj) return res.status(404).json({ success: false, error: '프로젝트 없음' });

    const [[stageDef]] = await pool.query(
      'SELECT stage_key, label, requires_file FROM project_stages WHERE stage_key = ? AND is_active = 1',
      [to_stage]
    );
    if (!stageDef)
      return res
        .status(400)
        .json({ success: false, error: '존재하지 않거나 비활성 단계: ' + to_stage });

    // 증빙 필수 단계 게이트 (검수확인서 수취 이력관리)
    if (stageDef.requires_file && !req.file)
      return res.status(400).json({
        success: false,
        error: `"${stageDef.label}" 단계는 증빙 파일(검수확인서 등) 업로드가 필수입니다.`,
        requires_file: true,
      });

    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    const plan = plan_date && YMD.test(String(plan_date)) ? plan_date : null;
    // 실제 도달일 — 미입력 시 오늘(전환 기록일)로 기본 설정 → 일정 gap 분석 기준
    const actual = actual_date && YMD.test(String(actual_date)) ? actual_date : null;

    await pool.query(
      `INSERT INTO project_stage_history
         (project_id, from_stage, to_stage, plan_date, actual_date, note, file_path, file_name, moved_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id,
        proj.stage || null,
        to_stage,
        plan,
        actual,
        String(note || '').slice(0, 500) || null,
        req.file ? req.file.path : null,
        req.file ? decodeOriginalName(req.file.originalname) : null,
        getUserId(req),
      ]
    );
    await pool.query('UPDATE projects SET stage = ? WHERE id = ?', [to_stage, id]);

    // 마지막 활성 단계 도달 → 완료류(is_final) 상태로 자동 동기화 (+ 완료 webhook — PUT 경로와 동일 이벤트)
    const [[last]] = await pool.query(
      'SELECT stage_key FROM project_stages WHERE is_active = 1 ORDER BY sort_order DESC LIMIT 1'
    );
    let statusSynced = false;
    const finalStatusKey = await projectStatuses.getFinalStatusKey();
    if (last && last.stage_key === to_stage && proj.status !== finalStatusKey) {
      await pool.query('UPDATE projects SET status = ? WHERE id = ?', [finalStatusKey, id]);
      statusSynced = true;
      try {
        const wh = require('../services/webhookDispatcher');
        const [[p]] = await pool.query(
          `SELECT id, name, customer_name, project_type, contract_amount, margin_pct
             FROM projects WHERE id = ?`,
          [id]
        );
        if (p) wh.emit('project.completed', p);
      } catch (_) {
        /* 무시 */
      }
    }

    res.json({
      success: true,
      data: {
        stage: to_stage,
        status_synced: statusSynced,
        file: req.file ? decodeOriginalName(req.file.originalname) : null,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// 단계 전환 이력 (최신순) — 단계 라벨 + 전환자명 포함
router.get('/:id(\\d+)/history', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT h.id, h.project_id, h.from_stage, h.to_stage, h.plan_date, h.actual_date, h.note,
              h.file_name, h.moved_by, h.moved_at,
              ps.label AS to_label, ps2.label AS from_label, u.full_name AS moved_by_name
         FROM project_stage_history h
         LEFT JOIN project_stages ps ON h.to_stage = ps.stage_key
         LEFT JOIN project_stages ps2 ON h.from_stage = ps2.stage_key
         LEFT JOIN users u ON h.moved_by = u.id
        WHERE h.project_id = ?
        ORDER BY h.moved_at DESC, h.id DESC`,
      [parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// 증빙 파일 다운로드 (검수확인서 등)
router.get('/:id(\\d+)/history/:hid(\\d+)/file', async (req, res) => {
  try {
    const [[h]] = await pool.query(
      'SELECT file_path, file_name FROM project_stage_history WHERE id = ? AND project_id = ?',
      [parseInt(req.params.hid, 10), parseInt(req.params.id, 10)]
    );
    if (!h || !h.file_path) return res.status(404).json({ success: false, error: '파일 없음' });
    res.download(h.file_path, h.file_name || 'file');
  } catch (err) {
    handleError(res, err);
  }
});

// ── 마일스톤 (단계별 목표일·실제 도달일 — 직접 편집형) ──────────────
//   GET: 활성 단계 + 단계별 마일스톤(목표/실제/증빙) — 미도달 단계도 포함
router.get('/:id(\\d+)/milestones', async (req, res) => {
  try {
    const pid = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      `SELECT s.stage_key, s.label, s.sort_order, s.color, s.requires_file, s.deliverable_guide,
              m.id AS milestone_id, m.plan_date, m.actual_date, m.note,
              u.full_name AS updated_by_name, m.updated_at,
              (SELECT COUNT(*) FROM project_milestone_files f
                WHERE f.project_id = ? AND f.stage_key = s.stage_key) AS file_count
         FROM project_stages s
         LEFT JOIN project_milestones m ON m.stage_key = s.stage_key AND m.project_id = ?
         LEFT JOIN users u ON m.updated_by = u.id
        WHERE s.is_active = 1
        ORDER BY s.sort_order ASC, s.id ASC`,
      [pid, pid]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// PUT: 단계 마일스톤 upsert (목표일/실제 도달일/메모) — 언제든 수정
//   실제 도달일 입력 = 해당 단계 도달 → 현재 위치 자동 재계산 + (증빙 게이트) + (완료 동기화)
//   산출물(증빙 파일)은 별도 /files 엔드포인트에서 관리
router.put('/:id(\\d+)/milestones/:stage_key', async (req, res) => {
  try {
    const pid = parseInt(req.params.id, 10);
    const stageKey = req.params.stage_key;
    const { plan_date, actual_date, note } = req.body || {};

    const [[stageDef]] = await pool.query(
      'SELECT stage_key, label, requires_file FROM project_stages WHERE stage_key = ? AND is_active = 1',
      [stageKey]
    );
    if (!stageDef)
      return res.status(400).json({ success: false, error: '존재하지 않거나 비활성 단계' });

    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    const plan = plan_date && YMD.test(String(plan_date)) ? plan_date : null;
    const actual = actual_date && YMD.test(String(actual_date)) ? actual_date : null;

    // 증빙 필수 게이트 — 실제 도달일 입력 + 증빙필수 단계 + 산출물 0건
    if (actual && stageDef.requires_file) {
      const [[{ fc }]] = await pool.query(
        'SELECT COUNT(*) AS fc FROM project_milestone_files WHERE project_id = ? AND stage_key = ?',
        [pid, stageKey]
      );
      if (fc === 0) {
        return res.status(400).json({
          success: false,
          error: `"${stageDef.label}" 단계는 실제 도달일 입력 시 증빙 산출물(검수확인서 등)이 1건 이상 필요합니다.`,
          requires_file: true,
        });
      }
    }

    const noteVal = String(note || '').slice(0, 500) || null;
    const [[existing]] = await pool.query(
      'SELECT id FROM project_milestones WHERE project_id = ? AND stage_key = ?',
      [pid, stageKey]
    );
    if (existing) {
      await pool.query(
        'UPDATE project_milestones SET plan_date=?, actual_date=?, note=?, updated_by=? WHERE id=?',
        [plan, actual, noteVal, getUserId(req), existing.id]
      );
    } else {
      await pool.query(
        `INSERT INTO project_milestones (project_id, stage_key, plan_date, actual_date, note, updated_by)
         VALUES (?,?,?,?,?,?)`,
        [pid, stageKey, plan, actual, noteVal, getUserId(req)]
      );
    }

    // 현재 위치 재계산 — 미도달(actual_date NULL) 첫 활성 단계 = 현재; 모두 도달 시 마지막
    const [activeStages] = await pool.query(
      `SELECT s.stage_key, m.actual_date
         FROM project_stages s
         LEFT JOIN project_milestones m ON m.stage_key = s.stage_key AND m.project_id = ?
        WHERE s.is_active = 1 ORDER BY s.sort_order ASC, s.id ASC`,
      [pid]
    );
    let currentStage = null;
    for (const st of activeStages) {
      if (!st.actual_date) {
        currentStage = st.stage_key;
        break;
      }
    }
    if (!currentStage && activeStages.length)
      currentStage = activeStages[activeStages.length - 1].stage_key;
    if (currentStage)
      await pool.query('UPDATE projects SET stage = ? WHERE id = ?', [currentStage, pid]);

    // 완료 동기화 — 모든 활성 단계 도달 시 is_final 상태
    const allReached = activeStages.length > 0 && activeStages.every(st => st.actual_date);
    let statusSynced = false;
    if (allReached) {
      const finalKey = await projectStatuses.getFinalStatusKey();
      const [[proj]] = await pool.query('SELECT status FROM projects WHERE id = ?', [pid]);
      if (proj && proj.status !== finalKey) {
        await pool.query('UPDATE projects SET status = ? WHERE id = ?', [finalKey, pid]);
        statusSynced = true;
      }
    }

    res.json({ success: true, data: { stage: currentStage, status_synced: statusSynced } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 마일스톤 산출물 파일 (단계별 다중) ─────────────────────────
// 목록
router.get('/:id(\\d+)/milestones/:stage_key/files', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.id, f.file_name, f.file_size, f.created_at, u.full_name AS uploaded_by_name
         FROM project_milestone_files f
         LEFT JOIN users u ON f.uploaded_by = u.id
        WHERE f.project_id = ? AND f.stage_key = ?
        ORDER BY f.id ASC`,
      [parseInt(req.params.id, 10), req.params.stage_key]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// 업로드 (다중 — field name: files)
router.post(
  '/:id(\\d+)/milestones/:stage_key/files',
  upload.array('files', 10),
  async (req, res) => {
    try {
      const pid = parseInt(req.params.id, 10);
      const stageKey = req.params.stage_key;
      const [[stageDef]] = await pool.query(
        'SELECT stage_key FROM project_stages WHERE stage_key = ? AND is_active = 1',
        [stageKey]
      );
      if (!stageDef)
        return res.status(400).json({ success: false, error: '존재하지 않거나 비활성 단계' });
      const files = req.files || [];
      if (!files.length)
        return res.status(400).json({ success: false, error: '업로드할 파일 없음' });
      for (const f of files) {
        await pool.query(
          `INSERT INTO project_milestone_files
             (project_id, stage_key, file_path, file_name, file_size, uploaded_by)
           VALUES (?,?,?,?,?,?)`,
          [
            pid,
            stageKey,
            f.path,
            decodeOriginalName(f.originalname),
            f.size || null,
            getUserId(req),
          ]
        );
      }
      res.json({ success: true, count: files.length });
    } catch (err) {
      handleError(res, err);
    }
  }
);

// 다운로드
router.get('/:id(\\d+)/milestones/:stage_key/files/:fileId(\\d+)', async (req, res) => {
  try {
    const [[f]] = await pool.query(
      'SELECT file_path, file_name FROM project_milestone_files WHERE id = ? AND project_id = ? AND stage_key = ?',
      [parseInt(req.params.fileId, 10), parseInt(req.params.id, 10), req.params.stage_key]
    );
    if (!f || !f.file_path) return res.status(404).json({ success: false, error: '파일 없음' });
    res.download(f.file_path, f.file_name || 'file');
  } catch (err) {
    handleError(res, err);
  }
});

// 삭제
router.delete('/:id(\\d+)/milestones/:stage_key/files/:fileId(\\d+)', async (req, res) => {
  try {
    const [[f]] = await pool.query(
      'SELECT id, file_path FROM project_milestone_files WHERE id = ? AND project_id = ? AND stage_key = ?',
      [parseInt(req.params.fileId, 10), parseInt(req.params.id, 10), req.params.stage_key]
    );
    if (!f) return res.status(404).json({ success: false, error: '파일 없음' });
    await pool.query('DELETE FROM project_milestone_files WHERE id = ?', [f.id]);
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

module.exports = router;
