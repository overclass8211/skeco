/**
 * Payments API 통합 테스트 — 수금 스케줄 일괄 저장(POST /batch) + 설정(GET/PUT /config)
 *
 * 🐛 회귀 방지: 2026-05-29 사용자 보고
 *   "수금 스케줄 등록 시 POST /api/payments/batch 404 (Not Found)"
 *   → 원인: 구버전 dev 서버 미재시작 (프론트 정적 파일만 갱신, 백엔드 라우트 미반영).
 *   → 본 테스트는 라우트가 in-process 앱에 실제 등록·동작함을 보장 (404 가 아님).
 *
 * 검증 대상: /api/payments
 *   GET  /config   — 수금품목유형 + 기본통화 (기본값 fallback)
 *   PUT  /config   — 유효성 검사 (통화 화이트리스트)
 *   POST /batch    — 계약 1건 → 마일스톤 N행 트랜잭션 저장 (Model A 평면)
 *                    create / upsert(UPDATE) / 유효성 400
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TEST_USER_ID = 1;
const createdIds = [];
const createdTaxIds = [];
// B1 연체 알림 — 테스트용 재무팀 메일 + 설정 원복용 보관
const TEST_NOTIFY_EMAIL = 'finance-overdue-test@example.com';
let origNotifyEmail = null;

afterAll(async () => {
  // B1 연체 알림 행 정리 (스케줄 삭제 전, FK 없음 — 순서 무관)
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM payment_notifications WHERE schedule_id IN (?)', [createdIds]);
  }
  await pool.query('DELETE FROM payment_notifications WHERE recipient = ?', [TEST_NOTIFY_EMAIL]);
  // notify_email 설정 원복 (테스트 전 상태로)
  if (origNotifyEmail !== null) {
    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ('payment_overdue_notify_email', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [origNotifyEmail]
    );
  }
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM payment_records WHERE schedule_id IN (?)', [createdIds]);
    await pool.query('DELETE FROM payment_schedules WHERE id IN (?)', [createdIds]);
  }
  if (createdTaxIds.length > 0) {
    await pool.query('DELETE FROM tax_invoices WHERE id IN (?)', [createdTaxIds]);
  }
  // 홈택스 import 테스트 행 정리 (invoice_no=HTTEST-*)
  await pool.query("DELETE FROM tax_invoices WHERE invoice_no LIKE 'HTTEST-%'");
});

describe('Payments API — 수금 스케줄 일괄 저장 + 설정', () => {
  // ── GET /config ───────────────────────────────────────────
  it('GET /config — stage_types / default_currency / allowed_currencies 반환', async () => {
    const res = await api().get('/api/payments/config').set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.stage_types)).toBe(true);
    expect(res.body.data.stage_types.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.allowed_currencies)).toBe(true);
    expect(res.body.data.allowed_currencies).toContain('KRW');
  });

  // ── POST /batch — 핵심 회귀 (404 아님 + N행 생성) ──────────
  it('POST /batch — 계약 1건 → 마일스톤 3행 생성 (404 아님)', async () => {
    const payload = {
      shared: {
        contract_id: null,
        customer_id: null,
        customer_name: '__TEST__수금고객사',
        contract_name: '__TEST__프로젝트A',
        contract_supply_amount: 10000000,
        currency: 'KRW',
        contract_start_date: '2026-01-01',
        contract_end_date: '2026-12-31',
      },
      milestones: [
        {
          stage_name: '착수금',
          ratio: 20,
          due_date: '2026-06-05',
          supply_amount: 2000000,
          tax_amount: 200000,
          scheduled_amount: 2200000,
          note: '비고',
        },
        {
          stage_name: '중도금',
          ratio: 30,
          due_date: '2026-07-03',
          supply_amount: 3000000,
          tax_amount: 300000,
          scheduled_amount: 3300000,
        },
        {
          stage_name: '잔금',
          ratio: 50,
          due_date: '2026-07-16',
          supply_amount: 5000000,
          tax_amount: 500000,
          scheduled_amount: 5500000,
        },
      ],
      delete_ids: [],
    };

    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send(payload);

    // 핵심: 404 가 아니라 200 (라우트가 등록·동작함)
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.created).toBe(3);
    expect(res.body.data.ids).toHaveLength(3);
    res.body.data.ids.forEach(id => createdIds.push(id));

    // DB 영속화 + 비정규화(통화/계약명) + VAT 합 확인
    const [rows] = await pool.query(
      `SELECT stage_name, supply_amount, tax_amount, scheduled_amount, currency, contract_name
         FROM payment_schedules WHERE id IN (?) ORDER BY stage_order`,
      [res.body.data.ids]
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].stage_name).toBe('착수금');
    expect(Number(rows[0].scheduled_amount)).toBe(2200000);
    expect(Number(rows[0].tax_amount)).toBe(200000);
    expect(rows[0].currency).toBe('KRW');
    expect(rows[0].contract_name).toBe('__TEST__프로젝트A');
  });

  // ── POST /batch — upsert(UPDATE): 기존 id 전달 시 갱신 (중복 생성 안 함) ──
  it('POST /batch — 기존 id 전달 시 UPDATE (created 0 / updated 1)', async () => {
    const targetId = createdIds[0];
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__수금고객사', currency: 'KRW' },
        milestones: [
          {
            id: targetId,
            stage_name: '착수금(수정)',
            due_date: '2026-06-10',
            supply_amount: 2500000,
            tax_amount: 250000,
            scheduled_amount: 2750000,
          },
        ],
        delete_ids: [],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.updated).toBe(1);

    const [rows] = await pool.query(
      'SELECT stage_name, scheduled_amount FROM payment_schedules WHERE id = ?',
      [targetId]
    );
    expect(rows[0].stage_name).toBe('착수금(수정)');
    expect(Number(rows[0].scheduled_amount)).toBe(2750000);
  });

  // ── 유효성 검사 ────────────────────────────────────────────
  it('POST /batch — customer_name 누락 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: {},
        milestones: [{ stage_name: '착수금', due_date: '2026-06-05', scheduled_amount: 100 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /batch — 마일스톤 stage_name 누락 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__' },
        milestones: [{ due_date: '2026-06-05', scheduled_amount: 100 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── 날짜 유효성 검사 (2026-05-29 추가) ──────────────────────
  //   ① 계약 시작/종료일 연도 4자리  ② due ≥ 계약 시작일  ③ 착수금 ≤ 중도금 ≤ 잔금
  it('POST /batch — 계약 시작일 연도가 4자리가 아니면 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__연도', currency: 'KRW', contract_start_date: '12026-01-01' },
        milestones: [
          { stage_name: '착수금', due_date: '2026-06-05', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /batch — 수금예정일이 계약 시작일보다 과거면 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__과거', currency: 'KRW', contract_start_date: '2026-03-01' },
        milestones: [
          { stage_name: '착수금', due_date: '2026-02-01', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /batch — 중도금이 착수금보다 빠르면 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__순서', currency: 'KRW' },
        milestones: [
          { stage_name: '착수금', due_date: '2026-06-10', supply_amount: 1000000, scheduled_amount: 1100000 },
          { stage_name: '중도금', due_date: '2026-06-05', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /batch — 잔금이 중도금보다 빠르면 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__순서2', currency: 'KRW' },
        milestones: [
          { stage_name: '착수금', due_date: '2026-06-01', supply_amount: 1000000, scheduled_amount: 1100000 },
          { stage_name: '중도금', due_date: '2026-07-01', supply_amount: 1000000, scheduled_amount: 1100000 },
          { stage_name: '잔금', due_date: '2026-06-15', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── 계약 연결: shared.contract_id/customer_id 영속 (2026-05-31) ──
  it('POST /batch — shared.contract_id/customer_id 전달 시 영속 (계약 연결)', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: {
          customer_name: '__TEST__계약연결',
          currency: 'KRW',
          contract_id: 999001,
          customer_id: 42,
        },
        milestones: [
          { stage_name: '착수금', due_date: '2026-06-05', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    res.body.data.ids.forEach(id => createdIds.push(id));

    const [[row]] = await pool.query(
      'SELECT contract_id, customer_id FROM payment_schedules WHERE id = ?',
      [res.body.data.ids[0]]
    );
    expect(Number(row.contract_id)).toBe(999001);
    expect(Number(row.customer_id)).toBe(42);
  });

  // ── 수금현황 엑셀 내보내기 ──
  it('GET /export — 수금현황 엑셀(.xlsx) 다운로드 200', async () => {
    const res = await api().get('/api/payments/export').set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition'] || '').toContain('attachment');
  });

  // ── PUT /config — 허용되지 않은 통화 → 400 (라우트 등록 확인, 부수효과 없음) ──
  it('PUT /config — 허용되지 않은 통화 코드 → 400', async () => {
    const res = await api()
      .put('/api/payments/config')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ default_currency: 'XXX' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ── 세금계산서(tax invoices) — 발행요청 UI 백엔드 (2026-05-31 Phase 2 키 불필요) ──
//   draft(작성중) → requested(발행요청) → issued(발행완료, 수동 기록) → cancelled(취소)
//   ※ 바로빌 자동발행/국세청 전송 아님 — 상태를 수동으로 관리
describe('Payments API — 세금계산서(tax invoices) 발행요청 + 상태 전환', () => {
  let taxId;

  it('POST /tax-invoices — draft 생성 → 200 + id (합계/번호 저장)', async () => {
    const res = await api()
      .post('/api/payments/tax-invoices')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        customer_name: '__TEST__세금고객사',
        invoice_no: 'TEST-0001',
        supply_amount: 1000000,
        tax_amount: 100000,
        issue_date: '2026-06-30',
        note: '테스트 발행요청',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
    taxId = res.body.data.id;
    createdTaxIds.push(taxId);

    const [[row]] = await pool.query(
      'SELECT status, total_amount, invoice_no FROM tax_invoices WHERE id = ?',
      [taxId]
    );
    expect(row.status).toBe('draft');
    expect(Number(row.total_amount)).toBe(1100000);
    expect(row.invoice_no).toBe('TEST-0001');
  });

  it('POST /tax-invoices — supply_amount 누락 → 400', async () => {
    const res = await api()
      .post('/api/payments/tax-invoices')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__무공급가' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('PUT /tax-invoices/:id — 허용되지 않은 상태값 → 400', async () => {
    const res = await api()
      .put(`/api/payments/tax-invoices/${taxId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'unknown_status' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('PUT /tax-invoices/:id — 발행완료(issued) 전환 → issued_at 자동 기록', async () => {
    const res = await api()
      .put(`/api/payments/tax-invoices/${taxId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'issued' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [[row]] = await pool.query('SELECT status, issued_at FROM tax_invoices WHERE id = ?', [
      taxId,
    ]);
    expect(row.status).toBe('issued');
    expect(row.issued_at).not.toBeNull();
  });

  it('PUT /tax-invoices/:id — issued 전환 시 연결 수금 스케줄 상태 invoiced 자동 전환', async () => {
    // 1) 수금 스케줄(scheduled) 생성
    const b = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__연동', currency: 'KRW' },
        milestones: [
          { stage_name: '착수금', due_date: '2026-09-05', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    const schedId = b.body.data.ids[0];
    createdIds.push(schedId);

    // 2) 해당 스케줄에 연결된 세금계산서(draft)
    const c = await api()
      .post('/api/payments/tax-invoices')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ schedule_id: schedId, customer_name: '__TEST__연동', supply_amount: 1000000, tax_amount: 100000 });
    const tid = c.body.data.id;
    createdTaxIds.push(tid);

    // 3) 발행완료 전환 → 스케줄 상태 자동 invoiced
    const res = await api()
      .put(`/api/payments/tax-invoices/${tid}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'issued' });
    expect(res.status).toBe(200);

    const [[sch]] = await pool.query('SELECT status FROM payment_schedules WHERE id = ?', [schedId]);
    expect(sch.status).toBe('invoiced');
  });

  it('DELETE /tax-invoices/:id — 발행완료 건은 삭제 차단 → 400', async () => {
    const res = await api()
      .delete(`/api/payments/tax-invoices/${taxId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('GET /tax-invoices — 목록에 생성 건 포함', async () => {
    const res = await api()
      .get('/api/payments/tax-invoices')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some(t => t.id === taxId)).toBe(true);
  });

  it('DELETE /tax-invoices/:id — draft 건은 삭제 성공 → 200', async () => {
    const c = await api()
      .post('/api/payments/tax-invoices')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__삭제용', supply_amount: 500000, tax_amount: 50000 });
    const delId = c.body.data.id;
    const res = await api()
      .delete(`/api/payments/tax-invoices/${delId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [rows] = await pool.query('SELECT id FROM tax_invoices WHERE id = ?', [delId]);
    expect(rows).toHaveLength(0);
  });
});

// ── 홈택스 가져오기(import) — 파일 파싱 + 매핑 행 일괄 등록 (2026-05-31) ──
//   POST /import/parse (csv→headers/rows) · POST /tax-invoices/bulk (issued, 중복 스킵)
describe('Payments API — 홈택스 가져오기(import)', () => {
  it('POST /tax-invoices/bulk — 2행 일괄 등록 (issued)', async () => {
    const res = await api()
      .post('/api/payments/tax-invoices/bulk')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        rows: [
          { customer_name: '__HTTEST__A', supply_amount: 1000000, tax_amount: 100000, issue_date: '2026-05-01', invoice_no: 'HTTEST-001' },
          { customer_name: '__HTTEST__B', supply_amount: 2000000, tax_amount: 200000, issue_date: '2026-05-02', invoice_no: 'HTTEST-002' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.created).toBe(2);
    expect(res.body.data.duplicates).toBe(0);
    expect(res.body.data.errors).toHaveLength(0);

    const [[row]] = await pool.query(
      'SELECT status, total_amount FROM tax_invoices WHERE invoice_no = ?',
      ['HTTEST-001']
    );
    expect(row.status).toBe('issued');
    expect(Number(row.total_amount)).toBe(1100000);
  });

  it('POST /tax-invoices/bulk — 중복 발행번호 스킵 + 공급가 누락 행 오류', async () => {
    const res = await api()
      .post('/api/payments/tax-invoices/bulk')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        rows: [
          { customer_name: '__HTTEST__dup', supply_amount: 500000, invoice_no: 'HTTEST-001' }, // 이미 존재 → 중복
          { customer_name: '__HTTEST__noamt', invoice_no: 'HTTEST-003' }, // 공급가 없음 → 오류
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.duplicates).toBe(1);
    expect(res.body.data.errors.length).toBe(1);
  });

  it('POST /tax-invoices/bulk — 빈 배열 → 400', async () => {
    const res = await api()
      .post('/api/payments/tax-invoices/bulk')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ rows: [] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /import/parse — CSV 파싱 → headers/rows (위치 기반)', async () => {
    const csv =
      '작성일자,상호,공급가액,세액,승인번호\n2026-05-01,테스트상사,1000000,100000,HT-1\n2026-05-02,테스트물산,2000000,200000,HT-2';
    const res = await api()
      .post('/api/payments/import/parse')
      .set('X-User-Id', String(TEST_USER_ID))
      .attach('file', Buffer.from(csv, 'utf-8'), 'hometax.csv');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.headers).toContain('작성일자');
    expect(res.body.data.headers).toContain('공급가액');
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows[0][0]).toBe('2026-05-01');
  });
});

// ── B1: 연체 미수금 자동 알림 — 스캔 → 인앱/이메일 + dedup + 읽음 (2026-06-01) ──
//   POST /notifications/scan · GET /notifications · PUT /notifications/:id/read
//   고정 재무팀 메일(payment_overdue_notify_email) 설정값으로 요약 메일 큐잉
describe('Payments API — 연체 미수금 알림 (B1)', () => {
  let overdueSchedId;

  it('준비 — 과거 예정일(2020-01-01) 수금 스케줄 생성 (연체 대상)', async () => {
    const b = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__연체고객', contract_name: '__TEST__연체PJT', currency: 'KRW' },
        milestones: [
          {
            stage_name: '잔금',
            due_date: '2020-01-01',
            supply_amount: 1000000,
            tax_amount: 100000,
            scheduled_amount: 1100000,
          },
        ],
        delete_ids: [],
      });
    expect(b.status).toBe(200);
    overdueSchedId = b.body.data.ids[0];
    createdIds.push(overdueSchedId);
  });

  it('PUT /config — notify_email 저장 + GET 반영 + 잘못된 형식 400', async () => {
    // 원복용 원본 보관
    const before = await api().get('/api/payments/config').set('X-User-Id', String(TEST_USER_ID));
    origNotifyEmail = before.body.data.notify_email || '';

    const bad = await api()
      .put('/api/payments/config')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ notify_email: 'not-an-email' });
    expect(bad.status).toBe(400);
    expect(bad.body.success).toBe(false);

    const ok = await api()
      .put('/api/payments/config')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ notify_email: TEST_NOTIFY_EMAIL });
    expect(ok.status).toBe(200);

    const after = await api().get('/api/payments/config').set('X-User-Id', String(TEST_USER_ID));
    expect(after.body.data.notify_email).toBe(TEST_NOTIFY_EMAIL);
  });

  it('POST /notifications/scan — 신규 연체 인앱 알림 + 재무팀 이메일(pending) 생성', async () => {
    // 이전 실행 잔여 정리 (동일 스케줄 dedup / 당일 이메일 키)
    await pool.query('DELETE FROM payment_notifications WHERE schedule_id = ?', [overdueSchedId]);
    await pool.query('DELETE FROM payment_notifications WHERE recipient = ?', [TEST_NOTIFY_EMAIL]);

    const res = await api()
      .post('/api/payments/notifications/scan')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.created_inapp).toBeGreaterThanOrEqual(1);
    expect(res.body.data.created_email).toBe(1); // notify_email 설정됨 → 요약 1건

    // 인앱 알림 행 (dedup_key=overdue:<id>)
    const [[inapp]] = await pool.query(
      `SELECT status, channel, overdue_days, amount FROM payment_notifications
        WHERE schedule_id = ? AND channel='inapp'`,
      [overdueSchedId]
    );
    expect(inapp.status).toBe('unread');
    expect(Number(inapp.amount)).toBe(1100000);
    expect(inapp.overdue_days).toBeGreaterThan(0);

    // 이메일 알림 행 (Gmail OAuth 없음 → pending 큐잉, 있으면 sent)
    const [[email]] = await pool.query(
      `SELECT status, recipient FROM payment_notifications
        WHERE recipient = ? AND channel='email'`,
      [TEST_NOTIFY_EMAIL]
    );
    expect(email.recipient).toBe(TEST_NOTIFY_EMAIL);
    expect(['pending', 'sent']).toContain(email.status);
  });

  it('POST /notifications/scan — 재스캔 시 동일 연체 중복 생성 안 함 (dedup)', async () => {
    const res = await api()
      .post('/api/payments/notifications/scan')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.created_inapp).toBe(0); // 이미 알림 존재 → 0
    expect(res.body.data.created_email).toBe(0); // 신규 연체 없음 → 메일 없음

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS c FROM payment_notifications WHERE schedule_id = ? AND channel='inapp'`,
      [overdueSchedId]
    );
    expect(Number(cnt.c)).toBe(1);
  });

  it('GET /notifications — 인앱 목록 + unread_count 반환', async () => {
    const res = await api()
      .get('/api/payments/notifications?status=unread')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.unread_count).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some(n => n.schedule_id === overdueSchedId)).toBe(true);
  });

  it('PUT /notifications/:id/read — 읽음 처리 → status=read + read_at 기록', async () => {
    const [[row]] = await pool.query(
      `SELECT id FROM payment_notifications WHERE schedule_id = ? AND channel='inapp'`,
      [overdueSchedId]
    );
    const res = await api()
      .put(`/api/payments/notifications/${row.id}/read`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [[after]] = await pool.query(
      'SELECT status, read_at FROM payment_notifications WHERE id = ?',
      [row.id]
    );
    expect(after.status).toBe('read');
    expect(after.read_at).not.toBeNull();
  });
});

// ── 은행 거래내역 자동 매칭 (입금 자동화) — match/apply (2026-06-08) ──
//   POST /bank/match (금액·입금자명·예정일 점수화) · POST /bank/apply (일괄 입금 + 상태전환)
describe('Payments API — 은행 거래내역 자동 매칭 (Phase 1)', () => {
  let schX, schY, schZ;

  const mkSchedule = (name, scheduled, supply, tax, due, stage) =>
    api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: name, currency: 'KRW' },
        milestones: [
          { stage_name: stage, due_date: due, supply_amount: supply, tax_amount: tax, scheduled_amount: scheduled },
        ],
        delete_ids: [],
      });

  it('준비 — 미수 스케줄 3건 생성 (고유 금액)', async () => {
    const a = await mkSchedule('__BANK__가나상사', 5610000, 5100000, 510000, '2026-08-10', '잔금');
    const b = await mkSchedule('__BANK__다라물산', 3410000, 3100000, 310000, '2026-08-20', '중도금');
    const c = await mkSchedule('__BANK__마바테크', 2090000, 1900000, 190000, '2026-08-25', '착수금');
    schX = a.body.data.ids[0];
    schY = b.body.data.ids[0];
    schZ = c.body.data.ids[0];
    [schX, schY, schZ].forEach(id => createdIds.push(id));
    expect(schX && schY && schZ).toBeTruthy();
  });

  it('POST /bank/match — 금액+입금자명+예정일 점수화 (상위 후보 + 콤마 파싱)', async () => {
    const res = await api()
      .post('/api/payments/bank/match')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        rows: [
          { date: '2026-08-11', amount: 5610000, name: '가나상사', memo: '8월 잔금' },
          { date: '2026-08-21', amount: '3,410,000', name: '(주)다라물산', memo: '' }, // 콤마/(주) 파싱
          { date: '2026-08-15', amount: 9999999999, name: '없는회사', memo: '' }, // 초고액 → 미매칭
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // 공유 dev DB 의 기존 미수금에 따라 매칭 수가 달라질 수 있어, 내 행만 정확히 검증
    expect(res.body.data.summary.total).toBe(3);

    const m0 = res.body.data.matches[0];
    expect(m0.suggested_schedule_id).toBe(schX);
    expect(m0.candidates[0].confidence).toBe('high');
    expect(m0.candidates[0].reasons).toContain('잔액 정확 일치');

    // 콤마 포함 금액 + (주) 정규화 → 다라물산 매칭
    expect(res.body.data.matches[1].suggested_schedule_id).toBe(schY);

    // 매칭 없는 행 → suggested null
    expect(res.body.data.matches[2].suggested_schedule_id).toBeNull();
  });

  it('POST /bank/apply — 확정 매칭 일괄 등록 + 상태 자동전환(collected/partial)', async () => {
    const res = await api()
      .post('/api/payments/bank/apply')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        applies: [
          { schedule_id: schX, paid_amount: 5610000, paid_date: '2026-08-11', name: '가나상사', memo: '8월 잔금' },
          { schedule_id: schZ, paid_amount: 1000000, paid_date: '2026-08-26', name: '마바테크', memo: '부분' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(2);

    const [[x]] = await pool.query('SELECT status FROM payment_schedules WHERE id = ?', [schX]);
    expect(x.status).toBe('collected'); // 전액
    const [[z]] = await pool.query('SELECT status FROM payment_schedules WHERE id = ?', [schZ]);
    expect(z.status).toBe('partial'); // 1,000,000 < 2,090,000

    // payment_records — 자동매칭 표식 + bank_transfer
    const [[rec]] = await pool.query(
      'SELECT note, payment_method, paid_amount FROM payment_records WHERE schedule_id = ? ORDER BY id DESC LIMIT 1',
      [schX]
    );
    expect(rec.note).toContain('은행자동매칭');
    expect(rec.payment_method).toBe('bank_transfer');
    expect(Number(rec.paid_amount)).toBe(5610000);
  });

  it('POST /bank/match·/bank/apply — 빈 입력 → 400', async () => {
    const m = await api()
      .post('/api/payments/bank/match')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ rows: [] });
    expect(m.status).toBe(400);
    const a = await api()
      .post('/api/payments/bank/apply')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ applies: [] });
    expect(a.status).toBe(400);
  });
});
