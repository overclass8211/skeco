/**
 * Quotes API 통합 테스트 — Phase 1 (수동 입력 + 자동 채번)
 *
 * 검증 대상: /api/quotes
 *   GET    /              — 목록
 *   POST   /              — 생성 + 자동채번 + 합계 계산
 *   GET    /:id           — 단건 + 품목
 *   PUT    /:id           — 수정 (헤더 + 품목 일괄 교체)
 *   DELETE /:id           — 삭제 (CASCADE 로 품목 자동 삭제)
 *   POST   /:id/duplicate — 리비전 복사
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TEST_USER_ID = 1;
const createdQuoteIds = [];

beforeAll(async () => {
  // 마이그레이션 완료 대기
  const { _migrationPromise } = await import('../src/routes/quotes.js')
    .then(m => m.default ?? m)
    .catch(() => ({}));
  if (_migrationPromise) await _migrationPromise;
});

afterAll(async () => {
  if (createdQuoteIds.length > 0) {
    await pool.query('DELETE FROM quotes WHERE id IN (?)', [createdQuoteIds]);
  }
});

describe('Quotes API', () => {
  let createdId;
  let createdQuoteNo;

  it('POST /api/quotes — 신규 견적 + 자동채번 + 합계 계산', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_A',
        customer_name: '__TEST__고객사_A',
        quote_date: '2026-05-01',
        vat_included: 0,
        items: [
          { item_name: '서버 A', unit_price: 1000000, quantity: 2, discount_pct: 10 },
          { item_name: '서버 B', unit_price: 500000, quantity: 3, discount_pct: 0 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quote_no).toMatch(/^Q-2026-\d{4}$/);
    // 합계: (1000000 * 2 * 0.9) + (500000 * 3) = 1,800,000 + 1,500,000 = 3,300,000
    expect(Number(res.body.data.subtotal)).toBe(3300000);
    // vat_included=0 → 부가세 미포함 → 가산 안 함 (사용자 의도)
    expect(Number(res.body.data.vat_amount)).toBe(0);
    expect(Number(res.body.data.total_amount)).toBe(3300000);
    createdId = res.body.id;
    createdQuoteNo = res.body.data.quote_no;
    createdQuoteIds.push(createdId);
  });

  it('POST /api/quotes — 견적명 누락 시 400', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__', quote_date: '2026-05-01', items: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/quotes — 고객명 누락 시 400', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ name: '__TEST__견적_X', quote_date: '2026-05-01', items: [] });
    expect(res.status).toBe(400);
  });

  // 🐛 사용자 보고 — 공급단가 = 단가 × (1-할인%/100), 제안금액 = 공급단가 × 수량
  it('POST /api/quotes — 공급단가 자동 계산 (할인 0% → 단가와 동일)', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__공급단가_할인0',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          // 단가 1000, 할인 0%, 수량 3 → 공급단가 1000, 제안금액 3000
          { item_name: 'A', unit_price: 1000, discount_pct: 0, quantity: 3 },
        ],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    const it = r2.body.data.items[0];
    expect(Number(it.supply_price)).toBe(1000); // 할인 0% → 단가와 동일
    expect(Number(it.proposed_amount)).toBe(3000); // 1000 × 3
    expect(Number(r2.body.data.subtotal)).toBe(3000);
  });

  it('POST /api/quotes — 공급단가 자동 계산 (할인 15% 적용)', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__공급단가_할인15',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          // 단가 2000, 할인 15%, 수량 4 → 공급단가 1700, 제안금액 6800
          { item_name: 'A', unit_price: 2000, discount_pct: 15, quantity: 4 },
        ],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    const it = r2.body.data.items[0];
    expect(Number(it.supply_price)).toBe(1700); // 2000 × 0.85
    expect(Number(it.proposed_amount)).toBe(6800); // 1700 × 4
  });

  it('POST /api/quotes — 사용자가 잘못된 supply_price 보내도 서버가 자동 재계산 (보안)', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__공급단가_조작방어',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          // 사용자가 supply_price=99999 보내도 서버는 1000 × 0.9 = 900 로 자동 계산
          {
            item_name: 'A',
            unit_price: 1000,
            discount_pct: 10,
            quantity: 1,
            supply_price: 99999, // 조작 시도
          },
        ],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    const it = r2.body.data.items[0];
    expect(Number(it.supply_price)).toBe(900); // 99999 무시, 자동 계산
    expect(Number(it.proposed_amount)).toBe(900); // 900 × 1
  });

  // Phase 5-C: 다음 자동 채번 미리보기
  it('GET /api/quotes/next-quote-no — 다음 채번 미리보기 (Q-YYYY-NNNN 패턴)', async () => {
    const res = await api()
      .get('/api/quotes/next-quote-no?year=2026')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quote_no).toMatch(/^Q-2026-\d{4}$/);
    expect(res.body.data.year).toBe(2026);
  });

  // Phase 5-B: 상태 전환 (빠른 액션)
  it('PATCH /api/quotes/:id/status — 상태 전환 draft → sent → accepted', async () => {
    const create = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__상태전환',
        customer_name: '__TEST__',
        quote_date: '2026-05-20',
        items: [{ item_name: 'A', unit_price: 100, quantity: 1 }],
      });
    const stId = create.body.id;
    createdQuoteIds.push(stId);

    // draft → sent
    const r1 = await api()
      .patch(`/api/quotes/${stId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'sent' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.status).toBe('sent');

    // sent → accepted
    const r2 = await api()
      .patch(`/api/quotes/${stId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'accepted' });
    expect(r2.status).toBe(200);
    expect(r2.body.data.status).toBe('accepted');

    // 잘못된 상태값 → 400
    const r3 = await api()
      .patch(`/api/quotes/${stId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'INVALID_STATE' });
    expect(r3.status).toBe(400);
  });

  // Phase 5-A: 리비전 트리 조회
  it('GET /api/quotes/:id/revisions — 그룹 전체 리비전 반환 (원본 + 복사본)', async () => {
    // 원본 생성
    const orig = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__리비전_원본',
        customer_name: '__TEST__',
        quote_date: '2026-05-20',
        items: [{ item_name: 'A', unit_price: 100, quantity: 1 }],
      });
    const origId = orig.body.id;
    createdQuoteIds.push(origId);

    // 리비전 2번 복사
    const dup1 = await api()
      .post(`/api/quotes/${origId}/duplicate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({});
    const dup1Id = dup1.body.data.id;
    createdQuoteIds.push(dup1Id);

    const dup2 = await api()
      .post(`/api/quotes/${origId}/duplicate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({});
    const dup2Id = dup2.body.data.id;
    createdQuoteIds.push(dup2Id);

    // 원본 기준 리비전 트리 조회 — 3건 (원본 + 2 리비전)
    const tree = await api()
      .get(`/api/quotes/${origId}/revisions`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(tree.status).toBe(200);
    expect(tree.body.data.group_parent_id).toBe(origId);
    expect(tree.body.data.current_id).toBe(origId);
    expect(tree.body.data.revisions.length).toBe(3);
    // revision_no ASC 정렬
    const revNos = tree.body.data.revisions.map(r => Number(r.revision_no));
    expect(revNos[0]).toBeLessThanOrEqual(revNos[1]);
    expect(revNos[1]).toBeLessThanOrEqual(revNos[2]);

    // 복사본 기준으로 조회해도 동일한 그룹 반환
    const tree2 = await api()
      .get(`/api/quotes/${dup2Id}/revisions`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(tree2.body.data.group_parent_id).toBe(origId);
    expect(tree2.body.data.current_id).toBe(dup2Id);
    expect(tree2.body.data.revisions.length).toBe(3);
  });

  // Phase 4 PDF 개선: 공급사/고객사/조건사항 필드 저장/조회
  it('POST + GET /api/quotes — 공급사/고객사/조건사항 7개 필드 저장 + 조회', async () => {
    const payload = {
      name: '__TEST__PDF필드',
      customer_name: '__TEST__고객사_ABC',
      customer_contact: '__TEST__홍길동',
      quote_date: '2026-05-20',
      supplier_company_name: '__TEST__공급사_XYZ',
      supplier_address: '서울특별시 강남구',
      supplier_ceo: '__TEST__대표자',
      sales_rep_name: '__TEST__영업담당',
      sales_rep_contact: '010-0000-0000 / sales@test.co.kr',
      terms_conditions: '1. 유효기간 30일\n2. 부가세 별도',
      items: [{ item_name: 'A', unit_price: 100, quantity: 1 }],
    };
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send(payload);
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.customer_contact).toBe(payload.customer_contact);
    expect(r2.body.data.supplier_company_name).toBe(payload.supplier_company_name);
    expect(r2.body.data.supplier_address).toBe(payload.supplier_address);
    expect(r2.body.data.supplier_ceo).toBe(payload.supplier_ceo);
    expect(r2.body.data.sales_rep_name).toBe(payload.sales_rep_name);
    expect(r2.body.data.sales_rep_contact).toBe(payload.sales_rep_contact);
    expect(r2.body.data.terms_conditions).toBe(payload.terms_conditions);
  });

  it('PUT /api/quotes/:id — 공급사/조건사항 갱신', async () => {
    const create = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__PDF필드_갱신',
        customer_name: '__TEST__',
        quote_date: '2026-05-20',
        items: [{ item_name: 'A', unit_price: 100, quantity: 1 }],
      });
    const updId = create.body.id;
    createdQuoteIds.push(updId);

    await api()
      .put(`/api/quotes/${updId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__PDF필드_갱신',
        customer_name: '__TEST__',
        quote_date: '2026-05-20',
        supplier_company_name: 'NEW 공급사',
        terms_conditions: 'NEW 조건사항',
        items: [{ item_name: 'A', unit_price: 100, quantity: 1 }],
      });
    const r2 = await api().get(`/api/quotes/${updId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.supplier_company_name).toBe('NEW 공급사');
    expect(r2.body.data.terms_conditions).toBe('NEW 조건사항');
  });

  // Phase 3-A: 컬럼 라벨 커스터마이징 저장/조회
  it('POST /api/quotes — column_labels 저장 + 조회 시 동일 반환', async () => {
    const customLabels = {
      item_name: '상품명',
      spec: 'Spec',
      unit_price: 'Unit Price',
      discount_pct: 'Disc %',
      supply_price: 'Net Price',
      quantity: 'Qty',
      proposed_amount: 'Subtotal',
      remark: '비고',
    };
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_컬럼라벨',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        column_labels: customLabels,
        items: [{ item_name: 'A', unit_price: 100, quantity: 1 }],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.column_labels).toEqual(customLabels);
  });

  // Phase 3-B: customer_id 저장
  it('POST /api/quotes — customer_id 저장 (lead 선택 시 함께 채워짐)', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_customer_id',
        customer_name: '__TEST__고객',
        quote_date: '2026-05-01',
        customer_id: 12345, // FK 없으니 임의 값
        lead_id: 67890,
        items: [{ item_name: 'A', unit_price: 100, quantity: 1 }],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.customer_id).toBe(12345);
    expect(r2.body.data.lead_id).toBe(67890);
  });

  // Phase 3-A: PUT 으로 column_labels 갱신
  it('PUT /api/quotes/:id — column_labels 갱신', async () => {
    const create = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__라벨갱신',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [{ item_name: 'A', unit_price: 100, quantity: 1 }],
      });
    const labelId = create.body.id;
    createdQuoteIds.push(labelId);

    // 신규는 column_labels=null
    const r1 = await api().get(`/api/quotes/${labelId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(r1.body.data.column_labels).toBeNull();

    // PUT 으로 라벨 추가
    const newLabels = { item_name: '상품', spec: '규격' };
    await api()
      .put(`/api/quotes/${labelId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__라벨갱신',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        column_labels: newLabels,
        items: [{ item_name: 'A', unit_price: 100, quantity: 1 }],
      });

    const r2 = await api().get(`/api/quotes/${labelId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.column_labels).toEqual(newLabels);
  });

  it('POST /api/quotes — lead_id 저장 + 조회 시 반환', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_lead연결',
        customer_name: '__TEST__고객사',
        quote_date: '2026-05-01',
        lead_id: 99999, // FK 없으니 임의 값
        items: [{ item_name: 'L', unit_price: 100, quantity: 1 }],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.lead_id).toBe(99999);
  });

  it('PUT /api/quotes/:id — 품목 순서 변경 시 display_order 재계산', async () => {
    // 임시 견적 — 품목 3개
    const create = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__순서변경',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          { item_name: 'A', unit_price: 100, quantity: 1 },
          { item_name: 'B', unit_price: 200, quantity: 1 },
          { item_name: 'C', unit_price: 300, quantity: 1 },
        ],
      });
    const sortId = create.body.id;
    createdQuoteIds.push(sortId);

    // [C, A, B] 로 재정렬 — Sortable.js 가 _items 배열 reorder 후 PUT
    const put = await api()
      .put(`/api/quotes/${sortId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__순서변경',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          { item_name: 'C', unit_price: 300, quantity: 1 },
          { item_name: 'A', unit_price: 100, quantity: 1 },
          { item_name: 'B', unit_price: 200, quantity: 1 },
        ],
      });
    expect(put.status).toBe(200);

    // GET 재조회 — display_order ASC 정렬 시 [C, A, B] 순
    const r2 = await api().get(`/api/quotes/${sortId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.items.map(it => it.item_name)).toEqual(['C', 'A', 'B']);
    // display_order 가 0, 1, 2 로 재계산됐는지
    expect(r2.body.data.items.map(it => Number(it.display_order))).toEqual([0, 1, 2]);
  });

  // 🐛 사용자 보고 — 부가세 포함 시 10% 가산 (이전: 반대로 동작)
  it('POST /api/quotes — vat_included=1 → 부가세 10% 가산', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_VAT포함',
        customer_name: '__TEST__고객사',
        quote_date: '2026-05-01',
        vat_included: 1,
        items: [{ item_name: 'A', unit_price: 100000, quantity: 1, discount_pct: 0 }],
      });
    expect(res.status).toBe(200);
    expect(Number(res.body.data.subtotal)).toBe(100000);
    expect(Number(res.body.data.vat_amount)).toBe(10000); // 10% 가산
    expect(Number(res.body.data.total_amount)).toBe(110000); // 100k + 10k
    createdQuoteIds.push(res.body.id);
  });

  it('POST /api/quotes — vat_included=0 → 부가세 가산 안 함', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_VAT미포함',
        customer_name: '__TEST__고객사',
        quote_date: '2026-05-01',
        vat_included: 0,
        items: [{ item_name: 'A', unit_price: 100000, quantity: 1, discount_pct: 0 }],
      });
    expect(res.status).toBe(200);
    expect(Number(res.body.data.subtotal)).toBe(100000);
    expect(Number(res.body.data.vat_amount)).toBe(0); // 가산 안 함
    expect(Number(res.body.data.total_amount)).toBe(100000); // 소계 = 총합계
    createdQuoteIds.push(res.body.id);
  });

  it('GET /api/quotes — 목록 (생성한 견적 포함)', async () => {
    const res = await api()
      .get('/api/quotes?search=__TEST__&limit=50')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(q => q.id === createdId);
    expect(found).toBeDefined();
    expect(found.quote_no).toBe(createdQuoteNo);
  });

  it('GET /api/quotes/:id — 단건 + 품목', async () => {
    const res = await api().get(`/api/quotes/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(createdId);
    expect(res.body.data.items).toBeDefined();
    expect(res.body.data.items.length).toBe(2);
    // proposed_amount 자동 계산 — 서버 A: 1000000 * 2 * 0.9 = 1,800,000
    const serverA = res.body.data.items.find(it => it.item_name === '서버 A');
    expect(Number(serverA.proposed_amount)).toBe(1800000);
  });

  it('GET /api/quotes/:id — 존재하지 않는 ID 404', async () => {
    const res = await api().get('/api/quotes/9999999').set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  it('PUT /api/quotes/:id — 수정 + 품목 교체', async () => {
    const res = await api()
      .put(`/api/quotes/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_A_수정',
        customer_name: '__TEST__고객사_수정',
        quote_date: '2026-05-15',
        vat_included: 0,
        items: [{ item_name: '신규품목', unit_price: 200000, quantity: 5, discount_pct: 5 }],
      });
    expect(res.status).toBe(200);
    // 공급단가 = 200000 * 0.95 = 190,000 / 제안금액 = 190,000 * 5 = 950,000
    // vat_included=0 → 미포함 → vat=0, total = subtotal
    expect(Number(res.body.data.subtotal)).toBe(950000);
    expect(Number(res.body.data.vat_amount)).toBe(0);
    expect(Number(res.body.data.total_amount)).toBe(950000);

    // 재조회로 품목 교체 확인
    const r2 = await api().get(`/api/quotes/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.items.length).toBe(1);
    expect(r2.body.data.items[0].item_name).toBe('신규품목');
  });

  it('POST /api/quotes/:id/duplicate — 리비전 복사', async () => {
    const res = await api()
      .post(`/api/quotes/${createdId}/duplicate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.revision_no).toBeGreaterThan(1);
    expect(res.body.data.quote_no).toMatch(/^Q-2026-\d{4}$/);
    createdQuoteIds.push(res.body.data.id);

    // 복사본의 품목도 복사됐는지 검증
    const r2 = await api()
      .get(`/api/quotes/${res.body.data.id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.items.length).toBe(1);
    expect(r2.body.data.parent_quote_id).toBe(createdId);
  });

  it('DELETE /api/quotes/:id — 삭제 (CASCADE 로 품목도 함께)', async () => {
    // 임시 견적 생성
    const create = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__삭제용',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [{ item_name: 'X', unit_price: 100, quantity: 1 }],
      });
    const delId = create.body.id;

    const res = await api().delete(`/api/quotes/${delId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 품목도 CASCADE 로 삭제됐는지 (직접 DB 확인)
    const [items] = await pool.query('SELECT * FROM quote_items WHERE quote_id = ?', [delId]);
    expect(items.length).toBe(0);
  });

  it('DELETE /api/quotes/:id — 존재하지 않는 ID 404', async () => {
    const res = await api().delete('/api/quotes/9999999').set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  // ── Bug 1: 공급사 신규 컬럼 (사업자번호 + 이메일) ──────────
  it('POST + GET — supplier_business_no + sales_rep_email 저장/조회', async () => {
    const create = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__신규컬럼',
        customer_name: '__TEST__',
        quote_date: '2026-05-22',
        supplier_company_name: '__TEST__OCI',
        supplier_business_no: '123-45-67890',
        sales_rep_email: 'sales@oci-test.com',
        items: [{ item_name: 'X', unit_price: 100, quantity: 1 }],
      });
    expect(create.status).toBe(200);
    const id = create.body.id;
    createdQuoteIds.push(id);

    const get = await api().get(`/api/quotes/${id}`).set('X-User-Id', String(TEST_USER_ID));
    expect(get.body.data.supplier_business_no).toBe('123-45-67890');
    expect(get.body.data.sales_rep_email).toBe('sales@oci-test.com');
  });

  it('PUT — supplier_business_no + sales_rep_email 수정', async () => {
    const create = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__수정테스트',
        customer_name: '__TEST__',
        quote_date: '2026-05-22',
        items: [{ item_name: 'Y', unit_price: 100, quantity: 1 }],
      });
    const id = create.body.id;
    createdQuoteIds.push(id);

    const upd = await api()
      .put(`/api/quotes/${id}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        supplier_business_no: '999-88-77777',
        sales_rep_email: 'new@oci.com',
      });
    expect(upd.status).toBe(200);

    const get = await api().get(`/api/quotes/${id}`).set('X-User-Id', String(TEST_USER_ID));
    expect(get.body.data.supplier_business_no).toBe('999-88-77777');
    expect(get.body.data.sales_rep_email).toBe('new@oci.com');
  });

  // ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ────────────────
  it('GET /:id/contracts — quote_id 로 연결된 계약 조회', async () => {
    // 신규 견적 생성
    const qr = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_for_contracts',
        customer_name: '__TEST__고객사_Q',
        quote_date: '2026-05-24',
        items: [{ item_name: '품목A', unit_price: 1000000, quantity: 1 }],
      });
    const quoteId = qr.body.id;
    createdQuoteIds.push(quoteId);

    // 계약 생성 (quote_id 연결)
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__contracts_by_quote',
        quote_id: quoteId,
        customer_name: '__TEST__고객사_Q',
        contract_type: 'service',
      });
    const contractId = cr.body.id;

    const res = await api()
      .get(`/api/quotes/${quoteId}/contracts`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    const found = res.body.data.find(c => c.id === contractId);
    expect(found).toBeDefined();
    expect(found.title).toBe('__TEST__contracts_by_quote');

    await pool.query('DELETE FROM contracts WHERE id = ?', [contractId]);
  });

  it('GET /:id/contracts — 존재하지 않는 견적 → 404', async () => {
    const res = await api()
      .get('/api/quotes/9999999/contracts')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });
});
