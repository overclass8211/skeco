const router = require('express').Router();
const fs = require('fs');
const pool = require('../db');
const upload = require('../middleware/upload');
const { handleError, friendlyError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { validateId, schema } = require('../middleware/validate');
const { requireFeature } = require('../middleware/featureGuard');
const { parsePage, pageResult } = require('../utils/routeHelper');
const { fromExcelBuffer } = require('../utils/excelHelper');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');
const {
  MAX_ROWS_PER_REQUEST: BULK_MAX_ROWS,
  sanitizeRow,
  validateRequest: validateBulkRequest,
  buildResponse: buildBulkResponse,
} = require('../utils/bulkPasteHelper');
const {
  genAI,
  MODEL_FAST,
  SAFETY_SETTINGS,
  logTokenUsage,
  runStream,
  sseStart,
  sseError,
} = require('../services/gemini');

// JSON 안전 파싱 (실패 시 fallback)
function safeJson(s, fallback) {
  if (!s) return fallback;
  if (typeof s === 'object') return s;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

const CUST_COLS = [
  { key: 'name', label: '고객사명' },
  { key: 'business_no', label: '사업자번호' },
  { key: 'region', label: '구분' },
  { key: 'country', label: '국가' },
  { key: 'industry', label: '산업군' },
  { key: 'contact_person', label: '담당자' },
  { key: 'phone', label: '연락처' },
  { key: 'email', label: '이메일' },
  { key: 'address', label: '주소' },
];

// v6.0.0: 사업자등록번호 유틸 (검증/정규화/체크섬)
const brnService = require('../services/businessRegistration');

router.get('/', async (req, res) => {
  try {
    const { search, region, industry, autocomplete } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    // ── Autocomplete 모드 (캘린더 자동완성 등) ──────────────
    // - Smart Ranking 적용 (정확/시작/부분 일치 + 활성딜 + 본인담당 + 최근활동)
    // - 응답에 active_deals_count, is_my_customer, last_activity_at 포함
    // - 기존 응답 형식 유지 (success, data) — 추가 필드만 더해짐
    if (autocomplete === '1' && search) {
      const userId = getUserId(req);
      const q = String(search).trim();
      if (q.length < 2) {
        return res.json({ success: true, data: [], query: q });
      }
      const acLimit = Math.min(20, parseInt(req.query.limit) || 10);
      const [rows] = await pool.query(
        `
        SELECT
          c.id, c.name, c.industry, c.region, c.country, c.contact_person,
          c.email, c.phone,
          (SELECT COUNT(*) FROM leads l
             WHERE l.customer_id = c.id
               AND l.stage NOT IN ('won','lost','dropped')) AS active_deals_count,
          (SELECT MAX(a.performed_at) FROM activities a
             JOIN leads l ON l.id = a.lead_id
            WHERE l.customer_id = c.id) AS last_activity_at,
          (SELECT 1 FROM leads l
             WHERE l.customer_id = c.id AND l.assigned_to = ?
             LIMIT 1) AS is_my_customer,
          (
            CASE WHEN c.name = ? THEN 100
                 WHEN c.name LIKE ? THEN 70
                 WHEN c.name LIKE ? THEN 40
                 ELSE 10 END
          ) AS match_score
        FROM customers c
        WHERE c.name LIKE ? OR c.contact_person LIKE ?
        ORDER BY
          match_score DESC,
          is_my_customer DESC,
          active_deals_count DESC,
          last_activity_at DESC,
          c.name ASC
        LIMIT ?
        `,
        [userId || 0, q, `${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, acLimit]
      );
      return res.json({
        success: true,
        data: rows.map(r => ({
          ...r,
          is_my_customer: !!r.is_my_customer,
          active_deals_count: Number(r.active_deals_count) || 0,
        })),
        query: q,
      });
    }

    // ── 기본 목록 조회 (기존 동작 유지) ─────────────────────
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (name LIKE ? OR contact_person LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (region) {
      where += ' AND region = ?';
      params.push(region);
    }
    if (industry) {
      where += ' AND industry = ?';
      params.push(industry);
    }

    // v6.0.0: 카드/리스트에 표시할 모듈별 카운트 4종을 서브쿼리로 enrich
    //   - related_deals_cnt: leads(customer_name = c.name) — 모달 [관련 딜] 탭과 동일
    //   - quotes/proposals/contracts_cnt: customer_id 매칭 + customer_name fallback
    //     (백필 누락 데이터 보호 — customer_id IS NULL 이어도 이름으로 매칭)
    //   leads.customer_name 인덱스 (initTables.js) 로 50개 카드 +30ms 이내
    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM customers ${where}`, params),
      pool.query(
        `SELECT c.*,
          (SELECT COUNT(*) FROM leads l
             WHERE l.customer_name = c.name) AS related_deals_cnt,
          (SELECT COUNT(*) FROM quotes q
             WHERE q.customer_id = c.id
                OR (q.customer_id IS NULL AND q.customer_name = c.name)) AS quotes_cnt,
          (SELECT COUNT(*) FROM proposals p
             WHERE p.customer_id = c.id
                OR (p.customer_id IS NULL AND p.customer_name = c.name)) AS proposals_cnt,
          (SELECT COUNT(*) FROM contracts ct
             WHERE ct.customer_id = c.id
                OR (ct.customer_id IS NULL AND ct.customer_name = c.name)) AS contracts_cnt
         FROM customers c
         ${where.replace(/\b(name|contact_person|region|industry)\b/g, 'c.$1')}
         ORDER BY c.name LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    // 숫자 정규화 (mysql2 driver 반환 시 string 가능성 방지)
    rows.forEach(r => {
      r.related_deals_cnt = Number(r.related_deals_cnt) || 0;
      r.quotes_cnt = Number(r.quotes_cnt) || 0;
      r.proposals_cnt = Number(r.proposals_cnt) || 0;
      r.contracts_cnt = Number(r.contracts_cnt) || 0;
    });
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── 중복 체크 헬퍼 (고객사명 + 담당자 + 연락처 조합) ──────────
async function findDuplicate(name, contact_person, phone) {
  const cp = contact_person || null;
  const ph = phone || null;
  const [[dup]] = await pool.query(
    `SELECT id, name, contact_person, phone, business_no FROM customers
     WHERE name = ? AND (contact_person <=> ?) AND (phone <=> ?)
     LIMIT 1`,
    [name, cp, ph]
  );
  return dup || null;
}

// v6.0.0: 사업자등록번호 매칭 — 정규화 컬럼 기준 (하이픈 무관)
async function findByBRN(brn) {
  const normalized = brnService.normalize(brn);
  if (normalized.length !== 10) return null;
  const [[dup]] = await pool.query(
    `SELECT id, name, business_no, contact_person, phone, region
       FROM customers
      WHERE business_no_normalized = ?
      LIMIT 1`,
    [normalized]
  );
  return dup || null;
}

// ── v6.0.0 Phase A4: 회사명 정규화 + 매칭 헬퍼 ─────────────────
// 한국/영문 법인 접미사 제거 + 공백/특수문자 정규화 → LIKE 매칭 정확도 향상
function normalizeCompanyName(name) {
  if (!name) return '';
  let s = String(name).trim();
  // 한국 법인 접미사 제거: (주), ㈜, 주식회사, (유), 유한회사, (재단), 재단법인 등
  s = s.replace(/[(〔（]\s*(주식회사|유한회사|재단법인|사단법인|주|유)\s*[)〕）]/gi, '');
  s = s.replace(/㈜|㈕|㈐|㉾/g, '');
  s = s.replace(/(주식회사|유한회사|재단법인|사단법인)\s*/gi, '');
  // 영문 접미사 제거: Inc., Co., Ltd., Corp., LLC, GmbH, S.A., etc.
  s = s.replace(
    /\s*[,.]?\s*(Inc\.?|Co\.?|Ltd\.?|Corp\.?|LLC|GmbH|S\.A\.?|Limited|Corporation|Company)\b\.?/gi,
    ''
  );
  // 다중 공백 → 단일 공백, trim
  return s.replace(/\s+/g, ' ').trim();
}

// ── GET /match — AI 추출 회사명 → 기존 고객사 매칭 (Phase A4) ─
// Query: ?name=쿼리
// Response: { exact: [...], partial: [...], normalized_query: "..." }
router.get('/match', async (req, res) => {
  try {
    const raw = String(req.query.name || '').trim();
    if (!raw || raw.length < 2) {
      return res.json({
        success: true,
        data: { exact: [], partial: [], normalized_query: raw, raw_query: raw },
      });
    }
    const normalized = normalizeCompanyName(raw);
    if (!normalized || normalized.length < 1) {
      return res.json({
        success: true,
        data: { exact: [], partial: [], normalized_query: normalized, raw_query: raw },
      });
    }
    const escaped = `%${normalized.replace(/[%_]/g, '\\$&')}%`;

    // 1) 정확 매치 (정규화 후 비교) — 모든 candidates 의 정규화된 이름과 비교는 SQL 만으로 불가
    //    → LIKE 로 후보군을 잡고 JS 에서 정규화 비교
    const [rows] = await pool.query(
      `SELECT id, name, industry, region, country, contact_person, phone, email
         FROM customers
        WHERE name LIKE ?
        ORDER BY CHAR_LENGTH(name) ASC
        LIMIT 50`,
      [escaped]
    );
    const exact = [];
    const partial = [];
    for (const r of rows) {
      const rn = normalizeCompanyName(r.name);
      if (rn.toLowerCase() === normalized.toLowerCase()) {
        exact.push(r);
      } else {
        partial.push(r);
      }
      if (exact.length + partial.length >= 10) break;
    }
    res.json({
      success: true,
      data: {
        exact: exact.slice(0, 3),
        partial: partial.slice(0, 5),
        normalized_query: normalized,
        raw_query: raw,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /match-by-brn — 사업자등록번호 매칭 (v6.0.0) ─────────
// Query: ?business_no=XXX-XX-XXXXX  (또는 하이픈 없는 10자리)
// Response: {
//   success, data: {
//     found: bool, customer?: {...},
//     nameChanged?: bool,        // 이름 다른 동일 BRN
//     newName?: string,          // 사용자가 입력한 새 이름 (전달 시)
//     valid: bool,               // 형식+체크섬 통과
//     normalized: string,
//   }
// }
router.get('/match-by-brn', async (req, res) => {
  try {
    const rawBrn = String(req.query.business_no || '').trim();
    const newName = String(req.query.name || '').trim();
    const normalized = brnService.normalize(rawBrn);
    const valid = brnService.validate(rawBrn);

    if (normalized.length !== 10) {
      return res.json({
        success: true,
        data: { found: false, valid: false, normalized, reason: '10자리 숫자가 아닙니다.' },
      });
    }

    const existing = await findByBRN(rawBrn);
    if (!existing) {
      return res.json({
        success: true,
        data: { found: false, valid, normalized },
      });
    }

    // 동일 BRN 발견 — 이름 비교
    const nameChanged = newName && existing.name && newName.trim() !== existing.name.trim();
    res.json({
      success: true,
      data: {
        found: true,
        valid,
        normalized,
        customer: existing,
        nameChanged: !!nameChanged,
        newName: nameChanged ? newName : undefined,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /:id/accept-name-change — 이름 변경 수락 (v6.0.0) ────
// Body: { newName: string, source?: 'manual'|'bulk_paste'|'ocr' }
router.post('/:id/accept-name-change', validateId, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { newName, source } = req.body || {};
    if (!newName || typeof newName !== 'string' || !newName.trim()) {
      return res.status(400).json({ success: false, message: 'newName 필수' });
    }
    const trimmed = newName.trim().slice(0, 200);

    // 기존 이름 조회
    const [[cur]] = await pool.query(`SELECT id, name FROM customers WHERE id = ?`, [id]);
    if (!cur) {
      return res.status(404).json({ success: false, message: '고객사를 찾을 수 없습니다.' });
    }
    if (cur.name === trimmed) {
      return res.json({ success: true, message: '이름 변경 없음', changed: false });
    }

    const userId = (() => {
      try {
        return getUserId(req) || null;
      } catch (_) {
        return null;
      }
    })();

    // 트랜잭션: history INSERT + customers UPDATE
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO customer_name_history
           (customer_id, old_name, new_name, changed_by, source)
         VALUES (?, ?, ?, ?, ?)`,
        [id, cur.name, trimmed, userId, source || 'manual']
      );
      await conn.query(`UPDATE customers SET name = ? WHERE id = ?`, [trimmed, id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    res.json({
      success: true,
      changed: true,
      data: { id, oldName: cur.name, newName: trimmed },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 일괄 등록 (Copy & Paste import) ──────────────────────────
// ── POST /bulk — 일괄 등록 (v6.0.0 강화: 행 수 제한 + 서버 sanitize) ──
router.post('/bulk', async (req, res) => {
  const { customers } = req.body;
  // 1) 행 수 / 형식 검증
  const reqErr = validateBulkRequest(customers);
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
  for (const rawRow of customers) {
    // 2) 서버 sanitize — 위험 패턴/제어 문자 차단
    let row;
    try {
      row = sanitizeRow(rawRow);
    } catch (e) {
      errors.push({ row: rawRow, reason: e.message || '보안 검증 실패' });
      continue;
    }
    if (!row.name) {
      errors.push({ row, reason: '고객사명 누락' });
      continue;
    }
    try {
      // v6.0.0: 사업자등록번호 정규화 + 검증
      let brnFormatted = null;
      if (row.business_no) {
        const norm = brnService.normalize(row.business_no);
        if (norm.length !== 10) {
          errors.push({ row, reason: '사업자등록번호 형식 오류 (10자리 숫자 아님)' });
          continue;
        }
        if (!brnService.validateChecksum(norm)) {
          errors.push({ row, reason: '사업자등록번호 체크섬 오류' });
          continue;
        }
        brnFormatted = brnService.format(norm);
        // BRN 우선 중복 체크
        const dupByBrn = await findByBRN(norm);
        if (dupByBrn) {
          const nameChanged = (dupByBrn.name || '').trim() !== (row.name || '').trim();
          duplicates.push({
            row,
            existingId: dupByBrn.id,
            reason: nameChanged
              ? `중복 BRN — 이름 변경 추정 (기존: ${dupByBrn.name} → 입력: ${row.name})`
              : `중복 (기존 ID:${dupByBrn.id} — ${dupByBrn.name})`,
            nameChanged,
            existingName: dupByBrn.name,
          });
          continue;
        }
      }

      // BRN 없거나 미매칭 → 기존 name/contact/phone 매칭
      const dup = await findDuplicate(row.name, row.contact_person, row.phone);
      if (dup) {
        duplicates.push({
          row,
          existingId: dup.id,
          reason: `중복 (기존 ID:${dup.id} — ${dup.name} / ${dup.contact_person || '-'} / ${dup.phone || '-'})`,
        });
        continue;
      }
      const [r] = await pool.query(
        `INSERT INTO customers
           (name, region, country, industry, contact_person, phone, email, address, business_no)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          row.name,
          row.region || '국내',
          row.country || null,
          row.industry || null,
          row.contact_person || null,
          row.phone || null,
          row.email || null,
          row.address || null,
          brnFormatted,
        ]
      );
      inserted.push(r.insertId);
    } catch (e) {
      errors.push({ row, reason: e.message });
    }
  }
  res.json(buildBulkResponse({ inserted, duplicates, errors }));
});

router.post(
  '/',
  schema({
    name: { type: 'string', required: true, minLen: 1, maxLen: 200 },
    region: { type: 'string', maxLen: 100 },
  }),
  async (req, res) => {
    try {
      const {
        name,
        region,
        country,
        industry,
        contact_person,
        phone,
        email,
        address,
        business_no,
      } = req.body;

      // v6.0.0: 사업자등록번호 검증 + 정규화
      let brnNormalized = null;
      let brnFormatted = null;
      if (business_no && String(business_no).trim()) {
        brnNormalized = brnService.normalize(business_no);
        if (brnNormalized.length !== 10) {
          return res.status(400).json({
            success: false,
            message: '사업자등록번호는 10자리 숫자여야 합니다.',
            code: 'BRN_FORMAT',
          });
        }
        if (!brnService.validateChecksum(brnNormalized)) {
          return res.status(400).json({
            success: false,
            message: '사업자등록번호 체크섬 오류 — 번호를 다시 확인해주세요.',
            code: 'BRN_CHECKSUM',
          });
        }
        brnFormatted = brnService.format(brnNormalized);

        // BRN 동일 고객 사전 차단 — 단, 이름 변경 케이스는 클라이언트가
        // /accept-name-change 로 처리해야 하므로 여기서는 409 로 안내
        const dupByBrn = await findByBRN(brnNormalized);
        if (dupByBrn) {
          return res.status(409).json({
            success: false,
            duplicate: true,
            duplicateBy: 'business_no',
            existingId: dupByBrn.id,
            existingName: dupByBrn.name,
            nameChanged: dupByBrn.name?.trim() !== String(name || '').trim(),
            message: `동일 사업자등록번호의 고객사가 이미 등록되어 있습니다 (${dupByBrn.name})`,
          });
        }
      }

      // BRN 미입력 시 — 기존 name/contact/phone 기반 중복 체크
      if (!brnNormalized) {
        const dup = await findDuplicate(name, contact_person, phone);
        if (dup) {
          return res.status(409).json({
            success: false,
            duplicate: true,
            duplicateBy: 'name_contact_phone',
            existingId: dup.id,
            message: `이미 등록된 고객사입니다 (${dup.name} / ${dup.contact_person || '담당자 없음'} / ${dup.phone || '연락처 없음'})`,
          });
        }
      }

      const [result] = await pool.query(
        `INSERT INTO customers
           (name, region, country, industry, contact_person, phone, email, address, business_no)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          name,
          region || '국내',
          country || null,
          industry || null,
          contact_person || null,
          phone || null,
          email || null,
          address || null,
          brnFormatted, // 정규화 후 표시 포맷 저장
        ]
      );
      res.json({ success: true, id: result.insertId, data: { id: result.insertId } });
    } catch (err) {
      handleError(res, err);
    }
  }
);

// 명함 OCR — 다중 파일 (최대 20장)
// v6.0.0 Phase 2A fix: multer 에러를 JSON 으로 통일 + 라우트 timeout 5분 override.
// 기존: multer 에러 시 Express 기본 에러 핸들러 → HTML 응답 → 프론트 JSON parse 에러
// 개선: 모든 에러 응답을 JSON 으로 통일 → 프론트가 친화적 메시지 표시 가능
router.post(
  '/ocr',
  requireFeature('ai.ocr'),
  (req, res, next) => {
    // Gemini 20장 순차 처리 시 60s+ 가능 → 라우트별 5분 timeout
    try {
      req.setTimeout(5 * 60 * 1000);
      res.setTimeout(5 * 60 * 1000);
    } catch (_) {
      /* noop */
    }
    upload.array('cards', 20)(req, res, err => {
      if (!err) return next();
      // multer 에러를 JSON 으로 통일 (HTML 응답으로 인한 JSON parse 에러 방지)
      const code = err.code || '';
      let friendly;
      if (code === 'LIMIT_FILE_COUNT') {
        friendly = '한 번에 최대 20장까지만 업로드 가능합니다.';
      } else if (code === 'LIMIT_FILE_SIZE') {
        friendly = '파일 크기가 너무 큽니다 (장당 최대 25MB).';
      } else if (code === 'LIMIT_UNEXPECTED_FILE') {
        friendly = '예상치 못한 파일 필드입니다.';
      } else {
        friendly = `업로드 오류: ${err.message || '알 수 없음'}`;
      }
      return res.status(400).json({ success: false, error: friendly, code });
    });
  },
  async (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
      return res
        .status(400)
        .json({ success: false, error: 'GEMINI_API_KEY가 .env에 설정되지 않았습니다.' });
    }
    if (!req.files || !req.files.length) {
      return res.status(400).json({ success: false, error: '파일이 없습니다.' });
    }

    const ocrModel = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const ocrPrompt = `이 명함 이미지에서 정보를 추출해 JSON으로만 반환하세요. 값이 명확히 보이지 않는 필드는 null로 표기.
JSON 형식: {"name":"회사명","contact_person":"이름","industry":"산업군 추정","phone":"전화번호","email":"이메일","address":"주소","region":"국내|해외","country":"국가명","title":"직책"}`;

    const results = [];
    for (const file of req.files) {
      try {
        const imageData = fs.readFileSync(file.path).toString('base64');
        const mimeType = file.mimetype || 'image/jpeg';
        const result = await ocrModel.generateContent([
          { text: ocrPrompt },
          { inlineData: { mimeType, data: imageData } },
        ]);
        await logTokenUsage('ocr', result.response.usageMetadata, MODEL_FAST, getUserId(req));
        const text = result.response.text();
        let parsed = {};
        try {
          parsed = JSON.parse(text);
        } catch (_) {
          const m = text.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              parsed = JSON.parse(m[0]);
            } catch (__) {
              /* fallback parse failed, use empty object */
            }
          }
        }
        results.push({ filename: file.originalname, raw_text: text, parsed });
      } catch (err) {
        console.error('OCR error:', err.message);
        results.push({ filename: file.originalname, error: friendlyError(err), parsed: {} });
      } finally {
        fs.unlink(file.path, () => {});
      }
    }
    res.json({ success: true, data: results });
  }
);

// 고객사 인텔리전스
router.get('/:id/intelligence', requireFeature('ai.intelligence'), validateId, async (req, res) => {
  let sseStarted = false;
  try {
    const [[customer]] = await pool.query('SELECT * FROM customers WHERE id=?', [req.params.id]);
    if (!customer) return res.status(404).json({ success: false, error: '고객사 없음' });

    const [leads] = await pool.query(
      `SELECT project_name, business_type, stage, expected_amount, currency, created_at, updated_at
       FROM leads WHERE customer_name=? ORDER BY updated_at DESC LIMIT 10`,
      [customer.name]
    );
    const [activities] = await pool.query(
      `SELECT a.activity_type, a.title, a.content, a.performed_at, t.name AS performer
       FROM activities a JOIN leads l ON a.lead_id=l.id
       LEFT JOIN team_members t ON a.performed_by=t.id
       WHERE l.customer_name=? ORDER BY a.performed_at DESC LIMIT 10`,
      [customer.name]
    );

    const stageMap = {
      lead: '리드',
      review: '검토',
      proposal: '제안',
      bidding: '입찰',
      negotiation: '협상',
      won: '수주',
      lost: '실주',
      dropped: '드롭',
    };

    const prompt = `당신은 OCI의 시니어 영업 전략가입니다.
다음 고객사 정보를 바탕으로 최신 동향 분석과 수주 Kill 전략을 작성해주세요.

## 고객사 정보
- 회사명: ${customer.name}
- 지역: ${customer.region} / ${customer.country || ''}
- 산업: ${customer.industry || '미분류'}
- 주요 연락처: ${customer.contact_person || '미등록'} (${customer.phone || ''} / ${customer.email || ''})

## 영업 이력 (${leads.length}건)
${leads.map(l => `- ${l.project_name} | ${l.business_type} | 단계: ${stageMap[l.stage] || l.stage} | 금액: ${l.expected_amount || 0}${l.currency}`).join('\n') || '이력 없음'}

## 최근 활동 (${activities.length}건)
${activities.map(a => `- [${a.activity_type}] ${a.title}: ${(a.content || '').substring(0, 80)} (${a.performer || ''}, ${new Date(a.performed_at).toLocaleDateString('ko-KR')})`).join('\n') || '활동 없음'}

다음 형식으로 작성하세요:

## 📊 고객사 현황 분석
(영업 관계 강도, 주요 관심 분야, 의사결정 구조)

## 🌐 최신 동향 & 시장 환경
(해당 산업/지역 트렌드, 예상 수요, 경쟁사 현황)

## ⚔️ 수주 Kill 전략
### 핵심 공략 포인트 3가지
(각 포인트별 구체적 액션 포함)

### 리스크 관리
(예상 장애물과 대응 방안)

## 🎯 즉시 실행 액션 (이번 주)
1.
2.
3.

한국어로 간결하고 실무적으로 작성하세요.`;

    sseStart(res);
    sseStarted = true;
    await runStream(res, {
      _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    console.error('Customer intelligence error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// ── 고객사 관련 딜(leads) 목록 ───────────────────────────────
// GET /api/customers/:id/deals → customer_name 매칭 leads + 상위 활동
router.get('/:id/deals', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id, name FROM customers WHERE id=?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    const [deals] = await pool.query(
      `SELECT id, project_name, business_type, region, stage,
              capacity_mw, expected_amount, currency,
              expected_close_date, bidding_deadline, updated_at, created_at
       FROM leads WHERE customer_name = ? ORDER BY updated_at DESC`,
      [c.name]
    );
    res.json({ success: true, data: deals });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 동일 회사명 그룹 (같은 name 의 customers 목록) ────────────
// GET /api/customers/:id/group → 같은 회사명을 가진 다른 고객 행들
router.get('/:id/group', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT name FROM customers WHERE id=?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    const [rows] = await pool.query(
      `SELECT id, name, region, country, industry, contact_person, phone, email
       FROM customers WHERE name=? ORDER BY id`,
      [c.name]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 고객사 핵심 브리핑 (간결 요약, 비스트리밍) ─────────────
// POST /api/customers/:id/brief → 핵심 4~6 bullet 요약 JSON
router.post('/:id/brief', validateId, async (req, res) => {
  try {
    const [[customer]] = await pool.query('SELECT * FROM customers WHERE id=?', [req.params.id]);
    if (!customer) return res.status(404).json({ success: false, error: '고객사 없음' });

    const [deals] = await pool.query(
      `SELECT project_name, business_type, stage, expected_amount, currency, updated_at
       FROM leads WHERE customer_name=? ORDER BY updated_at DESC LIMIT 10`,
      [customer.name]
    );
    const [acts] = await pool.query(
      `SELECT a.activity_type, a.title, a.performed_at, t.name AS performer
       FROM activities a JOIN leads l ON a.lead_id=l.id
       LEFT JOIN team_members t ON a.performed_by=t.id
       WHERE l.customer_name=? ORDER BY a.performed_at DESC LIMIT 5`,
      [customer.name]
    );

    const stageMap = {
      lead: '리드',
      review: '검토',
      proposal: '제안',
      bidding: '입찰',
      negotiation: '협상',
      won: '수주',
      lost: '실주',
      dropped: '드롭',
    };
    const totalAmount = deals.reduce((s, d) => s + Number(d.expected_amount || 0), 0);
    const wonCnt = deals.filter(d => d.stage === 'won').length;
    const openCnt = deals.filter(d => !['won', 'lost', 'dropped'].includes(d.stage)).length;

    const prompt = `당신은 OCI 영업팀 보조입니다. 다음 고객사를 매우 간결한 핵심 브리핑으로 정리하세요.

[고객사] ${customer.name} | ${customer.region} ${customer.country || ''} | ${customer.industry || '미분류'}
[담당자] ${customer.contact_person || '미등록'} (${customer.phone || ''})
[딜 ${deals.length}건] 진행 ${openCnt} · 수주 ${wonCnt} · 누적금액 ${totalAmount.toLocaleString()}
[최근 딜] ${
      deals
        .slice(0, 3)
        .map(d => `${d.project_name}(${stageMap[d.stage] || d.stage})`)
        .join(', ') || '없음'
    }
[최근 활동] ${
      acts
        .slice(0, 3)
        .map(a => `${a.activity_type}: ${a.title}`)
        .join(' / ') || '없음'
    }

다음 JSON 형식으로만 응답하세요 (마크다운/설명 없이 JSON만):
{
  "headline": "한 줄 요약 (40자 이내)",
  "key_points": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3", "핵심 포인트 4"],
  "next_action": "이번 주 즉시 실행할 단 한 가지 액션 (30자 이내)",
  "risk": "주의해야 할 리스크 한 줄 (없으면 null)"
}`;

    const model = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 600,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const r = await model.generateContent(prompt);
    const txt = r.response.text();
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch {
      return res
        .status(502)
        .json({ success: false, error: 'AI 응답 파싱 실패', raw: txt.slice(0, 300) });
    }

    const stats = { deals: deals.length, open: openCnt, won: wonCnt, total_amount: totalAmount };
    const userId = getUserId(req);

    // DB 캐시 + 이력 저장
    let savedRow = null;
    try {
      const [r] = await pool.query(
        `INSERT INTO customer_briefs
         (customer_id, headline, key_points, next_action, risk, stats, generated_by)
         VALUES (?,?,?,?,?,?,?)`,
        [
          req.params.id,
          (parsed.headline || '').slice(0, 250),
          JSON.stringify(parsed.key_points || []),
          (parsed.next_action || '').slice(0, 250),
          parsed.risk ? String(parsed.risk).slice(0, 490) : null,
          JSON.stringify(stats),
          userId || null,
        ]
      );
      const [[meta]] = await pool.query(`SELECT generated_at FROM customer_briefs WHERE id=?`, [
        r.insertId,
      ]);
      savedRow = { id: r.insertId, generated_at: meta?.generated_at, generated_by: userId };
    } catch (e) {
      console.warn('Brief 캐시 저장 실패:', e.message); // 저장 실패해도 응답은 유지
    }

    res.json({
      success: true,
      data: {
        ...parsed,
        stats,
        cached: false,
        ...(savedRow || {}),
      },
    });
  } catch (err) {
    console.error('Customer brief error:', err.message);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// ── 고객사 최근 브리핑 캐시 조회 (신규) ──────────────────────
// GET /api/customers/:id/brief → 가장 최근 저장된 브리핑 1건 (없으면 null)
router.get('/:id/brief', validateId, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cb.id, cb.customer_id, cb.headline, cb.key_points, cb.next_action,
              cb.risk, cb.stats, cb.generated_at, cb.generated_by,
              t.name AS generated_by_name
       FROM customer_briefs cb
       LEFT JOIN team_members t ON cb.generated_by = t.id
       WHERE cb.customer_id=? ORDER BY cb.generated_at DESC LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.json({ success: true, data: null });
    const r = rows[0];
    res.json({
      success: true,
      data: {
        id: r.id,
        headline: r.headline,
        key_points: safeJson(r.key_points, []),
        next_action: r.next_action,
        risk: r.risk,
        stats: safeJson(r.stats, {}),
        generated_at: r.generated_at,
        generated_by: r.generated_by,
        generated_by_name: r.generated_by_name,
        cached: true,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 고객사 브리핑 전체 이력 (신규) ───────────────────────────
// GET /api/customers/:id/brief/history → 시간 역순 전체 이력
router.get('/:id/brief/history', validateId, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cb.id, cb.headline, cb.next_action, cb.risk, cb.stats,
              cb.generated_at, cb.generated_by, t.name AS generated_by_name
       FROM customer_briefs cb
       LEFT JOIN team_members t ON cb.generated_by = t.id
       WHERE cb.customer_id=? ORDER BY cb.generated_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id,
        headline: r.headline,
        next_action: r.next_action,
        risk: r.risk,
        stats: safeJson(r.stats, {}),
        generated_at: r.generated_at,
        generated_by_name: r.generated_by_name,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 고객사 수정 ──────────────────────────────────────────────
router.put('/:id', validateId, async (req, res) => {
  try {
    const {
      name,
      region,
      country,
      industry,
      contact_person,
      phone,
      email,
      address,
      notes,
      business_no,
    } = req.body;
    const fields = [];
    const vals = [];
    if (name !== undefined) {
      fields.push('name=?');
      vals.push(name);
    }
    if (region !== undefined) {
      fields.push('region=?');
      vals.push(region);
    }
    if (country !== undefined) {
      fields.push('country=?');
      vals.push(country);
    }
    if (industry !== undefined) {
      fields.push('industry=?');
      vals.push(industry);
    }
    if (contact_person !== undefined) {
      fields.push('contact_person=?');
      vals.push(contact_person);
    }
    if (phone !== undefined) {
      fields.push('phone=?');
      vals.push(phone);
    }
    if (email !== undefined) {
      fields.push('email=?');
      vals.push(email);
    }
    if (address !== undefined) {
      fields.push('address=?');
      vals.push(address);
    }
    if (notes !== undefined) {
      fields.push('notes=?');
      vals.push(notes);
    }
    // v6.0.0: 사업자등록번호 — 검증 후 정규화 포맷으로 저장
    if (business_no !== undefined) {
      const v = business_no === null || business_no === '' ? null : String(business_no).trim();
      if (v) {
        const normalized = brnService.normalize(v);
        if (normalized.length !== 10) {
          return res.status(400).json({
            success: false,
            message: '사업자등록번호는 10자리 숫자여야 합니다.',
            code: 'BRN_FORMAT',
          });
        }
        if (!brnService.validateChecksum(normalized)) {
          return res.status(400).json({
            success: false,
            message: '사업자등록번호 체크섬 오류 — 번호를 다시 확인해주세요.',
            code: 'BRN_CHECKSUM',
          });
        }
        // 다른 customer 에 이미 등록된 BRN 인지 확인
        const dup = await findByBRN(normalized);
        if (dup && Number(dup.id) !== Number(req.params.id)) {
          return res.status(409).json({
            success: false,
            duplicate: true,
            duplicateBy: 'business_no',
            existingId: dup.id,
            message: `다른 고객사 (${dup.name}) 가 동일 사업자등록번호를 사용 중입니다.`,
          });
        }
        fields.push('business_no=?');
        vals.push(brnService.format(normalized));
      } else {
        fields.push('business_no=?');
        vals.push(null);
      }
    }
    if (!fields.length)
      return res.status(400).json({ success: false, error: '수정할 항목이 없습니다.' });
    vals.push(req.params.id);
    await pool.query(`UPDATE customers SET ${fields.join(',')} WHERE id=?`, vals);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 고객사 삭제 ──────────────────────────────────────────────
router.delete('/:id', validateId, async (req, res) => {
  try {
    await pool.query('DELETE FROM customers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 엑셀 내보내기 ────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { search, region, industry } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (name LIKE ? OR contact_person LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (region) {
      where += ' AND region = ?';
      params.push(region);
    }
    if (industry) {
      where += ' AND industry = ?';
      params.push(industry);
    }
    const [rows] = await pool.query(`SELECT * FROM customers ${where} ORDER BY name`, params);
    await sendExport(res, {
      columns: CUST_COLS,
      rows,
      sheetName: '고객사',
      filename: '고객사_' + new Date().toISOString().slice(0, 10),
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

    const inserted = [];
    const errors = [];
    const duplicates = [];
    for (const row of rows) {
      const name = String(row['고객사명'] || row['name'] || '').trim();
      if (!name) {
        errors.push({ row, reason: '고객사명 누락' });
        continue;
      }
      try {
        const contactPerson = String(row['담당자'] || row['contact_person'] || '').trim() || null;
        const phone = String(row['연락처'] || row['phone'] || '').trim() || null;
        const dup = await findDuplicate(name, contactPerson, phone);
        if (dup) {
          duplicates.push({
            row,
            existingId: dup.id,
            reason: `중복 (기존 ID:${dup.id} — ${dup.name})`,
          });
          continue;
        }
        const [r] = await pool.query(
          `INSERT INTO customers (name, region, country, industry, contact_person, phone, email, address)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            name,
            String(row['구분'] || row['region'] || '국내').trim(),
            String(row['국가'] || row['country'] || '').trim() || null,
            String(row['산업군'] || row['industry'] || '').trim() || null,
            contactPerson,
            phone,
            String(row['이메일'] || row['email'] || '').trim() || null,
            String(row['주소'] || row['address'] || '').trim() || null,
          ]
        );
        inserted.push(r.insertId);
      } catch (e) {
        errors.push({ row, reason: e.message });
      }
    }
    res.json({
      success: true,
      inserted: inserted.length,
      duplicates: duplicates.length,
      errors: [...errors, ...duplicates],
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ─────────────────
// GET /api/customers/:id/contracts → contracts WHERE customer_id = ?
// 고객사 상세 모달에서 "🔗 연결된 계약" 섹션 렌더링용
router.get('/:id/contracts', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id, name FROM customers WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    // v6.0.0: customer_id 매칭 + customer_name fallback (백필 누락 데이터 보호)
    const [contracts] = await pool.query(
      `SELECT id, contract_no, title, status, contract_type,
              contract_amount, currency, start_date, end_date,
              customer_name, created_at
         FROM contracts
        WHERE customer_id = ?
           OR (customer_id IS NULL AND customer_name = ?)
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.params.id, c.name]
    );
    res.json({ success: true, data: contracts });
  } catch (err) {
    handleError(res, err);
  }
});

// v6.0.0: GET /api/customers/dashboard → 상단 KPI 카드용 집계
// (전체 / 활성 / 신규 30일 / 휴면 90일+)
router.get('/dashboard', async (req, res) => {
  try {
    const [[row]] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS new_30d,
        SUM(CASE WHEN id IN (
          SELECT DISTINCT customer_id FROM leads
           WHERE customer_id IS NOT NULL AND updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        ) THEN 1 ELSE 0 END) AS active_30d,
        SUM(CASE WHEN id NOT IN (
          SELECT DISTINCT customer_id FROM leads
           WHERE customer_id IS NOT NULL AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        ) THEN 1 ELSE 0 END) AS dormant_90d
      FROM customers
    `);
    res.json({
      success: true,
      data: {
        total: Number(row.total) || 0,
        active_30d: Number(row.active_30d) || 0,
        new_30d: Number(row.new_30d) || 0,
        dormant_90d: Number(row.dormant_90d) || 0,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// v6.0.0: GET /api/customers/:id/quotes → quotes WHERE customer_id = ?
// 고객사 모달 [💰 견적] 탭 렌더링용
router.get('/:id/quotes', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id, name FROM customers WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    // 참고: quotes 테이블에는 currency 컬럼이 없음 → 프론트에서 'KRW' fallback
    // v6.0.0: customer_id 매칭 + customer_name fallback (백필 누락 데이터 보호)
    const [quotes] = await pool.query(
      `SELECT id, quote_no, name, status, customer_name,
              total_amount, quote_date,
              revision_no, created_at, updated_at
         FROM quotes
        WHERE customer_id = ?
           OR (customer_id IS NULL AND customer_name = ?)
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.params.id, c.name]
    );
    res.json({ success: true, data: quotes });
  } catch (err) {
    handleError(res, err);
  }
});

// v6.0.0: GET /api/customers/:id/proposals → proposals WHERE customer_id = ?
// 고객사 모달 [📝 제안] 탭 렌더링용
router.get('/:id/proposals', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id, name FROM customers WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    // v6.0.0: customer_id 매칭 + customer_name fallback (백필 누락 데이터 보호)
    const [proposals] = await pool.query(
      `SELECT id, proposal_no, proposal_title, status, customer_name,
              expected_amount, currency, proposal_date, due_date,
              owner_name, created_at, updated_at
         FROM proposals
        WHERE customer_id = ?
           OR (customer_id IS NULL AND customer_name = ?)
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.params.id, c.name]
    );
    res.json({ success: true, data: proposals });
  } catch (err) {
    handleError(res, err);
  }
});

// 모듈 간 연동: GET /api/customers/:id/payments → payment_schedules WHERE customer_id = ?
// 고객사 모달 [💳 수금] 탭 렌더링용 (customer_id 매칭 + customer_name fallback)
router.get('/:id/payments', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id, name FROM customers WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    const [rows] = await pool.query(
      `SELECT id, contract_id, contract_name, stage_name, ratio,
              scheduled_amount, supply_amount, tax_amount, currency,
              due_date, invoice_date, status, customer_name, created_at
         FROM payment_schedules
        WHERE customer_id = ?
           OR (customer_id IS NULL AND customer_name = ?)
        ORDER BY due_date ASC, id ASC
        LIMIT 200`,
      [req.params.id, c.name]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
