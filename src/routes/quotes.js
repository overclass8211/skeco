'use strict';
// =============================================================
// /api/quotes — 견적서 관리 (Phase 1 — MVP)
//
// 기능:
//   - 견적서 CRUD (헤더 + 품목 1:N)
//   - 자동채번 (Q-YYYY-NNNN, 연도별 시퀀스, 트랜잭션 보호)
//   - 합계 자동 계산 (소계 / VAT / 총계)
//   - 권한 스코프: manager 는 본인이 작성한 견적만
//
// 권한: team_lead+ (autoLevel 미들웨어 자동 적용)
// 기능 플래그: crm.quotes
//
// 엔드포인트:
//   GET    /              — 목록 (간단 필드만, 페이징)
//   GET    /:id           — 단건 (헤더 + 품목 포함)
//   POST   /              — 신규 (자동채번 또는 수동 quote_no)
//   PUT    /:id           — 수정 (헤더 + 품목 일괄 교체)
//   DELETE /:id           — 삭제 (CASCADE 로 품목 자동 삭제)
//   POST   /:id/duplicate — 리비전 복사 (Phase 4 미리 준비)
// =============================================================

const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { parsePage, pageResult } = require('../utils/routeHelper');
const readReceipts = require('../services/readReceipts');

router.use(requireFeature('crm.quotes'));

