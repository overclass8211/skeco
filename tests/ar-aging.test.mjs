// =============================================================
// P4-A AR aging (미수금 연령분석) — GET /api/payments/ar-aging
//   미수(잔여>0) 스케줄을 연체 경과일 버킷으로 집계 (읽기전용)
//   전역 집계라 절대값 대신 '내 데이터 >= 기여분' 으로 결정적 검증
// =============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TAG = '__ARAGE__';
const U = '1';
let customerId;

async function cleanup() {
  await pool.query(
    `DELETE FROM payment_records WHERE schedule_id IN
      (SELECT id FROM (SELECT id FROM payment_schedules WHERE customer_name LIKE '${TAG}%') t)`
  );
  await pool.query(`DELETE FROM payment_schedules WHERE customer_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM customers WHERE name LIKE '${TAG}%'`);
}

async function insSchedule(daysAgo, amount) {
  // daysAgo > 0: 과거(연체), < 0: 미래(미도래)
  const [r] = await pool.query(
    `INSERT INTO payment_schedules
       (customer_id, customer_name, contract_name, stage_name, stage_order, ratio,
        scheduled_amount, supply_amount, tax_amount, due_date, status, currency, created_at)
     VALUES (?,?,?, '잔금', 1, 100, ?, ?, ?, DATE_SUB(CURDATE(), INTERVAL ? DAY), 'scheduled', 'KRW', NOW())`,
    [customerId, `${TAG}고객`, `${TAG}계약`, amount, Math.round(amount / 1.1), amount - Math.round(amount / 1.1), daysAgo]
  );
  return r.insertId;
}

beforeAll(async () => {
  await cleanup();
  const [c] = await pool.query(`INSERT INTO customers (name, created_at) VALUES (?, NOW())`, [`${TAG}고객`]);
  customerId = c.insertId;
  await insSchedule(5, 5000000); // od=5 → d30
  await insSchedule(40, 4000000); // od=40 → d60
  await insSchedule(100, 3000000); // od=100 → d90p
  await insSchedule(-10, 2000000); // 미래 → not_due
});

afterAll(cleanup);

describe('P4-A AR aging', () => {
  it('GET /ar-aging — 5개 버킷 구조 + 내 데이터 연령 반영', async () => {
    const res = await api().get('/api/payments/ar-aging').set('X-User-Id', U);
    expect(res.status).toBe(200);
    const d = res.body.data;
    const keys = d.buckets.map(b => b.key);
    expect(keys).toEqual(['not_due', 'd30', 'd60', 'd90', 'd90p']);

    const amt = k => Number(d.buckets.find(b => b.key === k).amount);
    // 전역 합이지만 내 기여분 이상은 보장 (결정적)
    expect(amt('d30')).toBeGreaterThanOrEqual(5000000);
    expect(amt('d60')).toBeGreaterThanOrEqual(4000000);
    expect(amt('d90p')).toBeGreaterThanOrEqual(3000000);
    expect(amt('not_due')).toBeGreaterThanOrEqual(2000000);
    expect(Number(d.total_outstanding)).toBeGreaterThanOrEqual(14000000);
    expect(Array.isArray(d.by_customer)).toBe(true);
  });

  it('GET /ar-aging — 고객사별 연령 분해 합 = 합계', async () => {
    const res = await api().get('/api/payments/ar-aging').set('X-User-Id', U);
    const mine = res.body.data.by_customer.find(c => c.customer_id === customerId);
    if (mine) {
      // by_customer top10 에 포함되면 버킷 분해 검증
      expect(mine.d30).toBeGreaterThanOrEqual(5000000);
      expect(mine.d60).toBeGreaterThanOrEqual(4000000);
      expect(mine.d90p).toBeGreaterThanOrEqual(3000000);
      const sum = mine.not_due + mine.d30 + mine.d60 + mine.d90 + mine.d90p;
      expect(Math.round(mine.total)).toBe(Math.round(sum));
    } else {
      // top10 밖이면 최소 구조만 — 합 14M 가 전역 total 에 포함되는지로 대체 검증
      expect(Number(res.body.data.total_outstanding)).toBeGreaterThanOrEqual(14000000);
    }
  });
});
