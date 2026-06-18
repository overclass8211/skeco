/**
 * Products API 통합 테스트
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let createdId;

beforeAll(async () => {
  await pool.query("DELETE FROM products WHERE name LIKE '__TEST__%'");
});

afterAll(async () => {
  if (createdId) {
    await pool.query('DELETE FROM cost_history WHERE product_id = ?', [createdId]);
    await pool.query('DELETE FROM products WHERE id = ?', [createdId]);
  }
});

describe('Products API', () => {
  it('GET /api/products — 목록 조회', async () => {
    const res = await api().get('/api/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — 신규 제품 등록', async () => {
    const res = await api().post('/api/products').send({
      name: '__TEST__폴리실리콘',
      category: '원자재',
      unit: 'kg',
      current_price: 10.5,
      currency: 'USD',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdId = res.body.id;
  });

  it('PUT /:id — 가격 업데이트 + 변동률 자동 계산', async () => {
    const res = await api().put(`/api/products/${createdId}`).send({
      current_price: 11.0,
      notes: '테스트 가격 변경',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PUT /:id — 존재하지 않는 ID → 404', async () => {
    const res = await api().put('/api/products/9999999').send({ current_price: 1 });
    expect(res.status).toBe(404);
  });

  it('GET /:id/history — 가격 이력 조회', async () => {
    const res = await api().get(`/api/products/${createdId}/history`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2); // POST + PUT 2번 기록
  });

  it('DELETE /:id — 삭제', async () => {
    const res = await api().delete(`/api/products/${createdId}`);
    expect(res.status).toBe(200);
    createdId = null;
  });
});
