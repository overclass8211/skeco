/**
 * Contracts API 통합 테스트 — Phase 0 (CRUD + 파일 + history)
 *
 * 검증 대상: /api/contracts
 *   GET    /next-contract-no            — C-YYYY-NNNN 미리보기
 *   GET    /                            — 목록 (페이징 + 필터)
 *   GET    /:id                         — 단건 + files + history
 *   POST   /                            — 생성 (자동채번 + history)
 *   PUT    /:id                         — 수정 (diff history)
 *   DELETE /:id                         — CASCADE 삭제
 *   POST   /:id/files                   — 파일 업로드
 *   GET    /:id/files/:fileId/download  — 다운로드
 *   DELETE /:id/files/:fileId           — 파일 삭제
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { api, pool } from './helpers.mjs';

const TEST_USER_ID = 1;
const createdIds = [];
const TEST_FILE = path.join(process.cwd(), 'tests', '__contract_dummy.pdf');

beforeAll(async () => {
  // 더미 PDF 파일 생성 (PDF header 만 — 실제 분석은 안 함)
  if (!fs.existsSync(TEST_FILE)) {
    const PDF_MIN = Buffer.from(
      '%PDF-1.4\n1 0 obj<<>>endobj\nxref\n0 1\n0000000000 65535 f\ntrailer<</Size 1>>\nstartxref\n50\n%%EOF',
      'utf8'
    );
    fs.writeFileSync(TEST_FILE, PDF_MIN);
  }
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM contracts WHERE id IN (?)', [createdIds]);
  }
  if (fs.existsSync(TEST_FILE)) {
    try {
      fs.unlinkSync(TEST_FILE);
    } catch (_) {
      /* 무시 */
    }
  }
});

