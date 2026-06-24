/**
 * 반도체 수급 FCST API 테스트 (/api/forecast-sc)
 *   - 생산 Capa POST 업서트 + effective_capa 계산
 *   - 배분 산식: 공급 = 수요 × MIN(1, 유효Capa/제품월총수요)
 *   - 매출 = 공급 × 판가
 *   - Capa 미등록 월 = 무제약(전량 출하)
 *   - monthly / summary 집계 형식
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const PROD = '__SC_TEST_PR__'; // 테스트 격리용 유니크 제품명
const pfIds = [];

async function addDemand(period, qty, price, customer) {
  const res = await api().post('/api/production-forecasts').set('X-User-Id', '1').send({
    customer_name: customer, product_name: PROD, business_type: '포토소재',
    period, forecast_qty: qty, unit: 'L', unit_price: price, currency: 'USD',
  });
  expect(res.status).toBe(200);
  pfIds.push(res.body.data.id);
}

async function setCapa(period, nameplate, utilization) {
  const res = await api().post('/api/forecast-sc/capacity').set('X-User-Id', '1').send({
    product_name: PROD, period, nameplate, utilization, unit: 'L',
  });
  expect(res.status).toBe(200);
  return res.body.data;
}

beforeAll(async () => {
  // 2026-08: Capa 제약 (유효 800 < 총수요 1200) → 충족률 0.667
  await setCapa('2026-08', 1000, 0.8);
  await addDemand('2026-08', 600, 10, '__SC_A__');
  await addDemand('2026-08', 600, 10, '__SC_B__');
  // 2026-09: Capa 충분 (유효 1000 ≥ 수요 600) → 전량 출하
  await setCapa('2026-09', 1000, 1.0);
  await addDemand('2026-09', 600, 10, '__SC_A__');
  // 2026-10: Capa 미등록 → 무제약(전량 출하)
  await addDemand('2026-10', 500, 10, '__SC_A__');
});

afterAll(async () => {
  if (pfIds.length) {
    await pool.query(
      `DELETE FROM production_forecasts WHERE id IN (${pfIds.map(() => '?').join(',')})`,
      pfIds
    );
  }
  await pool.query('DELETE FROM production_capacity WHERE product_name=?', [PROD]);
});

describe('Forecast Supply-Chain API', () => {
  it('POST /capacity — 업서트 + effective_capa', async () => {
    const d = await setCapa('2026-08', 1000, 0.8); // 동일 키 재호출 → 업서트
    expect(d.effective_capa).toBe(800);
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS n FROM production_capacity WHERE product_name=? AND period=?',
      [PROD, '2026-08']
    );
    expect(rows[0].n).toBe(1); // 중복 생성 안 됨
  });

  it('GET /demand — Capa 제약월: 공급=수요×0.667, 매출=공급×판가', async () => {
    const res = await api()
      .get(`/api/forecast-sc/demand?year=2026&product=${PROD}&period=2026-08`)
      .set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const rows = res.body.data;
    expect(rows.length).toBe(2);
    for (const r of rows) {
      // 유효Capa 800 / 총수요 1200 = 0.6667 → 600×0.6667 = 400
      expect(r.supply_qty).toBe(400);
      expect(r.expected_revenue).toBe(4000); // 400 × 10
      expect(r.fulfill_ratio).toBe(0.67);
    }
  });

  it('GET /demand — Capa 충분월: 전량 출하', async () => {
    const res = await api()
      .get(`/api/forecast-sc/demand?year=2026&product=${PROD}&period=2026-09`)
      .set('X-User-Id', '1');
    const r = res.body.data[0];
    expect(r.supply_qty).toBe(600);
    expect(r.expected_revenue).toBe(6000);
    expect(r.fulfill_ratio).toBe(1);
  });

  it('GET /demand — Capa 미등록월: 무제약 전량 출하', async () => {
    const res = await api()
      .get(`/api/forecast-sc/demand?year=2026&product=${PROD}&period=2026-10`)
      .set('X-User-Id', '1');
    const r = res.body.data[0];
    expect(r.supply_qty).toBe(500);
    expect(r.expected_revenue).toBe(5000);
    expect(r.fulfill_ratio).toBe(1);
  });

  it('GET /monthly — 배열 길이 12 + 통화 메타', async () => {
    const res = await api().get('/api/forecast-sc/monthly?year=2026').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.demand).toHaveLength(12);
    expect(d.supply).toHaveLength(12);
    expect(d.revenue).toHaveLength(12);
    expect(d.fulfillment).toHaveLength(12);
    // 8월(index7) 테스트 데이터 반영 (수요 ≥ 1200, 공급 ≥ 800)
    expect(d.demand[7]).toBeGreaterThanOrEqual(1200);
    expect(d.supply[7]).toBeGreaterThanOrEqual(800);
  });

  it('GET /summary — 연간 요약 필드', async () => {
    const res = await api().get('/api/forecast-sc/summary?year=2026').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toHaveProperty('annual_demand');
    expect(d).toHaveProperty('annual_supply');
    expect(d).toHaveProperty('annual_revenue');
    expect(d).toHaveProperty('fulfillment_rate');
    expect(d.fulfillment_rate).toBeGreaterThan(0);
  });

  it('POST /capacity — 필수값 검증(400)', async () => {
    const res = await api()
      .post('/api/forecast-sc/capacity')
      .set('X-User-Id', '1')
      .send({ product_name: PROD }); // period 누락
    expect(res.status).toBe(400);
  });
});
