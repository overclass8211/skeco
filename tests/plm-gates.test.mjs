/**
 * PLM 스테이지-게이트 API 테스트 (Phase 1)
 *   - 게이트 정의 CRUD (설정형)
 *   - 소재 게이트 업서트 → 360 응답 materials[].gates + current_gate 반영
 *   - 지연(late) 산출: 과거 목표일 + 미완료
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let custId, matId;
const TEST_GATE = '__PLM_T__';

beforeAll(async () => {
  const [c] = await pool.query(
    `INSERT INTO customers (name, region, country, industry) VALUES ('__PLMGATE_T__','국내','대한민국','반도체')`
  );
  custId = c.insertId;
  const [m] = await pool.query(
    `INSERT INTO customer_materials (customer_id, material_name, business_type, lifecycle_stage, monthly_demand, demand_unit)
     VALUES (?, '__PLM_MAT__', '포토소재', 'evaluation', 100, 'L')`,
    [custId]
  );
  matId = m.insertId;
});

afterAll(async () => {
  if (matId) await pool.query('DELETE FROM material_gates WHERE customer_material_id=?', [matId]);
  if (matId) await pool.query('DELETE FROM customer_materials WHERE id=?', [matId]);
  if (custId) await pool.query('DELETE FROM customers WHERE id=?', [custId]);
  await pool.query('DELETE FROM plm_gates WHERE gate_key=?', [TEST_GATE]);
});

describe('PLM Stage-Gate API', () => {
  it('GET /gates — 기본 게이트 정의 조회(MRD~MP)', async () => {
    const res = await api().get('/api/customer360/gates').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const keys = res.body.data.map(g => g.gate_key);
    expect(keys).toContain('MRD');
    expect(keys).toContain('MP');
    // display_order 오름차순
    const ords = res.body.data.map(g => g.display_order);
    expect([...ords]).toEqual([...ords].sort((a, b) => a - b));
  });

  it('POST/PUT/DELETE /gates — 사용자 정의 게이트 추가·수정·삭제', async () => {
    const cr = await api().post('/api/customer360/gates').set('X-User-Id', '1')
      .send({ gate_key: TEST_GATE, gate_label: '커스텀게이트', display_order: 99, lifecycle_stage: 'sample' });
    expect(cr.status).toBe(200);
    let g = (await api().get('/api/customer360/gates?all=1').set('X-User-Id', '1')).body.data.find(x => x.gate_key === TEST_GATE);
    expect(g).toBeTruthy();
    expect(g.gate_label).toBe('커스텀게이트');

    const up = await api().put(`/api/customer360/gates/${TEST_GATE}`).set('X-User-Id', '1').send({ gate_label: '수정됨', is_active: 0 });
    expect(up.status).toBe(200);
    g = (await api().get('/api/customer360/gates?all=1').set('X-User-Id', '1')).body.data.find(x => x.gate_key === TEST_GATE);
    expect(g.gate_label).toBe('수정됨');
    expect(g.is_active).toBe(0);

    const del = await api().delete(`/api/customer360/gates/${TEST_GATE}`).set('X-User-Id', '1');
    expect(del.status).toBe(200);
    g = (await api().get('/api/customer360/gates?all=1').set('X-User-Id', '1')).body.data.find(x => x.gate_key === TEST_GATE);
    expect(g).toBeFalsy();
  });

  it('POST /gates — 필수값 검증(400)', async () => {
    const res = await api().post('/api/customer360/gates').set('X-User-Id', '1').send({ gate_key: 'X' });
    expect(res.status).toBe(400);
  });

  it('PUT /materials/:mid/gates/:key + 360 반영 — gates 타임라인 + current_gate', async () => {
    // MRD 완료, CRP 진행
    await api().put(`/api/customer360/materials/${matId}/gates/MRD`).set('X-User-Id', '1')
      .send({ target_date: '2025-10-15', actual_date: '2025-10-12', status: 'done' });
    const r2 = await api().put(`/api/customer360/materials/${matId}/gates/CRP`).set('X-User-Id', '1')
      .send({ target_date: '2025-12-15', status: 'in_progress' });
    expect(r2.status).toBe(200);

    const det = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    const mat = det.body.data.lifecycle.materials.find(m => m.id === matId);
    expect(mat).toBeTruthy();
    expect(Array.isArray(mat.gates)).toBe(true);
    const mrd = mat.gates.find(g => g.gate_key === 'MRD');
    const crp = mat.gates.find(g => g.gate_key === 'CRP');
    expect(mrd.status).toBe('done');
    expect(crp.status).toBe('in_progress');
    expect(mat.current_gate).toBe('CRP'); // 첫 in_progress
  });

  it('지연(late) 산출 — 과거 목표일 + 미완료', async () => {
    await api().put(`/api/customer360/materials/${matId}/gates/DOE`).set('X-User-Id', '1')
      .send({ target_date: '2020-01-01', status: 'pending' });
    const det = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    const mat = det.body.data.lifecycle.materials.find(m => m.id === matId);
    const doe = mat.gates.find(g => g.gate_key === 'DOE');
    expect(doe.late).toBe(true);
  });
});
