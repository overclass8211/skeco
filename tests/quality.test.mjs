/**
 * 전사 품질관리 (Quality Inbox) API 테스트
 *   - POST /api/quality/cases    — 생성(+필수값)
 *   - GET  /api/quality/cases    — 전사 목록 + 필터 + 에이징
 *   - GET  /api/quality/summary  — KPI 집계
 *   - PUT  /api/quality/cases/:id — 수정(완료 시 resolved_at 자동)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let custId, caseId;

beforeAll(async () => {
  const [c] = await pool.query(
    `INSERT INTO customers (name, region, country, industry) VALUES ('__QINBOX_T__','국내','대한민국','반도체')`
  );
  custId = c.insertId;
});

afterAll(async () => {
  await pool.query("DELETE FROM quality_cases WHERE title LIKE '\\_\\_QINBOX%'");
  if (custId) await pool.query('DELETE FROM customers WHERE id=?', [custId]);
});

describe('전사 품질관리 (Quality Inbox) API', () => {
  it('POST /quality/cases — 생성 + 필수값(customer_id) 검증', async () => {
    const bad = await api().post('/api/quality/cases').set('X-User-Id', '1').send({ title: 'x' });
    expect(bad.status).toBe(400);
    const ok = await api()
      .post('/api/quality/cases')
      .set('X-User-Id', '1')
      .send({ customer_id: custId, type: 'NCR', severity: 'high', title: '__QINBOX_T__ 케이스', opened_at: '2026-06-01' });
    expect(ok.status).toBe(200);
    caseId = ok.body.data.id;
    expect(ok.body.data.case_no).toMatch(/^Q-/);
  });

  it('GET /quality/cases — 전사 목록 + 필터 + age_days', async () => {
    const res = await api().get('/api/quality/cases?status=unresolved&severity=high').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const row = res.body.data.find(r => r.id === caseId);
    expect(row).toBeTruthy();
    expect(row.customer_name).toBe('__QINBOX_T__');
    expect(row).toHaveProperty('age_days');
    expect(res.body).toHaveProperty('detail_restricted');
  });

  it('GET /quality/summary — KPI 구조', async () => {
    const res = await api().get('/api/quality/summary').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toHaveProperty('open_total');
    expect(d).toHaveProperty('high_open');
    expect(d).toHaveProperty('avg_resolve_days');
    expect(d.open_total).toBeGreaterThanOrEqual(1);
  });

  it('PUT /quality/cases/:id — 완료 처리 시 resolved_at 자동 기록', async () => {
    const res = await api().put(`/api/quality/cases/${caseId}`).set('X-User-Id', '1').send({ status: 'resolved' });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT status, resolved_at FROM quality_cases WHERE id=?', [caseId]);
    expect(row.status).toBe('resolved');
    expect(row.resolved_at).toBeTruthy();
  });
});
