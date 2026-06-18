// =============================================================
// P1 — 계약 확정(completed) 자동 프로비저닝 (프로젝트 + 매출계획)
//   - provisionOnComplete 서비스 단위 + PATCH /:id/status 통합
// =============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';
import { provisionOnComplete } from '../src/services/contractProvision.js';

const TAG = '__PROV_TEST__';
let customerId;
let seq = 0;

beforeAll(async () => {
  // 컬럼 보장(마이그레이션 타이밍 무관 — 가산·멱등)
  await pool.query(
    `ALTER TABLE payment_schedules ADD COLUMN IF NOT EXISTS revenue_status VARCHAR(20) NOT NULL DEFAULT '예정'`
  );
  await pool.query(`ALTER TABLE payment_schedules ADD COLUMN IF NOT EXISTS recognized_at DATETIME NULL`);
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS auto_provisioned_at DATETIME NULL`);

  await pool.query(`DELETE FROM payment_schedules WHERE contract_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM projects WHERE name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM contracts WHERE title LIKE '${TAG}%'`);
  const [c] = await pool.query(`INSERT INTO customers (name, created_at) VALUES (?, NOW())`, [`${TAG}고객`]);
  customerId = c.insertId;
});

afterAll(async () => {
  await pool.query(`DELETE FROM payment_schedules WHERE contract_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM projects WHERE name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM contracts WHERE title LIKE '${TAG}%'`);
  if (customerId) await pool.query(`DELETE FROM customers WHERE id = ?`, [customerId]);
});

async function makeContract(status = 'approved', amount = 11000000) {
  const no = 'C-T-' + String(Date.now()).slice(-6) + String(++seq);
  const [r] = await pool.query(
    `INSERT INTO contracts
       (contract_no, title, customer_id, customer_name, status, contract_amount, currency, start_date, end_date, created_at)
     VALUES (?,?,?,?,?,?, 'KRW', '2026-01-01', '2026-12-31', NOW())`,
    [no, `${TAG}계약`, customerId, `${TAG}고객`, status, amount]
  );
  return r.insertId;
}

describe('P1 계약 확정 자동 프로비저닝 — provisionOnComplete', () => {
  it('체결 시 프로젝트 + 매출계획(단일 100%) 생성 + 공급/세액 분리', async () => {
    const cid = await makeContract('approved', 11000000);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await provisionOnComplete(conn, cid);
      await conn.commit();
      expect(out.projectCreated).toBe(true);
      expect(out.scheduleCreated).toBe(true);
    } finally {
      conn.release();
    }

    const [[pj]] = await pool.query('SELECT * FROM projects WHERE contract_id = ?', [cid]);
    expect(pj).toBeTruthy();
    expect(pj.project_code).toMatch(/^PRJ-\d{4}-\d{4}$/);
    expect(pj.status).toBe('진행중');

    const [[sc]] = await pool.query('SELECT * FROM payment_schedules WHERE contract_id = ?', [cid]);
    expect(sc).toBeTruthy();
    expect(Number(sc.scheduled_amount)).toBe(11000000);
    expect(Number(sc.supply_amount)).toBe(10000000); // 11,000,000 / 1.1
    expect(Number(sc.supply_amount) + Number(sc.tax_amount)).toBe(11000000);
    expect(sc.revenue_status).toBe('예정');
    expect(sc.status).toBe('scheduled');

    const [[ct]] = await pool.query('SELECT auto_provisioned_at FROM contracts WHERE id = ?', [cid]);
    expect(ct.auto_provisioned_at).toBeTruthy();
  });

  it('멱등 — 재호출 시 중복 생성 없음', async () => {
    const cid = await makeContract('approved', 5000000);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await provisionOnComplete(conn, cid);
      const out2 = await provisionOnComplete(conn, cid);
      await conn.commit();
      expect(out2.skipped).toBe('already_provisioned');
    } finally {
      conn.release();
    }
    const [[{ n: pjN }]] = await pool.query('SELECT COUNT(*) n FROM projects WHERE contract_id = ?', [cid]);
    const [[{ n: scN }]] = await pool.query('SELECT COUNT(*) n FROM payment_schedules WHERE contract_id = ?', [cid]);
    expect(pjN).toBe(1);
    expect(scN).toBe(1);
  });

  it('기존 프로젝트 있으면 프로젝트는 skip, 매출계획만 생성 (기존 보존)', async () => {
    const cid = await makeContract('approved', 3000000);
    await pool.query(
      `INSERT INTO projects (name, contract_id, status, created_at) VALUES (?, ?, '진행중', NOW())`,
      [`${TAG}기존PJ`, cid]
    );
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await provisionOnComplete(conn, cid);
      await conn.commit();
      expect(out.projectCreated).toBe(false);
      expect(out.scheduleCreated).toBe(true);
    } finally {
      conn.release();
    }
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM projects WHERE contract_id = ?', [cid]);
    expect(n).toBe(1);
  });

  it('PATCH /:id/status → completed 전이 시 자동생성 (통합)', async () => {
    const cid = await makeContract('approved', 22000000);
    const res = await api()
      .patch(`/api/contracts/${cid}/status`)
      .set('X-User-Id', '1')
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.data.to).toBe('completed');
    expect(res.body.data.provision?.projectCreated).toBe(true);
    expect(res.body.data.provision?.scheduleCreated).toBe(true);

    const [[pj]] = await pool.query('SELECT id FROM projects WHERE contract_id = ?', [cid]);
    expect(pj).toBeTruthy();
    const [[sc]] = await pool.query('SELECT id FROM payment_schedules WHERE contract_id = ?', [cid]);
    expect(sc).toBeTruthy();
  });
});
