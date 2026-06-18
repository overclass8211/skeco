// =============================================================
// P4-B 드릴다운 — GET /api/payments/flow/:contractId
//   계약 → 프로젝트 → 매출(청구차수) → 수금(입금) 체인 집계 (읽기전용)
// =============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TAG = '__FLOW__';
const U = '1';
let customerId, contractId, projectId, s1, s2;

async function cleanup() {
  await pool.query(
    `DELETE FROM payment_records WHERE schedule_id IN
      (SELECT id FROM (SELECT id FROM payment_schedules WHERE customer_name LIKE '${TAG}%') t)`
  );
  await pool.query(`DELETE FROM payment_schedules WHERE customer_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM projects WHERE name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM contracts WHERE title LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM customers WHERE name LIKE '${TAG}%'`);
}

beforeAll(async () => {
  await cleanup();
  const [c] = await pool.query(`INSERT INTO customers (name, created_at) VALUES (?, NOW())`, [`${TAG}고객`]);
  customerId = c.insertId;
  const [ct] = await pool.query(
    `INSERT INTO contracts (contract_no, title, customer_id, customer_name, status, contract_amount, currency, created_at)
     VALUES (?,?,?,?, 'completed', 10000000, 'KRW', NOW())`,
    ['C-FLOW-' + String(Date.now()).slice(-6), `${TAG}계약`, customerId, `${TAG}고객`]
  );
  contractId = ct.insertId;
  const [pj] = await pool.query(
    `INSERT INTO projects (name, customer_id, customer_name, contract_id, contract_amount, currency, status, project_code, created_at)
     VALUES (?,?,?,?, 10000000, 'KRW', '진행중', ?, NOW())`,
    [`${TAG}계약`, customerId, `${TAG}고객`, contractId, 'PRJ-FLOW-' + String(Date.now()).slice(-6)]
  );
  projectId = pj.insertId;
  const mkSched = async (stage, order, amount) => {
    const [r] = await pool.query(
      `INSERT INTO payment_schedules
         (contract_id, customer_id, customer_name, contract_name, stage_name, stage_order, ratio,
          scheduled_amount, supply_amount, tax_amount, due_date, status, currency, created_at)
       VALUES (?,?,?,?,?,?, 50, ?, ?, ?, '2026-08-01', 'scheduled', 'KRW', NOW())`,
      [contractId, customerId, `${TAG}고객`, `${TAG}계약`, stage, order, amount, Math.round(amount / 1.1), amount - Math.round(amount / 1.1)]
    );
    return r.insertId;
  };
  s1 = await mkSched('착수금', 1, 6000000);
  s2 = await mkSched('잔금', 2, 4000000);
  // s1 에 부분 입금 200만
  await pool.query(
    `INSERT INTO payment_records (schedule_id, contract_id, customer_id, paid_amount, paid_date, created_at)
     VALUES (?,?,?, 2000000, '2026-08-02', NOW())`,
    [s1, contractId, customerId]
  );
});

afterAll(cleanup);

describe('P4-B 드릴다운 흐름', () => {
  it('GET /flow/:id — 계약+프로젝트+청구차수+수금 합계', async () => {
    const res = await api().get(`/api/payments/flow/${contractId}`).set('X-User-Id', U);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.contract.id).toBe(contractId);
    expect(d.project).toBeTruthy();
    expect(d.project.id).toBe(projectId);
    expect(d.schedules.length).toBe(2);
    // 차수 순서(stage_order) 보장
    expect(d.schedules[0].id).toBe(s1);
    expect(Number(d.schedules[0].paid_amount)).toBe(2000000);
    // 합계
    expect(Number(d.totals.scheduled)).toBe(10000000);
    expect(Number(d.totals.collected)).toBe(2000000);
    expect(Number(d.totals.outstanding)).toBe(8000000);
  });

  it('GET /flow/:id — 없는 계약 404', async () => {
    const res = await api().get('/api/payments/flow/999999999').set('X-User-Id', U);
    expect(res.status).toBe(404);
  });
});
