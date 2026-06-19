const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const {
  requireFields,
  validateId,
  sanitizeQuery,
  schema,
  SCHEMAS,
} = require('../middleware/validate');
const { parsePage, pageResult } = require('../utils/routeHelper');
const { getUserId } = require('../middleware/auth');
const {
  MAX_ROWS_PER_REQUEST: BULK_MAX_ROWS,
  sanitizeRow,
  validateRequest: validateBulkRequest,
  buildResponse: buildBulkResponse,
} = require('../utils/bulkPasteHelper');
const readReceipts = require('../services/readReceipts');
const leadNotifier = require('./../services/leadNotifier');
const { wsBroadcast } = require('../ws');
const upload = require('../middleware/upload');
const { fromExcelBuffer } = require('../utils/excelHelper');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');

const STAGE_KO = {
  lead: '리드 발굴',
  review: '검토/미팅',
  proposal: '제안/견적',
  bidding: '입찰',
  negotiation: '협상/계약',
  won: '수주 완료',
  lost: '실주',
  dropped: '드롭',
};
const STAGE_EN = Object.fromEntries(Object.entries(STAGE_KO).map(([k, v]) => [v, k]));

const LEAD_COLS = [
  { key: 'customer_name', label: '고객사' },
  { key: 'project_name', label: '프로젝트명' },
  { key: 'business_type', label: '사업유형' },
  { key: 'capacity_mw', label: '예상 물량' },
  { key: 'stage_label', label: '단계' },
  { key: 'region', label: '구분' },
  { key: 'expected_amount', label: '예상금액' },
  { key: 'currency', label: '통화' },
  { key: 'assigned_name', label: '담당자' },
  { key: 'expected_close_date', label: '완료예정일' },
  { key: 'bidding_deadline', label: '입찰마감일' },
  { key: 'notes', label: '비고' },
];

// stage_changed_at 컬럼 자동 생성 (없을 경우)
pool
  .query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_changed_at DATETIME NULL DEFAULT NULL`)
  .catch(() => {});

// v6.0.0 Phase B: 복수 담당자 (협업자) — collaborator_ids JSON 컬럼
// 혼합 구조: 기존 assigned_to (주담당) + collaborator_ids (협업자 N명)
// JSON 배열 형태로 team_members.id 저장 (e.g., [3, 7, 12])
pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS collaborator_ids JSON NULL`).catch(() => {});

// v7.0.0 Option C 재설계: 이익률 + 경쟁사 컬럼
// profit_rate: 예상이익률 (%) — 이익금은 프론트에서 expected_amount × profit_rate / 100 으로 계산
// competitor: 경쟁사 자유 입력 텍스트
pool
  .query(
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS profit_rate DECIMAL(5,2) NULL DEFAULT NULL COMMENT '예상이익률 (%)'`
  )
  .catch(() => {});
pool
  .query(
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS competitor VARCHAR(200) NULL DEFAULT NULL COMMENT '경쟁사'`
  )
  .catch(() => {});

// 협업자 ID 배열 정규화: 입력값(JSON|배열|CSV|null) → 깨끗한 INT[] 반환
function normalizeCollaboratorIds(input, excludeId = null) {
  if (input === null || input === undefined || input === '') return [];
  let arr = input;
  if (typeof input === 'string') {
    try {
      arr = JSON.parse(input);
    } catch (_) {
      // CSV fallback (e.g., "3,7,12")
      arr = input
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }
  }
  if (!Array.isArray(arr)) return [];
  const ids = arr.map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x > 0);
  // 주담당과 중복 제거 + 자체 dedup
  const set = new Set(ids);
  if (excludeId) set.delete(parseInt(excludeId, 10));
  return Array.from(set);
}