// ── 자가 마이그레이션 (idempotent) ────────────────────────────
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        quote_no        VARCHAR(20) UNIQUE NOT NULL,
        name            VARCHAR(200) NOT NULL,
        lead_id         INT NULL,
        customer_id     INT NULL,
        customer_name   VARCHAR(200) NOT NULL,
        quote_date      DATE NOT NULL,
        vat_included    TINYINT(1) DEFAULT 0,
        column_labels   JSON NULL,
        subtotal        DECIMAL(15,2) DEFAULT 0,
        vat_amount      DECIMAL(15,2) DEFAULT 0,
        total_amount    DECIMAL(15,2) DEFAULT 0,
        created_by      INT NULL,
        parent_quote_id INT NULL,
        revision_no     INT DEFAULT 1,
        status          VARCHAR(20) DEFAULT 'draft',
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_quote_no       (quote_no),
        INDEX idx_created_by     (created_by),
        INDEX idx_quote_date     (quote_date),
        INDEX idx_lead_id        (lead_id),
        INDEX idx_parent         (parent_quote_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quote_items (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        quote_id        INT NOT NULL,
        display_order   INT DEFAULT 0,
        item_name       VARCHAR(300) NOT NULL,
        spec            VARCHAR(100) NULL,
        unit_price      DECIMAL(15,2) DEFAULT 0,
        discount_pct    DECIMAL(5,2)  DEFAULT 0,
        supply_price    DECIMAL(15,2) DEFAULT 0,
        quantity        DECIMAL(12,2) DEFAULT 1,
        proposed_amount DECIMAL(15,2) DEFAULT 0,
        remark          TEXT NULL,
        INDEX idx_quote_order (quote_id, display_order),
        CONSTRAINT fk_item_quote FOREIGN KEY (quote_id)
          REFERENCES quotes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (_e) {
    // 외래키 실패 시 fallback — 일반 컬럼만
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS quote_items (
          id              INT AUTO_INCREMENT PRIMARY KEY,
          quote_id        INT NOT NULL,
          display_order   INT DEFAULT 0,
          item_name       VARCHAR(300) NOT NULL,
          spec            VARCHAR(100) NULL,
          unit_price      DECIMAL(15,2) DEFAULT 0,
          discount_pct    DECIMAL(5,2)  DEFAULT 0,
          supply_price    DECIMAL(15,2) DEFAULT 0,
          quantity        DECIMAL(12,2) DEFAULT 1,
          proposed_amount DECIMAL(15,2) DEFAULT 0,
          remark          TEXT NULL,
          INDEX idx_quote_order (quote_id, display_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      /* 이미 존재 */
    }
  }

  // ── PDF 개선용 컬럼 추가 (Phase 4 보강) — ALTER 멱등 처리 ──
  // ER_DUP_FIELDNAME 무시하고 진행. MariaDB 10.0+ 는 ADD COLUMN IF NOT EXISTS 지원
  // 호환성 위해 try/catch 로 처리 (이전 버전 안전)
  const extraColumns = [
    { name: 'supplier_company_name', def: 'VARCHAR(200) NULL' },
    { name: 'supplier_address', def: 'VARCHAR(500) NULL' },
    { name: 'supplier_business_no', def: 'VARCHAR(50) NULL' }, // Bug 1: 사업자등록번호
    { name: 'supplier_ceo', def: 'VARCHAR(100) NULL' },
    { name: 'sales_rep_name', def: 'VARCHAR(100) NULL' },
    { name: 'sales_rep_contact', def: 'VARCHAR(200) NULL' },
    { name: 'sales_rep_email', def: 'VARCHAR(200) NULL' }, // Bug 1: 영업담당자 이메일
    { name: 'customer_contact', def: 'VARCHAR(100) NULL' },
    { name: 'terms_conditions', def: 'TEXT NULL' },
  ];
  for (const col of extraColumns) {
    try {
      await pool.query(`ALTER TABLE quotes ADD COLUMN ${col.name} ${col.def}`);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') {
        // 이미 존재 외 다른 에러는 로그만 — 부팅 막지 않음
        console.warn(`[quotes:migration] ALTER ADD ${col.name}:`, e.code || e.message);
      }
    }
  }
}
const _migrationPromise = ensureSchema();

// 첫 요청 안전성 — 마이그레이션 promise await
router.use(async (req, res, next) => {
  try {
    await _migrationPromise;
    next();
  } catch (err) {
    next(err);
  }
});

// ── 자동채번 헬퍼 ───────────────────────────────────────────
// 연도별 시퀀스 — Q-YYYY-NNNN (4자리 패딩)
// 동시성: 같은 트랜잭션 안에서 SELECT MAX + INSERT (race 가능성 최소)
async function generateQuoteNo(conn, year) {
  const yyyy = year || new Date().getFullYear();
  const prefix = `Q-${yyyy}-`;
  const [[row]] = await conn.query(
    `SELECT quote_no FROM quotes
      WHERE quote_no LIKE ?
      ORDER BY quote_no DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let next = 1;
  if (row && row.quote_no) {
    const m = row.quote_no.match(/Q-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

// ── 합계 계산 ───────────────────────────────────────────────
// 공급단가  = unit_price × (1 - discount_pct/100)  ← 할인 적용된 단가
//            (할인율 0% 인 경우 unit_price 와 동일)
// 제안금액  = supply_price × quantity              ← 공급단가 × 수량
function calcSupplyPrice(item) {
  const unit = Number(item.unit_price) || 0;
  const disc = Math.max(0, Math.min(100, Number(item.discount_pct) || 0));
  return Number((unit * (1 - disc / 100)).toFixed(2));
}
function calcItemAmount(item) {
  const supply = calcSupplyPrice(item);
  const qty = Number(item.quantity) || 0;
  return Number((supply * qty).toFixed(2));
}
// vat_included 의 의미 (사용자 정의 비즈니스 규칙):
//   1 = "부가세 포함" → 총합계에 부가세 10% 가산 (사용자가 명시한 의미)
//   0 = "부가세 미포함" → 가산 없음 (소계 = 총합계)
function calcTotals(items, vatIncluded) {
  const subtotal = items.reduce((s, it) => s + calcItemAmount(it), 0);
  const vat = vatIncluded ? Number((subtotal * 0.1).toFixed(2)) : 0;
  const total = Number((subtotal + vat).toFixed(2));
  return { subtotal: Number(subtotal.toFixed(2)), vat_amount: vat, total_amount: total };
}

// ── GET / — 목록 (페이징) ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { search, status, autocomplete } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    // v6.0.0 Step 2: Autocomplete 모드 (계약 모달의 견적 Combobox 용)
    if (autocomplete === '1' && search) {
      const q = String(search).trim();
      if (q.length < 2) return res.json({ success: true, data: [], query: q });
      const acLimit = Math.min(20, parseInt(req.query.limit) || 10);
      const [rows] = await pool.query(
        `SELECT id, quote_no, name, customer_id, customer_name, lead_id,
                total_amount, status
           FROM quotes
          WHERE (quote_no LIKE ? OR name LIKE ? OR customer_name LIKE ?)
          ORDER BY updated_at DESC
          LIMIT ?`,
        [`%${q}%`, `%${q}%`, `%${q}%`, acLimit]
      );
      return res.json({ success: true, data: rows, query: q });
    }

    // manager 스코프 — 본인 작성 견적만 보임 (간소화: role 체크는 추후 추가)
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (q.name LIKE ? OR q.customer_name LIKE ? OR q.quote_no LIKE ?)';
      const k = `%${search}%`;
      params.push(k, k, k);
    }
    if (status) {
      where += ' AND q.status = ?';
      params.push(status);
    }
    void userId; // manager 스코프는 Phase 2 에서 강화 (현재는 team_lead+ 만 접근)

    const [[countRow], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM quotes q ${where}`, params),
      pool.query(
        `SELECT q.id, q.quote_no, q.name, q.customer_name, q.quote_date,
                q.vat_included, q.total_amount, q.status,
                q.parent_quote_id, q.revision_no, q.created_at, q.updated_at,
                tm.name AS created_by_name
           FROM quotes q
           LEFT JOIN team_members tm ON tm.id = q.created_by
           ${where}
          ORDER BY q.created_at DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRow[0]?.total ?? 0);
    // v6.0.0: 읽음 상태 enrich
    await readReceipts.enrichListWithReadStatus(getUserId(req), 'quote', rows);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /next-quote-no — 다음 자동 채번 미리보기 (Phase 5-C) ──
// ⚠️ 반드시 /:id 보다 먼저 선언 — Express 라우트 매칭 순서
// v6.0.0: GET /api/quotes/dashboard — 상단 KPI 카드 (5개 모듈 통일)
// 초안 / 발송 / 수주 / 전체 합계
router.get('/dashboard', async (req, res) => {
  try {
    const [[row]] = await pool.query(`
      SELECT
        SUM(CASE WHEN status = 'draft'    THEN 1 ELSE 0 END) AS draft,
        SUM(CASE WHEN status = 'sent'     THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
        COALESCE(SUM(total_amount), 0)                       AS total_amount_sum
      FROM quotes
    `);
    res.json({
      success: true,
      data: {
        draft: Number(row.draft) || 0,
        sent: Number(row.sent) || 0,
        accepted: Number(row.accepted) || 0,
        total_amount_sum: Number(row.total_amount_sum) || 0,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/next-quote-no', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const conn = await pool.getConnection();
    try {
      const next = await generateQuoteNo(conn, year);
      res.json({ success: true, data: { quote_no: next, year } });
    } finally {
      conn.release();
    }
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /:id — 단건 + 품목 ──────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    // v6.0.0: 모달 오픈 = 읽음 처리 (best-effort)
    readReceipts.markRead(getUserId(req), 'quote', id).catch(() => {});

    const [[quote]] = await pool.query(
      `SELECT q.*, tm.name AS created_by_name
         FROM quotes q
         LEFT JOIN team_members tm ON tm.id = q.created_by
        WHERE q.id = ?`,
      [id]
    );
    if (!quote) return res.status(404).json({ success: false, error: '견적서를 찾을 수 없음' });

    const [items] = await pool.query(
      `SELECT * FROM quote_items WHERE quote_id = ? ORDER BY display_order ASC, id ASC`,
      [id]
    );
    // column_labels JSON 파싱
    if (quote.column_labels && typeof quote.column_labels === 'string') {
      try {
        quote.column_labels = JSON.parse(quote.column_labels);
      } catch (_) {
        quote.column_labels = null;
      }
    }
    res.json({ success: true, data: { ...quote, items } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST / — 신규 견적 (자동채번 또는 수동) ─────────────────
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const userId = getUserId(req);
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '견적명이 필요합니다' });
    }
    if (!body.quote_date) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '견적일이 필요합니다' });
    }

    // v6.0.0: 데이터 정합성 — lead_id 만 지정된 경우 lead.customer_id/customer_name 자동 도출
    // (고객사 카드 [💰 견적] 탭에서 보이려면 customer_id 가 필수)
    // ⚠️ customer_name 검증보다 **먼저** 실행되어야 자동 채움이 동작함
    if (body.lead_id && (!body.customer_id || !body.customer_name)) {
      const [[ld]] = await conn.query(
        `SELECT customer_id, customer_name FROM leads WHERE id = ? LIMIT 1`,
        [body.lead_id]
      );
      if (ld) {
        if (!body.customer_id && ld.customer_id) body.customer_id = ld.customer_id;
        if (!body.customer_name && ld.customer_name) body.customer_name = ld.customer_name;
      }
    }

    // 자동 채움 이후 검증 — 자동 도출도 실패하면 사용자가 누락
    if (!body.customer_name || !String(body.customer_name).trim()) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        error: '고객명이 필요합니다 (영업리드에서도 도출 불가)',
      });
    }

    // 자동채번 또는 수동 입력 — 수동 시 UNIQUE 충돌 가능
    const year = new Date(body.quote_date).getFullYear() || new Date().getFullYear();
    let quoteNo = body.quote_no && String(body.quote_no).trim();
    if (!quoteNo) {
      quoteNo = await generateQuoteNo(conn, year);
    }

    const items = Array.isArray(body.items) ? body.items : [];
    // 각 품목의 proposed_amount 자동 계산
    items.forEach((it, idx) => {
      it.supply_price = calcSupplyPrice(it); // 자동 계산 — 사용자 입력 무시
      it.proposed_amount = calcItemAmount(it);
      it.display_order = idx;
    });
    const totals = calcTotals(items, !!body.vat_included);

    const [result] = await conn.query(
      `INSERT INTO quotes
        (quote_no, name, lead_id, customer_id, customer_name, quote_date,
         vat_included, column_labels, subtotal, vat_amount, total_amount,
         created_by, parent_quote_id, revision_no, status,
         supplier_company_name, supplier_address, supplier_business_no, supplier_ceo,
         sales_rep_name, sales_rep_contact, sales_rep_email,
         customer_contact, terms_conditions)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        quoteNo,
        String(body.name).slice(0, 200),
        body.lead_id || null,
        body.customer_id || null,
        String(body.customer_name).slice(0, 200),
        body.quote_date,
        body.vat_included ? 1 : 0,
        body.column_labels ? JSON.stringify(body.column_labels) : null,
        totals.subtotal,
        totals.vat_amount,
        totals.total_amount,
        userId || null,
        body.parent_quote_id || null,
        Number(body.revision_no) || 1,
        body.status || 'draft',
        body.supplier_company_name ? String(body.supplier_company_name).slice(0, 200) : null,
        body.supplier_address ? String(body.supplier_address).slice(0, 500) : null,
        body.supplier_business_no ? String(body.supplier_business_no).slice(0, 50) : null,
        body.supplier_ceo ? String(body.supplier_ceo).slice(0, 100) : null,
        body.sales_rep_name ? String(body.sales_rep_name).slice(0, 100) : null,
        body.sales_rep_contact ? String(body.sales_rep_contact).slice(0, 200) : null,
        body.sales_rep_email ? String(body.sales_rep_email).slice(0, 200) : null,
        body.customer_contact ? String(body.customer_contact).slice(0, 100) : null,
        body.terms_conditions ? String(body.terms_conditions) : null,
      ]
    );
    const quoteId = result.insertId;

    // 품목 일괄 INSERT
    for (const it of items) {
      await conn.query(
        `INSERT INTO quote_items
          (quote_id, display_order, item_name, spec, unit_price, discount_pct,
           supply_price, quantity, proposed_amount, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          quoteId,
          it.display_order,
          String(it.item_name || '').slice(0, 300),
          it.spec ? String(it.spec).slice(0, 100) : null,
          Number(it.unit_price) || 0,
          Number(it.discount_pct) || 0,
          Number(it.supply_price) || 0,
          Number(it.quantity) || 0,
          it.proposed_amount,
          it.remark || null,
        ]
      );
    }
    // v6.0.0 Phase 5: lead_id 있으면 타임라인에 견적 기록 (best-effort — proposals.js 패턴 동일)
    if (body.lead_id) {
      try {
        const grandTotal = totals.grand_total ?? totals.supply_total ?? 0;
        await conn.query(
          `INSERT INTO activities (lead_id, activity_type, title, content, performed_by)
           VALUES (?, '견적', ?, ?, ?)`,
          [
            body.lead_id,
            `견적 생성: ${quoteNo}`,
            `견적명: ${body.name || ''}, 합계: ${Number(grandTotal).toLocaleString()}원`,
            userId || null,
          ]
        );
      } catch (_) {
        /* activities 스키마 차이 — 무시 */
      }
    }
    await conn.commit();
    res.json({ success: true, id: quoteId, data: { id: quoteId, quote_no: quoteNo, ...totals } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: '견적번호가 이미 존재합니다' });
    }
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── PUT /:id — 수정 (헤더 + 품목 일괄 교체) ─────────────────
router.put('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const body = req.body || {};

    // v6.0.0: 데이터 정합성 — lead_id 가 (변경되어) 들어왔는데 customer_id 가 비어있으면 자동 도출
    if (body.lead_id && body.customer_id === undefined) {
      const [[ld]] = await conn.query(
        `SELECT customer_id, customer_name FROM leads WHERE id = ? LIMIT 1`,
        [body.lead_id]
      );
      if (ld) {
        body.customer_id = ld.customer_id || null;
        if (body.customer_name === undefined && ld.customer_name) {
          body.customer_name = ld.customer_name;
        }
      }
    }

    const items = Array.isArray(body.items) ? body.items : [];
    items.forEach((it, idx) => {
      it.supply_price = calcSupplyPrice(it); // 자동 계산 — 사용자 입력 무시
      it.proposed_amount = calcItemAmount(it);
      it.display_order = idx;
    });
    const totals = calcTotals(items, !!body.vat_included);

    const fields = [];
    const values = [];
    const allowed = [
      'name',
      'lead_id',
      'customer_id',
      'customer_name',
      'quote_date',
      'vat_included',
      'column_labels',
      'status',
      // Phase 4 PDF 개선 — 공급사/고객사/조건사항
      'supplier_company_name',
      'supplier_address',
      'supplier_business_no', // Bug 1: 사업자등록번호
      'supplier_ceo',
      'sales_rep_name',
      'sales_rep_contact',
      'sales_rep_email', // Bug 1: 영업담당자 이메일
      'customer_contact',
      'terms_conditions',
    ];
    for (const f of allowed) {
      if (body[f] === undefined) continue;
      fields.push(`${f} = ?`);
      values.push(
        f === 'vat_included'
          ? body[f]
            ? 1
            : 0
          : f === 'column_labels'
            ? body[f]
              ? JSON.stringify(body[f])
              : null
            : body[f]
      );
    }
    // 합계 항상 갱신
    fields.push('subtotal = ?', 'vat_amount = ?', 'total_amount = ?');
    values.push(totals.subtotal, totals.vat_amount, totals.total_amount);
    values.push(id);

    if (fields.length > 0) {
      await conn.query(`UPDATE quotes SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    // 품목 — 모두 삭제 후 재삽입 (간단, 동시성 안전)
    await conn.query(`DELETE FROM quote_items WHERE quote_id = ?`, [id]);
    for (const it of items) {
      await conn.query(
        `INSERT INTO quote_items
          (quote_id, display_order, item_name, spec, unit_price, discount_pct,
           supply_price, quantity, proposed_amount, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          it.display_order,
          String(it.item_name || '').slice(0, 300),
          it.spec ? String(it.spec).slice(0, 100) : null,
          Number(it.unit_price) || 0,
          Number(it.discount_pct) || 0,
          Number(it.supply_price) || 0,
          Number(it.quantity) || 0,
          it.proposed_amount,
          it.remark || null,
        ]
      );
    }
    await conn.commit();
    res.json({ success: true, data: totals });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: '견적번호가 이미 존재합니다' });
    }
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── DELETE /:id ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [result] = await pool.query(`DELETE FROM quotes WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '견적서를 찾을 수 없음' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /:id/revisions — 같은 그룹의 리비전 트리 (Phase 5-A) ──
// parent_quote_id 가 같거나, id 자체가 parent 인 견적들을 revision_no ASC 로 반환
router.get('/:id/revisions', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    // 1) 견적 자체 + parent_quote_id 조회
    const [[base]] = await pool.query(
      `SELECT id, parent_quote_id, quote_no FROM quotes WHERE id = ?`,
      [id]
    );
    if (!base) return res.status(404).json({ success: false, error: '견적을 찾을 수 없음' });
    const groupParentId = base.parent_quote_id || base.id;
    // 2) 그룹 전체 (root + 모든 children) revision_no ASC + created_at ASC
    const [rows] = await pool.query(
      `SELECT id, quote_no, name, customer_name, quote_date, status,
              parent_quote_id, revision_no, total_amount, created_at, updated_at
         FROM quotes
        WHERE id = ? OR parent_quote_id = ?
        ORDER BY revision_no ASC, created_at ASC`,
      [groupParentId, groupParentId]
    );
    res.json({
      success: true,
      data: {
        group_parent_id: groupParentId,
        revisions: rows,
        current_id: id,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── PATCH /:id/status — 상태 전환 (Phase 5-B 빠른 액션) ─────
// 워크플로우: draft → sent / sent → accepted | rejected / 기타 → 자유
// 강제 안 함 (사용자 자율) — 다만 invalid status 만 400 처리
router.patch('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const status = String(req.body?.status || '').trim();
    const allowed = ['draft', 'sent', 'accepted', 'rejected'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: '유효하지 않은 상태값' });
    }
    const [result] = await pool.query(`UPDATE quotes SET status = ? WHERE id = ?`, [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '견적을 찾을 수 없음' });
    }
    res.json({ success: true, data: { id, status } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /:id/duplicate — 리비전 복사 (Phase 4 미리 준비) ───
// 원본의 헤더 + 품목을 그대로 복사 + parent_quote_id + revision_no++
router.post('/:id/duplicate', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);
    const [[orig]] = await conn.query(`SELECT * FROM quotes WHERE id = ?`, [id]);
    if (!orig) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '원본 견적을 찾을 수 없음' });
    }

    // 같은 그룹의 최대 revision_no 찾기 (parent 가 자기 자신 또는 자식들)
    const groupParentId = orig.parent_quote_id || orig.id;
    const [[maxRow]] = await conn.query(
      `SELECT COALESCE(MAX(revision_no), 0) AS maxRev
         FROM quotes WHERE id = ? OR parent_quote_id = ?`,
      [groupParentId, groupParentId]
    );
    const newRev = (maxRow?.maxRev ?? 1) + 1;

    // 새 채번 (연도별 시퀀스 이어서)
    const year = new Date(orig.quote_date).getFullYear();
    const newQuoteNo = await generateQuoteNo(conn, year);

    // 헤더 복사
    const [insRes] = await conn.query(
      `INSERT INTO quotes
        (quote_no, name, lead_id, customer_id, customer_name, quote_date,
         vat_included, column_labels, subtotal, vat_amount, total_amount,
         created_by, parent_quote_id, revision_no, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newQuoteNo,
        `${orig.name} (Rev ${newRev})`,
        orig.lead_id,
        orig.customer_id,
        orig.customer_name,
        orig.quote_date,
        orig.vat_included,
        orig.column_labels,
        orig.subtotal,
        orig.vat_amount,
        orig.total_amount,
        userId || null,
        groupParentId,
        newRev,
        'draft',
      ]
    );
    const newId = insRes.insertId;

    // 품목 복사
    await conn.query(
      `INSERT INTO quote_items
        (quote_id, display_order, item_name, spec, unit_price, discount_pct,
         supply_price, quantity, proposed_amount, remark)
       SELECT ?, display_order, item_name, spec, unit_price, discount_pct,
              supply_price, quantity, proposed_amount, remark
         FROM quote_items WHERE quote_id = ?`,
      [newId, id]
    );

    await conn.commit();
    res.json({
      success: true,
      data: { id: newId, quote_no: newQuoteNo, revision_no: newRev },
    });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ─────────────────
// GET /api/quotes/:id/contracts → contracts WHERE quote_id = ?
// 견적 상세 모달에서 "🔗 연결된 계약" 섹션 렌더링용
router.get('/:id/contracts', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [[q]] = await pool.query('SELECT id FROM quotes WHERE id = ?', [id]);
    if (!q) return res.status(404).json({ success: false, error: '견적 없음' });
    const [contracts] = await pool.query(
      `SELECT id, contract_no, title, status, contract_type,
              contract_amount, currency, start_date, end_date,
              customer_name, created_at
         FROM contracts
        WHERE quote_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [id]
    );
    res.json({ success: true, data: contracts });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
module.exports._migrationPromise = _migrationPromise;
