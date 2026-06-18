/**
 * v6.0.0 — 고객사 ↔ 견적/제안/계약 데이터 정합성 통합 테스트
 *
 * 시나리오 (12+):
 *  1. Quote POST: lead_id 만 지정 → customer_id 자동 채움
 *  2. Quote POST: customer_id 명시 → 그대로 유지 (자동 덮어쓰지 않음)
 *  3. Quote POST: lead_id 없음 → customer_id 그대로 유지
 *  4. Quote PUT: lead_id 변경 → customer_id 자동 갱신
 *  5. Quote PUT: customer_id 명시 변경 → 자동 도출 무시
 *  6. Proposal POST: lead_id 만 지정 → customer_id 자동 채움
 *  7. Proposal PUT: lead_id 변경 → customer_id 자동 갱신
 *  8. Contract POST: lead_id 만 지정 → customer_id 자동 채움
 *  9. Contract POST: proposal_id 지정 → proposal.customer_id 자동 도출
 * 10. Contract PUT: lead_id 변경 → customer_id 자동 갱신
 * 11. Contract PUT: proposal_id 변경 → customer_id 자동 갱신
 * 12. 카드 카운트 일치: GET /customers 의 quotes_cnt === GET /customers/:id/quotes 길이
 * 13. 카드 카운트 일치: proposals_cnt
 * 14. 카드 카운트 일치: contracts_cnt
 * 15. 백필 마이그레이션: NULL customer_id 행이 lead 정보로 채워짐
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TAG = '__LINK_TEST__';

let customer, lead, lead2; // 공유 픽스처

beforeAll(async () => {
  // 픽스처 정리
  await pool.query(`DELETE FROM contracts WHERE title LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM proposals WHERE proposal_title LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM quotes WHERE name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM leads WHERE project_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM customers WHERE name LIKE '${TAG}%'`);

  // 픽스처 생성: 고객사 2개, 리드 2개 (각각 다른 고객사 연결)
  const cRes = await api().post('/api/customers').send({
    name: `${TAG}고객A`,
    region: '국내',
    industry: 'IT',
  });
  customer = { id: cRes.body.id, name: `${TAG}고객A` };

  const c2Res = await api().post('/api/customers').send({
    name: `${TAG}고객B`,
    region: '국내',
    industry: 'IT',
  });
  const customer2 = { id: c2Res.body.id, name: `${TAG}고객B` };

  // 리드 — DB 직접 INSERT (POST API 가 stage 검증 등으로 복잡할 수 있음)
  const [r1] = await pool.query(
    `INSERT INTO leads (customer_id, customer_name, project_name, stage)
     VALUES (?, ?, ?, 'lead')`,
    [customer.id, customer.name, `${TAG}리드1`]
  );
  lead = { id: r1.insertId, customer_id: customer.id, customer_name: customer.name };

  const [r2] = await pool.query(
    `INSERT INTO leads (customer_id, customer_name, project_name, stage)
     VALUES (?, ?, ?, 'lead')`,
    [customer2.id, customer2.name, `${TAG}리드2`]
  );
  lead2 = { id: r2.insertId, customer_id: customer2.id, customer_name: customer2.name };
});

afterAll(async () => {
  await pool.query(`DELETE FROM contracts WHERE title LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM proposals WHERE proposal_title LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM quotes WHERE name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM leads WHERE project_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM customers WHERE name LIKE '${TAG}%'`);
});

describe('데이터 정합성 — Quotes', () => {
  it('1. Quote POST: lead_id 만 지정 → customer_id/customer_name 자동 채움', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', '1')
      .send({
        name: `${TAG}견적1`,
        lead_id: lead.id,
        customer_name: '', // 비어있어야 자동 채움 동작
        quote_date: '2026-05-25',
        vat_included: false,
        items: [{ item_name: '품목A', unit_price: 1000, quantity: 1 }],
      });
    expect(res.status).toBe(200);

    const [[row]] = await pool.query(
      'SELECT customer_id, customer_name, lead_id FROM quotes WHERE id = ?',
      [res.body.id]
    );
    expect(row.lead_id).toBe(lead.id);
    expect(row.customer_id).toBe(customer.id); // ← 자동 채움 핵심
    expect(row.customer_name).toBe(customer.name);
  });

  it('2. Quote POST: customer_id 명시 → 명시값 유지 (자동 덮어쓰기 X)', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', '1')
      .send({
        name: `${TAG}견적2`,
        lead_id: lead.id,
        customer_id: lead2.customer_id, // ← lead 와 다른 명시값
        customer_name: lead2.customer_name,
        quote_date: '2026-05-25',
        items: [{ item_name: '품목B', unit_price: 1000, quantity: 1 }],
      });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT customer_id FROM quotes WHERE id = ?', [res.body.id]);
    expect(row.customer_id).toBe(lead2.customer_id); // 명시값 유지
  });

  it('3. Quote POST: lead_id 없음 → customer_id 그대로', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', '1')
      .send({
        name: `${TAG}견적3`,
        customer_id: customer.id,
        customer_name: customer.name,
        quote_date: '2026-05-25',
        items: [{ item_name: '품목C', unit_price: 1000, quantity: 1 }],
      });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT customer_id, lead_id FROM quotes WHERE id = ?', [
      res.body.id,
    ]);
    expect(row.lead_id).toBeNull();
    expect(row.customer_id).toBe(customer.id);
  });

  it('4. Quote PUT: lead_id 변경 → customer_id 자동 갱신', async () => {
    // 먼저 lead2 로 견적 생성
    const cre = await api()
      .post('/api/quotes')
      .set('X-User-Id', '1')
      .send({
        name: `${TAG}견적4`,
        lead_id: lead2.id,
        customer_name: '',
        quote_date: '2026-05-25',
        items: [{ item_name: '품목D', unit_price: 1000, quantity: 1 }],
      });
    expect(cre.status).toBe(200);
    // lead → lead2 변경
    const upd = await api()
      .put(`/api/quotes/${cre.body.id}`)
      .set('X-User-Id', '1')
      .send({
        lead_id: lead.id, // ← 변경
        // customer_id 일부러 전달 안함 → 자동 도출되어야 함
        items: [{ item_name: '품목D', unit_price: 1000, quantity: 1 }],
      });
    expect(upd.status).toBe(200);
    const [[row]] = await pool.query('SELECT customer_id FROM quotes WHERE id = ?', [cre.body.id]);
    expect(row.customer_id).toBe(customer.id); // lead 의 customer_id 로 갱신
  });

  it('5. Quote PUT: customer_id 명시 → 자동 도출 무시', async () => {
    const cre = await api()
      .post('/api/quotes')
      .set('X-User-Id', '1')
      .send({
        name: `${TAG}견적5`,
        lead_id: lead.id,
        quote_date: '2026-05-25',
        items: [{ item_name: 'X', unit_price: 1000, quantity: 1 }],
      });
    const upd = await api()
      .put(`/api/quotes/${cre.body.id}`)
      .set('X-User-Id', '1')
      .send({
        lead_id: lead.id,
        customer_id: lead2.customer_id, // 명시값
        items: [{ item_name: 'X', unit_price: 1000, quantity: 1 }],
      });
    expect(upd.status).toBe(200);
    const [[row]] = await pool.query('SELECT customer_id FROM quotes WHERE id = ?', [cre.body.id]);
    expect(row.customer_id).toBe(lead2.customer_id);
  });
});

describe('데이터 정합성 — Proposals', () => {
  it('6. Proposal POST: lead_id 만 지정 → customer_id 자동 채움', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', '1')
      .send({
        proposal_title: `${TAG}제안1`,
        lead_id: lead.id,
        proposal_date: '2026-05-25',
      });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query(
      'SELECT customer_id, customer_name FROM proposals WHERE id = ?',
      [res.body.id]
    );
    expect(row.customer_id).toBe(customer.id);
    expect(row.customer_name).toBe(customer.name);
  });

  it('7. Proposal PUT: lead_id 변경 → customer_id 자동 갱신', async () => {
    const cre = await api()
      .post('/api/proposals')
      .set('X-User-Id', '1')
      .send({
        proposal_title: `${TAG}제안2`,
        lead_id: lead2.id,
        proposal_date: '2026-05-25',
      });
    const upd = await api().put(`/api/proposals/${cre.body.id}`).set('X-User-Id', '1').send({
      lead_id: lead.id, // 변경
    });
    expect(upd.status).toBe(200);
    const [[row]] = await pool.query('SELECT customer_id FROM proposals WHERE id = ?', [
      cre.body.id,
    ]);
    expect(row.customer_id).toBe(customer.id);
  });
});

describe('데이터 정합성 — Contracts', () => {
  it('8. Contract POST: lead_id 만 지정 → customer_id 자동 채움', async () => {
    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', '1')
      .send({
        title: `${TAG}계약1`,
        lead_id: lead.id,
        contract_type: 'NDA',
      });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query(
      'SELECT customer_id, customer_name FROM contracts WHERE id = ?',
      [res.body.id]
    );
    expect(row.customer_id).toBe(customer.id);
    expect(row.customer_name).toBe(customer.name);
  });

  it('9. Contract POST: proposal_id → proposal.customer_id 자동 도출', async () => {
    // 먼저 proposal 만들기 (lead2 기반)
    const pRes = await api()
      .post('/api/proposals')
      .set('X-User-Id', '1')
      .send({
        proposal_title: `${TAG}제안X`,
        lead_id: lead2.id,
        proposal_date: '2026-05-25',
      });
    // contract — proposal_id 만 지정
    const cRes = await api()
      .post('/api/contracts')
      .set('X-User-Id', '1')
      .send({
        title: `${TAG}계약2`,
        proposal_id: pRes.body.id,
        contract_type: 'MSA',
      });
    expect(cRes.status).toBe(200);
    const [[row]] = await pool.query('SELECT customer_id FROM contracts WHERE id = ?', [
      cRes.body.id,
    ]);
    expect(row.customer_id).toBe(lead2.customer_id);
  });

  it('10. Contract PUT: lead_id 변경 → customer_id 자동 갱신', async () => {
    const cre = await api()
      .post('/api/contracts')
      .set('X-User-Id', '1')
      .send({
        title: `${TAG}계약3`,
        lead_id: lead2.id,
        contract_type: 'NDA',
      });
    const upd = await api().put(`/api/contracts/${cre.body.id}`).set('X-User-Id', '1').send({
      lead_id: lead.id,
    });
    expect(upd.status).toBe(200);
    const [[row]] = await pool.query('SELECT customer_id FROM contracts WHERE id = ?', [
      cre.body.id,
    ]);
    expect(row.customer_id).toBe(customer.id);
  });

  it('11. Contract PUT: proposal_id 변경 → customer_id 자동 갱신', async () => {
    // 신규 proposal (lead2 기반)
    const pRes = await api()
      .post('/api/proposals')
      .set('X-User-Id', '1')
      .send({
        proposal_title: `${TAG}제안Y`,
        lead_id: lead2.id,
        proposal_date: '2026-05-25',
      });
    // 계약은 lead 기반으로 시작 → 이후 proposal_id 로 변경
    const cre = await api()
      .post('/api/contracts')
      .set('X-User-Id', '1')
      .send({
        title: `${TAG}계약4`,
        lead_id: lead.id,
        contract_type: 'NDA',
      });
    const upd = await api().put(`/api/contracts/${cre.body.id}`).set('X-User-Id', '1').send({
      proposal_id: pRes.body.id,
    });
    expect(upd.status).toBe(200);
    const [[row]] = await pool.query('SELECT customer_id FROM contracts WHERE id = ?', [
      cre.body.id,
    ]);
    expect(row.customer_id).toBe(lead2.customer_id);
  });
});

describe('카드 카운트 정합성 — GET /customers ↔ 모달 탭', () => {
  it('12. quotes_cnt 응답 === GET /customers/:id/quotes 길이', async () => {
    const list = await api().get(`/api/customers?search=${encodeURIComponent(customer.name)}`);
    const card = list.body.data.find(r => r.id === customer.id);
    expect(card).toBeDefined();
    const modal = await api().get(`/api/customers/${customer.id}/quotes`);
    expect(card.quotes_cnt).toBe(modal.body.data.length);
    expect(card.quotes_cnt).toBeGreaterThanOrEqual(1);
  });

  it('13. proposals_cnt 응답 === GET /customers/:id/proposals 길이', async () => {
    const list = await api().get(`/api/customers?search=${encodeURIComponent(customer.name)}`);
    const card = list.body.data.find(r => r.id === customer.id);
    const modal = await api().get(`/api/customers/${customer.id}/proposals`);
    expect(card.proposals_cnt).toBe(modal.body.data.length);
    expect(card.proposals_cnt).toBeGreaterThanOrEqual(1);
  });

  it('14. contracts_cnt 응답 === GET /customers/:id/contracts 길이', async () => {
    const list = await api().get(`/api/customers?search=${encodeURIComponent(customer.name)}`);
    const card = list.body.data.find(r => r.id === customer.id);
    const modal = await api().get(`/api/customers/${customer.id}/contracts`);
    expect(card.contracts_cnt).toBe(modal.body.data.length);
    expect(card.contracts_cnt).toBeGreaterThanOrEqual(1);
  });
});

describe('데이터 정합성 — 기존 NULL 백필', () => {
  it('15. 백필: lead_id 있고 customer_id NULL 인 quote 가 자동 보정됨', async () => {
    // 의도적으로 NULL 행 생성 (백엔드 자동화를 우회: 직접 INSERT)
    // quote_no 는 VARCHAR(20) 정도이므로 짧게 — Date.now() 끝 6자리 사용
    const shortKey = String(Date.now()).slice(-6);
    const [r] = await pool.query(
      `INSERT INTO quotes (quote_no, name, lead_id, customer_id, customer_name, quote_date,
                           subtotal, vat_amount, total_amount, revision_no, status)
       VALUES (?, ?, ?, NULL, '', ?, 0, 0, 0, 1, 'draft')`,
      [`Q-T-${shortKey}`, `${TAG}백필테스트`, lead.id, '2026-05-25']
    );
    const insertedId = r.insertId;

    // initTables 의 backfill SQL 패턴을 직접 실행 (initTables 는 부팅 시점만 동작)
    await pool.query(
      `UPDATE quotes q
         JOIN leads l ON l.id = q.lead_id
          SET q.customer_id = COALESCE(q.customer_id, l.customer_id),
              q.customer_name = COALESCE(NULLIF(q.customer_name, ''), l.customer_name)
        WHERE q.lead_id IS NOT NULL
          AND (q.customer_id IS NULL OR q.customer_name IS NULL OR q.customer_name = '')`
    );

    const [[row]] = await pool.query(
      'SELECT customer_id, customer_name FROM quotes WHERE id = ?',
      [insertedId]
    );
    expect(row.customer_id).toBe(customer.id);
    expect(row.customer_name).toBe(customer.name);
  });
});

describe('수금 연동 — GET /customers/:id/payments', () => {
  it('16. customer_id 로 연결된 수금일정이 조회됨', async () => {
    const [r] = await pool.query(
      `INSERT INTO payment_schedules
         (customer_id, customer_name, contract_name, stage_name, scheduled_amount, currency, due_date, status, created_at)
       VALUES (?, ?, ?, '계약금', 1000000, 'KRW', '2026-07-01', '예정', NOW())`,
      [customer.id, customer.name, `${TAG}수금계약`]
    );
    const sid = r.insertId;
    try {
      const res = await api().get(`/api/customers/${customer.id}/payments`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const found = res.body.data.find(x => x.id === sid);
      expect(found).toBeDefined();
      expect(Number(found.scheduled_amount)).toBe(1000000);
    } finally {
      await pool.query('DELETE FROM payment_schedules WHERE id = ?', [sid]);
    }
  });

  it('17. customer_id NULL + customer_name 일치 시 fallback 조회됨', async () => {
    const [r] = await pool.query(
      `INSERT INTO payment_schedules
         (customer_id, customer_name, stage_name, scheduled_amount, due_date, status, created_at)
       VALUES (NULL, ?, '잔금', 500000, '2026-08-01', '예정', NOW())`,
      [customer.name]
    );
    const sid = r.insertId;
    try {
      const res = await api().get(`/api/customers/${customer.id}/payments`);
      const found = res.body.data.find(x => x.id === sid);
      expect(found).toBeDefined();
    } finally {
      await pool.query('DELETE FROM payment_schedules WHERE id = ?', [sid]);
    }
  });
});