// 협업자 ID 배열 → team_members 정보 join (UI 표시용)
async function _hydrateCollaborators(collaboratorIdsRaw) {
  const ids = normalizeCollaboratorIds(collaboratorIdsRaw);
  if (!ids.length) return [];
  try {
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT id, name, email, role FROM team_members WHERE id IN (${placeholders})`,
      ids
    );
    // 입력 순서대로 정렬 (등록 순서 유지)
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    return ids.map(id => byId[id]).filter(Boolean);
  } catch (_) {
    return [];
  }
}

router.get('/', sanitizeQuery, async (req, res) => {
  try {
    const {
      stage,
      region,
      assigned_to,
      business_type,
      search,
      date_from,
      date_to,
      date_field,
      autocomplete,
    } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    // v6.0.0 Step 2: Autocomplete 모드 (계약 모달의 영업리드 Combobox 용)
    if (autocomplete === '1' && search) {
      const q = String(search).trim();
      if (q.length < 2) return res.json({ success: true, data: [], query: q });
      const acLimit = Math.min(20, parseInt(req.query.limit) || 10);
      const [rows] = await pool.query(
        `SELECT id, customer_id, customer_name, project_name, stage,
                business_type, region, expected_amount, currency, assigned_to
           FROM leads
          WHERE (customer_name LIKE ? OR project_name LIKE ?)
          ORDER BY updated_at DESC
          LIMIT ?`,
        [`%${q}%`, `%${q}%`, acLimit]
      );
      return res.json({ success: true, data: rows, query: q });
    }

    // date_field: 'stage'(기본) = stage_changed_at, 'created' = created_at,
    //             'close' = expected_close_date, 'updated' = updated_at
    const dateCol =
      date_field === 'created'
        ? 'l.created_at'
        : date_field === 'close'
          ? 'l.expected_close_date'
          : date_field === 'updated'
            ? 'l.updated_at'
            : 'COALESCE(l.stage_changed_at, l.updated_at)'; // 기본: 단계변경일

    let where = 'WHERE 1=1';
    const params = [];
    if (stage) {
      where += ' AND l.stage = ?';
      params.push(stage);
    }
    if (region) {
      where += ' AND l.region = ?';
      params.push(region);
    }
    if (assigned_to) {
      where += ' AND l.assigned_to = ?';
      params.push(assigned_to);
    }
    if (business_type) {
      where += ' AND l.business_type = ?';
      params.push(business_type);
    }
    if (date_from) {
      where += ` AND ${dateCol} >= ?`;
      params.push(date_from);
    }
    if (date_to) {
      where += ` AND ${dateCol} <= ?`;
      params.push(date_to);
    }
    if (search) {
      where += ' AND (l.customer_name LIKE ? OR l.project_name LIKE ? OR l.notes LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // ⚠️ mysql2의 pool.query 는 [rows, fields] 반환 → Promise.all 결과 destructure 주의
    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM leads l ${where}`, params),
      pool.query(
        `SELECT l.*, t.name AS assigned_name, t.role AS assigned_role
         FROM leads l LEFT JOIN team_members t ON l.assigned_to = t.id
         ${where} ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    // v6.0.0: 각 항목에 읽음 상태 enrich (is_read / has_update_after_read / last_read_at)
    await readReceipts.enrichListWithReadStatus(getUserId(req), 'lead', rows);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── 엑셀 내보내기 ────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { stage, region, assigned_to, business_type, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (stage) {
      where += ' AND l.stage = ?';
      params.push(stage);
    }
    if (region) {
      where += ' AND l.region = ?';
      params.push(region);
    }
    if (assigned_to) {
      where += ' AND l.assigned_to = ?';
      params.push(assigned_to);
    }
    if (business_type) {
      where += ' AND l.business_type = ?';
      params.push(business_type);
    }
    if (search) {
      where += ' AND (l.customer_name LIKE ? OR l.project_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await pool.query(
      `SELECT l.*, t.name AS assigned_name FROM leads l
       LEFT JOIN team_members t ON l.assigned_to = t.id
       ${where} ORDER BY l.updated_at DESC`,
      params
    );
    const data = rows.map(r => ({ ...r, stage_label: STAGE_KO[r.stage] || r.stage }));
    await sendExport(res, {
      columns: LEAD_COLS,
      rows: data,
      sheetName: '영업리드',
      filename: '영업리드_' + new Date().toISOString().slice(0, 10),
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
      const cn = String(row['고객사'] || row['customer_name'] || '').trim();
      const pn = String(row['프로젝트명'] || row['project_name'] || '').trim();
      if (!cn || !pn) {
        errors.push({ row, reason: '고객사/프로젝트명 누락' });
        continue;
      }
      try {
        const stageRaw = String(row['단계'] || row['stage'] || '').trim();
        const stage = STAGE_EN[stageRaw] || stageRaw || 'lead';
        const assignedName = String(row['담당자'] || row['assigned_name'] || '').trim();
        const assignedId = teamMap[assignedName] || null;
        const [r] = await pool.query(
          `INSERT INTO leads (customer_name, project_name, business_type, region,
           capacity_mw, expected_amount, currency, stage, assigned_to,
           expected_close_date, bidding_deadline, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            cn,
            pn,
            String(row['사업유형'] || row['business_type'] || '식각가스').trim(),
            String(row['구분'] || row['region'] || '국내').trim(),
            parseFloat(row['예상 물량'] || row['규모(MW)'] || row['capacity_mw']) || null,
            parseFloat(row['예상금액'] || row['expected_amount']) || null,
            String(row['통화'] || row['currency'] || 'KRW').trim(),
            stage,
            assignedId,
            row['완료예정일'] || row['expected_close_date'] || null,
            row['입찰마감일'] || row['bidding_deadline'] || null,
            String(row['비고'] || row['notes'] || '').trim() || null,
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

// ⚠️ 정적 경로는 반드시 /:id 보다 먼저 — Express 라우터 매칭 순서
router.get('/funnel-stats', async (req, res) => {
  try {
    const result = await calcFunnelConversion({
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      date_field: req.query.date_field,
      region: req.query.region,
      business_type: req.query.business_type,
      assigned_to: req.query.assigned_to,
      search: req.query.search,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

// v6.0.0: GET /api/leads/dashboard — 상단 KPI 카드 (5개 모듈 통일)
// 진행 중 / 마감 임박 / 수주 / 활성 금액
router.get('/dashboard', async (req, res) => {
  try {
    const ACTIVE = `stage NOT IN ('won','lost','dropped')`;
    const [[row]] = await pool.query(`
      SELECT
        SUM(CASE WHEN ${ACTIVE} THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN ${ACTIVE} AND bidding_deadline IS NOT NULL
                  AND bidding_deadline BETWEEN CURDATE()
                  AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS deadline_7d,
        SUM(CASE WHEN stage = 'won' THEN 1 ELSE 0 END) AS won,
        SUM(CASE WHEN ${ACTIVE} THEN COALESCE(expected_amount, 0) ELSE 0 END) AS pipeline_amount
      FROM leads
    `);
    res.json({
      success: true,
      data: {
        active: Number(row.active) || 0,
        deadline_7d: Number(row.deadline_7d) || 0,
        won: Number(row.won) || 0,
        pipeline_amount: Number(row.pipeline_amount) || 0,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', validateId, async (req, res) => {
  try {
    const [[lead]] = await pool.query(
      `SELECT l.*, t.name AS assigned_name FROM leads l
       LEFT JOIN team_members t ON l.assigned_to = t.id WHERE l.id = ?`,
      [req.params.id]
    );
    if (!lead) return res.status(404).json({ success: false, error: 'Not found' });
    // v6.0.0: 모달 오픈 = 읽음 처리 (best-effort, 비동기)
    readReceipts.markRead(getUserId(req), 'lead', parseInt(req.params.id, 10)).catch(() => {});
    const [activities] = await pool.query(
      `SELECT a.*, t.name AS performer_name FROM activities a
       LEFT JOIN team_members t ON a.performed_by = t.id
       WHERE a.lead_id = ? ORDER BY a.performed_at DESC`,
      [req.params.id]
    );

    // 연결된 회의록 (lead_id 직접 연결 OR 고객사명 기준 매핑)
    let meetings = [];
    try {
      const [byLead] = await pool.query(
        `SELECT id, title, meeting_date, customer_name, summary_md, calendar_event_id, created_at
         FROM meeting_minutes WHERE lead_id = ? ORDER BY meeting_date DESC`,
        [req.params.id]
      );
      const [byCustomer] = lead.customer_name
        ? await pool.query(
            `SELECT id, title, meeting_date, customer_name, summary_md, calendar_event_id, created_at
         FROM meeting_minutes WHERE customer_name = ? AND (lead_id IS NULL OR lead_id != ?)
         ORDER BY meeting_date DESC`,
            [lead.customer_name, req.params.id]
          )
        : [[]];
      // 중복 제거
      const seen = new Set(byLead.map(m => m.id));
      meetings = [...byLead, ...byCustomer.filter(m => !seen.has(m.id))];
    } catch (_) {
      /* meeting_minutes 테이블 없으면 빈 배열 */
    }

    // v6.0.0 Phase B: 협업자 정보 hydrate (id → name/email/role join)
    const collaborators = await _hydrateCollaborators(lead.collaborator_ids);

    res.json({
      success: true,
      data: { ...lead, activities, meetings, collaborators },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 일괄 등록 (Copy & Paste import) ──────────────────────────
// ── POST /bulk — 일괄 등록 (v6.0.0 강화: 행 수 제한 + 서버 sanitize + 중복 차단) ──
router.post('/bulk', async (req, res) => {
  const { leads } = req.body;
  // 1) 행 수 / 형식 검증
  const reqErr = validateBulkRequest(leads);
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
  for (const rawRow of leads) {
    // 2) 서버 sanitize
    let row;
    try {
      row = sanitizeRow(rawRow);
    } catch (e) {
      errors.push({ row: rawRow, reason: e.message || '보안 검증 실패' });
      continue;
    }
    const { customer_name, project_name } = row;
    if (!customer_name || !project_name) {
      errors.push({ row, reason: '고객사 또는 프로젝트명 누락' });
      continue;
    }
    try {
      // 3) 중복 체크 (project_name + customer_name 매칭)
      const [dupRows] = await pool.query(
        `SELECT id, customer_name, project_name FROM leads
          WHERE project_name = ? AND customer_name = ? LIMIT 1`,
        [project_name, customer_name]
      );
      if (dupRows.length) {
        duplicates.push({
          row,
          existingId: dupRows[0].id,
          reason: `중복 (기존 ID:${dupRows[0].id} — ${dupRows[0].customer_name} / ${dupRows[0].project_name})`,
        });
        continue;
      }
      const [r] = await pool.query(
        `INSERT INTO leads
         (customer_name, project_name, business_type, region,
          capacity_mw, expected_amount, currency, stage,
          assigned_to, expected_close_date, bidding_deadline, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          customer_name,
          project_name,
          row.business_type || '식각가스',
          row.region || '국내',
          row.capacity_mw || null,
          row.expected_amount || null,
          row.currency || 'KRW',
          row.stage || 'lead',
          row.assigned_to || null,
          row.expected_close_date || null,
          row.bidding_deadline || null,
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

// ── 동적 stage 검증 (pipeline_stages 테이블 기반) ──────────────
async function validateStage(stage) {
  if (!stage) return true; // null/undefined는 default('lead')로 처리됨
  const pipelineStages = require('./pipeline-stages');
  const validKeys = await pipelineStages.getValidKeys();
  return validKeys.includes(stage);
}

// 환산 헬퍼 — 실패 시 amount_krw=null로 두고 진행 (FX 장애가 리드 등록 막지 않게)
async function calcKrw(amount, currency) {
  if (!amount || !Number.isFinite(Number(amount))) return { krw: null, rate: null };
  if (!currency || currency === 'KRW') return { krw: Math.round(Number(amount)), rate: 1 };
  try {
    const Fx = require('../services/exchange');
    const rate = await Fx.getRate(currency);
    return { krw: Math.round(Number(amount) * rate), rate };
  } catch (e) {
    console.warn('[FX] 환산 실패 (currency=' + currency + '):', e.message);
    return { krw: null, rate: null };
  }
}

router.post('/', schema(SCHEMAS.createLead), async (req, res) => {
  try {
    const {
      customer_name,
      project_name,
      business_type,
      region,
      capacity_mw,
      expected_amount,
      currency,
      stage,
      assigned_to,
      expected_close_date,
      bidding_deadline,
      notes,
      collaborator_ids, // v6.0.0 Phase B
    } = req.body;

    // 동적 stage 검증 (pipeline_stages 기반)
    if (stage && !(await validateStage(stage))) {
      return res.status(400).json({ success: false, error: '존재하지 않는 단계입니다: ' + stage });
    }

    const cur = currency || 'KRW';
    const { krw, rate } = await calcKrw(expected_amount, cur);
    // 신규 등록은 항상 'live' 정책 (won 단계로 들어와도 등록 시점 확정 가능)
    const isWon = stage === 'won';
    const lockPolicy = isWon ? 'locked' : 'live';
    const lockedAt = isWon ? new Date() : null;

    // v6.0.0 Phase B: 협업자 정규화 (주담당과 자기 자신은 제외)
    const cleanedCollabIds = normalizeCollaboratorIds(collaborator_ids, assigned_to);

    const [result] = await pool.query(
      `INSERT INTO leads
       (customer_name, project_name, business_type, region,
        capacity_mw, expected_amount, currency, stage,
        assigned_to, expected_close_date, bidding_deadline, notes,
        amount_krw, fx_rate, fx_lock_policy, fx_locked_at, collaborator_ids)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        customer_name,
        project_name,
        business_type || '식각가스',
        region || '국내',
        capacity_mw || null,
        expected_amount || null,
        cur,
        stage || 'lead',
        assigned_to || null,
        expected_close_date || null,
        bidding_deadline || null,
        notes || null,
        krw,
        rate,
        lockPolicy,
        lockedAt,
        cleanedCollabIds.length ? JSON.stringify(cleanedCollabIds) : null,
      ]
    );
    // Webhook 발행 — fire-and-forget
    try {
      const wh = require('../services/webhookDispatcher');
      wh.emit('lead.created', {
        id: result.insertId,
        customer_name,
        project_name,
        business_type: business_type || '식각가스',
        stage: stage || 'lead',
        expected_amount,
        currency: cur,
        amount_krw: krw,
      });
      if (stage === 'won') {
        wh.emit('lead.won', {
          id: result.insertId,
          customer_name,
          project_name,
          expected_amount,
          currency: cur,
          amount_krw: krw,
        });
      }
    } catch (_) {
      /* webhook 실패는 무시 */
    }
    res.json({
      success: true,
      id: result.insertId,
      data: { id: result.insertId, amount_krw: krw },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', validateId, async (req, res) => {
  try {
    const fields = [
      'customer_name',
      'project_name',
      'business_type',
      'region',
      'capacity_mw',
      'expected_amount',
      'currency',
      'stage',
      'assigned_to',
      'expected_close_date',
      'bidding_deadline',
      'notes',
      'profit_rate', // v7.0.0 Option C
      'competitor', // v7.0.0 Option C
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    });

    // v6.0.0 Phase B: collaborator_ids 별도 처리 (JSON 정규화)
    if (req.body.collaborator_ids !== undefined) {
      // assigned_to 가 함께 변경되면 그 값으로, 아니면 기존 값으로 자기 제외
      let excludeId = req.body.assigned_to;
      if (excludeId === undefined) {
        try {
          const [[curRow]] = await pool.query('SELECT assigned_to FROM leads WHERE id = ?', [
            req.params.id,
          ]);
          excludeId = curRow ? curRow.assigned_to : null;
        } catch (_) {
          /* skip */
        }
      }
      const cleanedIds = normalizeCollaboratorIds(req.body.collaborator_ids, excludeId);
      updates.push('collaborator_ids = ?');
      values.push(cleanedIds.length ? JSON.stringify(cleanedIds) : null);
    }

    if (!updates.length) return res.json({ success: true, message: 'No changes' });

    // expected_amount 또는 currency 변경 시 amount_krw 재계산
    // 단, 이미 'locked' 정책이면 (수주 확정) 재계산 안 함
    const amtChanged = req.body.expected_amount !== undefined;
    const curChanged = req.body.currency !== undefined;
    if (amtChanged || curChanged) {
      const [[curr]] = await pool.query(
        'SELECT expected_amount, currency, fx_lock_policy FROM leads WHERE id=?',
        [req.params.id]
      );
      if (curr && curr.fx_lock_policy !== 'locked') {
        const newAmt = amtChanged ? req.body.expected_amount : curr.expected_amount;
        const newCur = curChanged ? req.body.currency : curr.currency;
        const { krw, rate } = await calcKrw(newAmt, newCur);
        updates.push('amount_krw=?');
        values.push(krw);
        updates.push('fx_rate=?');
        values.push(rate);
      }
    }

    values.push(req.params.id);
    await pool.query(`UPDATE leads SET ${updates.join(',')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── v6.0.0 Phase C: 주 담당자 변경 ──────────────────────────
// PUT /api/leads/:id/primary-owner
// body: { new_owner_id: number }
// 권한: admin/team_lead/executive/superadmin | 현재 주 담당자 본인
//       (NODE_ENV=test 에서는 req.user null → 통과)
router.put('/:id/primary-owner', validateId, requireFields(['new_owner_id']), async (req, res) => {
  try {
    const leadId = Number(req.params.id);
    const newOwnerId = Number(req.body.new_owner_id);
    if (!Number.isFinite(newOwnerId) || newOwnerId <= 0) {
      return res.status(400).json({ success: false, error: '유효하지 않은 담당자 ID입니다.' });
    }

    // 1. 리드 + 기존 담당자 정보 조회
    const [[lead]] = await pool.query(
      `SELECT l.id, l.assigned_to, l.customer_name, l.project_name,
              tm.name AS old_owner_name
         FROM leads l
         LEFT JOIN team_members tm ON tm.id = l.assigned_to
        WHERE l.id = ?`,
      [leadId]
    );
    if (!lead)
      return res.status(404).json({ success: false, error: '영업리드를 찾을 수 없습니다.' });

    // 2. 신규 담당자 존재 확인
    const [[newOwner]] = await pool.query('SELECT id, name FROM team_members WHERE id = ?', [
      newOwnerId,
    ]);
    if (!newOwner) {
      return res.status(400).json({ success: false, error: '존재하지 않는 담당자입니다.' });
    }

    // 3. 권한 체크 (test 환경 req.user=null → 통과)
    const user = req.user;
    if (user) {
      const privileged = ['admin', 'team_lead', 'executive', 'superadmin'];
      const isSelf = lead.assigned_to && String(user.id) === String(lead.assigned_to);
      if (!privileged.includes(user.role) && !isSelf) {
        return res.status(403).json({ success: false, error: '주 담당자 변경 권한이 없습니다.' });
      }
    }

    // 변경 없음
    if (lead.assigned_to === newOwnerId) {
      return res.json({
        success: true,
        message: 'No changes',
        data: { assigned_to: newOwnerId, owner_name: newOwner.name },
      });
    }

    // 4. leads.assigned_to 업데이트
    await pool.query('UPDATE leads SET assigned_to = ? WHERE id = ?', [newOwnerId, leadId]);

    // 5. 활동 기록 (owner_change)
    const oldName = lead.old_owner_name || '미지정';
    const actorId = req.user?.id || getUserId(req) || null;
    await pool.query(
      `INSERT INTO activities (lead_id, activity_type, title, content, performed_by)
       VALUES (?, 'owner_change', '주 담당자 변경', ?, ?)`,
      [leadId, `${oldName} → ${newOwner.name}`, actorId]
    );

    // 6. 알림 (fire-and-forget)
    leadNotifier
      .notifyOwnerChange({
        leadId,
        oldOwnerId: lead.assigned_to || null,
        newOwnerId,
        actorName: req.user?.username || '(시스템)',
        senderUserId: actorId,
      })
      .catch(e => console.warn('[leads] notifyOwnerChange err:', e.message));

    res.json({
      success: true,
      data: { assigned_to: newOwnerId, owner_name: newOwner.name, old_owner_name: oldName },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:id/stage', validateId, requireFields(['stage']), async (req, res) => {
  try {
    const { stage } = req.body;
    if (!(await validateStage(stage))) {
      return res.status(400).json({ success: false, error: '존재하지 않는 단계입니다: ' + stage });
    }

    // ── 환율 락 정책: won 전환 = 그날 환율로 고정, 그 외 = live 유지 ──
    let fxUpdate = '';
    const fxParams = [];
    if (stage === 'won') {
      // 현재 lead 정보 가져와서 그날 환율 고정
      const [[curr]] = await pool.query(
        'SELECT expected_amount, currency, fx_lock_policy FROM leads WHERE id=?',
        [req.params.id]
      );
      if (curr && curr.fx_lock_policy !== 'locked') {
        const { krw, rate } = await calcKrw(curr.expected_amount, curr.currency);
        fxUpdate = `, amount_krw=?, fx_rate=?, fx_lock_policy='locked', fx_locked_at=NOW()`;
        fxParams.push(krw, rate);
      }
    } else if (['lost', 'dropped'].includes(stage)) {
      // 실주/드롭은 마지막 환율로 잠금 (참조용 유지)
      const [[curr]] = await pool.query('SELECT fx_lock_policy FROM leads WHERE id=?', [
        req.params.id,
      ]);
      if (curr && curr.fx_lock_policy !== 'locked') {
        fxUpdate = `, fx_lock_policy='locked', fx_locked_at=NOW()`;
      }
    } else {
      // 활성 단계로 되돌아오면 live 로 풀기
      fxUpdate = `, fx_lock_policy='live', fx_locked_at=NULL`;
    }

    // stage_changed_at 함께 업데이트 (컬럼 없으면 ADD 후 재시도)
    const baseSql = `UPDATE leads SET stage = ?, stage_changed_at = NOW()${fxUpdate} WHERE id = ?`;
    try {
      await pool.query(baseSql, [stage, ...fxParams, req.params.id]);
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        await pool.query(
          `ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_changed_at DATETIME NULL DEFAULT NULL`
        );
        await pool.query(baseSql, [stage, ...fxParams, req.params.id]);
      } else throw e;
    }
    const stageNameMap = {
      lead: '리드발굴',
      review: '검토',
      proposal: '제안',
      bidding: '입찰',
      negotiation: '협상',
      won: '수주',
      lost: '실주',
      dropped: '드롭',
    };
    // v6.0.0 Phase 5: performed_by — 실제 요청자 ID 사용
    const stageActorId = req.user?.id || getUserId(req) || null;
    await pool.query(
      `INSERT INTO activities (lead_id, activity_type, title, content, performed_by) VALUES (?,?,?,?,?)`,
      [
        req.params.id,
        stage === 'won' ? '수주' : stage === 'dropped' ? '드롭' : 'stage_change',
        `단계 변경: ${stageNameMap[stage]}`,
        `리드 단계가 ${stageNameMap[stage]}(으)로 변경되었습니다.`,
        stageActorId,
      ]
    );
    // 단계 변경 실시간 알림 브로드캐스트
    const [[lead]] = await pool.query('SELECT customer_name, project_name FROM leads WHERE id=?', [
      req.params.id,
    ]);
    if (lead) {
      const icon =
        stage === 'won' ? '🏆' : stage === 'dropped' ? '❌' : stage === 'negotiation' ? '🤝' : '📋';
      wsBroadcast({
        type: 'stage_change',
        lead_id: Number(req.params.id),
        customer_name: lead.customer_name,
        project_name: lead.project_name,
        stage,
        stage_label: stageNameMap[stage],
        icon,
      });
      // Webhook 발행 — 단계 변경 + (수주일 때 추가 lead.won)
      try {
        const wh = require('../services/webhookDispatcher');
        wh.emit('lead.stage_changed', {
          id: Number(req.params.id),
          customer_name: lead.customer_name,
          project_name: lead.project_name,
          stage,
          stage_label: stageNameMap[stage],
        });
        if (stage === 'won') {
          const [[detail]] = await pool.query(
            'SELECT expected_amount, currency, amount_krw FROM leads WHERE id=?',
            [req.params.id]
          );
          wh.emit('lead.won', {
            id: Number(req.params.id),
            customer_name: lead.customer_name,
            project_name: lead.project_name,
            expected_amount: detail?.expected_amount,
            currency: detail?.currency,
            amount_krw: detail?.amount_krw,
          });
        }
      } catch (_) {
        /* 무시 */
      }
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', validateId, async (req, res) => {
  try {
    // 연결된 캘린더 이벤트의 lead_id를 NULL로 정리 (고아 데이터 방지)
    await pool.query('UPDATE calendar_events SET lead_id = NULL WHERE lead_id = ?', [
      req.params.id,
    ]);
    await pool.query('DELETE FROM leads WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// 시간 기반 진정한 전환율 계산 — funnel 누적 도달 방식 (영업 분석 표준)
//
// 정의:
//   - 단계 i의 "누적 도달 카드" = i 단계 + 그 이후 단계(won 포함) cnt 합
//   - 전환율(i → j) = j의 누적 도달 / i의 누적 도달
//   - 항상 0~100% (i → j 가는 카드는 i를 거쳐야 하므로)
//
// 옵션:
//   - filters: { date_from, date_to, date_field, region, business_type, assigned_to }
//     같은 필터를 페이지/AI 코칭에 적용하여 데이터 일치 보장
// ══════════════════════════════════════════════════════════════
async function calcFunnelConversion(filters = {}) {
  const pipelineStages = require('./pipeline-stages');
  const stages = await pipelineStages.getStagesCached();
  const activeStages = stages
    .filter(s => s.role === 'active')
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const wonKey = stages.find(s => s.role === 'won')?.stage_key;
  const flowKeys = [...activeStages.map(s => s.stage_key)];
  if (wonKey) flowKeys.push(wonKey); // funnel은 won 까지 포함 (목표 도달)

  // WHERE 절 구성 (필터)
  const cond = ['1=1'];
  const params = [];
  if (filters.date_from && filters.date_to) {
    const dateCol =
      filters.date_field === 'created'
        ? 'created_at'
        : filters.date_field === 'close'
          ? 'expected_close_date'
          : filters.date_field === 'updated'
            ? 'updated_at'
            : 'COALESCE(stage_changed_at, updated_at)';
    cond.push(`${dateCol} BETWEEN ? AND ?`);
    params.push(filters.date_from, filters.date_to);
  }
  if (filters.region) {
    cond.push('region = ?');
    params.push(filters.region);
  }
  if (filters.business_type) {
    cond.push('business_type = ?');
    params.push(filters.business_type);
  }
  if (filters.assigned_to) {
    cond.push('assigned_to = ?');
    params.push(filters.assigned_to);
  }
  if (filters.search) {
    cond.push('(customer_name LIKE ? OR project_name LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const where = cond.join(' AND ');

  // 단계별 cnt 조회
  const [rows] = await pool.query(
    `SELECT stage, COUNT(*) AS cnt FROM leads WHERE ${where} GROUP BY stage`,
    params
  );
  const dist = {};
  rows.forEach(r => (dist[r.stage] = Number(r.cnt)));

  // 누적 도달 카드 (i 단계 + 그 이후 단계 합)
  const reached = {};
  for (let i = 0; i < flowKeys.length; i++) {
    let sum = 0;
    for (let j = i; j < flowKeys.length; j++) sum += dist[flowKeys[j]] || 0;
    reached[flowKeys[i]] = sum;
  }

  // 단계 간 전환율 (i → i+1)
  const conversions = {};
  for (let i = 0; i < flowKeys.length - 1; i++) {
    const from = flowKeys[i],
      to = flowKeys[i + 1];
    conversions[from + '__' + to] =
      reached[from] > 0 ? Math.round((reached[to] / reached[from]) * 100) : null;
  }

  return { dist, reached, conversions, flowKeys };
}

// ══════════════════════════════════════════════════════════════
// POST /api/leads/stage-coach
//   파이프라인 단계별 AI 헬스 코칭
//   body: { stage, filters? }
//   반환: { status, headline, going_well[], warnings[], urgent[], next_actions[], stats }
// ══════════════════════════════════════════════════════════════
const { genAI, MODEL_FAST, SAFETY_SETTINGS } = require('../services/gemini');
const { friendlyError } = require('../middleware/errorHandler');

router.post('/stage-coach', async (req, res) => {
  try {
    const { stage, filters = {} } = req.body || {};
    // 동적 검증 (pipeline_stages 기반) — 사용자 정의 단계도 지원
    if (!(await validateStage(stage))) {
      return res.status(400).json({ success: false, error: '존재하지 않는 단계: ' + stage });
    }

    // pipeline_stages에서 label 조회 (사용자가 변경한 한글명 반영)
    const pipelineStages = require('./pipeline-stages');
    const stages = await pipelineStages.getStagesCached();
    const stageInfo = stages.find(s => s.stage_key === stage);
    const stageLabel = stageInfo?.label || STAGE_KO[stage] || stage;

    // ⚠️ 페이지와 동일 모수 사용: filters 적용
    const cardCond = ['stage = ?'];
    const cardParams = [stage];
    if (filters.date_from && filters.date_to) {
      const dateCol =
        filters.date_field === 'created'
          ? 'created_at'
          : filters.date_field === 'close'
            ? 'expected_close_date'
            : filters.date_field === 'updated'
              ? 'updated_at'
              : 'COALESCE(stage_changed_at, updated_at)';
      cardCond.push(`${dateCol} BETWEEN ? AND ?`);
      cardParams.push(filters.date_from, filters.date_to);
    }
    if (filters.region) {
      cardCond.push('region = ?');
      cardParams.push(filters.region);
    }
    if (filters.business_type) {
      cardCond.push('business_type = ?');
      cardParams.push(filters.business_type);
    }
    if (filters.assigned_to) {
      cardCond.push('assigned_to = ?');
      cardParams.push(filters.assigned_to);
    }
    if (filters.search) {
      cardCond.push('(customer_name LIKE ? OR project_name LIKE ?)');
      cardParams.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    // 해당 단계 카드 (필터 적용)
    const [cards] = await pool.query(
      `SELECT id, customer_name, project_name, expected_amount, currency,
              capacity_mw, business_type, region, expected_close_date, bidding_deadline,
              updated_at, created_at,
              DATEDIFF(NOW(), updated_at) AS days_in_stage
       FROM leads
       WHERE ${cardCond.join(' AND ')}
       ORDER BY updated_at ASC`,
      cardParams
    );

    // funnel 누적 도달 + 전환율 계산 (페이지와 동일 데이터)
    const funnel = await calcFunnelConversion(filters);

    // ⚠️ 0건 케이스 — AI 호출 스킵 (환각 방지) + 단계별 맞춤 안내
    if (cards.length === 0) {
      // role 기반 분류 (사용자 정의 stage_key도 지원)
      const role = stageInfo?.role || 'active';
      const isActive = role === 'active';
      const isWon = role === 'won';

      let status, headline, going_well, warnings, urgent, next_actions;
      if (isActive) {
        status = '주의';
        headline = `${stageLabel} 단계에 진행 중인 딜이 없습니다`;
        going_well = ['해당 단계에 정체된 딜이 없어 부담은 없음'];
        warnings = [
          '신규 딜 유입이 없어 파이프라인 흐름이 끊긴 상태',
          `${stageLabel} 단계 활동(미팅·제안 등)이 부족할 가능성`,
        ];
        urgent =
          stage === 'lead'
            ? ['신규 리드 발굴 활동 즉시 시작 필요']
            : [`이전 단계에서 ${stageLabel}로 진행할 딜 검토 필요`];
        next_actions =
          stage === 'lead'
            ? [
                '잠재 고객 리스트 업데이트 및 신규 영업 활동 계획 수립',
                '마케팅 캠페인·외부 이벤트 참여로 리드 유입 확대',
                '기존 고객사에 추가 제안 가능성 탐색',
              ]
            : [
                `이전 단계 진행 딜 중 ${stageLabel} 진입 후보 식별`,
                `${stageLabel} 단계의 평균 소요 시간 점검 및 병목 분석`,
                '영업 담당자별 단계 흐름 리뷰 미팅 진행',
              ];
      } else if (isWon) {
        status = '주의';
        headline = '아직 수주 완료된 딜이 없습니다';
        going_well = ['데이터 없음'];
        warnings = ['수주 사례 부재 — 영업 성과 데이터 부족'];
        urgent = ['협상/계약 단계 딜의 클로징 가속화 필요'];
        next_actions = [
          '협상 단계 딜의 진행 상태 점검 및 클로징 액션 수립',
          '경쟁사 대비 차별화 포인트 강화',
          '영업 사이클 단축을 위한 프로세스 개선 검토',
        ];
      } else {
        status = '정상';
        headline = `${stageLabel} 단계에 해당 딜이 없습니다`;
        going_well = ['실주/드롭 딜 없음 — 양호'];
        warnings = [];
        urgent = [];
        next_actions = ['현재 상태 유지 + 활성 단계에 집중'];
      }

      return res.json({
        success: true,
        data: {
          stage,
          stage_label: stageLabel,
          status,
          headline,
          going_well,
          warnings,
          urgent,
          next_actions,
          stats: { cnt: 0, total_amount: 0, avg_age: 0, stuck7: 0, stuck14: 0 },
          _ai_skipped: true,
        },
      });
    }

    // distMap, funnel 은 위에서 이미 calcFunnelConversion 으로 계산됨

    // 정체 통계
    const stuck14 = cards.filter(c => c.days_in_stage >= 14).length;
    const stuck7 = cards.filter(c => c.days_in_stage >= 7 && c.days_in_stage < 14).length;
    const avgAge = cards.length
      ? Math.round(cards.reduce((s, c) => s + (c.days_in_stage || 0), 0) / cards.length)
      : 0;
    const totalAmount = cards.reduce((s, c) => s + Number(c.expected_amount || 0), 0);

    // 상위 5건 상세 (정체된 것 우선)
    const topCards = cards
      .sort((a, b) => (b.days_in_stage || 0) - (a.days_in_stage || 0))
      .slice(0, 5)
      .map(
        c =>
          `- ${c.customer_name}/${c.project_name} (${c.business_type}, ${c.region}, ${Number(c.expected_amount || 0).toLocaleString()}${c.currency || 'KRW'}, ${c.days_in_stage}일 경과)`
      );

    // ── 단계 흐름 + 시간 기반 전환율 (funnel 누적 도달) ────────
    // flowKeys 는 funnel 에서 가져옴 (won 포함, 사용자 정의 단계 호환)
    const flowKeys = funnel.flowKeys;
    const idx = flowKeys.indexOf(stage);
    const prev = idx > 0 ? flowKeys[idx - 1] : null;
    const next = idx >= 0 && idx < flowKeys.length - 1 ? flowKeys[idx + 1] : null;

    const prevLabel = prev ? stages.find(s => s.stage_key === prev)?.label || prev : null;
    const nextLabel = next ? stages.find(s => s.stage_key === next)?.label || next : null;

    // 누적 도달 카드 수
    const stageReached = funnel.reached[stage] || 0;
    const prevReached = prev ? funnel.reached[prev] || 0 : null;
    const nextReached = next ? funnel.reached[next] || 0 : null;

    // 진정한 전환율 (누적 도달 기반, 항상 0~100%)
    const nextRate =
      next && stageReached > 0 ? Math.round((nextReached / stageReached) * 100) : null;
    const prevRate =
      prev && prevReached > 0 ? Math.round((stageReached / prevReached) * 100) : null;

    // 단계별 cnt (현재 모수 — 화면 표시용)
    const distMap = {};
    Object.keys(funnel.dist).forEach(k => (distMap[k] = { cnt: funnel.dist[k] }));
    const prevCnt = prev ? funnel.dist[prev] || 0 : null;
    const nextCnt = next ? funnel.dist[next] || 0 : null;

    // ══════════════════════════════════════════════════════════════
    // 🔒 사실 기반 진단 (백엔드 100% 신뢰 — AI 환각 차단)
    //    status / headline / going_well / warnings / urgent 는 모두 백엔드가 계산
    //    AI는 next_actions 만 제안 (실행 액션)
    // ══════════════════════════════════════════════════════════════
    const facts = { going_well: [], warnings: [], urgent: [] };

    // 잘 가고 있는 점 (사실 기반)
    if (stuck14 === 0 && stuck7 === 0 && cards.length > 0) {
      facts.going_well.push(`정체 딜 없음 (전체 ${cards.length}건 모두 7일 이내)`);
    }
    if (nextRate !== null && nextRate >= 60) {
      facts.going_well.push(`다음 단계(${nextLabel}) 전환율 ${nextRate}% — 양호`);
    }
    if (avgAge > 0 && avgAge <= 3) {
      facts.going_well.push(`평균 체류 ${avgAge}일 — 빠른 진행`);
    }
    if (cards.length > 0 && totalAmount > 0) {
      const amt =
        totalAmount >= 1e12
          ? `₩${(totalAmount / 1e12).toFixed(2)}조`
          : totalAmount >= 1e8
            ? `₩${(totalAmount / 1e8).toFixed(1)}억`
            : `₩${totalAmount.toLocaleString()}`;
      facts.going_well.push(`누적 ${amt} 규모의 파이프라인 확보`);
    }

    // 주의 사항 (사실 기반)
    if (stuck7 > 0 && stuck14 === 0) {
      facts.warnings.push(`7일 이상 체류 ${stuck7}건 — 진행 상태 점검 필요`);
    }
    if (nextRate !== null && nextRate >= 30 && nextRate < 60) {
      facts.warnings.push(`다음 단계 전환율 ${nextRate}% — 평균 이하 (60% 권장)`);
    }
    if (avgAge >= 7 && avgAge < 14) {
      facts.warnings.push(`평균 체류 ${avgAge}일 — 진행 속도 둔화`);
    }
    if (prevRate !== null && prevRate > 200) {
      facts.warnings.push(`이전 단계(${prevLabel})에서 ${prevRate}% 유입 — 적체 가능성`);
    }

    // 시급 사항 (사실 기반)
    if (stuck14 > 0) {
      facts.urgent.push(`14일 이상 정체 ${stuck14}건 — 즉시 처리 또는 정리 결정 필요`);
    }
    if (nextRate !== null && nextRate < 30) {
      facts.urgent.push(`다음 단계 전환율 ${nextRate}% — 심각한 병목 (30% 미만)`);
    }
    if (avgAge >= 14) {
      facts.urgent.push(`평균 체류 ${avgAge}일 — 단계 흐름 단절 위기`);
    }

    // status 결정 (사실 기반)
    let calculatedStatus;
    if (facts.urgent.length > 0) calculatedStatus = '시급';
    else if (facts.warnings.length > 0) calculatedStatus = '주의';
    else calculatedStatus = '정상';

    // headline 자동 생성
    let calculatedHeadline;
    if (calculatedStatus === '시급') {
      calculatedHeadline =
        stuck14 > 0
          ? `${stageLabel}: 14일+ 정체 ${stuck14}건 즉시 조치 필요`
          : nextRate !== null && nextRate < 30
            ? `${stageLabel}: 다음 단계 전환율 ${nextRate}%로 심각한 병목`
            : `${stageLabel}: 단계 흐름에 심각한 문제 발생`;
    } else if (calculatedStatus === '주의') {
      calculatedHeadline =
        stuck7 > 0
          ? `${stageLabel}: 7일+ 체류 ${stuck7}건 점검 필요`
          : nextRate !== null && nextRate < 60
            ? `${stageLabel}: 다음 단계 전환율 ${nextRate}%로 평균 이하`
            : `${stageLabel}: 일부 지표 점검 필요`;
    } else {
      calculatedHeadline = `${stageLabel}: ${cards.length}건 정상 진행 중`;
    }

    // ── AI는 next_actions 만 생성 (창의적 액션 제안) ────────────
    const contextText = `
[현재 단계] ${stageLabel}: ${cards.length}건 / 금액 ${totalAmount.toLocaleString()}원
${prev ? `[이전 단계] ${prevLabel}: ${prevCnt}건${prevRate !== null ? ` (이전→현재 진입율 ${prevRate}%)` : ''}` : ''}
${next ? `[다음 단계] ${nextLabel}: ${nextCnt}건${nextRate !== null ? ` (현재→다음 전환율 ${nextRate}%)` : ''}` : ''}

[정체 분석]
- 평균 체류: ${avgAge}일
- 7~13일 주의: ${stuck7}건
- 14일+ 정체: ${stuck14}건

[사실 기반 진단 — 이미 결정됨]
- 진단 상태: ${calculatedStatus}
- 진단 요약: ${calculatedHeadline}
- 주의 사항: ${facts.warnings.join(' / ') || '(없음)'}
- 시급 사항: ${facts.urgent.join(' / ') || '(없음)'}

[정체 상위 상세]
${topCards.join('\n') || '(없음)'}`;

    const prompt = `당신은 OCI의 시니어 영업 코치입니다. 위에 제공된 사실 기반 진단을 바탕으로, **이번 주에 실행할 액션 3~5개**를 제안해주세요.

${contextText}

⚠️ 규칙:
- 진단(status/headline/warnings 등)은 이미 백엔드가 결정함. 변경 금지.
- 위 컨텍스트에 없는 통계 수치(예: 114%, 임의의 일수 등)를 절대 만들지 말 것.
- 각 액션은 구체적·실무적이어야 함 (예: "X일까지 Y를 검토", "Z 담당자와 미팅" 등).

다음 JSON 형식으로만 응답하세요 (마크다운 금지, 순수 JSON만):
{
  "next_actions": ["액션 1", "액션 2", "액션 3", ...]
}`;

    let nextActions = [];
    try {
      const model = genAI.getGenerativeModel({
        model: MODEL_FAST,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
          maxOutputTokens: 500,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const r = await model.generateContent(prompt);
      const txt = r.response.text();
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed.next_actions)) nextActions = parsed.next_actions.slice(0, 5);
    } catch (e) {
      console.warn('AI next_actions 생성 실패 (fallback 사용):', e.message);
      // AI 실패 시 fallback 액션
      nextActions = [
        `${stageLabel} 단계 딜 ${cards.length}건의 진행 상태 일괄 점검`,
        stuck14 > 0
          ? `14일+ 정체 ${stuck14}건에 대한 액션 결정 (진행/드롭)`
          : '담당자별 단계 진행 현황 리뷰',
        next ? `다음 단계(${nextLabel}) 진입을 위한 사전 준비 점검` : '단계 정의 및 흐름 재검토',
      ];
    }

    res.json({
      success: true,
      data: {
        stage,
        stage_label: stageLabel,
        status: calculatedStatus,
        headline: calculatedHeadline,
        going_well: facts.going_well,
        warnings: facts.warnings,
        urgent: facts.urgent,
        next_actions: nextActions,
        stats: {
          cnt: cards.length,
          total_amount: totalAmount,
          avg_age: avgAge,
          stuck7,
          stuck14,
          next_rate: nextRate, // 진정한 전환율 (누적 도달 기반)
          prev_rate: prevRate,
          reached: stageReached, // 현재 단계 누적 도달 카드 수
          next_reached: nextReached, // 다음 단계 누적 도달 카드 수
        },
        // 디버깅·검증용 (페이지와 동일 모수 확인)
        _funnel: { dist: funnel.dist, reached: funnel.reached },
      },
    });
  } catch (err) {
    console.error('Stage coach error:', err.message);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ─────────────────
// GET /api/leads/:id/contracts → contracts WHERE lead_id = ?
// 영업리드 상세 모달에서 "🔗 연결된 계약" 섹션 렌더링용
router.get('/:id/contracts', validateId, async (req, res) => {
  try {
    const [[lead]] = await pool.query('SELECT id FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ success: false, error: '리드 없음' });
    const [contracts] = await pool.query(
      `SELECT id, contract_no, title, status, contract_type,
              contract_amount, currency, start_date, end_date,
              customer_name, created_at
         FROM contracts
        WHERE lead_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.params.id]
    );
    res.json({ success: true, data: contracts });
  } catch (err) {
    handleError(res, err);
  }
});

// ── v6.0.0 Phase A: 통합 타임라인용 역방향 조회 ────────────
// GET /api/leads/:id/quotes
router.get('/:id/quotes', validateId, async (req, res) => {
  try {
    const [[lead]] = await pool.query('SELECT id FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ success: false, error: '리드 없음' });
    const [rows] = await pool.query(
      `SELECT id, quote_no, name, customer_name, total_amount, status,
              revision_no, quote_date, created_at
         FROM quotes
        WHERE lead_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/leads/:id/proposals
router.get('/:id/proposals', validateId, async (req, res) => {
  try {
    const [[lead]] = await pool.query('SELECT id FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ success: false, error: '리드 없음' });
    const [rows] = await pool.query(
      `SELECT id, proposal_no, proposal_title, customer_name, status,
              expected_amount, currency, proposal_date, due_date, created_at
         FROM proposals
        WHERE lead_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// =============================================================
// v6.0.0: 영업리드 댓글 (계약 패턴 통일)
// 자가 마이그레이션 — lead_comments 테이블 (idempotent)
// =============================================================
let _commentsTableReady = null;
function _ensureCommentsTable() {
  if (_commentsTableReady) return _commentsTableReady;
  _commentsTableReady = (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lead_comments (
          id           INT AUTO_INCREMENT PRIMARY KEY,
          lead_id      INT NOT NULL,
          user_id      INT NULL,
          parent_id    INT NULL,
          comment_type VARCHAR(20) DEFAULT 'general'
                       COMMENT 'general|coach|question|urgent',
          body         TEXT NOT NULL,
          created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_lead_created (lead_id, created_at),
          CONSTRAINT fk_lc_lead FOREIGN KEY (lead_id)
            REFERENCES leads(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (e) {
      // FK 실패 환경 (테스트 등) 폴백 — FK 없이 생성
      console.warn('[leads:comments] FK 마이그레이션 실패, FK 없이 재시도:', e?.message);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lead_comments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          lead_id INT NOT NULL, user_id INT NULL, parent_id INT NULL,
          comment_type VARCHAR(20) DEFAULT 'general',
          body TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_lead_created (lead_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  })().catch(e => {
    console.error('[leads:comments] 마이그레이션 최종 실패:', e?.message);
    _commentsTableReady = null;
    throw e;
  });
  return _commentsTableReady;
}
// 부팅 시 1회 실행 (best-effort)
_ensureCommentsTable().catch(() => {
  /* startup 실패는 첫 호출 시 재시도 */
});

const ALLOWED_LEAD_COMMENT_TYPES = ['general', 'coach', 'question', 'urgent'];

// GET /api/leads/:id/comments — 댓글 목록 (작성자 이름 join)
router.get('/:id/comments', validateId, async (req, res) => {
  try {
    await _ensureCommentsTable();
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      `SELECT lc.id, lc.parent_id, lc.comment_type, lc.body, lc.created_at,
              lc.user_id, tm.name AS author_name, tm.email AS author_email
         FROM lead_comments lc
         LEFT JOIN team_members tm ON tm.id = lc.user_id
        WHERE lc.lead_id = ?
        ORDER BY lc.created_at ASC`,
      [id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/leads/:id/comments — 댓글 작성
router.post('/:id/comments', validateId, async (req, res) => {
  try {
    await _ensureCommentsTable();
    const id = parseInt(req.params.id, 10);
    const userId = getUserId(req);
    const body = req.body || {};
    const text = String(body.body || '').trim();
    if (!text) return res.status(400).json({ success: false, error: '댓글 내용 필요' });
    const commentType = ALLOWED_LEAD_COMMENT_TYPES.includes(body.comment_type)
      ? body.comment_type
      : 'general';
    const parentId = body.parent_id ? parseInt(body.parent_id, 10) : null;

    const [[lead]] = await pool.query(`SELECT id FROM leads WHERE id = ?`, [id]);
    if (!lead) return res.status(404).json({ success: false, error: '리드를 찾을 수 없음' });

    const [r] = await pool.query(
      `INSERT INTO lead_comments (lead_id, user_id, parent_id, comment_type, body)
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId || null, parentId, commentType, text.slice(0, 5000)]
    );

    // 작성자 정보 조회 (알림용)
    let authorEmail = null;
    let authorName = null;
    if (userId) {
      try {
        const [[u]] = await pool.query(`SELECT name, email FROM team_members WHERE id = ?`, [
          userId,
        ]);
        if (u) {
          authorEmail = u.email;
          authorName = u.name;
        }
      } catch (_) {
        /* skip */
      }
    }

    // 알림 (30초 디바운싱, best-effort)
    try {
      leadNotifier.notifyComment({
        leadId: id,
        commentId: r.insertId,
        authorEmail,
        authorName,
        authorUserId: userId,
        body: text,
      });
    } catch (_) {
      /* skip */
    }

    res.json({
      success: true,
      data: {
        id: r.insertId,
        comment_type: commentType,
        body: text,
        created_at: new Date(),
        user_id: userId || null,
        author_name: authorName,
        author_email: authorEmail,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// =============================================================
// v6.0.0 Phase A: 영업리드 고객지원 항목 (lead_supports)
// 통합 타임라인의 '고객지원' 카테고리 데이터
// =============================================================
let _supportsTableReady = null;
function _ensureSupportsTable() {
  if (_supportsTableReady) return _supportsTableReady;
  _supportsTableReady = (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lead_supports (
          id           INT AUTO_INCREMENT PRIMARY KEY,
          lead_id      INT NOT NULL,
          user_id      INT NULL,
          support_type VARCHAR(20) DEFAULT 'general'
                       COMMENT 'general|inquiry|complaint|followup',
          title        VARCHAR(200) NULL,
          body         TEXT NOT NULL,
          created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_lead_created (lead_id, created_at),
          CONSTRAINT fk_ls_lead FOREIGN KEY (lead_id)
            REFERENCES leads(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (e) {
      console.warn('[leads:supports] FK 마이그레이션 실패, FK 없이 재시도:', e?.message);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lead_supports (
          id INT AUTO_INCREMENT PRIMARY KEY,
          lead_id INT NOT NULL, user_id INT NULL,
          support_type VARCHAR(20) DEFAULT 'general',
          title VARCHAR(200) NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_lead_created (lead_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  })().catch(e => {
    console.error('[leads:supports] 마이그레이션 최종 실패:', e?.message);
    _supportsTableReady = null;
    throw e;
  });
  return _supportsTableReady;
}
_ensureSupportsTable().catch(() => {});

const ALLOWED_SUPPORT_TYPES = ['general', 'inquiry', 'complaint', 'followup'];

// GET /api/leads/:id/supports
router.get('/:id/supports', validateId, async (req, res) => {
  try {
    await _ensureSupportsTable();
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      `SELECT ls.id, ls.support_type, ls.title, ls.body, ls.created_at,
              ls.user_id, tm.name AS author_name
         FROM lead_supports ls
         LEFT JOIN team_members tm ON tm.id = ls.user_id
        WHERE ls.lead_id = ?
        ORDER BY ls.created_at DESC`,
      [id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/leads/:id/supports
router.post('/:id/supports', validateId, async (req, res) => {
  try {
    await _ensureSupportsTable();
    const id = parseInt(req.params.id, 10);
    const userId = getUserId(req);
    const body = req.body || {};
    const text = String(body.body || '').trim();
    if (!text) return res.status(400).json({ success: false, error: '내용 필요' });
    const supportType = ALLOWED_SUPPORT_TYPES.includes(body.support_type)
      ? body.support_type
      : 'general';
    const title = body.title ? String(body.title).slice(0, 200) : null;

    const [[lead]] = await pool.query(`SELECT id FROM leads WHERE id = ?`, [id]);
    if (!lead) return res.status(404).json({ success: false, error: '리드를 찾을 수 없음' });

    const [r] = await pool.query(
      `INSERT INTO lead_supports (lead_id, user_id, support_type, title, body)
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId || null, supportType, title, text.slice(0, 5000)]
    );
    res.json({
      success: true,
      data: {
        id: r.insertId,
        support_type: supportType,
        title,
        body: text,
        created_at: new Date(),
        user_id: userId || null,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
