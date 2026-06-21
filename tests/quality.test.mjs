/**
 * 전사 품질관리 (Quality Inbox) API 테스트
 *   - POST /api/quality/cases    — 생성(+필수값)
 *   - GET  /api/quality/cases    — 전사 목록 + 필터 + 에이징
 *   - GET  /api/quality/summary  — KPI 집계
 *   - PUT  /api/quality/cases/:id — 수정(완료 시 resolved_at 자동)
 *   - SLA(처리기한·초과) 계산 + sla=overdue 필터
 *   - GET  /api/quality/documents — 문서 만료(CoA/MSDS) 현황
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let custId, caseId, overdueCaseId;

beforeAll(async () => {
  const [c] = await pool.query(
    `INSERT INTO customers (name, region, country, industry) VALUES ('__QINBOX_T__','국내','대한민국','반도체')`
  );
  custId = c.insertId;
  // SLA 초과 케이스: high(기한 7일) + 30일 전 발생 → 미해결이면 확실히 초과
  const [oc] = await pool.query(
    `INSERT INTO quality_cases (case_no, customer_id, type, severity, status, title, opened_at)
     VALUES (?, ?, 'NCR', 'high', 'received', '__QINBOX_OVERDUE__', DATE_SUB(CURDATE(), INTERVAL 30 DAY))`,
    [`Q-T${Date.now().toString().slice(-7)}`, custId]
  );
  overdueCaseId = oc.insertId;
  // 문서 만료 데모: 만료(과거) / 임박(5일 후) / 유효(2년 후)
  await pool.query(
    `INSERT INTO quality_documents (customer_id, doc_type, doc_no, issued_at, valid_until, note) VALUES
       (?, 'MSDS', '__QDOC_EXPIRED__', DATE_SUB(CURDATE(), INTERVAL 400 DAY), DATE_SUB(CURDATE(), INTERVAL 10 DAY), '__QDOC__'),
       (?, 'CoA',  '__QDOC_SOON__',    DATE_SUB(CURDATE(), INTERVAL 360 DAY), DATE_ADD(CURDATE(), INTERVAL 5 DAY),  '__QDOC__'),
       (?, 'CoA',  '__QDOC_VALID__',   CURDATE(),                              DATE_ADD(CURDATE(), INTERVAL 730 DAY), '__QDOC__')`,
    [custId, custId, custId]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM quality_documents WHERE note = '__QDOC__'");
  // 하위(이력/첨부) 정리 후 케이스 삭제
  const [tc] = await pool.query("SELECT id FROM quality_cases WHERE title LIKE '\\_\\_QINBOX%'");
  for (const r of tc) {
    await pool.query('DELETE FROM quality_history WHERE case_id=?', [r.id]);
    await pool.query('DELETE FROM quality_files WHERE case_id=?', [r.id]);
  }
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

  it('GET /quality/summary — KPI 구조 (SLA·문서 만료 포함)', async () => {
    const res = await api().get('/api/quality/summary').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toHaveProperty('open_total');
    expect(d).toHaveProperty('high_open');
    expect(d).toHaveProperty('avg_resolve_days');
    expect(d).toHaveProperty('overdue');
    expect(d).toHaveProperty('doc_expired');
    expect(d).toHaveProperty('doc_expiring');
    expect(d.sla_policy).toMatchObject({ high: 7, medium: 14, low: 30 });
    expect(d.open_total).toBeGreaterThanOrEqual(1);
    expect(d.overdue).toBeGreaterThanOrEqual(1); // 위에서 만든 30일 전 high 케이스
    expect(d.doc_expired).toBeGreaterThanOrEqual(1);
    expect(d.doc_expiring).toBeGreaterThanOrEqual(1);
  });

  it('GET /quality/cases — SLA 필드(due_date·days_left·overdue) 산출', async () => {
    const res = await api().get('/api/quality/cases?status=unresolved').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const row = res.body.data.find(r => r.id === overdueCaseId);
    expect(row).toBeTruthy();
    expect(row.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // DATE_FORMAT 문자열
    expect(Number(row.days_left)).toBeLessThan(0); // 기한 경과
    expect(Number(row.overdue)).toBe(1);
  });

  it('GET /quality/cases?sla=overdue — 초과 케이스만 필터', async () => {
    const res = await api().get('/api/quality/cases?sla=overdue').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.find(r => r.id === overdueCaseId)).toBeTruthy();
    // 모두 미해결 + 기한 경과여야 함
    for (const r of res.body.data) {
      expect(r.status).not.toBe('resolved');
      expect(Number(r.overdue)).toBe(1);
    }
  });

  it('GET /quality/documents — 만료 상태 + days_left + 상태 필터', async () => {
    const all = await api().get('/api/quality/documents').set('X-User-Id', '1');
    expect(all.status).toBe(200);
    const expired = all.body.data.find(d => d.doc_no === '__QDOC_EXPIRED__');
    expect(expired).toBeTruthy();
    expect(expired.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(expired.days_left)).toBeLessThan(0);

    const onlyExpired = await api().get('/api/quality/documents?status=expired').set('X-User-Id', '1');
    expect(onlyExpired.body.data.every(d => Number(d.days_left) < 0)).toBe(true);
    expect(onlyExpired.body.data.find(d => d.doc_no === '__QDOC_VALID__')).toBeFalsy();

    const expiring = await api().get('/api/quality/documents?status=expiring').set('X-User-Id', '1');
    expect(expiring.body.data.find(d => d.doc_no === '__QDOC_SOON__')).toBeTruthy();
    expect(expiring.body.data.find(d => d.doc_no === '__QDOC_EXPIRED__')).toBeFalsy();
  });

  it('POST — 기본 상태 received + priority/channel/created_by + 이력 기록', async () => {
    const ok = await api()
      .post('/api/quality/cases')
      .set('X-User-Id', '7')
      .send({
        customer_id: custId,
        type: 'NCR',
        severity: 'medium',
        priority: 'urgent',
        channel: 'audit',
        title: '__QINBOX_WF__ 워크플로우',
        description: '고객 제기: 순도 편차로 수율 하락',
      });
    expect(ok.status).toBe(200);
    const wfId = ok.body.data.id;
    const [[row]] = await pool.query(
      'SELECT status, priority, channel, created_by, description FROM quality_cases WHERE id=?',
      [wfId]
    );
    expect(row.status).toBe('received'); // 기본 시작 상태(A/S 동일)
    expect(row.priority).toBe('urgent');
    expect(row.channel).toBe('audit');
    expect(row.created_by).toBe(7); // 접수자 = 현재 사용자
    expect(row.description).toBe('고객 제기: 순도 편차로 수율 하락'); // 접수내용 저장
    // 접수 이력 기록
    const hist = await api().get(`/api/quality/cases/${wfId}/history`).set('X-User-Id', '1');
    expect(hist.body.data.find(h => h.field === 'created')).toBeTruthy();
  });

  it('PATCH /cases/:id/transfer — 이관(담당 변경) + 사유 이력', async () => {
    const tr = await api()
      .patch(`/api/quality/cases/${overdueCaseId}/transfer`)
      .set('X-User-Id', '1')
      .send({ owner_id: 3, note: '생산팀 원인분석 이관' });
    expect(tr.status).toBe(200);
    const [[row]] = await pool.query('SELECT owner_id FROM quality_cases WHERE id=?', [overdueCaseId]);
    expect(row.owner_id).toBe(3);
    const hist = await api().get(`/api/quality/cases/${overdueCaseId}/history`).set('X-User-Id', '1');
    const ev = hist.body.data.find(h => h.field === 'owner_id' && h.note === '생산팀 원인분석 이관');
    expect(ev).toBeTruthy();
    expect(String(ev.to_value)).toBe('3');
  });

  it('PUT — 8D/CAPA 도메인 필드 저장/조회 (근본원인·CAPA·불량코드·재발)', async () => {
    const res = await api()
      .put(`/api/quality/cases/${caseId}`)
      .set('X-User-Id', '1')
      .send({
        root_cause: '챔버 MFC 드리프트',
        correction: 'Lot 격리',
        preventive_action: 'MFC 주기 교정 표준 신설',
        verification: '후속 3배치 SPEC 충족',
        verified_at: '2026-06-20',
        defect_code: 'ETCH-PURITY',
        lot_no: 'L2026-0612',
        defect_qty: 120,
        defect_unit: 'ea',
        customer_ref_no: 'SEC-CLM-9981',
        is_recurring: 1,
      });
    expect(res.status).toBe(200);
    const list = await api().get('/api/quality/cases?status=unresolved').set('X-User-Id', '1');
    let row = list.body.data.find(r => r.id === caseId);
    // caseId 가 미해결이 아닐 수 있어 전체에서 재확인
    if (!row) {
      const all = await api().get('/api/quality/cases?status=').set('X-User-Id', '1');
      row = all.body.data.find(r => r.id === caseId);
    }
    expect(row.root_cause).toBe('챔버 MFC 드리프트');
    expect(row.preventive_action).toBe('MFC 주기 교정 표준 신설');
    expect(row.defect_code).toBe('ETCH-PURITY');
    expect(Number(row.defect_qty)).toBe(120);
    expect(Number(row.is_recurring)).toBe(1);
    expect(row.customer_ref_no).toBe('SEC-CLM-9981');
  });

  it('PUT — 드롭(dropped) 종결 시 closed_at 기록 + 미해결 집계 제외', async () => {
    const res = await api()
      .put(`/api/quality/cases/${overdueCaseId}`)
      .set('X-User-Id', '1')
      .send({ status: 'dropped' });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT status, closed_at FROM quality_cases WHERE id=?', [
      overdueCaseId,
    ]);
    expect(row.status).toBe('dropped');
    expect(row.closed_at).toBeTruthy();
    // dropped 는 미해결 목록에서 제외
    const list = await api().get('/api/quality/cases?status=unresolved').set('X-User-Id', '1');
    expect(list.body.data.find(r => r.id === overdueCaseId)).toBeFalsy();
  });

  it('PUT /quality/cases/:id — 완료 처리 시 resolved_at 자동 기록 + 상태 이력', async () => {
    const res = await api().put(`/api/quality/cases/${caseId}`).set('X-User-Id', '1').send({ status: 'resolved' });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT status, resolved_at FROM quality_cases WHERE id=?', [caseId]);
    expect(row.status).toBe('resolved');
    expect(row.resolved_at).toBeTruthy();
    const hist = await api().get(`/api/quality/cases/${caseId}/history`).set('X-User-Id', '1');
    expect(hist.body.data.find(h => h.field === 'status' && h.to_value === 'resolved')).toBeTruthy();
  });
});
