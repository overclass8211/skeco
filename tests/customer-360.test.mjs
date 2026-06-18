/**
 * 고객 360뷰 API 테스트
 *   - GET /api/customers/:id/360view — 모든 접점 통합 집계 구조
 *   - 딜 1건이 summary.deals + pipeline 에 반영되는지
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let custId, leadId;

beforeAll(async () => {
  const [c] = await pool.query(
    `INSERT INTO customers (name, region, country, industry) VALUES ('__C360_T__','국내','대한민국','반도체')`
  );
  custId = c.insertId;
  const [l] = await pool.query(
    `INSERT INTO leads (customer_id, customer_name, project_name, business_type, region, stage, expected_amount, currency)
     VALUES (?, '__C360_T__', '__C360_PRJ__', '식각가스', '국내', 'proposal', 12.00, 'KRW')`,
    [custId]
  );
  leadId = l.insertId;
});

afterAll(async () => {
  if (leadId) await pool.query('DELETE FROM leads WHERE id=?', [leadId]);
  if (custId) await pool.query('DELETE FROM customers WHERE id=?', [custId]);
});

describe('Customer 360 API', () => {
  it('GET /api/customers/:id/360view — 통합 집계 구조', async () => {
    const res = await api().get(`/api/customers/${custId}/360view`).set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.customer.id).toBe(custId);
    expect(d.summary).toHaveProperty('deals');
    expect(d.summary).toHaveProperty('quotes');
    expect(d.summary).toHaveProperty('contracts');
    expect(Array.isArray(d.pipeline)).toBe(true);
    expect(Array.isArray(d.timeline)).toBe(true);
  });

  it('딜 1건이 summary.deals 에 반영', async () => {
    const res = await api().get(`/api/customers/${custId}/360view`).set('X-User-Id', '1');
    expect(res.body.data.summary.deals.count).toBeGreaterThanOrEqual(1);
  });

  it('존재하지 않는 고객 → 404', async () => {
    const res = await api().get('/api/customers/99999999/360view').set('X-User-Id', '1');
    expect(res.status).toBe(404);
  });
});