describe('Contracts API — Phase 0', () => {
  let createdId;
  let createdNo;

  // ── v6.0.0 Phase C: KPI 대시보드 ─────────────────────────
  it('GET /dashboard — 4단계 카운트 + 만료 임박 분류', async () => {
    // 만료 임박 시드 (approved + 25일 후 종료)
    const today = new Date();
    const in25Days = new Date(today.getTime() + 25 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const in45Days = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const yesterday = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    // 3건 시드: expiring_30, expiring_60, overdue
    for (const [date, label] of [
      [in25Days, '__TEST__C_expiring30'],
      [in45Days, '__TEST__C_expiring60'],
      [yesterday, '__TEST__C_overdue'],
    ]) {
      const cr = await api()
        .post('/api/contracts')
        .set('X-User-Id', String(TEST_USER_ID))
        .send({
          title: label,
          customer_name: '__TEST__',
          contract_type: 'NDA',
          start_date: '2026-01-01',
          end_date: date,
        });
      createdIds.push(cr.body.id);
      // status 를 approved 로 전이 (draft → review → approved)
      await api()
        .patch(`/api/contracts/${cr.body.id}/status`)
        .set('X-User-Id', String(TEST_USER_ID))
        .send({ status: 'review' });
      await api()
        .patch(`/api/contracts/${cr.body.id}/status`)
        .set('X-User-Id', String(TEST_USER_ID))
        .send({ status: 'approved' });
    }

    const res = await api()
      .get('/api/contracts/dashboard')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d).toBeDefined();
    expect(typeof d.total).toBe('number');
    expect(d.by_status).toBeDefined();
    expect(typeof d.by_status.draft).toBe('number');
    expect(typeof d.by_status.review).toBe('number');
    expect(typeof d.by_status.approved).toBe('number');
    expect(typeof d.by_status.completed).toBe('number');
    expect(typeof d.expiring_30).toBe('number');
    expect(typeof d.expiring_60).toBe('number');
    expect(typeof d.expiring_90).toBe('number');
    expect(typeof d.overdue).toBe('number');
    // 시드한 만큼 최소치는 충족해야 함
    expect(d.expiring_30).toBeGreaterThanOrEqual(1);
    expect(d.expiring_60).toBeGreaterThanOrEqual(1);
    expect(d.overdue).toBeGreaterThanOrEqual(1);
  });

  it('GET /next-contract-no — C-YYYY-NNNN 패턴', async () => {
    const res = await api()
      .get('/api/contracts/next-contract-no?year=2026')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contract_no).toMatch(/^C-2026-\d{4}$/);
    expect(res.body.data.year).toBe(2026);
  });

  it('POST / — 신규 계약 + 자동채번 + history 기록', async () => {
    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__NDA_A사',
        customer_name: '__TEST__고객사_A',
        contract_type: 'NDA',
        start_date: '2026-05-23',
        end_date: '2027-05-22',
        contract_amount: 30000000,
        currency: 'KRW',
        auto_renewal: true,
        renewal_notice_days: 60,
        notes: '테스트 비고',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contract_no).toMatch(/^C-2026-\d{4}$/);
    createdId = res.body.id;
    createdNo = res.body.data.contract_no;
    createdIds.push(createdId);

    // history 자동 기록 확인
    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.status).toBe(200);
    expect(detail.body.data.contract_no).toBe(createdNo);
    expect(detail.body.data.contract_type).toBe('NDA');
    expect(detail.body.data.auto_renewal).toBe(1);
    const history = detail.body.data.history;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some(h => h.action_type === 'create')).toBe(true);
  });

  it('POST / — 제목 누락 시 400', async () => {
    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__' });
    expect(res.status).toBe(400);
  });

  it('POST / — 유효하지 않은 contract_type → etc 로 보정', async () => {
    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__bogus_type',
        customer_name: '__TEST__',
        contract_type: 'invalid_xyz',
      });
    expect(res.status).toBe(200);
    const id = res.body.id;
    createdIds.push(id);
    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.contract_type).toBe('etc');
  });

  it('GET / — 목록 검색 (생성한 계약 포함)', async () => {
    const res = await api()
      .get('/api/contracts?search=__TEST__&limit=50')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(c => c.id === createdId);
    expect(found).toBeDefined();
    expect(found.contract_no).toBe(createdNo);
    expect(Number(found.contract_amount)).toBe(30000000);
  });

  it('GET / — status 필터', async () => {
    const res = await api()
      .get('/api/contracts?status=draft&limit=50')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.every(c => c.status === 'draft')).toBe(true);
  });

  it('PUT /:id — 수정 + diff history 자동 기록', async () => {
    const res = await api()
      .put(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__NDA_A사_v2',
        status: 'review',
        contract_amount: 35000000,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.title).toBe('__TEST__NDA_A사_v2');
    expect(detail.body.data.status).toBe('review');
    expect(Number(detail.body.data.contract_amount)).toBe(35000000);
    // diff history: title/status/contract_amount 3건이 기록되어야 함
    const history = detail.body.data.history;
    expect(history.some(h => h.field_name === 'title')).toBe(true);
    expect(history.some(h => h.field_name === 'status' && h.action_type === 'status_change')).toBe(
      true
    );
    expect(history.some(h => h.field_name === 'contract_amount')).toBe(true);
  });

  it('PUT /:id — 잘못된 status → 400', async () => {
    const res = await api()
      .put(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'bogus_status' });
    expect(res.status).toBe(400);
  });

  it('POST /:id/files — 파일 업로드 + history', async () => {
    const res = await api()
      .post(`/api/contracts/${createdId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'contract')
      .field('version_no', '1')
      .field('is_final', '0')
      .attach('files', TEST_FILE);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.uploaded.length).toBe(1);

    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(Array.isArray(detail.body.data.files)).toBe(true);
    expect(detail.body.data.files.length).toBe(1);
    expect(detail.body.data.files[0].file_type).toBe('contract');
    expect(detail.body.data.history.some(h => h.action_type === 'file_upload')).toBe(true);
  });

  it('GET /:id/files/:fileId/download — 다운로드 200', async () => {
    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    const fileId = detail.body.data.files[0].id;
    const res = await api()
      .get(`/api/contracts/${createdId}/files/${fileId}/download`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('DELETE /:id/files/:fileId — 파일 삭제 + history', async () => {
    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    const fileId = detail.body.data.files[0].id;
    const res = await api()
      .delete(`/api/contracts/${createdId}/files/${fileId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);

    const detail2 = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail2.body.data.files.length).toBe(0);
    expect(detail2.body.data.history.some(h => h.action_type === 'file_delete')).toBe(true);
  });

  it('GET /:id — 존재하지 않는 ID → 404', async () => {
    const res = await api()
      .get('/api/contracts/999999999')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  it('DELETE /:id — CASCADE 삭제', async () => {
    // 새 계약 생성 후 파일 1건 업로드, 그 후 DELETE → files/history 동반 삭제 확인
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__del_cascade',
        customer_name: '__TEST__',
        contract_type: 'service',
        start_date: '2026-05-23',
      });
    const id = cr.body.id;
    createdIds.push(id);

    await api()
      .post(`/api/contracts/${id}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'contract')
      .attach('files', TEST_FILE);

    const del = await api()
      .delete(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const get = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(get.status).toBe(404);

    // 파일/이력도 CASCADE 로 삭제됐는지
    const [filesAfter] = await pool.query(
      'SELECT id FROM contract_files WHERE contract_id = ?',
      [id]
    );
    expect(filesAfter.length).toBe(0);
    const [historyAfter] = await pool.query(
      'SELECT id FROM contract_history WHERE contract_id = ?',
      [id]
    );
    expect(historyAfter.length).toBe(0);
  });

  // v6.0.0 슬림화: Phase 4 (만료 알림) / Phase 3 (템플릿) / Phase 5 (협상 코칭) / Phase 6 (번역) 제거됨
  // 향후 부활 시 본 블록에 시나리오 복원

  // ── Phase 1: CLM 4단계 워크플로우 (draft → review → approved → completed) ─────────────────
  it('PATCH /:id/status — 정상 전이 (draft → review → approved → completed)', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__CLM_v6_normal',
        customer_name: '__TEST__',
        contract_type: 'MSA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    // draft → review
    let res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'review' });
    expect(res.status).toBe(200);
    expect(res.body.data.from).toBe('draft');
    expect(res.body.data.to).toBe('review');

    // review → approved
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'approved' });
    expect(res.status).toBe(200);

    // approved → completed
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'completed' });
    expect(res.status).toBe(200);

    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.status).toBe('completed');
    const historyChanges = detail.body.data.history.filter(h => h.action_type === 'status_change');
    expect(historyChanges.length).toBe(3); // 3번의 전이
  });

  it('PATCH /:id/status — 수정 요청 (review → draft 회귀 액션)', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__CLM_v6_revise',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    // draft → review
    await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'review' });

    // review → draft (수정 요청 액션)
    const res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'draft' });
    expect(res.status).toBe(200);
    expect(res.body.data.from).toBe('review');
    expect(res.body.data.to).toBe('draft');
  });

  it('PATCH /:id/status — 잘못된 전이 (draft → approved 직접 점프 금지) → 400', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__CLM_v6_invalid',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    const res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'approved' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('잘못된 전이');
  });

  it('PATCH /:id/status — completed 에서는 어디로도 전이 불가', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__CLM_v6_completed',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    // draft → completed (강제 종료 허용)
    let res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'completed' });
    expect(res.status).toBe(200);

    // completed 에서 어디로도 전이 시도 → 400
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'draft' });
    expect(res.status).toBe(400);
  });

  // ── Phase 2: AI 법무 검토 (유지 — 핵심 자산) ───────────────
  it('POST /:id/files/:fileId/legal-review — AI 법무 검토 실행 + DB 영속화 + history', async () => {
    // 새 계약 + 파일 1건 업로드
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__legal_review_A',
        customer_name: '__TEST__',
        contract_type: 'NDA',
        start_date: '2026-05-23',
      });
    const id = cr.body.id;
    createdIds.push(id);

    const up = await api()
      .post(`/api/contracts/${id}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'contract')
      .attach('files', TEST_FILE);
    const fileId = up.body.data.uploaded[0].id;

    // AI 법무 검토 실행 (mock 응답 — NODE_ENV=test)
    const res = await api()
      .post(`/api/contracts/${id}/files/${fileId}/legal-review`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.review_score).toBeGreaterThanOrEqual(0);
    expect(res.body.data.review_score).toBeLessThanOrEqual(100);
    expect(['high', 'medium', 'low']).toContain(res.body.data.risk_level);
    expect(Array.isArray(res.body.data.toxic_clauses)).toBe(true);
    expect(Array.isArray(res.body.data.missing_clauses)).toBe(true);
    expect(res.body.data.legal_compliance).toBeDefined();
    expect(res.body.data.legal_compliance.fair_trade_act).toBeDefined();

    // v6.0.0 Phase A1: extracted_meta 검증 (계약 등록 폼 자동 채움용)
    expect(res.body.data.extracted_meta).toBeDefined();
    expect(res.body.data.extracted_meta).not.toBeNull();
    expect(res.body.data.extracted_meta.title).toContain('__MOCK__');
    expect(res.body.data.extracted_meta.counterparty_name).toContain('__MOCK__');
    expect(res.body.data.extracted_meta.contract_type).toBe('NDA');
    expect(res.body.data.extracted_meta.amount).toBe(30000000);
    expect(res.body.data.extracted_meta.currency).toBe('KRW');
    expect(res.body.data.extracted_meta.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.data.extracted_meta.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // DB 에 영속화 됐는지 + GET /:id 응답에 latest_legal_review 포함되는지
    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.latest_legal_review).toBeDefined();
    expect(detail.body.data.latest_legal_review).not.toBeNull();
    expect(detail.body.data.latest_legal_review.target_file_id).toBe(fileId);
    expect(detail.body.data.latest_legal_review.review_score).toBe(res.body.data.review_score);
    // extracted_meta 도 GET 응답에 포함
    expect(detail.body.data.latest_legal_review.extracted_meta).toBeDefined();
    expect(detail.body.data.latest_legal_review.extracted_meta).not.toBeNull();
    expect(detail.body.data.latest_legal_review.extracted_meta.contract_type).toBe('NDA');
    expect(detail.body.data.latest_legal_review.extracted_meta.amount).toBe(30000000);
    // history 에 legal_review 액션 기록
    expect(detail.body.data.history.some(h => h.action_type === 'legal_review')).toBe(true);
    // 메인 테이블에도 score 반영
    expect(detail.body.data.legal_review_score).toBe(res.body.data.review_score);
  });

  it('GET /:id/legal-reviews — 검토 이력 조회 (다중 버전)', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__legal_history',
        customer_name: '__TEST__',
        contract_type: 'service',
      });
    const id = cr.body.id;
    createdIds.push(id);

    const up = await api()
      .post(`/api/contracts/${id}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'contract')
      .attach('files', TEST_FILE);
    const fileId = up.body.data.uploaded[0].id;

    // 같은 파일 2번 검토 → 이력 2건
    await api()
      .post(`/api/contracts/${id}/files/${fileId}/legal-review`)
      .set('X-User-Id', String(TEST_USER_ID));
    await api()
      .post(`/api/contracts/${id}/files/${fileId}/legal-review`)
      .set('X-User-Id', String(TEST_USER_ID));

    const list = await api()
      .get(`/api/contracts/${id}/legal-reviews`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(2);
    expect(list.body.data[0].target_filename).toBeDefined();
    expect(list.body.data[0].review_score).toBeGreaterThanOrEqual(0);
    expect(list.body.data[0].toxic_clauses).toBeDefined();
    expect(list.body.data[0].legal_compliance.fair_trade_act).toBeDefined();
  });

  it('POST /:id/files/:fileId/legal-review — 존재하지 않는 파일 → 404', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__no_file',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    const res = await api()
      .post(`/api/contracts/${id}/files/999999/legal-review`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  // ── v6.0.0 Phase A3: 수동 채번 + external_contract_no 시나리오 ─────────────
  it('POST / — 수동 채번 (contract_no 직접 지정)', async () => {
    const manualNo = `__TEST_A3_${Date.now()}`;
    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__A3_manual_no',
        customer_name: '__TEST__',
        contract_type: 'NDA',
        contract_no: manualNo,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.contract_no).toBe(manualNo);
    const id = res.body.id;
    createdIds.push(id);

    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.contract_no).toBe(manualNo);
  });

  it('POST / — 수동 채번 중복 시 409', async () => {
    const dupNo = `__TEST_DUP_${Date.now()}`;
    // 1차 생성
    const r1 = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__A3_dup_first',
        customer_name: '__TEST__',
        contract_type: 'NDA',
        contract_no: dupNo,
      });
    expect(r1.status).toBe(200);
    createdIds.push(r1.body.id);

    // 2차 생성 (같은 번호) → 409
    const r2 = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__A3_dup_second',
        customer_name: '__TEST__',
        contract_type: 'NDA',
        contract_no: dupNo,
      });
    expect(r2.status).toBe(409);
    expect(r2.body.success).toBe(false);
  });

  it('POST / + GET / + GET /:id — external_contract_no 저장/조회/검색', async () => {
    const extNo = `EXT-A3-${Date.now()}`;
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__A3_external_no',
        customer_name: '__TEST__A3_ext',
        contract_type: 'MSA',
        external_contract_no: extNo,
      });
    expect(cr.status).toBe(200);
    const id = cr.body.id;
    createdIds.push(id);

    // GET /:id 응답에 external_contract_no 포함
    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.external_contract_no).toBe(extNo);

    // GET / 목록 응답에 external_contract_no 포함
    const list = await api()
      .get(`/api/contracts?search=__TEST__A3_external_no&limit=10`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(list.status).toBe(200);
    const found = list.body.data.find(c => c.id === id);
    expect(found).toBeDefined();
    expect(found.external_contract_no).toBe(extNo);

    // 거래처 계약번호로 검색 (search 파라미터)
    const searchRes = await api()
      .get(`/api/contracts?search=${encodeURIComponent(extNo)}&limit=10`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data.some(c => c.id === id)).toBe(true);
  });

  it('PUT /:id — contract_no 수정 (자동→수동 전환 시뮬레이션) + history', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__A3_no_update',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);
    const newNo = `__TEST_A3_NEW_${Date.now()}`;

    const upd = await api()
      .put(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ contract_no: newNo });
    expect(upd.status).toBe(200);

    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.contract_no).toBe(newNo);
    expect(detail.body.data.history.some(h => h.field_name === 'contract_no')).toBe(true);
  });

  it('PUT /:id — contract_no 빈값 거부 → 400', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__A3_no_blank',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    const upd = await api()
      .put(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ contract_no: '   ' });
    expect(upd.status).toBe(400);
    expect(upd.body.error).toContain('비울 수 없습니다');
  });

  it('PUT /:id — external_contract_no 빈문자 → null 로 저장', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__A3_ext_clear',
        customer_name: '__TEST__',
        contract_type: 'NDA',
        external_contract_no: 'TO_BE_CLEARED',
      });
    const id = cr.body.id;
    createdIds.push(id);

    // 빈문자열 전송 → 백엔드에서 null 로 정규화
    const upd = await api()
      .put(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ external_contract_no: '' });
    expect(upd.status).toBe(200);

    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.external_contract_no).toBeNull();
  });

  it('POST / — proposal_id 연결 시 customer 자동 반영', async () => {
    // 임시 proposal 생성 (mock 데이터)
    const propRes = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__계약자동연결',
        customer_name: '__TEST__고객사_연결',
        proposal_date: '2026-05-23',
        expected_amount: 99000000,
        currency: 'KRW',
      });
    const propId = propRes.body.id;

    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__계약_자동연결',
        proposal_id: propId,
        contract_type: 'service',
      });
    expect(res.status).toBe(200);
    const contractId = res.body.id;
    createdIds.push(contractId);

    const detail = await api()
      .get(`/api/contracts/${contractId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.customer_name).toBe('__TEST__고객사_연결');
    expect(Number(detail.body.data.contract_amount)).toBe(99000000);

    // proposal 도 cleanup
    await pool.query('DELETE FROM proposals WHERE id = ?', [propId]);
  });
});
