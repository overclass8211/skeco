/**
 * 고객·제품 360뷰 (MVP) API 테스트
 *   - GET /api/customer360/customers — 선택기 목록(+빠른 KPI)
 *   - GET /api/customer360/:id        — 헤더/요약/소재·제품/영업기회/타임라인/브리핑
 *   - 가중 예상매출 = expected_amount × 단계 확률
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let custId, leadId, matId;

beforeAll(async () => {
  const [c] = await pool.query(
    `INSERT INTO customers (name, region, country, industry) VALUES ('__C360MVP_T__','국내','대한민국','반도체')`
  );
  custId = c.insertId;
  // proposal 단계(기본 확률 50%) · 예상매출 10억 → 가중 5억
  const [l] = await pool.query(
    `INSERT INTO leads (customer_id, customer_name, project_name, business_type, region, stage, expected_amount, currency)
     VALUES (?, '__C360MVP_T__', '__C360MVP_PRJ__', '식각가스', '국내', 'proposal', 1000000000, 'KRW')`,
    [custId]
  );
  leadId = l.insertId;
  // 라이프사이클 소재 + 월 Forecast (수요 100 > CAPA 80 → 갭 20)
  const [m] = await pool.query(
    `INSERT INTO customer_materials (customer_id, material_name, business_type, lifecycle_stage, monthly_demand, demand_unit, win_probability)
     VALUES (?, '__C360_MAT__', '식각가스', 'specin', 100, 'kg', 80)`,
    [custId]
  );
  matId = m.insertId;
  await pool.query(
    `INSERT INTO demand_forecasts (customer_material_id, customer_id, month, customer_forecast, production_capacity, win_probability, expected_revenue, unit)
     VALUES (?, ?, '2026-07', 100, 80, 80, 200000000, 'kg')`,
    [matId, custId]
  );
});

afterAll(async () => {
  if (matId) {
    await pool.query('DELETE FROM demand_forecasts WHERE customer_material_id=?', [matId]);
    await pool.query('DELETE FROM customer_materials WHERE id=?', [matId]);
  }
  if (leadId) await pool.query('DELETE FROM leads WHERE id=?', [leadId]);
  if (custId) await pool.query('DELETE FROM customers WHERE id=?', [custId]);
});

describe('Customer360 (MVP) API', () => {
  it('GET /api/customer360/customers — 선택기 목록 구조', async () => {
    const res = await api().get('/api/customer360/customers').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const row = res.body.data.find(c => c.id === custId);
    expect(row).toBeTruthy();
    expect(row).toHaveProperty('open_deals');
    expect(row).toHaveProperty('pipeline_amount');
  });

  it('GET /api/customer360/customers?search= — 검색 필터', async () => {
    const res = await api().get('/api/customer360/customers?search=__C360MVP_T__').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every(c => c.name.includes('__C360MVP_T__'))).toBe(true);
  });

  it('GET /api/customer360/:id — 통합 구조 + 가중 예상매출', async () => {
    const res = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.customer.id).toBe(custId);
    expect(d.header).toHaveProperty('health_grade');
    expect(d.header).toHaveProperty('weighted_expected');
    // 10억 × 50% = 5억
    expect(d.header.weighted_expected).toBe(500000000);
    expect(Array.isArray(d.materials)).toBe(true);
    expect(Array.isArray(d.deals)).toBe(true);
    expect(Array.isArray(d.pipeline)).toBe(true);
    expect(Array.isArray(d.timeline)).toBe(true);
    // 소재(식각가스) 그룹에 딜 1건
    const mat = d.materials.find(m => m.business_type === '식각가스');
    expect(mat).toBeTruthy();
    expect(mat.count).toBeGreaterThanOrEqual(1);
    // 딜 목록에 가중값
    const deal = d.deals.find(x => x.id === leadId);
    expect(deal).toBeTruthy();
    expect(deal.probability).toBe(50);
    expect(deal.weighted).toBe(500000000);
  });

  it('존재하지 않는 고객 → 404', async () => {
    const res = await api().get('/api/customer360/99999999').set('X-User-Id', '1');
    expect(res.status).toBe(404);
  });

  it('lifecycle — 소재 보드 + 수요/생산/수주 흐름 + CAPA 갭', async () => {
    const res = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    const lc = res.body.data.lifecycle;
    expect(lc).toBeTruthy();
    const mat = lc.materials.find(m => m.material_name === '__C360_MAT__');
    expect(mat).toBeTruthy();
    expect(mat.lifecycle_stage).toBe('specin');
    expect(mat.lifecycle_index).toBe(3); // discovery0 sample1 evaluation2 specin3
    // 수요 100 > CAPA 80 → 갭 20
    expect(lc.demand_flow.demand).toBe(100);
    expect(lc.demand_flow.capacity).toBe(80);
    expect(lc.demand_flow.gap).toBe(20);
    // specin 소재 → 양산 승인 미팅 액션 존재
    expect(lc.actions.some(a => /양산 승인/.test(a.text))).toBe(true);
  });

  it('PUT /materials/:id — 단계 수정', async () => {
    const res = await api()
      .put(`/api/customer360/materials/${matId}`)
      .set('X-User-Id', '1')
      .send({ lifecycle_stage: 'massprod' });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT lifecycle_stage FROM customer_materials WHERE id=?', [matId]);
    expect(row.lifecycle_stage).toBe('massprod');
  });

  it('POST /forecasts — 월 upsert', async () => {
    const res = await api()
      .post('/api/customer360/forecasts')
      .set('X-User-Id', '1')
      .send({ customer_material_id: matId, customer_id: custId, month: '2026-08', customer_forecast: 120, production_capacity: 130, expected_revenue: 250000000, unit: 'kg' });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query(
      'SELECT customer_forecast FROM demand_forecasts WHERE customer_material_id=? AND month=?',
      [matId, '2026-08']
    );
    expect(Number(row.customer_forecast)).toBe(120);
  });

  it('POST /materials — 생성 + 필수값 검증', async () => {
    const bad = await api().post('/api/customer360/materials').set('X-User-Id', '1').send({ customer_id: custId });
    expect(bad.status).toBe(400);
    const ok = await api()
      .post('/api/customer360/materials')
      .set('X-User-Id', '1')
      .send({ customer_id: custId, material_name: '__C360_MAT2__', lifecycle_stage: 'sample' });
    expect(ok.status).toBe(200);
    await pool.query('DELETE FROM customer_materials WHERE id=?', [ok.body.data.id]);
  });
});
