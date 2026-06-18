/**
 * Proposals API 통합 테스트 — Phase 1 (CRUD + 상태 + history)
 *
 * 검증 대상: /api/proposals
 *   GET    /next-proposal-no — P-YYYY-NNNN 미리보기
 *   GET    /                 — 목록 (페이징 + 필터)
 *   GET    /:id              — 단건 + history
 *   POST   /                 — 생성 (자동채번 + history)
 *   PUT    /:id              — 수정 (status timestamp 자동)
 *   PATCH  /:id/status       — 상태 전환 + history
 *   DELETE /:id              — CASCADE 삭제
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TEST_USER_ID = 1;
const createdIds = [];

beforeAll(async () => {
  // 마이그레이션 완료 대기 — server.js 로드 시 자동 트리거
  // (helpers.mjs 가 server.js 로드)
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM proposals WHERE id IN (?)', [createdIds]);
  }
});

describe('Proposals API — Phase 1', () => {
  let createdId;
  let createdNo;

  it('GET /next-proposal-no — P-YYYY-NNNN 패턴', async () => {
    const res = await api()
      .get('/api/proposals/next-proposal-no?year=2026')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.proposal_no).toMatch(/^P-2026-\d{4}$/);
    expect(res.body.data.year).toBe(2026);
  });

  it('POST / — 신규 제안 + 자동채번 + history 기록', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__제안_A',
        customer_name: '__TEST__고객사_A',
        proposal_date: '2026-05-21',
        due_date: '2026-06-20',
        expected_amount: 50000000,
        currency: 'KRW',
        remark: '테스트 비고',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.proposal_no).toMatch(/^P-2026-\d{4}$/);
    createdId = res.body.id;
    createdNo = res.body.data.proposal_no;
    createdIds.push(createdId);

    // history 자동 기록 검증
    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    const history = detail.body.data.history;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some(h => h.action_type === 'create')).toBe(true);
  });

  it('POST / — 제안명 누락 시 400', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__', proposal_date: '2026-05-21' });
    expect(res.status).toBe(400);
  });

  it('POST / — 고객명 누락 시 400 (lead 도 없는 경우)', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_title: '__TEST__', proposal_date: '2026-05-21' });
    expect(res.status).toBe(400);
  });

  it('GET / — 목록 (생성한 제안 포함)', async () => {
    const res = await api()
      .get('/api/proposals?search=__TEST__&limit=50')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(p => p.id === createdId);
    expect(found).toBeDefined();
    expect(found.proposal_no).toBe(createdNo);
    expect(Number(found.expected_amount)).toBe(50000000);
  });

  it('GET /:id — 단건 + lead/quote null + files/revisions/history 배열', async () => {
    const res = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdId);
    expect(res.body.data.lead).toBeNull();
    expect(res.body.data.quote).toBeNull();
    expect(Array.isArray(res.body.data.files)).toBe(true);
    expect(Array.isArray(res.body.data.revisions)).toBe(true);
    expect(Array.isArray(res.body.data.email_logs)).toBe(true);
    expect(Array.isArray(res.body.data.history)).toBe(true);
  });

  it('GET /:id — 존재하지 않는 ID 404', async () => {
    const res = await api().get('/api/proposals/9999999').set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  it('PUT /:id — 수정 + history update 기록', async () => {
    const res = await api()
      .put(`/api/proposals/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_title: '__TEST__제안_A_수정', expected_amount: 60000000 });
    expect(res.status).toBe(200);

    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.proposal_title).toBe('__TEST__제안_A_수정');
    expect(Number(detail.body.data.expected_amount)).toBe(60000000);
    expect(detail.body.data.history.some(h => h.action_type === 'update')).toBe(true);
  });

  it('PATCH /:id/status — draft → sent (sent_at 자동 기록) + history', async () => {
    const r1 = await api()
      .patch(`/api/proposals/${createdId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'sent' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.status).toBe('sent');

    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.status).toBe('sent');
    expect(detail.body.data.sent_at).toBeTruthy();
    expect(
      detail.body.data.history.some(h => h.action_type === 'status_change' && h.new_value === 'sent')
    ).toBe(true);
  });

  it('PATCH /:id/status — sent → accepted (accepted_at 자동 기록)', async () => {
    const r = await api()
      .patch(`/api/proposals/${createdId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'accepted' });
    expect(r.status).toBe(200);

    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.accepted_at).toBeTruthy();
  });

  it('PATCH /:id/status — 잘못된 상태값 400', async () => {
    const r = await api()
      .patch(`/api/proposals/${createdId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'INVALID_X' });
    expect(r.status).toBe(400);
  });

  it('POST / + quote_id 자동 반영 — quote_no/expected_amount 자동', async () => {
    // 1) 임시 견적 생성
    const q = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_for_proposal',
        customer_name: '__TEST__quote_cust',
        quote_date: '2026-05-21',
        items: [{ item_name: 'A', unit_price: 1000000, quantity: 5 }],
      });
    const quoteId = q.body.id;

    // 2) 제안 생성 시 quote_id 만 명시 — customer_name/quote_no/expected_amount 자동
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__제안_quote연결',
        proposal_date: '2026-05-21',
        quote_id: quoteId,
        // customer_name 생략 → 견적에서 자동 추출
      });
    expect(res.status).toBe(200);
    const propId = res.body.id;
    createdIds.push(propId);

    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.quote_id).toBe(quoteId);
    expect(detail.body.data.quote_no).toMatch(/^Q-/);
    expect(detail.body.data.customer_name).toBe('__TEST__quote_cust');
    expect(Number(detail.body.data.expected_amount)).toBe(5000000); // 1000000 * 5
    expect(detail.body.data.quote).toBeDefined();
    expect(detail.body.data.quote.id).toBe(quoteId);

    // 정리 — 견적
    await pool.query('DELETE FROM quotes WHERE id = ?', [quoteId]);
  });

  // Phase 2: RFP 메타정보 저장/조회
  it('PUT /:id — RFP 메타정보 저장 (title/received_date/due_date/summary)', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__RFP메타',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const rfpId = create.body.id;
    createdIds.push(rfpId);

    const summary = 'RFP 요약:\n- 핵심 요구사항\n- 평가 기준\n- 예산 100억';
    await api()
      .put(`/api/proposals/${rfpId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        rfp_title: '2026년 클라우드 인프라 구축 RFP',
        rfp_received_date: '2026-05-15',
        rfp_due_date: '2026-06-15',
        rfp_summary: summary,
      });

    const detail = await api().get(`/api/proposals/${rfpId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.rfp_title).toBe('2026년 클라우드 인프라 구축 RFP');
    expect(detail.body.data.rfp_summary).toBe(summary);
    // 날짜는 DATE 타입 — DB 가 ISO 로 반환 + TZ 변환 가능 (KST → UTC -9h)
    // 입력값 ± 1일 범위만 확인 (TZ 무관 round-trip)
    const rcv = new Date(detail.body.data.rfp_received_date).getTime();
    const due = new Date(detail.body.data.rfp_due_date).getTime();
    expect(Math.abs(rcv - new Date('2026-05-15').getTime())).toBeLessThanOrEqual(24 * 3600 * 1000);
    expect(Math.abs(due - new Date('2026-06-15').getTime())).toBeLessThanOrEqual(24 * 3600 * 1000);
  });

  // Phase 3: 파일 업로드 (multipart simulation via supertest .attach)
  it('POST /:id/files — 일반 파일 업로드 + history 기록 + 목록 노출', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__파일_제안',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    // 임시 파일 만들기 — 작은 PDF 파일 (헤더만)
    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_proposal_${propId}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF-1.4 dummy proposal file content'));

    const upload = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .field('description', '테스트 제안서')
      .field('is_final', '1')
      .field('include_in_email', '1')
      .attach('file', tmpFile);
    expect(upload.status).toBe(200);
    expect(upload.body.success).toBe(true);
    // Phase 4-B: 응답 형식 {uploaded, failed}
    expect(upload.body.data.uploaded.length).toBe(1);
    expect(upload.body.data.failed.length).toBe(0);
    expect(upload.body.data.uploaded[0].original_filename).toContain('__test_proposal');

    // 상세 조회 — 파일 목록 + history 기록 확인
    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.files.length).toBe(1);
    expect(detail.body.data.files[0].file_type).toBe('proposal');
    expect(detail.body.data.files[0].is_final).toBe(1);
    expect(detail.body.data.history.some(h => h.action_type === 'file_upload')).toBe(true);

    // 정리 — 디스크 파일
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it('POST /:id/rfp — RFP 파일 업로드 + 메타정보 동시 갱신', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__RFP파일',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_rfp_${propId}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF-1.4 dummy RFP'));

    const upload = await api()
      .post(`/api/proposals/${propId}/rfp`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('rfp_title', '클라우드 인프라 RFP')
      .field('rfp_received_date', '2026-05-15')
      .field('rfp_due_date', '2026-06-15')
      .attach('file', tmpFile);
    expect(upload.status).toBe(200);

    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.rfp_title).toBe('클라우드 인프라 RFP');
    expect(detail.body.data.files.length).toBe(1);
    expect(detail.body.data.files[0].file_type).toBe('rfp');
    expect(detail.body.data.history.some(h => h.action_type === 'rfp_upload')).toBe(true);

    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it('POST /:id/files — 허용 외 확장자 (.exe) 거부', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__bad_ext',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_bad_${propId}.exe`);
    fs.writeFileSync(tmpFile, Buffer.from('malicious'));

    const upload = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .attach('file', tmpFile);
    // multer fileFilter cb(null, false) → req.file 미생성 → 400
    expect(upload.status).toBe(400);

    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it('DELETE /:id/files/:fileId — 파일 삭제 + history', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__파일_삭제',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_del_${propId}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF dummy'));
    const up = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'etc')
      .attach('file', tmpFile);
    const fileId = up.body.data.uploaded[0].id;

    const del = await api()
      .delete(`/api/proposals/${propId}/files/${fileId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(del.status).toBe(200);

    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.files.length).toBe(0);
    expect(detail.body.data.history.some(h => h.action_type === 'file_delete')).toBe(true);

    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it('POST /:id/revisions — 리비전 생성 + version_no 증가 + history', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__리비전',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    // 첫 리비전 생성 — version_no 1 → 2
    const r1 = await api()
      .post(`/api/proposals/${propId}/revisions`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ title: '1차 수정안', description: '가격 5% 인하' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.revision_no).toBe(2);

    // 두 번째 리비전 — version_no 2 → 3
    const r2 = await api()
      .post(`/api/proposals/${propId}/revisions`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ title: '최종안' });
    expect(r2.body.data.revision_no).toBe(3);

    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.version_no).toBe(3);
    expect(detail.body.data.revisions.length).toBe(2);
    expect(detail.body.data.history.filter(h => h.action_type === 'revision_create').length).toBe(2);
  });

  // ── Phase 4-A: AI 제안전략 분석 ─────────────────────────────
  it('POST /:id/rfp/analyze — mock Gemini 응답 + 5필드 반환 + history 기록', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__AI분석',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    // RFP 파일 업로드
    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_ai_${propId}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF-1.4 AI test'));
    const up = await api()
      .post(`/api/proposals/${propId}/rfp`)
      .set('X-User-Id', String(TEST_USER_ID))
      .attach('file', tmpFile);
    const fileId = up.body.data.uploaded[0].id;

    // AI 분석 호출 (NODE_ENV=test → mock 응답)
    const ana = await api()
      .post(`/api/proposals/${propId}/rfp/analyze`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ file_id: fileId });
    expect(ana.status).toBe(200);
    expect(ana.body.success).toBe(true);
    expect(ana.body.data.rfp_title).toBe('__MOCK__ RFP 제목');
    expect(ana.body.data.rfp_received_date).toBe('2026-05-15');
    expect(ana.body.data.rfp_due_date).toBe('2026-06-15');
    expect(ana.body.data.rfp_summary).toMatch(/__MOCK__/);
    // Phase 8-A: 6섹션 마크다운 + 제안 기본정보 자동 추출
    expect(ana.body.data.ai_strategy_md).toMatch(/제안 목표/);
    expect(ana.body.data.proposal_title).toBe('__MOCK__ 제안서 제목');
    expect(ana.body.data.expected_amount).toBe(50000000);
    expect(ana.body.data.currency).toBe('KRW');
    // Phase 9: 고객사명 자동 추출
    expect(ana.body.data.customer_name).toBe('__MOCK__ 고객사');

    // DB 자동 저장 X — proposals.rfp_title 은 아직 비어있어야 함
    const [[prop]] = await pool.query(
      'SELECT rfp_title, rfp_summary, ai_strategy_md FROM proposals WHERE id = ?',
      [propId]
    );
    expect(prop.rfp_title).toBeNull();
    expect(prop.rfp_summary).toBeNull();
    expect(prop.ai_strategy_md).toBeNull();

    // history 에 ai_analyze 기록 (best-effort, 비동기이므로 약간 대기)
    await new Promise(r => setTimeout(r, 200));
    const [hist] = await pool.query(
      `SELECT action_type FROM proposal_history WHERE proposal_id = ? AND action_type = 'ai_analyze'`,
      [propId]
    );
    expect(hist.length).toBeGreaterThanOrEqual(1);

    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {}
  });

  it('POST /:id/rfp/analyze — file_id 누락 시 400', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__AI_400',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const r = await api()
      .post(`/api/proposals/${propId}/rfp/analyze`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/file_id/);
  });

  it('PUT /:id — ai_strategy_md 저장 시 ai_strategy_generated_at 자동 갱신 (Phase 4-C)', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__AI_저장',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const upd = await api()
      .put(`/api/proposals/${propId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        ai_strategy_md: '## 1. RFP 핵심 요약\n- 사용자 검토 후 저장된 전략',
        rfp_summary: 'AI 분석 결과 검토 완료',
      });
    expect(upd.status).toBe(200);

    const [[row]] = await pool.query(
      'SELECT ai_strategy_md, ai_strategy_generated_at FROM proposals WHERE id = ?',
      [propId]
    );
    expect(row.ai_strategy_md).toMatch(/RFP 핵심 요약/);
    expect(row.ai_strategy_generated_at).not.toBeNull();
  });

  it('POST /:id/rfp/analyze — 존재하지 않는 file_id 시 404', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__AI_404',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const r = await api()
      .post(`/api/proposals/${propId}/rfp/analyze`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ file_id: 99999999 });
    expect(r.status).toBe(404);
  });

  // ── Phase 4-B: 다중 파일 업로드 ─────────────────────────────
  it('POST /:id/rfp — 다중 파일 (files 필드) 동시 업로드 성공', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__다중RFP',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const f1 = path.join(os.tmpdir(), `__multi_rfp_a_${propId}.pdf`);
    const f2 = path.join(os.tmpdir(), `__multi_rfp_b_${propId}.pdf`);
    const f3 = path.join(os.tmpdir(), `__multi_rfp_c_${propId}.pdf`);
    fs.writeFileSync(f1, Buffer.from('%PDF a'));
    fs.writeFileSync(f2, Buffer.from('%PDF b'));
    fs.writeFileSync(f3, Buffer.from('%PDF c'));

    const upload = await api()
      .post(`/api/proposals/${propId}/rfp`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('rfp_title', '다중 RFP 묶음')
      .attach('files', f1)
      .attach('files', f2)
      .attach('files', f3);
    expect(upload.status).toBe(200);
    expect(upload.body.data.uploaded.length).toBe(3);
    expect(upload.body.data.failed.length).toBe(0);

    const detail = await api()
      .get(`/api/proposals/${propId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.files.length).toBe(3);
    expect(detail.body.data.rfp_title).toBe('다중 RFP 묶음');
    // 다중 history 기록
    expect(
      detail.body.data.history.filter(h => h.action_type === 'rfp_upload').length
    ).toBeGreaterThanOrEqual(3);

    [f1, f2, f3].forEach(f => {
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    });
  });

  it('POST /:id/files — file (단일) + files (다중) 혼합 입력 동시 처리', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__혼합업로드',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const single = path.join(os.tmpdir(), `__mix_single_${propId}.pdf`);
    const multi1 = path.join(os.tmpdir(), `__mix_multi1_${propId}.pdf`);
    const multi2 = path.join(os.tmpdir(), `__mix_multi2_${propId}.pdf`);
    [single, multi1, multi2].forEach(f => fs.writeFileSync(f, Buffer.from('%PDF mix')));

    const upload = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'reference')
      .attach('file', single)
      .attach('files', multi1)
      .attach('files', multi2);
    expect(upload.status).toBe(200);
    expect(upload.body.data.uploaded.length).toBe(3);
    expect(upload.body.data.uploaded.every(u => u.file_type === 'reference')).toBe(true);

    [single, multi1, multi2].forEach(f => {
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    });
  });

  // ── Phase 6-B: AI 제안서 평가 ───────────────────────────────
  it('POST /:id/evaluate — RFP + 제안서 mock 평가 + DB 저장 + history', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__AI평가',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    // RFP 파일 업로드
    const rfpFile = path.join(os.tmpdir(), `__eval_rfp_${propId}.pdf`);
    fs.writeFileSync(rfpFile, Buffer.from('%PDF-1.4 evaluation rfp test content'));
    const rfpUp = await api()
      .post(`/api/proposals/${propId}/rfp`)
      .set('X-User-Id', String(TEST_USER_ID))
      .attach('file', rfpFile);
    expect(rfpUp.body.data.uploaded.length).toBe(1);

    // 제안서 파일 업로드
    const propFile = path.join(os.tmpdir(), `__eval_prop_${propId}.pdf`);
    fs.writeFileSync(propFile, Buffer.from('%PDF-1.4 evaluation proposal test content'));
    const propUp = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .attach('file', propFile);
    const targetFileId = propUp.body.data.uploaded[0].id;

    // 평가 호출 (mock)
    const evalRes = await api()
      .post(`/api/proposals/${propId}/evaluate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_file_id: targetFileId });
    expect(evalRes.status).toBe(200);
    expect(evalRes.body.success).toBe(true);
    expect(evalRes.body.data.coverage_score).toBe(78);
    expect(evalRes.body.data.covered_count).toBe(12);
    expect(evalRes.body.data.missing_count).toBe(3);
    expect(evalRes.body.data.missing_items[0].severity).toBe('high');
    expect(evalRes.body.data.target_filename).toContain('__eval_prop');
    expect(evalRes.body.data.rfp_filename).toContain('__eval_rfp');

    // DB 저장 확인
    const [[row]] = await pool.query(
      `SELECT coverage_score, covered_count, missing_count
         FROM proposal_evaluations WHERE id = ?`,
      [evalRes.body.data.id]
    );
    expect(row.coverage_score).toBe(78);
    expect(row.covered_count).toBe(12);

    // history 'evaluate' 기록
    await new Promise(r => setTimeout(r, 200));
    const [hist] = await pool.query(
      `SELECT action_type, description FROM proposal_history
        WHERE proposal_id = ? AND action_type = 'evaluate'`,
      [propId]
    );
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist[0].description).toMatch(/커버율 78%/);

    [rfpFile, propFile].forEach(f => {
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    });
  });

  it('GET /:id/evaluations — 평가 이력 조회 (다중 버전)', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__평가이력',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const rfpFile = path.join(os.tmpdir(), `__hist_rfp_${propId}.pdf`);
    const propFile = path.join(os.tmpdir(), `__hist_prop_${propId}.pdf`);
    fs.writeFileSync(rfpFile, Buffer.from('%PDF rfp'));
    fs.writeFileSync(propFile, Buffer.from('%PDF prop'));
    await api()
      .post(`/api/proposals/${propId}/rfp`)
      .set('X-User-Id', String(TEST_USER_ID))
      .attach('file', rfpFile);
    const propUp = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .attach('file', propFile);
    const targetFileId = propUp.body.data.uploaded[0].id;

    // 2회 평가 (동일 파일이라도 mock 응답은 같지만 이력은 2개)
    await api()
      .post(`/api/proposals/${propId}/evaluate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_file_id: targetFileId });
    await api()
      .post(`/api/proposals/${propId}/evaluate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_file_id: targetFileId });

    const list = await api()
      .get(`/api/proposals/${propId}/evaluations`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(2);
    // 최신 → 과거 순
    expect(list.body.data[0].coverage_score).toBe(78);
    expect(list.body.data[0].target_filename).toContain('__hist_prop');
    expect(list.body.data[0].rfp_filename).toContain('__hist_rfp');
    expect(list.body.data[0].evaluation_json).toBeTruthy();
    expect(list.body.data[0].evaluation_json.covered_items.length).toBeGreaterThan(0);

    [rfpFile, propFile].forEach(f => {
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    });
  });

  it('POST /:id/evaluate — RFP 파일 없으면 400 + 명확한 안내', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__RFP없음',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    // 제안서만 업로드 (RFP 없음)
    const propFile = path.join(os.tmpdir(), `__no_rfp_${propId}.pdf`);
    fs.writeFileSync(propFile, Buffer.from('%PDF prop only'));
    const propUp = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .attach('file', propFile);
    const targetFileId = propUp.body.data.uploaded[0].id;

    const r = await api()
      .post(`/api/proposals/${propId}/evaluate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_file_id: targetFileId });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/RFP 파일이 없|분석 불가/);

    try {
      fs.unlinkSync(propFile);
    } catch (_) {}
  });

  it('POST /:id/evaluate — proposal_file_id 누락 시 400', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__400_no_target',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const r = await api()
      .post(`/api/proposals/${propId}/evaluate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/proposal_file_id/);
  });

  it('POST /:id/evaluate — 다른 제안의 file_id 시 404 (소유 검증)', async () => {
    // 제안 A
    const cA = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__평가소유A',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propA = cA.body.id;
    createdIds.push(propA);

    // 제안 B + 파일
    const cB = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__평가소유B',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propB = cB.body.id;
    createdIds.push(propB);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmp = path.join(os.tmpdir(), `__eval_owner_${propB}.pdf`);
    fs.writeFileSync(tmp, Buffer.from('%PDF B'));
    const up = await api()
      .post(`/api/proposals/${propB}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .attach('file', tmp);
    const fileIdOfB = up.body.data.uploaded[0].id;

    // 제안 A 에서 제안 B 의 파일로 평가
    const r = await api()
      .post(`/api/proposals/${propA}/evaluate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_file_id: fileIdOfB });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/찾을 수 없/);

    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
  });

  // ── Phase 9-3: AI 제안전략 Word(.docx) 다운로드 ───────────────
  it('GET /:id/ai-strategy/word — markdown → docx 변환 + 다운로드 헤더', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__Word다운',
        customer_name: '__TEST__고객',
        proposal_date: '2026-05-23',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    // 1) ai_strategy_md 비어있으면 400
    const empty = await api()
      .get(`/api/proposals/${propId}/ai-strategy/word`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/비어있/);

    // 2) ai_strategy_md 채운 뒤 다시 시도 → 200 + docx bytes
    const sampleMd = [
      '## 제안 목표',
      '- __TEST__ 목표 1',
      '- __TEST__ 목표 2',
      '',
      '## 제안 주요 일정',
      '1. 1차 발표',
      '2. 최종 제출',
      '',
      '## 제안 준비사항 (체크리스트)',
      '- [ ] __TEST__ 미체크',
      '- [x] __TEST__ 체크',
    ].join('\n');
    await api()
      .put(`/api/proposals/${propId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ ai_strategy_md: sampleMd });

    const ok = await api()
      .get(`/api/proposals/${propId}/ai-strategy/word`)
      .set('X-User-Id', String(TEST_USER_ID))
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/wordprocessingml/);
    expect(ok.headers['content-disposition']).toMatch(/attachment/);
    expect(ok.headers['content-disposition']).toMatch(/AI/i);
    // docx 는 ZIP 포맷 — magic bytes 50 4B 03 04 ('PK\x03\x04')
    expect(ok.body[0]).toBe(0x50);
    expect(ok.body[1]).toBe(0x4b);
    expect(ok.body.length).toBeGreaterThan(1000); // 최소 docx 크기

    // 3) 존재하지 않는 proposal → 404
    const notFound = await api()
      .get('/api/proposals/99999999/ai-strategy/word')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(notFound.status).toBe(404);
  });

  // ── Phase 5-B: 이메일 발송 ──────────────────────────────────
  it('POST /:id/email/send — mock Gmail 발송 + email_logs + history 기록', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__이메일발송',
        customer_name: '__TEST__고객',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    // 파일 업로드 1건
    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_email_${propId}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF-1.4 email attach'));
    const up = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .attach('file', tmpFile);
    const fileId = up.body.data.uploaded[0].id;

    // 이메일 발송 (NODE_ENV=test → gmail.js mock 응답)
    const send = await api()
      .post(`/api/proposals/${propId}/email/send`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        to: 'client@example.com',
        cc: 'manager@example.com',
        subject: '제안서 발송 안내',
        body: '안녕하세요. 제안서를 첨부합니다.',
        file_ids: [fileId],
      });
    expect(send.status).toBe(200);
    expect(send.body.success).toBe(true);
    expect(send.body.data.log_id).toBeGreaterThan(0);
    expect(send.body.data.attachment_count).toBe(1);
    expect(send.body.data.message_id).toBe('__MOCK_MID__');

    // email_logs sent 상태
    const [[log]] = await pool.query(
      `SELECT to_emails, cc_emails, subject, send_status, gmail_message_id, attachment_file_ids
         FROM proposal_email_logs WHERE id = ?`,
      [send.body.data.log_id]
    );
    expect(log.to_emails).toBe('client@example.com');
    expect(log.cc_emails).toBe('manager@example.com');
    expect(log.subject).toBe('제안서 발송 안내');
    expect(log.send_status).toBe('sent');
    expect(log.gmail_message_id).toBe('__MOCK_MID__');
    expect(JSON.parse(log.attachment_file_ids)).toEqual([fileId]);

    // history 에 email_send 기록 (best-effort, 비동기 대기)
    await new Promise(r => setTimeout(r, 200));
    const [hist] = await pool.query(
      `SELECT action_type, description FROM proposal_history
        WHERE proposal_id = ? AND action_type = 'email_send'`,
      [propId]
    );
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist[0].description).toMatch(/client@example\.com/);

    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {}
  });

  it('POST /:id/email/send — to 누락 시 400', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__이메일_400_to',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const r = await api()
      .post(`/api/proposals/${propId}/email/send`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ subject: 'no to', body: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/수신자/);
  });

  it('POST /:id/email/send — subject 누락 시 400', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__이메일_400_subj',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const r = await api()
      .post(`/api/proposals/${propId}/email/send`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ to: 'x@y.com', body: 'no subj' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/제목/);
  });

  it('POST /:id/email/send — 다른 제안의 file_id 로 발송 시도 시 400 (소유 검증)', async () => {
    // 제안 A
    const cA = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__제안A',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propA = cA.body.id;
    createdIds.push(propA);

    // 제안 B + 파일
    const cB = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__제안B',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propB = cB.body.id;
    createdIds.push(propB);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_owner_${propB}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF B'));
    const up = await api()
      .post(`/api/proposals/${propB}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .attach('file', tmpFile);
    const fileIdOfB = up.body.data.uploaded[0].id;

    // 제안 A 에서 제안 B 의 파일로 발송 시도
    const r = await api()
      .post(`/api/proposals/${propA}/email/send`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        to: 'x@y.com',
        subject: '잘못된 첨부',
        body: 'test',
        file_ids: [fileIdOfB],
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/소유|file_id/);

    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {}
  });

  // ── Phase 5-C: 공유 링크 ───────────────────────────────────
  it('POST /:id/share — 토큰 발급 + shared_until + history', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__공유발급',
        customer_name: '__TEST__고객',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const r = await api()
      .post(`/api/proposals/${propId}/share`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ expires_days: 7 });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.share_token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(r.body.data.expires_days).toBe(7);
    expect(r.body.data.shared_until).not.toBeNull();

    // DB 반영 확인
    const [[row]] = await pool.query(
      'SELECT share_token, shared_until FROM proposals WHERE id = ?',
      [propId]
    );
    expect(row.share_token).toBe(r.body.data.share_token);

    // history 'share_create' 기록
    await new Promise(r => setTimeout(r, 200));
    const [hist] = await pool.query(
      `SELECT action_type FROM proposal_history
        WHERE proposal_id = ? AND action_type = 'share_create'`,
      [propId]
    );
    expect(hist.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /:id/share — expires_days=0 = 무제한 (shared_until NULL)', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__무제한공유',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const r = await api()
      .post(`/api/proposals/${propId}/share`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ expires_days: 0 });
    expect(r.status).toBe(200);
    expect(r.body.data.expires_days).toBeNull();
    expect(r.body.data.shared_until).toBeNull();
  });

  it('GET /api/proposals/share/:token — 공유 페이지 데이터 (최소 정보 + include_in_email)', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__공유조회',
        customer_name: '__TEST__외부고객',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    // RFP 메타 + 파일 2건 (1건 include_in_email=1, 1건 =0)
    await api()
      .put(`/api/proposals/${propId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        rfp_title: '공유 RFP 제목',
        rfp_summary: '공유 RFP 요약',
        ai_strategy_md: '## 비공개 AI 전략',
      });

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const f1 = path.join(os.tmpdir(), `__share_pub_${propId}.pdf`);
    const f2 = path.join(os.tmpdir(), `__share_priv_${propId}.pdf`);
    fs.writeFileSync(f1, Buffer.from('%PDF public'));
    fs.writeFileSync(f2, Buffer.from('%PDF private'));
    const up1 = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .field('include_in_email', '1')
      .attach('file', f1);
    const pubFileId = up1.body.data.uploaded[0].id;
    await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .field('include_in_email', '0')
      .attach('file', f2);

    const sh = await api()
      .post(`/api/proposals/${propId}/share`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ expires_days: 7 });
    const token = sh.body.data.share_token;

    // 인증 없이 접근 가능해야 함 — X-User-Id 헤더 X
    const view = await api().get(`/api/proposals/share/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.success).toBe(true);
    expect(view.body.data.proposal_title).toBe('__TEST__공유조회');
    expect(view.body.data.customer_name).toBe('__TEST__외부고객');
    expect(view.body.data.rfp_title).toBe('공유 RFP 제목');
    expect(view.body.data.rfp_summary).toBe('공유 RFP 요약');
    // AI 전략 미노출
    expect(view.body.data.ai_strategy_md).toBeUndefined();
    expect(view.body.data.expected_amount).toBeUndefined();
    // include_in_email = 1 파일만 노출
    expect(view.body.data.files.length).toBe(1);
    expect(view.body.data.files[0].id).toBe(pubFileId);
    expect(view.body.data.files[0].download_url).toContain(`/api/proposals/share/${token}`);

    [f1, f2].forEach(f => {
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    });
  });

  it('GET /api/proposals/share/:token — 잘못된 토큰 → 404', async () => {
    const r = await api().get('/api/proposals/share/INVALID_TOKEN_THAT_DOES_NOT_EXIST_123456789');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/유효하지 않/);
  });

  it('DELETE /:id/share — 무효화 후 외부 접근 시 404', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__공유무효화',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const sh = await api()
      .post(`/api/proposals/${propId}/share`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ expires_days: 7 });
    const token = sh.body.data.share_token;

    // 외부 접근 — 가능
    const v1 = await api().get(`/api/proposals/share/${token}`);
    expect(v1.status).toBe(200);

    // 무효화
    const del = await api()
      .delete(`/api/proposals/${propId}/share`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(del.status).toBe(200);

    // 외부 접근 — 더이상 불가
    const v2 = await api().get(`/api/proposals/share/${token}`);
    expect(v2.status).toBe(404);

    // history 'share_revoke' 기록
    await new Promise(r => setTimeout(r, 200));
    const [hist] = await pool.query(
      `SELECT action_type FROM proposal_history
        WHERE proposal_id = ? AND action_type = 'share_revoke'`,
      [propId]
    );
    expect(hist.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /share/:token — 만료된 토큰 → 410', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__만료',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const sh = await api()
      .post(`/api/proposals/${propId}/share`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ expires_days: 7 });
    const token = sh.body.data.share_token;

    // shared_until 을 강제로 과거로 변경
    await pool.query(
      `UPDATE proposals SET shared_until = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?`,
      [propId]
    );

    const v = await api().get(`/api/proposals/share/${token}`);
    expect(v.status).toBe(410);
    expect(v.body.error).toMatch(/만료/);
  });

  // ── 회귀 방지 (Bug fix 2026-05-21) ─────────────────────────
  it('🐛 회귀: PUT /:id — proposal_date 가 ISO 8601 ("...T15:00:00.000Z") 이어도 저장 성공', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__ISO_date',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    // 프론트 _editing fallback 시 ISO 8601 그대로 전송되는 케이스 재현
    const upd = await api()
      .put(`/api/proposals/${propId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_date: '2026-05-21T15:00:00.000Z',
        due_date: '2026-06-20T00:00:00.000Z',
        rfp_received_date: '2026-05-15T15:00:00.000Z',
        rfp_due_date: '2026-06-15T15:00:00.000Z',
        rfp_title: 'ISO date 정규화 확인',
      });
    expect(upd.status).toBe(200);
    expect(upd.body.success).toBe(true);
  });

  it('🐛 회귀: POST /:id/rfp — 한글 파일명 (latin1 → utf8 디코딩) 정상 복원', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__한글파일명',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const koreanName = 'OCI 창조관광혁신상품 충청_260508.pdf';
    const tmpFile = path.join(os.tmpdir(), `__test_korean_${propId}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF korean'));

    // supertest .attach(field, file, options) 의 3번째 인자로 filename 명시 가능
    // multer 는 multipart 의 filename 을 latin1 로 디코딩 → 백엔드에서 utf8 재디코딩
    const upload = await api()
      .post(`/api/proposals/${propId}/rfp`)
      .set('X-User-Id', String(TEST_USER_ID))
      .attach('file', tmpFile, { filename: koreanName });
    expect(upload.status).toBe(200);
    expect(upload.body.data.uploaded[0].original_filename).toBe(koreanName);

    const detail = await api()
      .get(`/api/proposals/${propId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    const rfpFile = detail.body.data.files.find(f => f.file_type === 'rfp');
    expect(rfpFile).toBeTruthy();
    expect(rfpFile.original_filename).toBe(koreanName);

    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {}
  });

  it('DELETE /:id — 삭제 (CASCADE 로 children)', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__삭제용',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const delId = create.body.id;

    const res = await api().delete(`/api/proposals/${delId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);

    // history 도 CASCADE 로 삭제
    const [history] = await pool.query('SELECT * FROM proposal_history WHERE proposal_id = ?', [delId]);
    expect(history.length).toBe(0);
  });

  it('DELETE /:id — 존재하지 않는 ID 404', async () => {
    const r = await api().delete('/api/proposals/9999999').set('X-User-Id', String(TEST_USER_ID));
    expect(r.status).toBe(404);
  });

  // ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ────────────────
  it('GET /:id/contracts — proposal_id 로 연결된 계약 조회', async () => {
    // 신규 제안 생성
    const pr = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__제안_for_contracts',
        customer_name: '__TEST__고객사_C',
        proposal_date: '2026-05-24',
      });
    const proposalId = pr.body.id;
    createdIds.push(proposalId);

    // 계약 생성 (proposal_id 연결)
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__contracts_by_proposal',
        proposal_id: proposalId,
        customer_name: '__TEST__고객사_C',
        contract_type: 'MSA',
      });
    const contractId = cr.body.id;

    const res = await api()
      .get(`/api/proposals/${proposalId}/contracts`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    const found = res.body.data.find(c => c.id === contractId);
    expect(found).toBeDefined();
    expect(found.title).toBe('__TEST__contracts_by_proposal');

    await pool.query('DELETE FROM contracts WHERE id = ?', [contractId]);
  });

  it('GET /:id/contracts — 존재하지 않는 제안 → 404', async () => {
    const res = await api()
      .get('/api/proposals/9999999/contracts')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });
});
