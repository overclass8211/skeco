/**
 * 생산예측 API 테스트 (Phase B)
 *   - POST 생성 (expected_revenue = 수량 × 단가)
 *   - GET 목록 (필터)
 *   - POST /:id/convert — 수주 전환 → leads(stage=won) 생성 + 상태 변경
 *   - DELETE
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const created = [];
let convertedLeadId;

afterAll(async () => {
  if (convertedLeadId) await pool.query('DELETE FROM leads WHERE id=?', [convertedLeadId]);
  if (created.length) {
    await pool.query(
      `DELETE FROM production_forecasts WHERE id IN (${created.map(() => '?').join(',')})`,
      created
    );
  }
});

describe('Production Forecasts API', () => {
  it('POST — 생성 + expected_revenue 자동 계산', async () => {
    const res = await api().post('/api/production-forecasts').set('X-User-Id', '1').send({
      customer_name: '__PF_T__', product_name: '식각가스 C4F6', business_type: '식각가스',
      period: '2026-07', forecast_qty: 1200, unit: 'kg', unit_price: 1250000,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.expected_revenue).toBe(1200 * 1250000);
    created.push(res.body.data.id);
  });

  it('GET — 목록 필터(period)', async () => {
    const res = await api().get('/api/production-forecasts?period=2026-07&q=__PF_T__').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.some(r => r.customer_name === '__PF_T__')).toBe(true);
  });

  it('POST /:id/convert — 수주 전환 → leads(won) 생성', async () => {
    const id = created[0];
    const res = await api().post(`/api/production-forecasts/${id}/convert`).set('X-User-Id', '1').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.lead_id).toBeTruthy();
    convertedLeadId = res.body.data.lead_id;

    const [[lead]] = await pool.query('SELECT stage, expected_amount FROM leads WHERE id=?', [convertedLeadId]);
    expect(lead.stage).toBe('won');
    // 1200 × 1,250,000 = 1,500,000,000 원 (expected_amount 는 원 풀값)
    expect(Number(lead.expected_amount)).toBe(1200 * 1250000);

    const [[pf]] = await pool.query('SELECT status, converted_lead_id FROM production_forecasts WHERE id=?', [id]);
    expect(pf.status).toBe('수주전환');
    expect(pf.converted_lead_id).toBe(convertedLeadId);
  });

  it('이미 전환된 건 재전환 → 409', async () => {
    const res = await api().post(`/api/production-forecasts/${created[0]}/convert`).set('X-User-Id', '1').send({});
    expect(res.status).toBe(409);
  });
});
