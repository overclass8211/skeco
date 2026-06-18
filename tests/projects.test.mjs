/**
 * Projects API 통합 테스트
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let createdId;

beforeAll(async () => {
  await pool.query("DELETE FROM projects WHERE name LIKE '__TEST__%'");
});

afterAll(async () => {
  if (createdId) await pool.query('DELETE FROM projects WHERE id = ?', [createdId]);
});

describe('Projects API', () => {
  it('GET /api/projects — 목록 조회', async () => {
    const res = await api().get('/api/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — 신규 프로젝트 등록', async () => {
    const res = await api().post('/api/projects').send({
      name: '__TEST__태양광 1MW',
      customer_name: '__TEST__고객사',
      project_type: '태양광',
      contract_amount: 1000,
      estimated_cost: 800,
      status: '진행중',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdId = res.body.id;
  });

  it('PUT /:id — 수정 (마진 자동 계산)', async () => {
    const res = await api().put(`/api/projects/${createdId}`).send({
      contract_amount: 1200,
      estimated_cost: 900,
      status: '완료',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PUT /:id — 변경 없이 호출해도 200', async () => {
    const res = await api().put(`/api/projects/${createdId}`).send({});
    expect(res.status).toBe(200);
  });

  it('DELETE /:id — 삭제', async () => {
    const res = await api().delete(`/api/projects/${createdId}`);
    expect(res.status).toBe(200);
    createdId = null;
  });
});

// ─── Phase 1: 메타 확장 + 자동채번 + 단계 정의 ────────────────
describe('Projects Phase 1 — 자동채번 + 확장 메타', () => {
  const made = [];
  afterAll(async () => {
    if (made.length) await pool.query('DELETE FROM projects WHERE id IN (?)', [made]);
  });

  it('POST 코드 미지정 → PRJ-YYYY-NNNN 자동채번 + 응답 포함', async () => {
    const res = await api().post('/api/projects').send({ name: '__TEST__채번1' });
    expect(res.status).toBe(200);
    expect(res.body.project_code).toMatch(/^PRJ-\d{4}-\d{4}$/);
    made.push(res.body.id);
  });

  it('연속 생성 시 시퀀스 증가', async () => {
    const r1 = await api().post('/api/projects').send({ name: '__TEST__채번2' });
    const r2 = await api().post('/api/projects').send({ name: '__TEST__채번3' });
    made.push(r1.body.id, r2.body.id);
    // 병렬 테스트 파일이 동시 생성할 수 있어 정확히 +1 대신 단조 증가만 보장
    const seq = code => parseInt(code.split('-')[2], 10);
    expect(seq(r2.body.project_code)).toBeGreaterThan(seq(r1.body.project_code));
  });

  it('수동 코드 중복 → 409', async () => {
    const r1 = await api()
      .post('/api/projects')
      .send({ name: '__TEST__수동코드', project_code: '__TEST-DUP-01' });
    expect(r1.status).toBe(200);
    made.push(r1.body.id);
    const r2 = await api()
      .post('/api/projects')
      .send({ name: '__TEST__수동코드2', project_code: '__TEST-DUP-01' });
    expect(r2.status).toBe(409);
  });

  it('프로젝트명 누락 → 400', async () => {
    const res = await api().post('/api/projects').send({ customer_name: '__TEST__고객' });
    expect(res.status).toBe(400);
  });

  it('확장 메타 저장/조회 (기간·PM·투입인원·담당고객·계약연결·협업담당 JSON)', async () => {
    const create = await api().post('/api/projects').send({
      name: '__TEST__메타확장',
      customer_name: '__TEST__고객사',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      pm_user_id: 1,
      headcount: 6,
      customer_contact: '김담당 과장',
      contract_id: 9999,
      currency: 'KRW',
      collaborators: [{ id: 2, name: '협업자A' }],
    });
    expect(create.status).toBe(200);
    made.push(create.body.id);

    const res = await api().get(`/api/projects/${create.body.id}`);
    expect(res.status).toBe(200);
    const p = res.body.data;
    expect(p.headcount).toBe(6);
    expect(p.customer_contact).toBe('김담당 과장');
    expect(p.contract_id).toBe(9999);
    expect(p.currency).toBe('KRW');
    expect(JSON.parse(p.collaborators)[0].name).toBe('협업자A');
    expect(String(p.start_date)).toContain('2026');
  });

  it('stage 미지정 시 첫 활성 단계 자동 부여', async () => {
    const [stagesRes, create] = await Promise.all([
      api().get('/api/projects/stages'),
      api().post('/api/projects').send({ name: '__TEST__단계기본' }),
    ]);
    made.push(create.body.id);
    const firstKey = stagesRes.body.data[0]?.stage_key;
    const res = await api().get(`/api/projects/${create.body.id}`);
    expect(res.body.data.stage).toBe(firstKey);
    expect(res.body.data.stage_label).toBe(stagesRes.body.data[0]?.label);
  });

  it('PUT — 확장 필드 수정 (headcount/stage)', async () => {
    const create = await api().post('/api/projects').send({ name: '__TEST__수정' });
    made.push(create.body.id);
    const put = await api()
      .put(`/api/projects/${create.body.id}`)
      .send({ headcount: 9, stage: 'inspection' });
    expect(put.status).toBe(200);
    const res = await api().get(`/api/projects/${create.body.id}`);
    expect(res.body.data.headcount).toBe(9);
    expect(res.body.data.stage).toBe('inspection');
  });
});

// ─── Phase 3: 단계 전환 + 이력 + 검수 파일 게이트 ─────────────
describe('Projects Phase 3 — 단계 전환 API', () => {
  let pid;
  beforeAll(async () => {
    const r = await api().post('/api/projects').send({ name: '__TEST__단계전환' });
    pid = r.body.id;
  });
  afterAll(async () => {
    if (pid) {
      // 업로드된 증빙 파일 정리
      const [files] = await pool.query(
        'SELECT file_path FROM project_stage_history WHERE project_id = ? AND file_path IS NOT NULL',
        [pid]
      );
      const fs = await import('node:fs');
      files.forEach(f => {
        try {
          fs.unlinkSync(f.file_path);
        } catch (_) {
          /* 무시 */
        }
      });
      await pool.query('DELETE FROM project_stage_history WHERE project_id = ?', [pid]);
      await pool.query('DELETE FROM projects WHERE id = ?', [pid]);
    }
  });

  it('전환 성공 → stage 갱신 + 이력 기록 (목표일/메모 포함)', async () => {
    const res = await api().post(`/api/projects/${pid}/stage`).send({
      to_stage: 'execution',
      note: '수행 착수',
      plan_date: '2026-08-01',
      actual_date: '2026-07-25',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe('execution');

    const d = await api().get(`/api/projects/${pid}`);
    expect(d.body.data.stage).toBe('execution');

    const h = await api().get(`/api/projects/${pid}/history`);
    expect(h.body.data.length).toBe(1);
    expect(h.body.data[0].to_stage).toBe('execution');
    expect(h.body.data[0].note).toBe('수행 착수');
    // DATE 직렬화는 tz 영향(KST 자정 → UTC -9h) — 로컬 자정 기준으로 비교
    expect(new Date(h.body.data[0].plan_date).getTime()).toBe(
      new Date('2026-08-01T00:00:00').getTime()
    );
    // 실제 도달일(actual_date) — 일정 gap 분석 기준
    expect(new Date(h.body.data[0].actual_date).getTime()).toBe(
      new Date('2026-07-25T00:00:00').getTime()
    );
  });

  it('검수(requires_file) — 파일 없이 전환 → 400 + requires_file 플래그', async () => {
    const res = await api().post(`/api/projects/${pid}/stage`).send({ to_stage: 'inspection' });
    expect(res.status).toBe(400);
    expect(res.body.requires_file).toBe(true);
  });

  it('검수 — 파일 첨부 시 성공 + 파일명 기록 + 다운로드 200', async () => {
    const res = await api()
      .post(`/api/projects/${pid}/stage`)
      .field('to_stage', 'inspection')
      .field('note', '검수 완료')
      .attach('file', Buffer.from('dummy-pdf-content'), 'TEST검수확인서.pdf');
    expect(res.status).toBe(200);
    expect(res.body.data.file).toBe('TEST검수확인서.pdf');

    const h = await api().get(`/api/projects/${pid}/history`);
    expect(h.body.data[0].file_name).toBe('TEST검수확인서.pdf');

    const dl = await api().get(`/api/projects/${pid}/history/${h.body.data[0].id}/file`);
    expect(dl.status).toBe(200);
  });

  it('존재하지 않는 단계 → 400', async () => {
    const res = await api().post(`/api/projects/${pid}/stage`).send({ to_stage: 'no_such' });
    expect(res.status).toBe(400);
  });

  it('마지막 활성 단계(done) 도달 → status 완료 자동 동기화', async () => {
    const res = await api().post(`/api/projects/${pid}/stage`).send({ to_stage: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.data.status_synced).toBe(true);
    const d = await api().get(`/api/projects/${pid}`);
    expect(d.body.data.status).toBe('완료');
  });
});

describe('Project Stages API — 단계 정의 (관리자 설정)', () => {
  it('GET — 기본 7단계 시드 + 검수 단계 requires_file=1', async () => {
    const res = await api().get('/api/projects/stages');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(7);
    const inspection = res.body.data.find(s => s.stage_key === 'inspection');
    expect(inspection).toBeTruthy();
    expect(Number(inspection.requires_file)).toBe(1);
  });

  it('POST — 비관리자(테스트 env: req.user 없음) → 403 (RBAC 게이트)', async () => {
    const res = await api()
      .post('/api/projects/stages')
      .send({ stage_key: '__test_stage', label: '테스트단계' });
    expect(res.status).toBe(403);
  });

  it('DELETE — 비관리자 → 403', async () => {
    const res = await api().delete('/api/projects/stages/99999');
    expect(res.status).toBe(403);
  });
});

describe('Project Statuses API — 상태 정의 (관리자 설정)', () => {
  it('GET — 상태 정의 목록 + 스키마(색 화이트리스트)', async () => {
    // 상태는 관리자가 추가/이름변경/삭제 가능 → 특정 시드값 단정 대신 스키마 검증
    const res = await api().get('/api/projects/statuses');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1); // 시드 또는 사용자 정의 ≥ 1
    const COLORS = ['blue', 'green', 'amber', 'red', 'gray'];
    for (const s of res.body.data) {
      expect(s.status_key).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(COLORS).toContain(s.color);
    }
  });

  it('POST — 비관리자(테스트 env: req.user 없음) → 403 (RBAC 게이트)', async () => {
    const res = await api().post('/api/projects/statuses').send({ label: '__test_status' });
    expect(res.status).toBe(403);
  });

  it('DELETE — 비관리자 → 403', async () => {
    const res = await api().delete('/api/projects/statuses/99999');
    expect(res.status).toBe(403);
  });

  it('상세 JOIN — status_label·status_color 포함 (활성 상태 기준)', async () => {
    // 시드/사용자 정의 무관하게 현재 활성 상태 첫 번째로 검증 (mutable 데이터 대응)
    const statuses = (await api().get('/api/projects/statuses')).body.data;
    const st = statuses[0];
    const create = await api()
      .post('/api/projects')
      .send({ name: '__TEST__상태조인', status: st.status_key });
    const id = create.body.id;
    const res = await api().get(`/api/projects/${id}`);
    expect(res.body.data.status).toBe(st.status_key);
    expect(res.body.data.status_label).toBe(st.label);
    expect(res.body.data.status_color).toBe(st.color);
    await pool.query('DELETE FROM projects WHERE id = ?', [id]);
  });

  it('완료 동기화 — 마지막 단계 도달 시 is_final 상태로 자동 변경', async () => {
    const stagesRes = await api().get('/api/projects/stages');
    const active = stagesRes.body.data.filter(s => s.is_active);
    const last = active[active.length - 1]; // sort_order ASC → 마지막이 최종 단계
    if (!last || Number(last.requires_file) === 1) return; // 증빙필수 단계면 skip (파일 필요)

    const statusesRes = await api().get('/api/projects/statuses');
    const finalKey = (statusesRes.body.data.find(s => s.is_final) || {}).status_key;

    const create = await api()
      .post('/api/projects')
      .send({ name: '__TEST__완료동기화', status: '진행중' });
    const id = create.body.id;
    const mv = await api().post(`/api/projects/${id}/stage`).send({ to_stage: last.stage_key });
    expect(mv.status).toBe(200);
    expect(mv.body.data.status_synced).toBe(true);
    const res = await api().get(`/api/projects/${id}`);
    expect(res.body.data.status).toBe(finalKey);
    await pool.query('DELETE FROM project_stage_history WHERE project_id = ?', [id]);
    await pool.query('DELETE FROM projects WHERE id = ?', [id]);
  });
});

