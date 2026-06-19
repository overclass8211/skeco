/**
 * 고객·제품 360뷰 (MVP) API 테스트
 *   - GET /api/customer360/customers — 선택기 목록(+빠른 KPI)
 *   - GET /api/customer360/:id        — 헤더/요약/소재·제품/영업기회/타임라인/브리핑
 *   - 가중 예상매출 = expected_amount × 단계 확률
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let custId, leadId;

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
});

afterAll(async () => {
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
});
