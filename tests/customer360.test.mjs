/**
 * 고객·제품 360뷰 (MVP) API 테스트
 *   - GET /api/customer360/customers — 선택기 목록(+빠른 KPI)
 *   - GET /api/customer360/:id        — 헤더/요약/소재·제품/영업딜/타임라인/브리핑
 *   - 가중 예상매출 = expected_amount × 단계 확률
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let custId, leadId, matId;

beforeAll(async () => {
  const [c] = await pool.query(
    `INSERT INTO customers (name, region, country, industry) VALUES ('__C360MVP_T__','국내','대한민국','반도체')`
  );
  custId = c.insertId;
  // proposal 단계(기본 확률 50%) · 예상매출 10억 → 가중 5억
  const [l] = await pool.query(
    `INSERT INTO leads (customer_id, customer_name, project_name, business_type, region, stage, expected_amount, currency)
     VALUES (?, '__C360MVP_T__', '__C360MVP_PRJ__', '식각가스', '국내', 'proposal', 1000000000, 'KRW')`,
    [custId]
  );
  leadId = l.insertId;
  // 라이프사이클 소재 + 월 Forecast (수요 100 > CAPA 80 → 갭 20)
  const [m] = await pool.query(
    `INSERT INTO customer_materials (customer_id, material_name, business_type, lifecycle_stage, monthly_demand, demand_unit, win_probability)
     VALUES (?, '__C360_MAT__', '식각가스', 'specin', 100, 'kg', 80)`,
    [custId]
  );
  matId = m.insertId;
  await pool.query(
    `INSERT INTO demand_forecasts (customer_material_id, customer_id, month, customer_forecast, production_capacity, win_probability, expected_revenue, unit)
     VALUES (?, ?, '2026-07', 100, 80, 80, 200000000, 'kg')`,
    [matId, custId]
  );
});

afterAll(async () => {
  if (custId) {
    await pool.query('DELETE FROM customer_sites WHERE customer_id=?', [custId]);
    await pool.query('DELETE FROM customer_contacts WHERE customer_id=?', [custId]);
    await pool.query('DELETE FROM sample_requests WHERE customer_id=?', [custId]);
    await pool.query('DELETE FROM quality_cases WHERE customer_id=?', [custId]);
    await pool.query('DELETE FROM quality_documents WHERE customer_id=?', [custId]);
    await pool.query('DELETE FROM customer_satisfaction WHERE customer_id=?', [custId]);
    const [vs] = await pool.query('SELECT id FROM forecast_versions WHERE customer_id=?', [custId]);
    for (const v of vs) await pool.query('DELETE FROM forecast_version_items WHERE version_id=?', [v.id]);
    await pool.query('DELETE FROM forecast_versions WHERE customer_id=?', [custId]);
  }
  if (matId) {
    await pool.query('DELETE FROM demand_forecasts WHERE customer_material_id=?', [matId]);
    await pool.query('DELETE FROM material_gates WHERE customer_material_id=?', [matId]);
    await pool.query('DELETE FROM customer_materials WHERE id=?', [matId]);
  }
  if (leadId) await pool.query('DELETE FROM leads WHERE id=?', [leadId]);
  if (custId) await pool.query('DELETE FROM customers WHERE id=?', [custId]);
  // Health 기준 설정 원복(테스트가 저장한 값 제거 → 기본값 복귀)
  await pool.query("DELETE FROM system_settings WHERE setting_key='health_config'");
});

describe('Customer360 (MVP) API', () => {
  it('GET /api/customer360/customers — 선택기 목록 구조', async () => {
    const res = await api().get('/api/customer360/customers').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const row = res.body.data.find(c => c.id === custId);
    expect(row).toBeTruthy();
    expect(row).toHaveProperty('open_deals');
    expect(row).toHaveProperty('pipeline_amount');
    // 고급 필터 facet
    expect(row).toHaveProperty('health_grade');
    expect(row).toHaveProperty('has_capa_short');
    expect(row).toHaveProperty('weighted');
    expect(Array.isArray(row.business_types)).toBe(true);
  });

  it('GET /api/customer360/customers?search= — 검색 필터', async () => {
    const res = await api().get('/api/customer360/customers?search=__C360MVP_T__').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every(c => c.name.includes('__C360MVP_T__'))).toBe(true);
  });

  it('GET /api/customer360/:id — 통합 구조 + 가중 예상매출', async () => {
    const res = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.customer.id).toBe(custId);
    expect(d.header).toHaveProperty('health_grade');
    expect(d.header).toHaveProperty('weighted_expected');
    // 단계 정합성 인사이트
    expect(d.header).toHaveProperty('stage_alignment');
    expect(d.header.stage_alignment).toHaveProperty('flags');
    expect(Array.isArray(d.header.stage_alignment.flags)).toBe(true);
    // 10억 × 50% = 5억
    expect(d.header.weighted_expected).toBe(500000000);
    expect(Array.isArray(d.materials)).toBe(true);
    expect(Array.isArray(d.deals)).toBe(true);
    expect(Array.isArray(d.pipeline)).toBe(true);
    expect(Array.isArray(d.timeline)).toBe(true);
    // 소재(식각가스) 그룹에 딜 1건
    const mat = d.materials.find(m => m.business_type === '식각가스');
    expect(mat).toBeTruthy();
    expect(mat.count).toBeGreaterThanOrEqual(1);
    // 딜 목록에 가중값
    const deal = d.deals.find(x => x.id === leadId);
    expect(deal).toBeTruthy();
    expect(deal.probability).toBe(50);
    expect(deal.weighted).toBe(500000000);
  });

  it('존재하지 않는 고객 → 404', async () => {
    const res = await api().get('/api/customer360/99999999').set('X-User-Id', '1');
    expect(res.status).toBe(404);
  });

  it('lifecycle — 소재 보드 + 수요/생산/수주 흐름 + CAPA 갭', async () => {
    const res = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    const lc = res.body.data.lifecycle;
    expect(lc).toBeTruthy();
    const mat = lc.materials.find(m => m.material_name === '__C360_MAT__');
    expect(mat).toBeTruthy();
    expect(mat.lifecycle_stage).toBe('specin');
    expect(mat.lifecycle_index).toBe(3); // discovery0 sample1 evaluation2 specin3
    // 소재↔딜 소프트 링크: 같은 business_type(식각가스) 딜 1건 → primary 지정(직행)
    expect(mat.linked_deal_count).toBe(1);
    expect(mat.primary_lead_id).toBe(leadId);
    expect(Array.isArray(mat.linked_deals)).toBe(true);
    expect(mat.linked_deals[0]).toMatchObject({ id: leadId, stage: 'proposal' });
    expect(mat.linked_deals[0].project_name).toBe('__C360MVP_PRJ__');
    // 수요 100 > CAPA 80 → 갭 20
    expect(lc.demand_flow.demand).toBe(100);
    expect(lc.demand_flow.capacity).toBe(80);
    expect(lc.demand_flow.gap).toBe(20);
    // specin 소재 → 양산 승인 미팅 액션 존재 (카드형: title/owner/priority)
    const mpAction = lc.actions.find(a => /양산 승인/.test(a.title || ''));
    expect(mpAction).toBeTruthy();
    expect(mpAction).toHaveProperty('priority');
    expect(mpAction).toHaveProperty('owner');
  });

  it('POST /:id/capa-diagnose — 부족 흐름 + 소재별 (ai는 선택)', async () => {
    const res = await api().post(`/api/customer360/${custId}/capa-diagnose`).set('X-User-Id', '1').send({});
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.flow).toHaveProperty('gap');
    expect(Array.isArray(d.materials)).toBe(true);
    // 부족 소재(capacity<demand)가 1건 이상 포착
    expect(d.materials.length).toBeGreaterThanOrEqual(1);
    expect(d.materials[0]).toHaveProperty('gap');
    expect(d).toHaveProperty('ai'); // AI 키 존재(키 없으면 null)
  });

  it('PUT /materials/:id — 단계 수정', async () => {
    const res = await api()
      .put(`/api/customer360/materials/${matId}`)
      .set('X-User-Id', '1')
      .send({ lifecycle_stage: 'massprod' });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT lifecycle_stage FROM customer_materials WHERE id=?', [matId]);
    expect(row.lifecycle_stage).toBe('massprod');
  });

  it('PUT /materials/:mid/current-gate — 현재 게이트 일괄 설정 + lifecycle_stage 동기화', async () => {
    // 활성 게이트 정의 (display_order 순)
    const [defs] = await pool.query(
      "SELECT gate_key, lifecycle_stage FROM plm_gates WHERE is_active=1 ORDER BY display_order ASC, gate_key ASC"
    );
    expect(defs.length).toBeGreaterThan(2);
    const midIdx = Math.floor(defs.length / 2);
    const target = defs[midIdx];

    const res = await api()
      .put(`/api/customer360/materials/${matId}/current-gate`)
      .set('X-User-Id', '1')
      .send({ gate_key: target.gate_key });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 이전=done / 선택=in_progress / 이후=pending + 이전 게이트 실제일 자동 채움(오늘)
    const [rows] = await pool.query(
      "SELECT gate_key, status, DATE_FORMAT(actual_date,'%Y-%m-%d') AS actual_date FROM material_gates WHERE customer_material_id=?",
      [matId]
    );
    const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') AS today");
    const byKey = new Map(rows.map(r => [r.gate_key, r.status]));
    const actByKey = new Map(rows.map(r => [r.gate_key, r.actual_date]));
    defs.forEach((d, i) => {
      const exp = i < midIdx ? 'done' : i === midIdx ? 'in_progress' : 'pending';
      expect(byKey.get(d.gate_key)).toBe(exp);
      if (i < midIdx) expect(actByKey.get(d.gate_key)).toBe(today); // 이전 게이트 실제일 = 오늘
      else expect(actByKey.get(d.gate_key)).toBeFalsy(); // 현재·이후 실제일 해제
    });
    // lifecycle_stage 동기화 (매핑 있을 때만)
    if (target.lifecycle_stage) {
      const [[m]] = await pool.query('SELECT lifecycle_stage FROM customer_materials WHERE id=?', [matId]);
      expect(m.lifecycle_stage).toBe(target.lifecycle_stage);
    }
  });

  it('PUT /materials/:mid/gate-schedule — 게이트 예정일 저장(상태 불변)', async () => {
    const [defs] = await pool.query(
      "SELECT gate_key FROM plm_gates WHERE is_active=1 ORDER BY display_order ASC, gate_key ASC"
    );
    const gk = defs[0].gate_key;
    // 사전: 해당 게이트를 in_progress 로 만들어 상태 보존 확인
    await pool.query(
      `INSERT INTO material_gates (customer_material_id, gate_key, status) VALUES (?,?, 'in_progress')
       ON DUPLICATE KEY UPDATE status='in_progress'`,
      [matId, gk]
    );
    const res = await api()
      .put(`/api/customer360/materials/${matId}/gate-schedule`)
      .set('X-User-Id', '1')
      .send({ gates: [{ gate_key: gk, target_date: '2026-09-30' }] });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query(
      "SELECT DATE_FORMAT(target_date,'%Y-%m-%d') AS td, status FROM material_gates WHERE customer_material_id=? AND gate_key=?",
      [matId, gk]
    );
    expect(row.td).toBe('2026-09-30');
    expect(row.status).toBe('in_progress'); // 상태는 건드리지 않음
  });

  it('PUT /materials/:mid/gate-schedule — 실제일 입력 = 완료(done), 비우면 pending', async () => {
    const [defs] = await pool.query(
      "SELECT gate_key FROM plm_gates WHERE is_active=1 ORDER BY display_order ASC, gate_key ASC"
    );
    const gk = defs[0].gate_key;
    // 실제일 입력 → done + actual 저장
    const set = await api()
      .put(`/api/customer360/materials/${matId}/gate-schedule`)
      .set('X-User-Id', '1')
      .send({ gates: [{ gate_key: gk, actual_date: '2026-03-15' }] });
    expect(set.status).toBe(200);
    let [[row]] = await pool.query(
      "SELECT DATE_FORMAT(actual_date,'%Y-%m-%d') AS ad, status FROM material_gates WHERE customer_material_id=? AND gate_key=?",
      [matId, gk]
    );
    expect(row.ad).toBe('2026-03-15');
    expect(row.status).toBe('done');
    // 실제일 비움 → pending + actual NULL
    const clr = await api()
      .put(`/api/customer360/materials/${matId}/gate-schedule`)
      .set('X-User-Id', '1')
      .send({ gates: [{ gate_key: gk, actual_date: null }] });
    expect(clr.status).toBe(200);
    [[row]] = await pool.query(
      'SELECT actual_date, status FROM material_gates WHERE customer_material_id=? AND gate_key=?',
      [matId, gk]
    );
    expect(row.actual_date).toBeNull();
    expect(row.status).toBe('pending');
  });

  it('PUT /materials/:mid/gate-schedule — 배열 아니면 400', async () => {
    const res = await api()
      .put(`/api/customer360/materials/${matId}/gate-schedule`)
      .set('X-User-Id', '1')
      .send({ gates: 'nope' });
    expect(res.status).toBe(400);
  });

  it('PUT /materials/:mid/current-gate — 잘못된 게이트 키는 400', async () => {
    const res = await api()
      .put(`/api/customer360/materials/${matId}/current-gate`)
      .set('X-User-Id', '1')
      .send({ gate_key: '__NOPE__' });
    expect(res.status).toBe(400);
  });

  it('GET /gate-board — 전사 공정 라이프사이클 집계(게이트 컬럼·행·KPI)', async () => {
    const res = await api().get('/api/customer360/gate-board').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(Array.isArray(d.gates)).toBe(true);
    expect(d.gates.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(d.rows)).toBe(true);
    expect(d.kpis).toBeTruthy();
    expect(typeof d.kpis.total).toBe('number');
    expect(d.kpis.total).toBe(d.rows.length);
    // 테스트 소재가 보드에 포함 + 행 구조 검증
    const row = d.rows.find(r => r.material_id === matId);
    expect(row).toBeTruthy();
    expect(row.customer_id).toBe(custId);
    expect(Array.isArray(row.gates)).toBe(true);
    expect(row.gates.length).toBe(d.gates.length);
    expect(row).toHaveProperty('current_gate');
    expect(row).toHaveProperty('delayed');
  });

  it('POST /forecasts — 월 upsert', async () => {
    const res = await api()
      .post('/api/customer360/forecasts')
      .set('X-User-Id', '1')
      .send({ customer_material_id: matId, customer_id: custId, month: '2026-08', customer_forecast: 120, production_capacity: 130, expected_revenue: 250000000, unit: 'kg' });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query(
      'SELECT customer_forecast FROM demand_forecasts WHERE customer_material_id=? AND month=?',
      [matId, '2026-08']
    );
    expect(Number(row.customer_forecast)).toBe(120);
  });

  it('POST /materials — 생성 + 필수값 검증', async () => {
    const bad = await api().post('/api/customer360/materials').set('X-User-Id', '1').send({ customer_id: custId });
    expect(bad.status).toBe(400);
    const ok = await api()
      .post('/api/customer360/materials')
      .set('X-User-Id', '1')
      .send({ customer_id: custId, material_name: '__C360_MAT2__', lifecycle_stage: 'sample' });
    expect(ok.status).toBe(200);
    await pool.query('DELETE FROM customer_materials WHERE id=?', [ok.body.data.id]);
  });

  it('GET /:id/forecast — 6개월 그리드 + 고객/내부 분리 + 합계', async () => {
    const res = await api().get(`/api/customer360/${custId}/forecast`).set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.months).toHaveLength(6);
    const mat = d.materials.find(m => m.id === matId);
    expect(mat).toBeTruthy();
    expect(mat.rows['2026-07'].customer_forecast).toBe(100);
    expect(mat.rows['2026-07'].internal_forecast).toBeDefined();
    // 합계: 2026-08 은 POST 테스트에서 120 추가됨 (앞선 it 실행 후), 07 은 100 보장
    expect(d.totals['2026-07'].customer).toBe(100);
    expect(Array.isArray(d.versions)).toBe(true);
  });

  let versionId;
  it('POST /:id/forecast/versions — 스냅샷 저장', async () => {
    const res = await api()
      .post(`/api/customer360/${custId}/forecast/versions`)
      .set('X-User-Id', '1')
      .send({ label: '__C360_VER__', version_type: 'internal' });
    expect(res.status).toBe(200);
    expect(res.body.data.item_count).toBeGreaterThanOrEqual(1);
    versionId = res.body.data.id;
  });

  it('GET /forecast/versions/:vid — 버전 월별 합계', async () => {
    const res = await api().get(`/api/customer360/forecast/versions/${versionId}`).set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.version.label).toBe('__C360_VER__');
    expect(res.body.data.totals['2026-07'].customer).toBe(100);
  });

  // ── Phase 3: 조직 / 샘플 / 품질 ──
  it('사업장 CRUD + /:id organization 반영', async () => {
    const cr = await api().post(`/api/customer360/${custId}/sites`).set('X-User-Id', '1').send({ site_name: '__SITE__', line: 'P3', process: '식각' });
    expect(cr.status).toBe(200);
    const sid = cr.body.data.id;
    const det = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    expect(det.body.data.organization.sites.some(s => s.id === sid)).toBe(true);
    const up = await api().put(`/api/customer360/sites/${sid}`).set('X-User-Id', '1').send({ line: 'P4' });
    expect(up.status).toBe(200);
    const del = await api().delete(`/api/customer360/sites/${sid}`).set('X-User-Id', '1');
    expect(del.status).toBe(200);
  });

  it('담당자 생성 + organization 반영', async () => {
    const cr = await api().post(`/api/customer360/${custId}/contacts`).set('X-User-Id', '1').send({ name: '__CONTACT__', role: '구매', is_primary: 1 });
    expect(cr.status).toBe(200);
    const det = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    const c = det.body.data.organization.contacts.find(x => x.id === cr.body.data.id);
    expect(c).toBeTruthy();
    expect(c.is_primary).toBe(1);
    await pool.query('DELETE FROM customer_contacts WHERE id=?', [cr.body.data.id]);
  });

  it('샘플 생성/수정 + GET /:id/samples', async () => {
    const cr = await api().post(`/api/customer360/${custId}/samples`).set('X-User-Id', '1').send({ customer_material_id: matId, purpose: '평가용', status: 'sent' });
    expect(cr.status).toBe(200);
    const list = await api().get(`/api/customer360/${custId}/samples`).set('X-User-Id', '1');
    expect(list.body.data.some(s => s.id === cr.body.data.id)).toBe(true);
    const up = await api().put(`/api/customer360/samples/${cr.body.data.id}`).set('X-User-Id', '1').send({ status: 'passed', result: 'Spec-in' });
    expect(up.status).toBe(200);
    const [[row]] = await pool.query('SELECT status FROM sample_requests WHERE id=?', [cr.body.data.id]);
    expect(row.status).toBe('passed');
    await pool.query('DELETE FROM sample_requests WHERE id=?', [cr.body.data.id]);
  });

  it('GET /exec-summary — 전사 집계 구조', async () => {
    const res = await api().get('/api/customer360/exec-summary').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.kpis).toHaveProperty('weighted_expected');
    expect(d.kpis).toHaveProperty('open_quality');
    expect(d.kpis).toHaveProperty('capa_short_accounts');
    expect(d.kpis).toHaveProperty('gate_delay_count'); // PLM 지연 게이트 KPI
    expect(Array.isArray(d.stage_distribution)).toBe(true);
    // 단계 분포 = PLM 게이트 기준 (전면 교체) — 활성 게이트 수만큼, MRD 포함
    expect(d.stage_distribution.length).toBeGreaterThanOrEqual(6);
    expect(d.stage_distribution.map(s => s.stage)).toContain('MRD');
    expect(Array.isArray(d.top_accounts)).toBe(true);
    expect(d.risks).toHaveProperty('capa_short');
    expect(d.risks).toHaveProperty('quality');
    expect(d.risks).toHaveProperty('eval_delay');
    expect(Array.isArray(d.risks.gate_delay)).toBe(true); // PLM 지연 게이트 목록
    expect(Array.isArray(d.risks.misalign)).toBe(true); // 단계 정합성 불일치
    // /exec-summary 가 /:id 보다 먼저 매칭되어 404/400 이 아님
    expect(res.body.success).toBe(true);
  });

  it('POST /exec-stage/:gate — 게이트 단계 진단(전면 교체: 게이트 키)', async () => {
    // 유효 게이트(MRD) → 200 + 라벨/소재배열 (AI 키 없으면 ai=null)
    const ok = await api().post('/api/customer360/exec-stage/MRD').set('X-User-Id', '1').send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.stage).toBe('MRD');
    expect(typeof ok.body.data.label).toBe('string');
    expect(Array.isArray(ok.body.data.materials)).toBe(true);
    expect(ok.body.data.stats).toHaveProperty('count');
    // 미존재 게이트 → 400
    const bad = await api().post('/api/customer360/exec-stage/__NOPE__').set('X-User-Id', '1').send({});
    expect(bad.status).toBe(400);
  });

  it('exec-summary Top 계정 Health 등급이 상세뷰 등급과 일치 (회귀 방지)', async () => {
    // 🐛 임원360뷰와 고객·제품360뷰의 Health 등급 불일치 버그 회귀 방지
    //   원인: 두 화면이 서로 다른 점수 산식 사용 → computeHealth 단일화로 통일
    const ex = await api().get('/api/customer360/exec-summary').set('X-User-Id', '1');
    expect(ex.status).toBe(200);
    const top = ex.body.data.top_accounts;
    expect(Array.isArray(top)).toBe(true);
    for (const a of top) {
      const d = await api().get(`/api/customer360/${a.id}`).set('X-User-Id', '1');
      expect(d.status).toBe(200);
      expect(a.health_grade).toBe(d.body.data.header.health_grade);
    }
  });

  it('POST /:id/forecast/sync-capa — 생산예측 → CAPA 반영', async () => {
    // 소재명과 동일 product_name 의 생산예측 1건 (forecast_qty 333)
    const [pf] = await pool.query(
      `INSERT INTO production_forecasts (customer_id, customer_name, product_name, business_type, period, forecast_qty, unit, status)
       VALUES (?, '__C360MVP_T__', '__C360_MAT__', '식각가스', '2026-07', 333, 'kg', '예측')`,
      [custId]
    );
    const res = await api().post(`/api/customer360/${custId}/forecast/sync-capa`).set('X-User-Id', '1').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBeGreaterThanOrEqual(1);
    const [[row]] = await pool.query(
      'SELECT production_capacity FROM demand_forecasts WHERE customer_material_id=? AND month=?',
      [matId, '2026-07']
    );
    expect(Number(row.production_capacity)).toBe(333);
    await pool.query('DELETE FROM production_forecasts WHERE id=?', [pf.insertId]);
  });

  it('품질 케이스 생성 + GET /:id/quality + 필수값 + owner_name', async () => {
    const bad = await api().post(`/api/customer360/${custId}/quality`).set('X-User-Id', '1').send({ type: 'VOC' });
    expect(bad.status).toBe(400);
    const cr = await api().post(`/api/customer360/${custId}/quality`).set('X-User-Id', '1').send({ title: '__QCASE__', type: 'NCR', severity: 'high' });
    expect(cr.status).toBe(200);
    const list = await api().get(`/api/customer360/${custId}/quality`).set('X-User-Id', '1');
    const row = list.body.data.find(q => q.id === cr.body.data.id);
    expect(row).toBeTruthy();
    expect(row).toHaveProperty('owner_name'); // B: 담당 join
    await pool.query('DELETE FROM quality_cases WHERE id=?', [cr.body.data.id]);
  });

  it('D: 샘플 상세필드(평가기준/불합격/재샘플) 저장·반영', async () => {
    const cr = await api()
      .post(`/api/customer360/${custId}/samples`)
      .set('X-User-Id', '1')
      .send({ customer_material_id: matId, purpose: '평가', eval_criteria: '순도 99.999%', eval_equipment: '식각설비A', resample: 1 });
    expect(cr.status).toBe(200);
    const up = await api()
      .put(`/api/customer360/samples/${cr.body.data.id}`)
      .set('X-User-Id', '1')
      .send({ status: 'failed', fail_reason: '순도 미달' });
    expect(up.status).toBe(200);
    const list = await api().get(`/api/customer360/${custId}/samples`).set('X-User-Id', '1');
    const row = list.body.data.find(s => s.id === cr.body.data.id);
    expect(row.eval_criteria).toBe('순도 99.999%');
    expect(row.fail_reason).toBe('순도 미달');
    expect(Number(row.resample)).toBe(1);
    await pool.query('DELETE FROM sample_requests WHERE id=?', [cr.body.data.id]);
  });

  it('A: GET /:id/revenue — Forecast→수주→매출→수금 funnel', async () => {
    const res = await api().get(`/api/customer360/${custId}/revenue`).set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(Array.isArray(d.funnel)).toBe(true);
    expect(d.funnel.map(f => f.key)).toEqual(['forecast', 'order', 'sales', 'collection']);
    expect(d).toHaveProperty('ar');
    expect(d).toHaveProperty('overdue');
    expect(d).toHaveProperty('gap');
  });

  it('후속1: header.revenue_breakdown 월/분기/연', async () => {
    const res = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    const rb = res.body.data.header.revenue_breakdown;
    expect(rb).toBeTruthy();
    expect(rb).toHaveProperty('month');
    expect(rb).toHaveProperty('quarter');
    expect(rb).toHaveProperty('annual');
  });

  it('후속2: 품질 문서(CoA/MSDS) CRUD', async () => {
    const cr = await api()
      .post(`/api/customer360/${custId}/documents`)
      .set('X-User-Id', '1')
      .send({ doc_type: 'CoA', doc_no: '__COA__', customer_material_id: matId, issued_at: '2026-06-01' });
    expect(cr.status).toBe(200);
    const list = await api().get(`/api/customer360/${custId}/documents`).set('X-User-Id', '1');
    expect(list.body.data.some(d => d.id === cr.body.data.id)).toBe(true);
    const up = await api().put(`/api/customer360/documents/${cr.body.data.id}`).set('X-User-Id', '1').send({ doc_type: 'MSDS' });
    expect(up.status).toBe(200);
    const del = await api().delete(`/api/customer360/documents/${cr.body.data.id}`).set('X-User-Id', '1');
    expect(del.status).toBe(200);
  });

  it('후속3: 품질 문서 첨부 업로드 + 다운로드', async () => {
    const cr = await api()
      .post(`/api/customer360/${custId}/documents`)
      .set('X-User-Id', '1')
      .send({ doc_type: 'CoA', doc_no: '__COA_FILE__', customer_material_id: matId });
    const docId = cr.body.data.id;
    // 첨부 없는 상태 → 다운로드 404
    const noFile = await api().get(`/api/customer360/documents/${docId}/file`).set('X-User-Id', '1');
    expect(noFile.status).toBe(404);
    // 멀티파트 업로드
    const up = await api()
      .post(`/api/customer360/documents/${docId}/file`)
      .set('X-User-Id', '1')
      .attach('file', Buffer.from('%PDF-1.4 test'), '성적서.pdf');
    expect(up.status).toBe(200);
    // 목록에 file_path/file_name 반영
    const list = await api().get(`/api/customer360/${custId}/documents`).set('X-User-Id', '1');
    const row = list.body.data.find(d => d.id === docId);
    expect(row.file_name).toBe('성적서.pdf');
    expect(row.file_path).toBeTruthy();
    // 다운로드 200 + 첨부 헤더
    const dl = await api().get(`/api/customer360/documents/${docId}/file`).set('X-User-Id', '1');
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    await api().delete(`/api/customer360/documents/${docId}`).set('X-User-Id', '1');
  });

  it('후속3: 품질 응답에 detail_restricted 플래그', async () => {
    const res = await api().get(`/api/customer360/${custId}/quality`).set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('detail_restricted');
  });

  // ── Health 기준 설정 (4대 축 비중 모델 v2) ──
  const DIMS_100 = {
    commercial: { weight: 35, base: 40, perWon: 15, perActive: 8, contractBonus: 20 },
    collection: { weight: 20, perOverdue: 25 },
    quality: { weight: 20, perQuality: 20, perSupport: 15 },
    supply: { weight: 15, shortScore: 50 },
    satisfaction: { weight: 10 },
  };
  const THR = { 'A+': 90, A: 80, 'B+': 70, B: 60, C: 45 };

  it('GET /health-config — 5대 축 + 기본값 구조(v2)', async () => {
    const res = await api().get('/api/customer360/health-config').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.config.version).toBe(2);
    expect(d.config.dimensions.commercial).toHaveProperty('weight');
    expect(d.config.dimensions.satisfaction).toHaveProperty('weight'); // 관계·만족도 축
    expect(d.config.thresholds).toHaveProperty('A+');
    // 5대 축 비중 합 100
    const wsum = ['commercial', 'collection', 'quality', 'supply', 'satisfaction'].reduce(
      (s, k) => s + d.config.dimensions[k].weight,
      0
    );
    expect(wsum).toBe(100);
  });

  it('PUT /health-config — 잘못된 임계값(단조감소 위반) 400', async () => {
    const res = await api()
      .put('/api/customer360/health-config')
      .set('X-User-Id', '1')
      .send({ dimensions: DIMS_100, thresholds: { 'A+': 70, A: 80, 'B+': 60, B: 50, C: 40 } });
    expect(res.status).toBe(400);
  });

  it('PUT /health-config — 비중 합 100 아님 400', async () => {
    const res = await api()
      .put('/api/customer360/health-config')
      .set('X-User-Id', '1')
      .send({ dimensions: { ...DIMS_100, commercial: { ...DIMS_100.commercial, weight: 50 } }, thresholds: THR });
    expect(res.status).toBe(400);
  });

  it('PUT /health-config — 유효 저장 200 + GET 반영 + 등급 변화', async () => {
    // 임계값을 크게 낮춰 등급 상향 → 저장 반영 확인
    const save = await api()
      .put('/api/customer360/health-config')
      .set('X-User-Id', '1')
      .send({ dimensions: DIMS_100, thresholds: { 'A+': 55, A: 45, 'B+': 35, B: 25, C: 15 } });
    expect(save.status).toBe(200);
    expect(save.body.data.config.dimensions.commercial.weight).toBe(35);
    const get = await api().get('/api/customer360/health-config').set('X-User-Id', '1');
    expect(get.body.data.config.thresholds['A+']).toBe(55);
    // 상세뷰 등급 상향 + 축별 분해(health_breakdown) 동봉 확인
    const det = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    expect(['A+', 'A', 'B+', 'B']).toContain(det.body.data.header.health_grade);
    const bd = det.body.data.header.health_breakdown;
    expect(Array.isArray(bd.dims)).toBe(true);
    expect(bd.dims).toHaveLength(4); // 만족도 미수집 고객 → 4축(만족도 제외, 비중 재정규화)
    expect(bd.subs).toHaveProperty('commercial');
  });

  it('만족도(NPS/CSAT) — 입력 시 Health 관계·만족도 축 반영 / 미수집 시 제외', async () => {
    // 미수집: 만족도 축 제외 + 나머지 비중 재정규화(합 100)
    const before = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    const dimsBefore = before.body.data.header.health_breakdown.dims;
    expect(dimsBefore.find(d => d.key === 'satisfaction')).toBeFalsy();
    expect(dimsBefore.reduce((a, d) => a + d.weight, 0)).toBe(100);

    // 범위 검증 — NPS 0~10 초과 400
    const bad = await api()
      .post(`/api/customer360/${custId}/satisfaction`)
      .set('X-User-Id', '1')
      .send({ survey_type: 'NPS', score: 15 });
    expect(bad.status).toBe(400);

    // 입력 — NPS 9(→90), CSAT 4(→75) → 만족도 83
    const p1 = await api()
      .post(`/api/customer360/${custId}/satisfaction`)
      .set('X-User-Id', '1')
      .send({ survey_type: 'NPS', score: 9, surveyed_at: '2026-05-01' });
    expect(p1.status).toBe(200);
    await api()
      .post(`/api/customer360/${custId}/satisfaction`)
      .set('X-User-Id', '1')
      .send({ survey_type: 'CSAT', score: 4, surveyed_at: '2026-05-01' });

    // 조회 — 최근값 + 0~100 점수
    const sat = await api().get(`/api/customer360/${custId}/satisfaction`).set('X-User-Id', '1');
    expect(sat.body.data.latest_nps).toBe(9);
    expect(sat.body.data.latest_csat).toBe(4);
    expect(sat.body.data.score).toBe(83); // round(avg(90, 75))
    expect(sat.body.data.rows.length).toBeGreaterThanOrEqual(2);

    // 반영: 만족도 축 포함(5축) + 점수 83 + 비중 합 100
    const after = await api().get(`/api/customer360/${custId}`).set('X-User-Id', '1');
    const dimsAfter = after.body.data.header.health_breakdown.dims;
    const satDim = dimsAfter.find(d => d.key === 'satisfaction');
    expect(satDim).toBeTruthy();
    expect(satDim.score).toBe(83);
    expect(dimsAfter.reduce((a, d) => a + d.weight, 0)).toBe(100);

    // 정리 — 다른 테스트 격리
    await pool.query('DELETE FROM customer_satisfaction WHERE customer_id=?', [custId]);
  });
});
