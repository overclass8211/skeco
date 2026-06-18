/**
 * 리드(Lead) API 통합 테스트 — 라이프사이클 + 정리.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool, teardown } from './helpers.mjs';

let createdLeadId;

beforeAll(async () => {
  await pool.query("DELETE FROM leads WHERE customer_name LIKE '__TEST__%'");
});

afterAll(async () => {
  if (createdLeadId) {
    // v6.0.0: lead_comments + lead_supports 정리 (FK CASCADE 가 동작하지만 안전망)
    try {
      await pool.query('DELETE FROM lead_comments WHERE lead_id = ?', [createdLeadId]);
    } catch (_) {
      /* table may not exist */
    }
    try {
      await pool.query('DELETE FROM lead_supports WHERE lead_id = ?', [createdLeadId]);
    } catch (_) {
      /* table may not exist */
    }
    await pool.query('DELETE FROM activities WHERE lead_id = ?', [createdLeadId]);
    await pool.query('DELETE FROM leads WHERE id = ?', [createdLeadId]);
  }
});

describe('Leads API', () => {
  it('GET /api/leads — 목록 조회', async () => {
    const res = await api().get('/api/leads');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET ?stage=bidding — 필터 적용', async () => {
    const res = await api().get('/api/leads?stage=bidding');
    expect(res.status).toBe(200);
    res.body.data.forEach(l => expect(l.stage).toBe('bidding'));
  });

  it('POST — 신규 등록', async () => {
    const res = await api().post('/api/leads').send({
      customer_name: '__TEST__고객사',
      project_name: '__TEST__테스트 프로젝트',
      business_type: '태양광',
      region: '국내',
      capacity_mw: 10,
      expected_amount: 5,
      currency: 'KRW',
      stage: 'lead',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdLeadId = res.body.id;
  });

  it('PATCH /:id/stage — 단계 변경 + 활동 자동 기록', async () => {
    const res = await api().patch(`/api/leads/${createdLeadId}/stage`).send({ stage: 'review' });
    expect(res.status).toBe(200);

    const [acts] = await pool.query(
      'SELECT title FROM activities WHERE lead_id = ? ORDER BY id DESC LIMIT 1',
      [createdLeadId]
    );
    expect(acts[0].title).toContain('단계 변경');
  });

  it('GET /:id — 상세 (활동 포함)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdLeadId);
    expect(Array.isArray(res.body.data.activities)).toBe(true);
  });

  // ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ────────────────
  it('GET /:id/contracts — lead_id 로 연결된 계약 조회', async () => {
    const cr = await api().post('/api/contracts').set('X-User-Id', '1').send({
      title: '__TEST__contracts_by_lead',
      lead_id: createdLeadId,
      customer_name: '__TEST__고객사',
      contract_type: 'service',
    });
    expect(cr.status).toBe(200);
    const contractId = cr.body.id;

    const res = await api().get(`/api/leads/${createdLeadId}/contracts`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(c => c.id === contractId);
    expect(found).toBeDefined();
    expect(found.title).toBe('__TEST__contracts_by_lead');

    await pool.query('DELETE FROM contracts WHERE id = ?', [contractId]);
  });

  it('GET /:id/contracts — 존재하지 않는 리드 → 404', async () => {
    const res = await api().get('/api/leads/9999999/contracts');
    expect(res.status).toBe(404);
  });

  // ── v6.0.0: 댓글 (계약 패턴 통일) ─────────────────────────
  it('GET /:id/comments — 빈 목록 (자가 마이그레이션 검증)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}/comments`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /:id/comments — 댓글 등록 + 응답 형식 검증', async () => {
    const r = await api()
      .post(`/api/leads/${createdLeadId}/comments`)
      .set('X-User-Id', '1')
      .send({ body: '테스트 댓글 (vitest)', comment_type: 'coach' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.id).toBeGreaterThan(0);
    expect(r.body.data.comment_type).toBe('coach');
  });

  it('POST /:id/comments — 빈 본문 → 400', async () => {
    const r = await api()
      .post(`/api/leads/${createdLeadId}/comments`)
      .send({ body: '' });
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
  });

  it('POST /:id/comments — 잘못된 comment_type → general 로 fallback', async () => {
    const r = await api()
      .post(`/api/leads/${createdLeadId}/comments`)
      .send({ body: '타입 검증', comment_type: 'invalid_type' });
    expect(r.status).toBe(200);
    expect(r.body.data.comment_type).toBe('general');
  });

  it('GET /:id/comments — 등록한 댓글 목록 반환 (ORDER BY created_at ASC)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}/comments`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const types = res.body.data.map(c => c.comment_type);
    expect(types).toContain('coach');
    expect(types).toContain('general');
  });

  it('POST /:id/comments — 존재하지 않는 리드 → 404', async () => {
    const r = await api()
      .post('/api/leads/9999999/comments')
      .send({ body: '존재 안함' });
    expect(r.status).toBe(404);
  });

  // ── v6.0.0 Phase A: 통합 타임라인용 역방향 조회 + 고객지원 ──
  it('GET /:id/quotes — 빈 목록 (lead_id 로 quotes 조회)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}/quotes`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /:id/proposals — 빈 목록 (lead_id 로 proposals 조회)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}/proposals`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /:id/quotes — 존재하지 않는 리드 → 404', async () => {
    const r = await api().get('/api/leads/9999999/quotes');
    expect(r.status).toBe(404);
  });

  it('GET /:id/supports — 빈 목록 (자가 마이그레이션)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}/supports`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /:id/supports — 고객지원 등록 + 응답 검증', async () => {
    const r = await api()
      .post(`/api/leads/${createdLeadId}/supports`)
      .set('X-User-Id', '1')
      .send({ body: '고객 납기 문의 응대', support_type: 'inquiry', title: '문의 응대' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.support_type).toBe('inquiry');
    expect(r.body.data.title).toBe('문의 응대');
  });

  it('POST /:id/supports — 잘못된 타입 → general 로 fallback', async () => {
    const r = await api()
      .post(`/api/leads/${createdLeadId}/supports`)
      .send({ body: 'fallback 검증', support_type: 'bad' });
    expect(r.status).toBe(200);
    expect(r.body.data.support_type).toBe('general');
  });

  it('GET /:id/supports — 등록한 지원 목록 반환 (DESC)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}/supports`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const types = res.body.data.map(s => s.support_type);
    expect(types).toContain('inquiry');
    expect(types).toContain('general');
  });

  // ── v6.0.0 Phase B: 복수 담당자 (collaborator_ids 혼합 구조) ──
  it('PUT /:id — collaborator_ids 저장 + GET 응답에 collaborators 반환', async () => {
    // 임의 team_members ID 2개 (assigned_to 와 다른 ID)
    const [teamRows] = await pool.query('SELECT id FROM team_members LIMIT 3');
    const ids = teamRows.map(r => r.id).filter(Boolean);
    if (ids.length < 2) {
      // team_members 미충분 — 스킵 (테스트 환경 의존성)
      return;
    }
    const collabIds = ids.slice(0, 2);
    const r = await api()
      .put(`/api/leads/${createdLeadId}`)
      .send({ collaborator_ids: collabIds });
    expect(r.status).toBe(200);

    const res = await api().get(`/api/leads/${createdLeadId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.collaborators)).toBe(true);
    expect(res.body.data.collaborators.length).toBeGreaterThanOrEqual(1);
    // 협업자 ID 가 응답에 포함되는지 (assigned_to 와 같은 ID 는 제외됨)
    const returnedIds = res.body.data.collaborators.map(c => c.id);
    const expectedAfterExclude = collabIds.filter(
      id => id !== res.body.data.assigned_to
    );
    expectedAfterExclude.forEach(id => {
      expect(returnedIds).toContain(id);
    });
  });

  it('PUT /:id — collaborator_ids 빈 배열 → 협업자 0명', async () => {
    const r = await api()
      .put(`/api/leads/${createdLeadId}`)
      .send({ collaborator_ids: [] });
    expect(r.status).toBe(200);
    const res = await api().get(`/api/leads/${createdLeadId}`);
    expect(res.body.data.collaborators).toEqual([]);
  });

  it('PUT /:id — collaborator_ids CSV 문자열 fallback', async () => {
    const [teamRows] = await pool.query('SELECT id FROM team_members LIMIT 2');
    if (teamRows.length < 1) return;
    const csv = teamRows.map(r => r.id).join(',');
    const r = await api()
      .put(`/api/leads/${createdLeadId}`)
      .send({ collaborator_ids: csv });
    expect(r.status).toBe(200);
  });

  // ── v6.0.0 Phase C: 주 담당자 변경 ─────────────────────────
  it('PUT /:id/primary-owner — 정상 변경 + activities 기록', async () => {
    // team_members에서 현재 담당자와 다른 사람 선택
    const [teamRows] = await pool.query('SELECT id FROM team_members LIMIT 3');
    if (teamRows.length < 1) return; // 팀원 없으면 스킵

    const newOwnerId = teamRows[teamRows.length - 1].id; // 마지막 팀원
    const r = await api()
      .put(`/api/leads/${createdLeadId}/primary-owner`)
      .set('X-User-Id', '1')
      .send({ new_owner_id: newOwnerId });

    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.assigned_to).toBe(newOwnerId);
    expect(typeof r.body.data.owner_name).toBe('string');

    // activities 기록 확인
    const [acts] = await pool.query(
      `SELECT activity_type, title, content FROM activities
        WHERE lead_id = ? AND activity_type = 'owner_change'
        ORDER BY id DESC LIMIT 1`,
      [createdLeadId]
    );
    expect(acts.length).toBeGreaterThan(0);
    expect(acts[0].title).toBe('주 담당자 변경');
    expect(acts[0].content).toContain('→');
  });

  it('PUT /:id/primary-owner — 동일 담당자 재설정 → No changes', async () => {
    // 현재 assigned_to 조회
    const [[current]] = await pool.query('SELECT assigned_to FROM leads WHERE id = ?', [
      createdLeadId,
    ]);
    if (!current?.assigned_to) return;

    const r = await api()
      .put(`/api/leads/${createdLeadId}/primary-owner`)
      .send({ new_owner_id: current.assigned_to });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  it('PUT /:id/primary-owner — 존재하지 않는 리드 → 404', async () => {
    const r = await api()
      .put('/api/leads/9999999/primary-owner')
      .send({ new_owner_id: 1 });
    expect(r.status).toBe(404);
    expect(r.body.success).toBe(false);
  });

  it('PUT /:id/primary-owner — 존재하지 않는 담당자 → 400', async () => {
    const r = await api()
      .put(`/api/leads/${createdLeadId}/primary-owner`)
      .send({ new_owner_id: 9999999 });
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
  });

  it('PUT /:id/primary-owner — new_owner_id 누락 → 400', async () => {
    const r = await api()
      .put(`/api/leads/${createdLeadId}/primary-owner`)
      .send({});
    expect(r.status).toBe(400);
  });
});
