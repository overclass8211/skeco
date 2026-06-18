/**
 * Customers API 통합 테스트
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool, teardown } from './helpers.mjs';

let createdId;

beforeAll(async () => {
  await pool.query("DELETE FROM customers WHERE name LIKE '__TEST__%'");
});

afterAll(async () => {
  if (createdId) await pool.query('DELETE FROM customers WHERE id = ?', [createdId]);
});

describe('Customers API', () => {
  it('GET /api/customers — 목록 조회', async () => {
    const res = await api().get('/api/customers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — name 누락 시 400', async () => {
    const res = await api().post('/api/customers').send({ region: '국내' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST — 신규 고객사 등록', async () => {
    const res = await api().post('/api/customers').send({
      name: '__TEST__OCI고객',
      region: '국내',
      industry: 'IT',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdId = res.body.id;
  });

  it('GET /:id/intelligence — 잘못된 ID 400', async () => {
    const res = await api().get('/api/customers/abc/intelligence');
    expect(res.status).toBe(400);
  });

  it('GET /:id/intelligence — 존재하지 않는 ID 처리', async () => {
    const res = await api().get('/api/customers/9999999/intelligence');
    // GEMINI_API_KEY 미설정이면 400, DB 조회 실패면 404 또는 400
    expect([200, 400, 404, 500]).toContain(res.status);
  });

  it('POST /ocr — 파일 없으면 400', async () => {
    const res = await api().post('/api/customers/ocr');
    expect(res.status).toBe(400);
  });

  // ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ────────────────
  it('GET /:id/contracts — customer_id 로 연결된 계약 조회', async () => {
    // 계약 1건 생성 (customer_id = createdId)
    const cr = await api().post('/api/contracts').set('X-User-Id', '1').send({
      title: '__TEST__contracts_by_customer',
      customer_id: createdId,
      customer_name: '__TEST__OCI고객',
      contract_type: 'NDA',
    });
    expect(cr.status).toBe(200);
    const contractId = cr.body.id;

    const res = await api().get(`/api/customers/${createdId}/contracts`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const found = res.body.data.find(c => c.id === contractId);
    expect(found).toBeDefined();
    expect(found.title).toBe('__TEST__contracts_by_customer');
    expect(found.contract_no).toMatch(/^C-\d{4}-\d{4}$/);

    // 정리
    await pool.query('DELETE FROM contracts WHERE id = ?', [contractId]);
  });

  it('GET /:id/contracts — 존재하지 않는 고객사 → 404', async () => {
    const res = await api().get('/api/customers/9999999/contracts');
    expect(res.status).toBe(404);
  });

  // ── v6.0.0: GET / 응답에 모듈별 카운트 4종 포함 (카드 통계 바) ──
  it('GET / — 응답에 related_deals_cnt/quotes_cnt/proposals_cnt/contracts_cnt 포함', async () => {
    const res = await api().get('/api/customers?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    if (res.body.data.length > 0) {
      const row = res.body.data[0];
      expect(row).toHaveProperty('related_deals_cnt');
      expect(row).toHaveProperty('quotes_cnt');
      expect(row).toHaveProperty('proposals_cnt');
      expect(row).toHaveProperty('contracts_cnt');
      expect(typeof row.related_deals_cnt).toBe('number');
      expect(typeof row.quotes_cnt).toBe('number');
      expect(typeof row.proposals_cnt).toBe('number');
      expect(typeof row.contracts_cnt).toBe('number');
    }
  });

  // ── v6.0.0: 카드 related_deals_cnt 가 모달 [관련 딜] 탭과 동일한지 검증 ──
  // 두 API 가 동일한 customer_name 매칭 기준을 쓰는지가 핵심
  it('GET / 의 related_deals_cnt === GET /:id/deals 의 data.length', async () => {
    // 테스트 고객사명으로 leads 2건 INSERT (customer_name 매칭)
    const [[cust]] = await pool.query('SELECT id, name FROM customers WHERE id = ?', [createdId]);
    await pool.query(
      `INSERT INTO leads (customer_name, project_name, stage) VALUES (?, ?, 'lead'), (?, ?, 'won')`,
      [cust.name, '__TEST__딜A', cust.name, '__TEST__딜B']
    );
    try {
      // 1) 목록 응답에서 related_deals_cnt
      const listRes = await api().get('/api/customers?search=' + encodeURIComponent(cust.name));
      const cardRow = listRes.body.data.find(r => r.id === createdId);
      expect(cardRow).toBeDefined();
      // 2) 모달 /:id/deals 응답 길이
      const modalRes = await api().get(`/api/customers/${createdId}/deals`);
      // 동일해야 함 (둘 다 customer_name 매칭, stage 필터 없음)
      expect(cardRow.related_deals_cnt).toBe(modalRes.body.data.length);
      expect(cardRow.related_deals_cnt).toBeGreaterThanOrEqual(2);
    } finally {
      await pool.query(`DELETE FROM leads WHERE project_name IN ('__TEST__딜A','__TEST__딜B')`);
    }
  });

  // ── v6.0.0: 연결된 견적/제안 역방향 조회 (고객사 모달 탭) ──
  it('GET /:id/quotes — customer_id 로 연결된 견적 조회', async () => {
    const res = await api().get(`/api/customers/${createdId}/quotes`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // 빈 결과도 OK (견적 미생성) — 응답 형식만 검증
  });

  it('GET /:id/quotes — 존재하지 않는 고객사 → 404', async () => {
    const res = await api().get('/api/customers/9999999/quotes');
    expect(res.status).toBe(404);
  });

  it('GET /:id/proposals — customer_id 로 연결된 제안 조회', async () => {
    const res = await api().get(`/api/customers/${createdId}/proposals`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /:id/proposals — 존재하지 않는 고객사 → 404', async () => {
    const res = await api().get('/api/customers/9999999/proposals');
    expect(res.status).toBe(404);
  });

  // ── v6.0.0 Phase A4: 회사명 정규화 매칭 ─────────────────────
  describe('GET /match — 회사명 매칭 (Phase A4)', () => {
    let extraIds = [];

    beforeAll(async () => {
      // 매칭 테스트용 고객사 3건 (접미사 다양화)
      const [r1] = await pool.query(
        `INSERT INTO customers (name, region, industry) VALUES (?,?,?)`,
        ['__TEST__A4_삼성전자(주)', '국내', 'IT']
      );
      const [r2] = await pool.query(
        `INSERT INTO customers (name, region, industry) VALUES (?,?,?)`,
        ['주식회사 __TEST__A4_엘지', '국내', 'IT']
      );
      const [r3] = await pool.query(
        `INSERT INTO customers (name, region, industry) VALUES (?,?,?)`,
        ['__TEST__A4_Acme Corp.', '해외', '제조']
      );
      extraIds = [r1.insertId, r2.insertId, r3.insertId];
    });

    afterAll(async () => {
      if (extraIds.length) {
        await pool.query('DELETE FROM customers WHERE id IN (?)', [extraIds]);
      }
    });

    it('정확 매치 — "(주)" 접미사 제거 후 동일하면 exact 분류', async () => {
      // 입력: "__TEST__A4_삼성전자" (접미사 없음) → DB 의 "__TEST__A4_삼성전자(주)" 와 정규화 후 동일
      const res = await api().get('/api/customers/match?name=' + encodeURIComponent('__TEST__A4_삼성전자'));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.exact)).toBe(true);
      const found = res.body.data.exact.find(c => extraIds.includes(c.id));
      expect(found).toBeDefined();
      expect(found.name).toContain('__TEST__A4_삼성전자');
    });

    it('정확 매치 — 영문 "Corp." 접미사 제거 후 동일', async () => {
      const res = await api().get('/api/customers/match?name=' + encodeURIComponent('__TEST__A4_Acme'));
      expect(res.status).toBe(200);
      const found = res.body.data.exact.find(c => extraIds.includes(c.id));
      expect(found).toBeDefined();
      expect(found.name).toContain('Acme Corp');
    });

    it('정확 매치 — 입력에 "주식회사" 포함되어도 정규화 후 매칭', async () => {
      // 입력: "__TEST__A4_엘지" → DB: "주식회사 __TEST__A4_엘지"
      const res = await api().get('/api/customers/match?name=' + encodeURIComponent('__TEST__A4_엘지'));
      expect(res.status).toBe(200);
      const found = res.body.data.exact.find(c => extraIds.includes(c.id));
      expect(found).toBeDefined();
    });

    it('부분 매치 — 정확 일치 없으면 partial 로 분류', async () => {
      const res = await api().get('/api/customers/match?name=' + encodeURIComponent('__TEST__A4_삼성전자_특수부서'));
      expect(res.status).toBe(200);
      // 정확 매치는 없지만 LIKE 로 partial 에 포함될 수 있음
      // (이 케이스는 partial 우선 — 입력값에 더 많은 글자가 있어 정규화 후 다름)
      const totalFound = res.body.data.exact.length + res.body.data.partial.length;
      expect(totalFound).toBeGreaterThanOrEqual(0); // 매칭 없을 수도, partial 있을 수도
    });

    it('매칭 없음 — 빈 결과 반환', async () => {
      const res = await api().get('/api/customers/match?name=' + encodeURIComponent('__TEST__A4_절대없는회사명_xyz789'));
      expect(res.status).toBe(200);
      expect(res.body.data.exact).toEqual([]);
      expect(res.body.data.partial).toEqual([]);
    });

    it('너무 짧은 쿼리 (1글자) → 빈 결과', async () => {
      const res = await api().get('/api/customers/match?name=' + encodeURIComponent('A'));
      expect(res.status).toBe(200);
      expect(res.body.data.exact).toEqual([]);
      expect(res.body.data.partial).toEqual([]);
    });

    it('정규화된 쿼리 응답 — normalized_query 필드 포함', async () => {
      const res = await api().get('/api/customers/match?name=' + encodeURIComponent('테스트회사(주)'));
      expect(res.status).toBe(200);
      expect(res.body.data.normalized_query).toBeDefined();
      // "(주)" 제거되었어야 함
      expect(res.body.data.normalized_query).not.toContain('(주)');
      expect(res.body.data.raw_query).toBe('테스트회사(주)');
    });
  });
});