// ─── 마일스톤 재구성: 목표일 vs 실제 도달일 + Gap + 단계별 산출물(다중) ───
describe('Projects — 마일스톤(목표 vs 실제 도달) + 산출물 API', () => {
  let pid;
  let active = [];
  beforeAll(async () => {
    const r = await api().post('/api/projects').send({ name: '__TEST__마일스톤' });
    pid = r.body.id;
    active = (await api().get('/api/projects/stages')).body.data.filter(s => s.is_active);
  });
  afterAll(async () => {
    if (pid) {
      // 업로드된 산출물 파일 정리
      const [files] = await pool.query(
        'SELECT file_path FROM project_milestone_files WHERE project_id = ?',
        [pid]
      );
      const fs = await import('node:fs');
      files.forEach(f => {
        try {
          fs.unlinkSync(f.file_path);
        } catch (_) {
          /* 무시 */
        }
      });
      await pool.query('DELETE FROM project_milestone_files WHERE project_id = ?', [pid]);
      await pool.query('DELETE FROM project_milestones WHERE project_id = ?', [pid]);
      await pool.query('DELETE FROM projects WHERE id = ?', [pid]);
    }
  });

  it('GET /:id/milestones — 활성 단계별 1행 + deliverable_guide + file_count', async () => {
    const res = await api().get(`/api/projects/${pid}/milestones`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(active.length);
    const first = res.body.data[0];
    expect(first.stage_key).toBe(active[0].stage_key);
    expect(first.plan_date).toBeNull();
    expect(first.actual_date).toBeNull();
    expect(Number(first.file_count)).toBe(0);
    expect('deliverable_guide' in first).toBe(true); // 가이드 컬럼 노출
  });

  it('PUT — 목표일·실제 도달일 upsert → 저장 + 메모 반영', async () => {
    const nf = active.find(s => Number(s.requires_file) === 0); // 비증빙 단계
    const put = await api()
      .put(`/api/projects/${pid}/milestones/${nf.stage_key}`)
      .send({ plan_date: '2026-06-01', actual_date: '2026-06-05', note: '도달함' });
    expect(put.status).toBe(200);

    const ms = (await api().get(`/api/projects/${pid}/milestones`)).body.data.find(
      m => m.stage_key === nf.stage_key
    );
    // DATE 직렬화 tz 영향 — 로컬 자정 기준 비교
    expect(new Date(ms.plan_date).getTime()).toBe(new Date('2026-06-01T00:00:00').getTime());
    expect(new Date(ms.actual_date).getTime()).toBe(new Date('2026-06-05T00:00:00').getTime());
    expect(ms.note).toBe('도달함');
  });

  it('PUT — 실제 도달일 비우면(미도달) actual_date NULL 로 상시 변경', async () => {
    const nf = active.find(s => Number(s.requires_file) === 0);
    const put = await api()
      .put(`/api/projects/${pid}/milestones/${nf.stage_key}`)
      .send({ plan_date: '2026-06-01', actual_date: '' });
    expect(put.status).toBe(200);
    const ms = (await api().get(`/api/projects/${pid}/milestones`)).body.data.find(
      m => m.stage_key === nf.stage_key
    );
    expect(ms.actual_date).toBeNull();
    expect(new Date(ms.plan_date).getTime()).toBe(new Date('2026-06-01T00:00:00').getTime());
  });

  it('산출물 — 다중 업로드 + 목록 + file_count 반영 + 다운로드 + 삭제', async () => {
    const nf = active.find(s => Number(s.requires_file) === 0);
    const up = await api()
      .post(`/api/projects/${pid}/milestones/${nf.stage_key}/files`)
      .attach('files', Buffer.from('a'), '산출물1.pdf')
      .attach('files', Buffer.from('bb'), '산출물2.docx');
    expect(up.status).toBe(200);
    expect(up.body.count).toBe(2);

    const list = await api().get(`/api/projects/${pid}/milestones/${nf.stage_key}/files`);
    expect(list.body.data.length).toBe(2);
    expect(list.body.data.map(f => f.file_name)).toContain('산출물1.pdf');

    // GET milestones 의 file_count 반영
    const ms = (await api().get(`/api/projects/${pid}/milestones`)).body.data.find(
      m => m.stage_key === nf.stage_key
    );
    expect(Number(ms.file_count)).toBe(2);

    // 다운로드
    const dl = await api().get(
      `/api/projects/${pid}/milestones/${nf.stage_key}/files/${list.body.data[0].id}`
    );
    expect(dl.status).toBe(200);

    // 삭제 → 1건 남음
    const del = await api().delete(
      `/api/projects/${pid}/milestones/${nf.stage_key}/files/${list.body.data[0].id}`
    );
    expect(del.status).toBe(200);
    const after = await api().get(`/api/projects/${pid}/milestones/${nf.stage_key}/files`);
    expect(after.body.data.length).toBe(1);
  });

  it('증빙필수 단계 — 산출물 없이 실제 도달일 입력 시 400 + requires_file', async () => {
    const rf = active.find(s => Number(s.requires_file) === 1);
    if (!rf) return; // 증빙필수 단계 없으면 skip
    const res = await api()
      .put(`/api/projects/${pid}/milestones/${rf.stage_key}`)
      .send({ actual_date: '2026-06-20' });
    expect(res.status).toBe(400);
    expect(res.body.requires_file).toBe(true);
  });

  it('증빙필수 단계 — 산출물 업로드 후 실제 도달일 저장 성공', async () => {
    const rf = active.find(s => Number(s.requires_file) === 1);
    if (!rf) return;
    const up = await api()
      .post(`/api/projects/${pid}/milestones/${rf.stage_key}/files`)
      .attach('files', Buffer.from('proof'), 'TEST검수확인서.pdf');
    expect(up.status).toBe(200);
    const put = await api()
      .put(`/api/projects/${pid}/milestones/${rf.stage_key}`)
      .send({ plan_date: '2026-06-18', actual_date: '2026-06-20' });
    expect(put.status).toBe(200);
  });

  it('모든 활성 단계 도달 → status 완료(is_final) 자동 동기화', async () => {
    const finalKey = (
      (await api().get('/api/projects/statuses')).body.data.find(s => s.is_final) || {}
    ).status_key;
    for (const s of active) {
      // 증빙필수 단계는 산출물이 1건 이상 있어야 도달 가능
      if (Number(s.requires_file) === 1) {
        const [[{ fc }]] = await pool.query(
          'SELECT COUNT(*) AS fc FROM project_milestone_files WHERE project_id = ? AND stage_key = ?',
          [pid, s.stage_key]
        );
        if (fc === 0)
          await api()
            .post(`/api/projects/${pid}/milestones/${s.stage_key}/files`)
            .attach('files', Buffer.from('x'), 'p.pdf');
      }
      const r = await api()
        .put(`/api/projects/${pid}/milestones/${s.stage_key}`)
        .send({ plan_date: '2026-06-01', actual_date: '2026-06-10' });
      expect(r.status).toBe(200);
    }
    const d = await api().get(`/api/projects/${pid}`);
    expect(d.body.data.status).toBe(finalKey);
  });
});

// ─── 관련 영업리드 연결 — 상세 응답 lead_name JOIN ───
describe('Projects — 관련 영업리드 연결 (lead JOIN)', () => {
  let pid;
  let leadId;
  beforeAll(async () => {
    const [r] = await pool.query(
      "INSERT INTO leads (customer_name, project_name, stage) VALUES ('__TEST__리드고객', '__TEST__리드딜', 'lead')"
    );
    leadId = r.insertId;
    const res = await api()
      .post('/api/projects')
      .send({ name: '__TEST__리드연결', customer_name: '__TEST__리드고객', lead_id: leadId });
    pid = res.body.id;
  });
  afterAll(async () => {
    if (pid) await pool.query('DELETE FROM projects WHERE id = ?', [pid]);
    if (leadId) await pool.query('DELETE FROM leads WHERE id = ?', [leadId]);
  });

  it('GET /:id — lead_id 연결 시 lead_name(딜명) 포함', async () => {
    const res = await api().get(`/api/projects/${pid}`);
    expect(res.status).toBe(200);
    expect(res.body.data.lead_id).toBe(leadId);
    expect(res.body.data.lead_name).toBe('__TEST__리드딜');
  });

  it('GET /:id — lead 미연결 프로젝트는 lead_name null (LEFT JOIN)', async () => {
    const res = await api().post('/api/projects').send({ name: '__TEST__리드없음' });
    const np = res.body.id;
    const got = await api().get(`/api/projects/${np}`);
    expect(got.body.data.lead_id == null).toBe(true);
    expect(got.body.data.lead_name).toBeNull();
    await pool.query('DELETE FROM projects WHERE id = ?', [np]);
  });

  it('GET 목록 — lead 연결 행에 lead_name 포함 (컬럼 선택기용)', async () => {
    const res = await api().get('/api/projects?search=__TEST__리드연결&limit=50');
    expect(res.status).toBe(200);
    const row = res.body.data.find(r => r.id === pid);
    expect(row).toBeTruthy();
    expect(row.lead_name).toBe('__TEST__리드딜');
  });
});
