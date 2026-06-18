// =============================================================
// P3 수금관리 — 단계별 독촉(dunning) 엔진
//   · 스키마 변경 0: payment_notifications(kind 'dunning_*') + system_settings 재사용
//   · 연체 경과일 → 단계 판정(D+7/14/30), dedup, 정책/템플릿/미리보기
// =============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TAG = '__DUN_TEST__';
const U = '1';
let customerId;
let s1, s2, s3, s4; // 연체 10/20/35/3일

async function cleanup() {
  await pool.query(`DELETE FROM payment_notifications WHERE customer_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM payment_records WHERE schedule_id IN
    (SELECT id FROM (SELECT id FROM payment_schedules WHERE customer_name LIKE '${TAG}%') t)`);
  await pool.query(`DELETE FROM payment_schedules WHERE customer_name LIKE '${TAG}%'`);
  await pool.query(`DELETE FROM customers WHERE name LIKE '${TAG}%'`);
  // 독촉 설정 키 초기화(코드 기본값으로 복귀) — 테스트가 생성한 키만
  await pool.query(
    `DELETE FROM system_settings WHERE setting_key IN ('payment_dunning_policy','payment_dunning_templates')`
  );
}

async function insSchedule(daysAgo, amount) {
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
  s1 = await insSchedule(10, 1100000); // → dunning_1st
  s2 = await insSchedule(20, 2200000); // → dunning_2nd
  s3 = await insSchedule(35, 3300000); // → dunning_3rd
  s4 = await insSchedule(3, 500000); // 연체이나 1차 미도래 → null
});

afterAll(cleanup);

describe('P3 독촉(dunning) — 단계 판정/스캔', () => {
  it('POST /dunning/scan — 연체 경과일별 단계 알림 생성(1st/2nd/3rd)', async () => {
    const res = await api().post('/api/payments/dunning/scan').set('X-User-Id', U);
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBeGreaterThanOrEqual(3);

    const [[n1]] = await pool.query(
      `SELECT kind FROM payment_notifications WHERE schedule_id=? AND kind LIKE 'dunning%'`,
      [s1]
    );
    const [[n2]] = await pool.query(
      `SELECT kind FROM payment_notifications WHERE schedule_id=? AND kind LIKE 'dunning%'`,
      [s2]
    );
    const [[n3]] = await pool.query(
      `SELECT kind FROM payment_notifications WHERE schedule_id=? AND kind LIKE 'dunning%'`,
      [s3]
    );
    expect(n1.kind).toBe('dunning_1st');
    expect(n2.kind).toBe('dunning_2nd');
    expect(n3.kind).toBe('dunning_3rd');

    // 3일 연체(s4)는 1차 미도래 → 알림 없음
    const [[n4]] = await pool.query(
      `SELECT COUNT(*) AS c FROM payment_notifications WHERE schedule_id=? AND kind LIKE 'dunning%'`,
      [s4]
    );
    expect(Number(n4.c)).toBe(0);
  });

  it('재스캔 dedup — 동일 단계 중복 생성 없음', async () => {
    await api().post('/api/payments/dunning/scan').set('X-User-Id', U);
    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS c FROM payment_notifications WHERE schedule_id=? AND kind='dunning_1st'`,
      [s1]
    );
    expect(Number(cnt.c)).toBe(1);
  });

  it('GET /dunning/list — 현황에 단계 라벨 포함(독촉 전 포함)', async () => {
    const res = await api().get('/api/payments/dunning/list').set('X-User-Id', U);
    expect(res.status).toBe(200);
    const r1 = res.body.data.find(r => r.schedule_id === s1);
    const r4 = res.body.data.find(r => r.schedule_id === s4);
    expect(r1.dunning_kind).toBe('dunning_1st');
    expect(r1.remaining).toBe(1100000);
    expect(r4.dunning_kind).toBeNull(); // 독촉 전
  });

  it('GET /dunning/summary — 단계별 집계 구조', async () => {
    const res = await api().get('/api/payments/dunning/summary').set('X-User-Id', U);
    expect(res.status).toBe(200);
    expect(res.body.data.stages.dunning_1st.count).toBeGreaterThanOrEqual(1);
    expect(res.body.data.total_amount).toBeGreaterThanOrEqual(6600000);
  });
});

describe('P3 독촉 — 정책/템플릿/미리보기', () => {
  it('GET /dunning/policy — 기본 3단계', async () => {
    const res = await api().get('/api/payments/dunning/policy').set('X-User-Id', U);
    expect(res.status).toBe(200);
    expect(res.body.data.policy).toHaveLength(3);
    expect(res.body.data.policy[0].kind).toBe('dunning_1st');
  });

  it('PUT /dunning/policy — 사용자 정의 저장/조회', async () => {
    const stages = [
      { kind: 'dunning_1st', label: '1차', min_days: 5 },
      { kind: 'dunning_2nd', label: '2차', min_days: 25 },
    ];
    const put = await api().put('/api/payments/dunning/policy').set('X-User-Id', U).send({ stages });
    expect(put.status).toBe(200);
    const get = await api().get('/api/payments/dunning/policy').set('X-User-Id', U);
    expect(get.body.data.policy).toHaveLength(2);
    expect(get.body.data.policy[1].min_days).toBe(25);
  });

  it('PUT /dunning/policy — 잘못된 입력 거부', async () => {
    const res = await api().put('/api/payments/dunning/policy').set('X-User-Id', U).send({ stages: [] });
    expect(res.status).toBe(400);
  });

  it('POST /dunning/preview — 치환자 렌더링', async () => {
    const res = await api()
      .post('/api/payments/dunning/preview')
      .set('X-User-Id', U)
      .send({ schedule_id: s1, kind: 'dunning_1st' });
    expect(res.status).toBe(200);
    expect(res.body.data.body).toContain(`${TAG}고객`); // {customer_name} 치환됨
    expect(res.body.data.body).not.toContain('{customer_name}'); // 미치환 잔여 없음
    expect(res.body.data.subject).toBeTruthy();
  });
});

describe('P3-C 독촉 — 수동 메일 발송 안전성', () => {
  it('POST /dunning/send — 잘못된 이메일 거부', async () => {
    const res = await api()
      .post('/api/payments/dunning/send')
      .set('X-User-Id', U)
      .send({ schedule_id: s1, kind: 'dunning_1st', to: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('POST /dunning/send — to(수신) 누락 거부', async () => {
    const res = await api()
      .post('/api/payments/dunning/send')
      .set('X-User-Id', U)
      .send({ schedule_id: s1, kind: 'dunning_1st' });
    expect(res.status).toBe(400);
  });

  it('POST /dunning/send — Gmail 미연결 시 발송/기록 없이 실패(안전)', async () => {
    const res = await api()
      .post('/api/payments/dunning/send')
      .set('X-User-Id', U)
      .send({ schedule_id: s1, kind: 'dunning_1st', to: 'customer@corp.com' });
    expect(res.status).toBe(400); // 미연결/인증실패 → 발송 안 됨
    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS c FROM payment_notifications WHERE schedule_id=? AND channel='email'`,
      [s1]
    );
    expect(Number(cnt.c)).toBe(0); // 실패 시 이력 기록 없음(부작용 없음)
  });
});
