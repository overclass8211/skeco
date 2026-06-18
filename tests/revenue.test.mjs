// =============================================================
// P2 매출관리 — 매출확정 동기화(세금계산서 발행) + 집계/목록 API
// =============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TAG = '__REV_TEST__';
let customerId, contractId, scheduleId, invoiceId;

beforeAll(async () => {
  await pool.query(
    `ALTER TABLE payment_schedules ADD COLUMN IF NOT EXISTS revenue_status VARCHAR(20) NOT NULL DEFAULT '예정'`
  );
  await pool.query(`ALTER TABLE payment_schedules ADD COLUMN IF NOT EXISTS recognized_at DATETIME NULL`);
  // P2a: 세금계산서 수신 담당자 (가산·멱등)
  await pool.query(
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_recipient_name VARCHAR(100) NULL`
  );
  await pool.query(
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_recipient_dept VARCHAR(100) NULL`
  );
  await pool.query(
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_recipient_email VARCHAR(200) NULL`
  );

  await pool.query(`DELETE FROM tax_invoices WHERE customer_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM payment_schedules WHERE contract_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM contracts WHERE title LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM customers WHERE name LIKE '${TAG}%'`);

  const [c] = await pool.query(`INSERT INTO customers (name, created_at) VALUES (?, NOW())`, [`${TAG}고객`]);
  customerId = c.insertId;
  const [ct] = await pool.query(
    `INSERT INTO contracts (contract_no, title, customer_id, customer_name, status, contract_amount, currency, created_at)
     VALUES (?,?,?,?, 'completed', 11000000, 'KRW', NOW())`,
    ['C-REV-' + String(Date.now()).slice(-6), `${TAG}계약`, customerId, `${TAG}고객`]
  );
  contractId = ct.insertId;
  const [s] = await pool.query(
    `INSERT INTO payment_schedules
       (contract_id, customer_id, customer_name, contract_name, stage_name, stage_order, ratio,
        scheduled_amount, supply_amount, tax_amount, due_date, status, revenue_status, currency, created_at)
     VALUES (?,?,?,?, '일시불', 1, 100, 11000000, 10000000, 1000000, '2026-07-01', 'scheduled', '예정', 'KRW', NOW())`,
    [contractId, customerId, `${TAG}고객`, `${TAG}계약`]
  );
  scheduleId = s.insertId;
  const [inv] = await pool.query(
    `INSERT INTO tax_invoices
       (schedule_id, contract_id, customer_id, customer_name, supply_amount, tax_amount, total_amount, status, created_by)
     VALUES (?,?,?,?, 10000000, 1000000, 11000000, 'draft', 1)`,
    [scheduleId, contractId, customerId, `${TAG}고객`]
  );
  invoiceId = inv.insertId;
});

afterAll(async () => {
  await pool.query(`DELETE FROM tax_invoices WHERE customer_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM payment_schedules WHERE contract_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM contracts WHERE title LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM customers WHERE name LIKE '${TAG}%'`);
});

describe('P2 매출관리 — 매출확정 동기화 + 집계', () => {
  it('세금계산서 발행(issued) → schedule.revenue_status=확정 + recognized_at', async () => {
    const res = await api()
      .put(`/api/payments/tax-invoices/${invoiceId}`)
      .set('X-User-Id', '1')
      .send({ status: 'issued' });
    expect(res.status).toBe(200);
    const [[sc]] = await pool.query(
      'SELECT revenue_status, recognized_at, status FROM payment_schedules WHERE id=?',
      [scheduleId]
    );
    expect(sc.revenue_status).toBe('확정');
    expect(sc.recognized_at).toBeTruthy();
    expect(sc.status).toBe('invoiced'); // 수금상태도 청구 승급
  });

  it('GET /api/revenue/summary — 확정 매출 집계 반영', async () => {
    const res = await api().get('/api/revenue/summary').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.kpi.확정.amount).toBeGreaterThanOrEqual(11000000);
  });

  it('GET /api/revenue/schedules — 매출 라인 목록(계약 필터)', async () => {
    const res = await api()
      .get(`/api/revenue/schedules?contract_id=${contractId}`)
      .set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const row = res.body.data.find(r => r.id === scheduleId);
    expect(row).toBeTruthy();
    expect(row.revenue_status).toBe('확정');
    expect(Number(row.issued_cnt)).toBe(1);
  });

  it('세금계산서 취소(cancelled) → revenue_status 예정 복귀', async () => {
    const res = await api()
      .put(`/api/payments/tax-invoices/${invoiceId}`)
      .set('X-User-Id', '1')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    const [[sc]] = await pool.query(
      'SELECT revenue_status, recognized_at FROM payment_schedules WHERE id=?',
      [scheduleId]
    );
    expect(sc.revenue_status).toBe('예정');
    expect(sc.recognized_at).toBeNull();
  });
});

describe('P2a 청구차수 상세 + 세금계산서 수신 담당자', () => {
  it('GET /schedules/:id — 상세(기본 + 고객사 + 공급자)', async () => {
    const res = await api().get(`/api/revenue/schedules/${scheduleId}`).set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.schedule.id).toBe(scheduleId);
    expect(res.body.data.customer.id).toBe(customerId);
    expect(res.body.data).toHaveProperty('supplier');
  });

  it('PUT /schedules/:id/tax-recipient — 저장 후 상세 반영', async () => {
    const put = await api()
      .put(`/api/revenue/schedules/${scheduleId}/tax-recipient`)
      .set('X-User-Id', '1')
      .send({ name: '김세금', dept: '재무팀', email: 'tax@corp.com' });
    expect(put.status).toBe(200);
    const res = await api().get(`/api/revenue/schedules/${scheduleId}`).set('X-User-Id', '1');
    expect(res.body.data.customer.tax_recipient_name).toBe('김세금');
    expect(res.body.data.customer.tax_recipient_dept).toBe('재무팀');
    expect(res.body.data.customer.tax_recipient_email).toBe('tax@corp.com');
  });

  it('PUT /schedules/:id/tax-recipient — 잘못된 이메일 거부', async () => {
    const res = await api()
      .put(`/api/revenue/schedules/${scheduleId}/tax-recipient`)
      .set('X-User-Id', '1')
      .send({ email: 'bad-email' });
    expect(res.status).toBe(400);
  });
});
