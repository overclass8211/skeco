'use strict';
// =============================================================
// 고객·제품 360뷰 (MVP 1차) — 집계 전용 라우트
//
//   GET /api/customer360/customers   고객 선택기용 경량 목록(+빠른 KPI)
//   GET /api/customer360/:id         단일 고객 통합 360 (헤더/요약/소재·제품/영업기회/타임라인/AI 브리핑)
//
// 설계: 기존 테이블만 사용(무스키마변경).
//   - 매칭 규칙: leads/activities 는 customer_name, quotes/proposals/contracts 는
//     (customer_id 우선, NULL 이면 customer_name fallback) — 기존 360view 와 동일.
//   - 가중 예상매출: SUM(expected_amount × 단계 수주확률), lead.win_probability 우선.
//   - Account Health: 간이 휴리스틱(수주/진행/리스크 가감) → 0~100 + 등급.
//   금액 단위: 원(₩) 풀값.
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { validateId } = require('../middleware/validate');
const { requireLevel } = require('../middleware/rbac');
const { getUserId } = require('../middleware/auth');
const { getRoleInfo } = require('../services/authService');
const { genAI, MODEL_FAST, SAFETY_SETTINGS } = require('../services/gemini');

// 요청자 권한 레벨 (테스트/비인증 컨텍스트는 풀접근으로 간주)
function userLevel(req) {
  if (!req.user) return 99;
  try {
    return getRoleInfo(req.user.role).level || 0;
  } catch (_) {
    return 0;
  }
}

// JSON 안전 파싱
function safeJson(s, fallback) {
  if (!s) return fallback;
  if (typeof s === 'object') return s;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// ── 고객 선택기 목록 (경량 + 빠른 KPI) ───────────────────────
router.get('/customers', async (req, res) => {
  try {
    const q = (req.query.search || '').trim();
    const like = `%${q}%`;
    const where = q ? 'WHERE c.name LIKE ? OR c.industry LIKE ?' : '';
    const params = q ? [like, like] : [];
    // 동일 회사명 복수 행(소속 담당자) → 회사 단위로 1건만 (대표=MIN id)
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.industry, c.region, c.country,
              (SELECT COUNT(*) FROM leads l
                 WHERE l.customer_name = c.name
                   AND l.stage NOT IN ('won','lost','dropped')) AS open_deals,
              (SELECT COALESCE(SUM(l.expected_amount),0) FROM leads l
                 WHERE l.customer_name = c.name
                   AND l.stage NOT IN ('lost','dropped')) AS pipeline_amount
         FROM customers c
         JOIN (SELECT MIN(id) AS id FROM customers GROUP BY name) rep ON rep.id = c.id
         ${where}
         ORDER BY pipeline_amount DESC, c.name ASC
         LIMIT 500`,
      params
    );
    res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id,
        name: r.name,
        industry: r.industry || null,
        region: r.region || null,
        country: r.country || null,
        open_deals: Number(r.open_deals) || 0,
        pipeline_amount: Number(r.pipeline_amount) || 0,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// 임원 360 요약(전사) — /:id 보다 먼저 등록 (정적 경로 우선)
router.get('/exec-summary', execSummary);
// 임원 AI 브리핑 — 캐시 조회(GET) / 생성(POST). /:id 보다 먼저 등록
router.get('/exec-brief', execBriefGet);
router.post('/exec-brief', execBriefPost);
router.post('/exec-stage/:stage', execStageAnalyze);
router.get('/exec-kpi/:kpi', execKpiList); // KPI 근거 전체 목록 — /:id 보다 먼저
router.get('/health-config', healthConfigGet); // Health 기준 조회 (전원)
router.put('/health-config', requireLevel(2), healthConfigSave); // Health 기준 저장 (team_lead+)

// ── 단일 고객 통합 360 ───────────────────────────────────────
router.get('/:id', validateId, async (req, res) => {
  try {
    const id = req.params.id;
    const [[c]] = await pool.query('SELECT * FROM customers WHERE id=?', [id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    const name = c.name;
    const byCust = '(customer_id = ? OR (customer_id IS NULL AND customer_name = ?))';
    const p = [id, name];

    const [
      leadRows,
      [weightedAgg],
      [quoteAgg],
      [propAgg],
      [contractAgg],
      [payAgg],
      [supportAgg],
      [actAgg],
      recentActs,
      recentQuotes,
      recentProps,
      recentContracts,
      [brief],
    ] = await Promise.all([
      // 딜(leads) 전체 — 소재/제품·영업기회 탭 공용
      pool
        .query(
          `SELECT l.id, l.project_name, l.business_type, l.region, l.stage,
                  l.expected_amount, l.win_probability, l.expected_close_date,
                  l.assigned_to, t.name AS owner_name,
                  ps.label AS stage_label, ps.role AS stage_role,
                  COALESCE(l.win_probability, ps.win_probability, 0) AS prob
             FROM leads l
             LEFT JOIN pipeline_stages ps ON ps.stage_key = l.stage
             LEFT JOIN team_members t ON t.id = l.assigned_to
            WHERE l.customer_name = ?
            ORDER BY ps.sort_order ASC, l.expected_amount DESC`,
          [name]
        )
        .then(r => r[0]),
      // 가중 예상매출 (진행 딜만 — lost/dropped 제외)
      pool
        .query(
          `SELECT COALESCE(SUM(l.expected_amount * COALESCE(l.win_probability, ps.win_probability, 0) / 100),0) AS weighted
             FROM leads l
             LEFT JOIN pipeline_stages ps ON ps.stage_key = l.stage
            WHERE l.customer_name = ? AND l.stage NOT IN ('lost','dropped')`,
          [name]
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS amt FROM quotes WHERE ${byCust}`,
          p
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(expected_amount),0) AS amt FROM proposals WHERE ${byCust}`,
          p
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(contract_amount),0) AS amt,
                  SUM(CASE WHEN status IN ('active','signed','approved','completed') THEN 1 ELSE 0 END) AS active_cnt
             FROM contracts WHERE ${byCust}`,
          p
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT COUNT(*) AS cnt,
                  SUM(CASE WHEN due_date < CURDATE() AND recognized_at IS NULL THEN 1 ELSE 0 END) AS overdue_cnt
             FROM payment_schedules WHERE ${byCust}`,
          p
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT COUNT(*) AS cnt,
                  SUM(CASE WHEN resolved_at IS NULL AND closed_at IS NULL THEN 1 ELSE 0 END) AS open_cnt
             FROM support_tickets WHERE customer_id = ?`,
          [id]
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT COUNT(*) AS cnt FROM activities a JOIN leads l ON a.lead_id = l.id WHERE l.customer_name = ?`,
          [name]
        )
        .then(r => r[0]),
      // 타임라인 머지용
      pool
        .query(
          `SELECT a.activity_type, a.title, a.performed_at AS dt
             FROM activities a JOIN leads l ON a.lead_id = l.id
            WHERE l.customer_name = ? ORDER BY a.performed_at DESC LIMIT 8`,
          [name]
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT quote_no, name, total_amount, status, COALESCE(quote_date, created_at) AS dt
             FROM quotes WHERE ${byCust} ORDER BY dt DESC LIMIT 6`,
          p
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT proposal_no, proposal_title, expected_amount, status, COALESCE(proposal_date, created_at) AS dt
             FROM proposals WHERE ${byCust} ORDER BY dt DESC LIMIT 6`,
          p
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT contract_no, title, contract_amount, status, COALESCE(start_date, created_at) AS dt
             FROM contracts WHERE ${byCust} ORDER BY dt DESC LIMIT 6`,
          p
        )
        .then(r => r[0]),
      // 최신 AI 브리핑
      pool
        .query(
          `SELECT headline, key_points, next_action, risk, stats, generated_at
             FROM customer_briefs WHERE customer_id = ? ORDER BY generated_at DESC LIMIT 1`,
          [id]
        )
        .then(r => r[0]),
    ]);

    // ── 소재/제품 탭: business_type 별 그룹 ──
    const matMap = new Map();
    for (const l of leadRows) {
      const key = l.business_type || '기타';
      if (!matMap.has(key)) {
        matMap.set(key, {
          business_type: key,
          count: 0,
          total_expected: 0,
          weighted: 0,
          stages: {},
          won: 0,
        });
      }
      const m = matMap.get(key);
      m.count += 1;
      const amt = Number(l.expected_amount) || 0;
      if (l.stage_role !== 'lost' && l.stage_role !== 'dropped') {
        m.total_expected += amt;
        m.weighted += (amt * (Number(l.prob) || 0)) / 100;
      }
      const sl = l.stage_label || l.stage;
      m.stages[sl] = (m.stages[sl] || 0) + 1;
      if (l.stage_role === 'won') m.won += 1;
    }
    const materials = [...matMap.values()].sort((a, b) => b.total_expected - a.total_expected);

    // ── 영업기회(딜) 목록 ──
    const deals = leadRows.map(l => ({
      id: l.id,
      project_name: l.project_name,
      business_type: l.business_type,
      stage: l.stage,
      stage_label: l.stage_label || l.stage,
      stage_role: l.stage_role || 'active',
      expected_amount: Number(l.expected_amount) || 0,
      probability: Number(l.prob) || 0,
      weighted: Math.round(((Number(l.expected_amount) || 0) * (Number(l.prob) || 0)) / 100),
      expected_close_date: l.expected_close_date || null,
      owner_name: l.owner_name || null,
    }));

    // ── 파이프라인(단계별 분포) ──
    const pipeMap = new Map();
    for (const l of leadRows) {
      const k = l.stage_label || l.stage;
      if (!pipeMap.has(k))
        pipeMap.set(k, { stage: k, role: l.stage_role || 'active', count: 0, amount: 0 });
      const e = pipeMap.get(k);
      e.count += 1;
      e.amount += Number(l.expected_amount) || 0;
    }
    const pipeline = [...pipeMap.values()];

    // ── 통합 타임라인 (type 만 부여, 아이콘은 프론트 SVG) — 샘플/품질 접점 포함 ──
    const [recentSamples, recentQuality] = await Promise.all([
      pool
        .query(
          `SELECT sample_no, status, COALESCE(sent_at, requested_at, created_at) AS dt
             FROM sample_requests WHERE customer_id=? ORDER BY dt DESC LIMIT 5`,
          [id]
        )
        .then(r => r[0]),
      pool
        .query(
          `SELECT case_no, title, type, status, COALESCE(opened_at, created_at) AS dt
             FROM quality_cases WHERE customer_id=? ORDER BY dt DESC LIMIT 5`,
          [id]
        )
        .then(r => r[0]),
    ]);
    const timeline = [
      ...recentActs.map(r => ({ type: 'activity', title: r.title || r.activity_type, date: r.dt })),
      ...recentSamples.map(r => ({
        type: 'sample',
        title: `샘플 ${r.sample_no || ''}`.trim(),
        date: r.dt,
        status: r.status,
      })),
      ...recentQuality.map(r => ({
        type: 'quality',
        title: `품질 ${r.case_no || ''} ${r.title || ''}`.trim(),
        date: r.dt,
        status: r.status,
      })),
      ...recentQuotes.map(r => ({
        type: 'quote',
        title: `견적 ${r.quote_no || ''} ${r.name || ''}`.trim(),
        date: r.dt,
        amount: Number(r.total_amount) || 0,
        status: r.status,
      })),
      ...recentProps.map(r => ({
        type: 'proposal',
        title: `제안 ${r.proposal_no || ''} ${r.proposal_title || ''}`.trim(),
        date: r.dt,
        amount: Number(r.expected_amount) || 0,
        status: r.status,
      })),
      ...recentContracts.map(r => ({
        type: 'contract',
        title: `계약 ${r.contract_no || ''} ${r.title || ''}`.trim(),
        date: r.dt,
        amount: Number(r.contract_amount) || 0,
        status: r.status,
      })),
    ]
      .filter(e => e.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 15);

    // ── 헤더 지표 ──
    const wonCount = leadRows.filter(l => l.stage_role === 'won').length;
    const activeCount = leadRows.filter(
      l => l.stage_role !== 'won' && l.stage_role !== 'lost' && l.stage_role !== 'dropped'
    ).length;
    const overdue = Number(payAgg.overdue_cnt) || 0;
    const openSupport = Number(supportAgg.open_cnt) || 0;
    const contractAmt = Number(contractAgg.amt) || 0;

    // Account Health 는 라이프사이클(품질·CAPA)까지 반영하므로 아래 lifecycle 계산 후 산출
    const risks = [];
    if (overdue > 0) risks.push({ level: 'high', label: `연체 수금 ${overdue}건` });
    if (openSupport > 0) risks.push({ level: 'medium', label: `미해결 지원 ${openSupport}건` });
    const stalledLeads = leadRows.filter(l => l.stage === 'lead' || l.stage === 'review').length;
    if (stalledLeads >= 2) risks.push({ level: 'low', label: `초기단계 정체 ${stalledLeads}건` });

    // ── 라이프사이클(소재) + 수요·생산·수주 흐름 + 품질 ──
    const lifecycle = await buildLifecycle(id);
    // 라이프사이클 리스크를 헤더 리스크에 병합
    if (lifecycle.demand_flow.gap > 0) {
      risks.unshift({ level: 'high', label: `CAPA 부족 ${lifecycle.demand_flow.gap_label}` });
    }
    const openQ = lifecycle.quality.filter(q => q.status !== 'resolved').length;
    if (openQ > 0) risks.unshift({ level: 'medium', label: `품질 이슈 ${openQ}건` });

    // 단일 Account Health 산식 (상세뷰·임원뷰 공용) — 등급 불일치 방지
    const _healthCfgDetail = await getHealthConfig();
    const { score, grade, subs } = computeHealth(
      {
        won: wonCount,
        active: activeCount,
        contractAmt,
        overdue,
        openSupport,
        openQuality: openQ,
        capaShort: lifecycle.demand_flow.gap > 0,
      },
      _healthCfgDetail
    );
    // 경영진 설명용 — 축별 점수 + 비중/라벨
    const healthBreakdown = {
      subs,
      dims: HEALTH_DIM_KEYS.map(k => ({
        key: k,
        label: _healthCfgDetail.dimensions[k].label,
        weight: _healthCfgDetail.dimensions[k].weight,
        score: subs[k],
      })),
    };

    // ── 예상매출 월/분기/연 분해 (demand_forecasts 기준) ──
    const [brkRows] = await pool.query(
      `SELECT df.month AS m, COALESCE(SUM(df.expected_revenue),0) AS rev
         FROM demand_forecasts df
         JOIN customer_materials cm ON cm.id = df.customer_material_id
        WHERE cm.customer_id = ? GROUP BY df.month ORDER BY df.month`,
      [id]
    );
    const sortedRev = brkRows.map(r => ({ m: r.m, rev: Number(r.rev) || 0 }));
    const revenueBreakdown = {
      month: sortedRev.length ? sortedRev[0].rev : 0,
      quarter: sortedRev.slice(0, 3).reduce((s, r) => s + r.rev, 0),
      annual: sortedRev.reduce((s, r) => s + r.rev, 0),
    };

    // ── 조직: 사업장 + 담당자 ──
    const [orgSites, orgContacts] = await Promise.all([
      pool
        .query('SELECT * FROM customer_sites WHERE customer_id=? ORDER BY id', [id])
        .then(r => r[0]),
      pool
        .query('SELECT * FROM customer_contacts WHERE customer_id=? ORDER BY is_primary DESC, id', [
          id,
        ])
        .then(r => r[0]),
    ]);

    res.json({
      success: true,
      data: {
        customer: {
          id: c.id,
          name: c.name,
          industry: c.industry ?? null,
          region: c.region ?? null,
          country: c.country ?? null,
          contact_person: c.contact_person ?? null,
          phone: c.phone ?? null,
          email: c.email ?? null,
          created_at: c.created_at ?? null,
        },
        header: {
          health_score: score,
          health_grade: grade,
          health_breakdown: healthBreakdown,
          weighted_expected: Math.round(Number(weightedAgg.weighted) || 0),
          won_count: wonCount,
          active_count: activeCount,
          contract_amount: contractAmt,
          revenue_breakdown: revenueBreakdown,
          risks,
        },
        summary: {
          deals: {
            count: leadRows.length,
            total_expected: leadRows
              .filter(l => l.stage_role !== 'lost' && l.stage_role !== 'dropped')
              .reduce((s, l) => s + (Number(l.expected_amount) || 0), 0),
          },
          quotes: { count: Number(quoteAgg.cnt) || 0, total_amount: Number(quoteAgg.amt) || 0 },
          proposals: { count: Number(propAgg.cnt) || 0, total_expected: Number(propAgg.amt) || 0 },
          contracts: {
            count: Number(contractAgg.cnt) || 0,
            total_amount: contractAmt,
            active_count: Number(contractAgg.active_cnt) || 0,
          },
          payments: { count: Number(payAgg.cnt) || 0, overdue_count: overdue },
          support: { count: Number(supportAgg.cnt) || 0, open_count: openSupport },
          activities: { count: Number(actAgg.cnt) || 0 },
        },
        materials,
        deals,
        pipeline,
        timeline,
        lifecycle,
        organization: { sites: orgSites, contacts: orgContacts },
        brief: brief
          ? {
              headline: brief.headline || '',
              key_points: safeJson(brief.key_points, []),
              next_action: brief.next_action || '',
              risk: brief.risk || '',
              stats: safeJson(brief.stats, {}),
              generated_at: brief.generated_at || null,
            }
          : null,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 라이프사이클 단계 메타 ───────────────────────────────────
const STAGE_LABELS = {
  discovery: '발굴',
  sample: '샘플',
  evaluation: '평가',
  specin: 'Spec-in',
  massprod: '양산',
  delivery: '납품',
};
const STAGE_ORDER = ['discovery', 'sample', 'evaluation', 'specin', 'massprod', 'delivery'];
const FLOW_MONTHS = ['2026-07', '2026-08', '2026-09'];

function fmtQty(n, unit) {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString('ko-KR')}${unit || ''}`;
}

// 고객의 소재 라이프사이클 + 분기 수요/생산/수주 흐름 + 품질 + AI 액션
async function buildLifecycle(customerId) {
  const [mats] = await pool.query(
    `SELECT * FROM customer_materials WHERE customer_id=? AND status<>'closed'
       ORDER BY FIELD(lifecycle_stage,'massprod','specin','evaluation','sample','discovery','delivery'), id`,
    [customerId]
  );
  const matIds = mats.map(m => m.id);
  let fcs = [];
  if (matIds.length) {
    [fcs] = await pool.query(
      `SELECT * FROM demand_forecasts WHERE customer_material_id IN (?) AND month IN (?)`,
      [matIds, FLOW_MONTHS]
    );
  }
  const [qcs] = await pool.query(
    `SELECT id, case_no, customer_material_id, type, severity, status, title, opened_at
       FROM quality_cases WHERE customer_id=? ORDER BY FIELD(status,'open','in_progress','resolved'), opened_at DESC`,
    [customerId]
  );

  const fcByMat = new Map();
  for (const f of fcs) {
    if (!fcByMat.has(f.customer_material_id)) fcByMat.set(f.customer_material_id, []);
    fcByMat.get(f.customer_material_id).push(f);
  }
  const openQByMat = new Map();
  for (const q of qcs) {
    if (q.status === 'resolved') continue;
    openQByMat.set(q.customer_material_id, (openQByMat.get(q.customer_material_id) || 0) + 1);
  }

  let totalDemand = 0;
  let totalCapa = 0;
  let totalExpectedOrder = 0;
  const unitSet = new Set();

  const materials = mats.map(m => {
    const list = fcByMat.get(m.id) || [];
    const demand = list.reduce((s, f) => s + (Number(f.customer_forecast) || 0), 0);
    const capa = list.reduce((s, f) => s + (Number(f.production_capacity) || 0), 0);
    const expRev = list.reduce(
      (s, f) => s + ((Number(f.expected_revenue) || 0) * (Number(f.win_probability) || 0)) / 100,
      0
    );
    totalDemand += demand;
    totalCapa += capa;
    totalExpectedOrder += expRev;
    if (m.demand_unit) unitSet.add(m.demand_unit);
    const capaShort = capa > 0 && capa < demand;
    return {
      id: m.id,
      material_name: m.material_name,
      business_type: m.business_type,
      fab_line: m.fab_line,
      lifecycle_stage: m.lifecycle_stage,
      lifecycle_label: STAGE_LABELS[m.lifecycle_stage] || m.lifecycle_stage,
      lifecycle_index: Math.max(0, STAGE_ORDER.indexOf(m.lifecycle_stage)),
      expected_mp_date: m.expected_mp_date,
      monthly_demand: Number(m.monthly_demand) || 0,
      demand_unit: m.demand_unit,
      win_probability: m.win_probability,
      quarter_demand: Math.round(demand),
      quarter_capacity: Math.round(capa),
      quarter_expected_order: Math.round(expRev),
      capa_short: capaShort,
      open_quality: openQByMat.get(m.id) || 0,
    };
  });

  const unit = unitSet.size === 1 ? [...unitSet][0] : '';
  const gap = Math.max(0, Math.round(totalDemand - totalCapa));
  const demand_flow = {
    demand: Math.round(totalDemand),
    capacity: Math.round(totalCapa),
    gap,
    expected_order: Math.round(totalExpectedOrder),
    unit,
    demand_label: fmtQty(totalDemand, unit),
    capacity_label: fmtQty(totalCapa, unit),
    gap_label: fmtQty(gap, unit),
  };

  const quality = qcs.map(q => ({
    id: q.id,
    case_no: q.case_no,
    material_id: q.customer_material_id,
    type: q.type,
    severity: q.severity,
    status: q.status,
    title: q.title,
    opened_at: q.opened_at,
  }));

  // 규칙 기반 AI 추천 액션 (상위 4건)
  const actions = [];
  const shortMat = materials.find(m => m.capa_short);
  if (shortMat) {
    actions.push({
      icon: 'factory',
      text: `생산팀에 CAPA 재검토 요청 — ${shortMat.material_name} 분기 수요 ${fmtQty(shortMat.quarter_demand, shortMat.demand_unit)} 대비 부족`,
    });
  }
  const specinMat = materials.find(m => m.lifecycle_stage === 'specin');
  if (specinMat) {
    actions.push({
      icon: 'file-check',
      text: `${specinMat.material_name} 양산 승인 미팅 제안 — 공정기술팀 평가 결과 확인`,
    });
  }
  const openQuality = quality.find(q => q.status !== 'resolved');
  if (openQuality) {
    actions.push({
      icon: 'shield-check',
      text: `${openQuality.title} 재발방지 보고서 고객 공유 — 평가/거래 재개 유도`,
    });
  }
  const evalMat = materials.find(m => m.lifecycle_stage === 'evaluation');
  if (evalMat && actions.length < 4) {
    actions.push({
      icon: 'flask',
      text: `${evalMat.material_name} 고객 평가 진행 점검 — 재샘플/스펙 협의 필요 여부 확인`,
    });
  }

  return { materials, demand_flow, quality, actions };
}

// ── 편집 CRUD (manager+ · requireLevel 1) ────────────────────
// 소재 생성
router.post('/materials', requireLevel(1), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.customer_id || !b.material_name)
      return res.status(400).json({ success: false, error: 'customer_id, material_name 필수' });
    const stage = STAGE_ORDER.includes(b.lifecycle_stage) ? b.lifecycle_stage : 'discovery';
    const [r] = await pool.query(
      `INSERT INTO customer_materials
         (customer_id, product_id, material_name, business_type, fab_line, lifecycle_stage,
          expected_mp_date, monthly_demand, demand_unit, win_probability, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        b.customer_id,
        b.product_id || null,
        b.material_name,
        b.business_type || null,
        b.fab_line || null,
        stage,
        b.expected_mp_date || null,
        b.monthly_demand ?? null,
        b.demand_unit || 'kg',
        b.win_probability ?? null,
        b.notes || null,
      ]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (err) {
    handleError(res, err);
  }
});

// 소재 수정 (단계/수요/양산일/확률 등)
router.put('/materials/:id', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    const fields = [];
    const vals = [];
    const allow = {
      material_name: 'material_name',
      business_type: 'business_type',
      fab_line: 'fab_line',
      lifecycle_stage: 'lifecycle_stage',
      expected_mp_date: 'expected_mp_date',
      monthly_demand: 'monthly_demand',
      demand_unit: 'demand_unit',
      win_probability: 'win_probability',
      status: 'status',
      notes: 'notes',
    };
    for (const [k, col] of Object.entries(allow)) {
      if (b[k] !== undefined) {
        if (k === 'lifecycle_stage' && !STAGE_ORDER.includes(b[k])) continue;
        fields.push(`${col}=?`);
        vals.push(b[k] === '' ? null : b[k]);
      }
    }
    if (!fields.length) return res.status(400).json({ success: false, error: '수정할 필드 없음' });
    vals.push(req.params.id);
    const [r] = await pool.query(
      `UPDATE customer_materials SET ${fields.join(', ')} WHERE id=?`,
      vals
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, error: '소재 없음' });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// 월별 Forecast upsert
router.post('/forecasts', requireLevel(1), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.customer_material_id || !b.month)
      return res.status(400).json({ success: false, error: 'customer_material_id, month 필수' });
    await pool.query(
      `INSERT INTO demand_forecasts
         (customer_material_id, customer_id, month, customer_forecast, internal_forecast,
          production_capacity, win_probability, expected_revenue, unit)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE customer_forecast=VALUES(customer_forecast),
         internal_forecast=VALUES(internal_forecast), production_capacity=VALUES(production_capacity),
         win_probability=VALUES(win_probability), expected_revenue=VALUES(expected_revenue),
         unit=VALUES(unit)`,
      [
        b.customer_material_id,
        b.customer_id || null,
        b.month,
        b.customer_forecast || 0,
        b.internal_forecast || 0,
        b.production_capacity ?? null,
        b.win_probability ?? null,
        b.expected_revenue || 0,
        b.unit || 'kg',
      ]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 포캐스트 탭 (고객/내부 분리 + 버전관리) ──────────────────
const FORECAST_MONTHS = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];

async function buildForecastDetail(customerId) {
  const [mats] = await pool.query(
    `SELECT id, material_name, business_type, demand_unit FROM customer_materials
       WHERE customer_id=? AND status<>'closed' ORDER BY id`,
    [customerId]
  );
  const matIds = mats.map(m => m.id);
  let fcs = [];
  if (matIds.length) {
    [fcs] = await pool.query(
      `SELECT * FROM demand_forecasts WHERE customer_material_id IN (?) AND month IN (?)`,
      [matIds, FORECAST_MONTHS]
    );
  }
  const key = (mid, mn) => `${mid}|${mn}`;
  const fcMap = new Map();
  for (const f of fcs) fcMap.set(key(f.customer_material_id, f.month), f);

  const totals = {};
  FORECAST_MONTHS.forEach(
    mn => (totals[mn] = { customer: 0, internal: 0, capacity: 0, expected: 0 })
  );

  const materials = mats.map(m => {
    const rows = {};
    FORECAST_MONTHS.forEach(mn => {
      const f = fcMap.get(key(m.id, mn));
      const cf = Number(f?.customer_forecast) || 0;
      const inf = Number(f?.internal_forecast) || 0;
      const capRaw = f ? f.production_capacity : null;
      const cap = capRaw === null || capRaw === undefined ? null : Number(capRaw);
      const rev = Number(f?.expected_revenue) || 0;
      rows[mn] = {
        customer_forecast: cf,
        internal_forecast: inf,
        production_capacity: cap,
        gap: cap === null ? null : Math.round(cap - cf),
        expected_revenue: rev,
        win_probability: f?.win_probability ?? null,
      };
      totals[mn].customer += cf;
      totals[mn].internal += inf;
      totals[mn].capacity += cap || 0;
      totals[mn].expected += rev;
    });
    return {
      id: m.id,
      material_name: m.material_name,
      business_type: m.business_type,
      unit: m.demand_unit,
      rows,
    };
  });

  const [vers] = await pool.query(
    `SELECT v.id, v.label, v.version_type, v.note, v.created_at,
            (SELECT COUNT(*) FROM forecast_version_items i WHERE i.version_id=v.id) AS item_count
       FROM forecast_versions v WHERE v.customer_id=? ORDER BY v.created_at DESC, v.id DESC`,
    [customerId]
  );

  return {
    months: FORECAST_MONTHS,
    materials,
    totals,
    versions: vers.map(v => ({
      id: v.id,
      label: v.label,
      version_type: v.version_type,
      note: v.note,
      created_at: v.created_at,
      item_count: Number(v.item_count) || 0,
    })),
  };
}

// 현재 포캐스트 상세 + 버전 목록
router.get('/:id/forecast', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id FROM customers WHERE id=?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    res.json({ success: true, data: await buildForecastDetail(req.params.id) });
  } catch (err) {
    handleError(res, err);
  }
});

// 현재 포캐스트를 버전(스냅샷)으로 저장
router.post('/:id/forecast/versions', requireLevel(1), validateId, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const customerId = req.params.id;
    const label = (req.body?.label || '').trim();
    if (!label) return res.status(400).json({ success: false, error: 'label 필수' });
    const versionType = req.body?.version_type || 'baseline';
    const [mats] = await conn.query('SELECT id FROM customer_materials WHERE customer_id=?', [
      customerId,
    ]);
    const matIds = mats.map(m => m.id);
    let items = [];
    if (matIds.length) {
      [items] = await conn.query(
        'SELECT * FROM demand_forecasts WHERE customer_material_id IN (?)',
        [matIds]
      );
    }
    await conn.beginTransaction();
    const [v] = await conn.query(
      `INSERT INTO forecast_versions (customer_id, label, version_type, note, created_by) VALUES (?,?,?,?,?)`,
      [customerId, label, versionType, req.body?.note || null, getUserId(req)]
    );
    const vid = v.insertId;
    for (const it of items) {
      await conn.query(
        `INSERT INTO forecast_version_items
           (version_id, customer_material_id, month, customer_forecast, internal_forecast,
            production_capacity, win_probability, expected_revenue, unit)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          vid,
          it.customer_material_id,
          it.month,
          it.customer_forecast,
          it.internal_forecast,
          it.production_capacity,
          it.win_probability,
          it.expected_revenue,
          it.unit,
        ]
      );
    }
    await conn.commit();
    res.json({ success: true, data: { id: vid, item_count: items.length } });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      /* noop */
    }
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// 생산예측(productionForecasts) → demand_forecasts.production_capacity 동기화
//   소재명(material_name == production_forecasts.product_name) 1:1 매칭, 월별 CAPA 반영.
router.post('/:id/forecast/sync-capa', requireLevel(1), validateId, async (req, res) => {
  try {
    const customerId = req.params.id;
    const [mats] = await pool.query(
      `SELECT id, material_name, demand_unit FROM customer_materials WHERE customer_id=?`,
      [customerId]
    );
    const matByName = new Map(mats.map(m => [m.material_name, m]));
    const [pfs] = await pool.query(
      `SELECT product_name, period, forecast_qty, unit FROM production_forecasts
         WHERE customer_id=? AND status<>'취소' AND period IN (?)`,
      [customerId, FORECAST_MONTHS]
    );
    let updated = 0;
    for (const pf of pfs) {
      const mat = matByName.get(pf.product_name);
      if (!mat) continue;
      await pool.query(
        `INSERT INTO demand_forecasts
           (customer_material_id, customer_id, month, customer_forecast, internal_forecast,
            production_capacity, unit)
         VALUES (?,?,?,0,0,?,?)
         ON DUPLICATE KEY UPDATE production_capacity=VALUES(production_capacity)`,
        [mat.id, customerId, pf.period, pf.forecast_qty, pf.unit || mat.demand_unit || 'kg']
      );
      updated += 1;
    }
    res.json({ success: true, data: { updated, source: 'production_forecasts' } });
  } catch (err) {
    handleError(res, err);
  }
});

// 특정 버전의 월별 합계 (비교용)
router.get('/forecast/versions/:vid', async (req, res) => {
  try {
    const vid = parseInt(req.params.vid, 10);
    if (!vid || vid < 1)
      return res.status(400).json({ success: false, error: '유효하지 않은 버전 ID' });
    const [[v]] = await pool.query('SELECT * FROM forecast_versions WHERE id=?', [vid]);
    if (!v) return res.status(404).json({ success: false, error: '버전 없음' });
    const [items] = await pool.query('SELECT * FROM forecast_version_items WHERE version_id=?', [
      vid,
    ]);
    const totals = {};
    FORECAST_MONTHS.forEach(
      mn => (totals[mn] = { customer: 0, internal: 0, capacity: 0, expected: 0 })
    );
    for (const it of items) {
      if (!totals[it.month]) continue;
      totals[it.month].customer += Number(it.customer_forecast) || 0;
      totals[it.month].internal += Number(it.internal_forecast) || 0;
      totals[it.month].capacity += Number(it.production_capacity) || 0;
      totals[it.month].expected += Number(it.expected_revenue) || 0;
    }
    res.json({
      success: true,
      data: {
        version: {
          id: v.id,
          label: v.label,
          version_type: v.version_type,
          created_at: v.created_at,
        },
        months: FORECAST_MONTHS,
        totals,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 임원 360 요약 (전사 집계) ────────────────────────────────
// Account Health 산식 — "4대 건강 축"을 각 0~100점으로 환산 후 비중(%)으로 가중평균.
//   경영진 설명용: "거래 35% · 회수 25% · 품질 25% · 공급 15% 비중으로 종합한 점수".
//   각 축 세부 규칙(건당 점수 등)은 고급 설정으로 재정의 가능. system_settings 저장.
const HEALTH_CFG_KEY = 'health_config';
const DEFAULT_HEALTH_CONFIG = {
  version: 2,
  dimensions: {
    // 거래 성장: 거래를 키우는가 (수주·진행·계약) — 기본 40점에서 활동만큼 가점
    commercial: {
      label: '거래 성장',
      desc: '우리와 거래를 키우는가',
      base: 40,
      perWon: 15,
      perActive: 8,
      contractBonus: 20,
      weight: 35,
    },
    // 대금 회수: 제때 회수되는가 (연체 없으면 100, 건당 차감)
    collection: { label: '대금 회수', desc: '대금이 제때 회수되는가', perOverdue: 25, weight: 25 },
    // 품질·서비스: 문제 없이 공급되는가 (품질·지원 이슈 없으면 100)
    quality: {
      label: '품질·서비스',
      desc: '문제 없이 공급되는가',
      perQuality: 20,
      perSupport: 15,
      weight: 25,
    },
    // 공급 역량: 수요를 감당하는가 (CAPA 부족 시 점수 하락)
    supply: { label: '공급 역량', desc: '수요를 감당할 수 있는가', shortScore: 50, weight: 15 },
  },
  thresholds: { 'A+': 90, A: 80, 'B+': 70, B: 60, C: 45 }, // 미만은 D
};
const HEALTH_DIM_KEYS = ['commercial', 'collection', 'quality', 'supply'];
const HEALTH_GRADE_ORDER = ['A+', 'A', 'B+', 'B', 'C'];

// 저장값(부분) + 기본값 병합 — 누락 키 폴백 (구버전 저장값은 기본값으로 대체)
function mergeHealthConfig(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const sd = s.dimensions || {};
  const D = DEFAULT_HEALTH_CONFIG.dimensions;
  const md = k => ({ ...D[k], ...(sd[k] || {}) });
  return {
    version: 2,
    dimensions: {
      commercial: md('commercial'),
      collection: md('collection'),
      quality: md('quality'),
      supply: md('supply'),
    },
    thresholds: { ...DEFAULT_HEALTH_CONFIG.thresholds, ...(s.thresholds || {}) },
  };
}

let _healthCfg = null;
let _healthCfgAt = 0;
async function getHealthConfig(force) {
  if (!force && _healthCfg && Date.now() - _healthCfgAt < 30000) return _healthCfg;
  let saved = {};
  try {
    const [[row]] = await pool.query(
      'SELECT setting_value FROM system_settings WHERE setting_key=?',
      [HEALTH_CFG_KEY]
    );
    if (row && row.setting_value) saved = JSON.parse(row.setting_value);
  } catch (_) {
    /* 파싱/조회 실패 시 기본값 */
  }
  _healthCfg = mergeHealthConfig(saved);
  _healthCfgAt = Date.now();
  return _healthCfg;
}

// 입력 검증 — 비중 0~100(합 100), 세부 점수 0~100, 임계값 A+>A>B+>B>C 단조감소
function validateHealthConfig(input) {
  const cfg = mergeHealthConfig(input);
  const errs = [];
  const ok = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
  const D = cfg.dimensions;
  HEALTH_DIM_KEYS.forEach(k => {
    if (!ok(D[k].weight)) errs.push(`'${D[k].label}' 비중은 0~100 숫자여야 합니다`);
  });
  const wsum = HEALTH_DIM_KEYS.reduce((s, k) => s + (Number(D[k].weight) || 0), 0);
  if (!errs.length && Math.round(wsum) !== 100)
    errs.push(`4대 축 비중 합이 100%가 되어야 합니다 (현재 ${Math.round(wsum)}%)`);
  const subs = [
    ['거래 기준점', D.commercial.base],
    ['수주 점수', D.commercial.perWon],
    ['진행 점수', D.commercial.perActive],
    ['계약 보너스', D.commercial.contractBonus],
    ['연체 감점', D.collection.perOverdue],
    ['품질 감점', D.quality.perQuality],
    ['지원 감점', D.quality.perSupport],
    ['공급부족 점수', D.supply.shortScore],
  ];
  subs.forEach(([lab, v]) => {
    if (!ok(v)) errs.push(`'${lab}'은 0~100 숫자여야 합니다`);
  });
  const tv = HEALTH_GRADE_ORDER.map(g => cfg.thresholds[g]);
  if (tv.some(v => !ok(v))) {
    errs.push('등급 임계값은 0~100 숫자여야 합니다');
  } else {
    for (let i = 1; i < tv.length; i++) {
      if (tv[i] >= tv[i - 1]) {
        errs.push('등급 임계값은 A+ > A > B+ > B > C 순으로 낮아져야 합니다');
        break;
      }
    }
  }
  return { cfg, errs };
}

function healthGrade(score, thr) {
  const t = thr || DEFAULT_HEALTH_CONFIG.thresholds;
  return score >= t['A+']
    ? 'A+'
    : score >= t.A
      ? 'A'
      : score >= t['B+']
        ? 'B+'
        : score >= t.B
          ? 'B'
          : score >= t.C
            ? 'C'
            : 'D';
}

// 단일 Account Health 산식 (상세뷰·임원뷰 공용) — 4대 축 0~100 → 비중 가중평균
//   subs: 축별 0~100 점수 (경영진 "왜 이 등급?" 설명용 분해)
function computeHealth(sig, cfg) {
  const c = cfg || DEFAULT_HEALTH_CONFIG;
  const D = c.dimensions;
  const clamp = v => Math.max(0, Math.min(100, v));
  const won = Number(sig.won) || 0;
  const active = Number(sig.active) || 0;
  const overdue = Number(sig.overdue) || 0;
  const oq = Number(sig.openQuality) || 0;
  const os = Number(sig.openSupport) || 0;
  const hasContract = (Number(sig.contractAmt) || 0) > 0;
  const subs = {
    commercial: Math.round(
      clamp(
        D.commercial.base +
          won * D.commercial.perWon +
          active * D.commercial.perActive +
          (hasContract ? D.commercial.contractBonus : 0)
      )
    ),
    collection: Math.round(clamp(100 - overdue * D.collection.perOverdue)),
    quality: Math.round(clamp(100 - oq * D.quality.perQuality - os * D.quality.perSupport)),
    supply: sig.capaShort ? Math.round(clamp(D.supply.shortScore)) : 100,
  };
  const wsum = HEALTH_DIM_KEYS.reduce((s, k) => s + (Number(D[k].weight) || 0), 0) || 100;
  const score = Math.round(
    HEALTH_DIM_KEYS.reduce((s, k) => s + subs[k] * (Number(D[k].weight) || 0), 0) / wsum
  );
  return { score, grade: healthGrade(score, c.thresholds), subs };
}

// 임원뷰 Top 계정용 — 상세뷰와 '동일한' 신호를 수집해 동일 산식 적용
async function gatherHealthSignals(customerId, customerName) {
  const byCust = '(customer_id = ? OR (customer_id IS NULL AND customer_name = ?))';
  const p = [customerId, customerName];
  const [[leadAgg], [contractAgg], [payAgg], [supportAgg], lifecycle] = await Promise.all([
    pool
      .query(
        `SELECT SUM(CASE WHEN ps.role='won' THEN 1 ELSE 0 END) AS won,
                SUM(CASE WHEN COALESCE(ps.role,'') NOT IN ('won','lost','dropped') THEN 1 ELSE 0 END) AS active
           FROM leads l LEFT JOIN pipeline_stages ps ON ps.stage_key = l.stage
          WHERE l.customer_name = ?`,
        [customerName]
      )
      .then(r => r[0]),
    pool
      .query(`SELECT COALESCE(SUM(contract_amount),0) AS amt FROM contracts WHERE ${byCust}`, p)
      .then(r => r[0]),
    pool
      .query(
        `SELECT SUM(CASE WHEN due_date < CURDATE() AND recognized_at IS NULL THEN 1 ELSE 0 END) AS overdue_cnt
           FROM payment_schedules WHERE ${byCust}`,
        p
      )
      .then(r => r[0]),
    pool
      .query(
        `SELECT SUM(CASE WHEN resolved_at IS NULL AND closed_at IS NULL THEN 1 ELSE 0 END) AS open_cnt
           FROM support_tickets WHERE customer_id = ?`,
        [customerId]
      )
      .then(r => r[0]),
    buildLifecycle(customerId),
  ]);
  return {
    won: Number(leadAgg.won) || 0,
    active: Number(leadAgg.active) || 0,
    contractAmt: Number(contractAgg.amt) || 0,
    overdue: Number(payAgg.overdue_cnt) || 0,
    openSupport: Number(supportAgg.open_cnt) || 0,
    openQuality: lifecycle.quality.filter(q => q.status !== 'resolved').length,
    capaShort: lifecycle.demand_flow.gap > 0,
  };
}
async function buildExecSummaryData() {
  const [[wAgg], [dealAgg], stageRows, [qAgg], capaRows, acctRows, qTop, evalRows] =
    await Promise.all([
      // 전사 가중 예상매출 (진행 딜)
      pool
        .query(
          `SELECT COALESCE(SUM(l.expected_amount * COALESCE(l.win_probability, ps.win_probability, 0)/100),0) AS weighted
             FROM leads l LEFT JOIN pipeline_stages ps ON ps.stage_key=l.stage
            WHERE l.stage NOT IN ('won','lost','dropped')`
        )
        .then(r => r[0]),
      // 진행 딜 수 + 수주/실주 (수주율)
      pool
        .query(
          `SELECT
             SUM(CASE WHEN stage NOT IN ('won','lost','dropped') THEN 1 ELSE 0 END) AS active,
             SUM(CASE WHEN stage='won' THEN 1 ELSE 0 END) AS won,
             SUM(CASE WHEN stage='lost' THEN 1 ELSE 0 END) AS lost
             FROM leads`
        )
        .then(r => r[0]),
      // 소재 라이프사이클 단계 분포
      pool
        .query(
          `SELECT lifecycle_stage AS s, COUNT(*) AS n FROM customer_materials WHERE status<>'closed' GROUP BY lifecycle_stage`
        )
        .then(r => r[0]),
      // 품질 오픈
      pool
        .query(`SELECT COUNT(*) AS n FROM quality_cases WHERE status<>'resolved'`)
        .then(r => r[0]),
      // 고객별 분기 수요 vs 생산가능 (CAPA 부족 판정)
      pool
        .query(
          `SELECT customer_id,
                  COALESCE(SUM(customer_forecast),0) AS demand,
                  COALESCE(SUM(production_capacity),0) AS capacity
             FROM demand_forecasts
            WHERE month IN (?)
            GROUP BY customer_id`,
          [FORECAST_MONTHS]
        )
        .then(r => r[0]),
      // Top 계정 (가중 예상매출) — 회사명 단위 집계 후 대표 고객 id 매핑(동일사명 중복행 배수집계 방지)
      pool
        .query(
          `SELECT rep.id, agg.customer_name AS name, agg.weighted, agg.active, agg.won
               FROM (
                 SELECT l.customer_name,
                        COALESCE(SUM(CASE WHEN l.stage NOT IN ('won','lost','dropped')
                             THEN l.expected_amount * COALESCE(l.win_probability, ps.win_probability, 0)/100 ELSE 0 END),0) AS weighted,
                        SUM(CASE WHEN l.stage NOT IN ('won','lost','dropped') THEN 1 ELSE 0 END) AS active,
                        SUM(CASE WHEN l.stage='won' THEN 1 ELSE 0 END) AS won
                   FROM leads l LEFT JOIN pipeline_stages ps ON ps.stage_key = l.stage
                  GROUP BY l.customer_name
               ) agg
               JOIN (SELECT name, MIN(id) AS id FROM customers GROUP BY name) rep ON rep.name = agg.customer_name
              WHERE agg.weighted > 0 OR agg.active > 0
              ORDER BY agg.weighted DESC
              LIMIT 8`
        )
        .then(r => r[0]),
      // 품질 오픈 Top
      pool
        .query(
          `SELECT q.customer_id, c.name AS customer_name, q.title, q.severity, q.type
             FROM quality_cases q JOIN customers c ON c.id=q.customer_id
            WHERE q.status<>'resolved'
            ORDER BY FIELD(q.severity,'high','medium','low'), q.opened_at DESC LIMIT 6`
        )
        .then(r => r[0]),
      // 평가 지연(평가/샘플 단계 소재)
      pool
        .query(
          `SELECT c.name AS customer_name, m.material_name
             FROM customer_materials m JOIN customers c ON c.id=m.customer_id
            WHERE m.lifecycle_stage IN ('evaluation','sample') AND m.status<>'closed'
            ORDER BY m.updated_at ASC LIMIT 6`
        )
        .then(r => r[0]),
    ]);

  // CAPA 부족 고객 set
  const capaShortIds = new Set();
  const capaShortList = [];
  for (const r of capaRows) {
    const demand = Number(r.demand) || 0;
    const capacity = Number(r.capacity) || 0;
    if (capacity > 0 && capacity < demand) {
      capaShortIds.add(r.customer_id);
      capaShortList.push({ customer_id: r.customer_id, gap: Math.round(demand - capacity) });
    }
  }
  // capaShort 고객명 매핑
  const capIds = capaShortList.map(x => x.customer_id).filter(Boolean);
  let capNames = [];
  if (capIds.length) {
    [capNames] = await pool.query('SELECT id, name FROM customers WHERE id IN (?)', [capIds]);
  }
  const nameById = new Map(capNames.map(c => [c.id, c.name]));

  const won = Number(dealAgg.won) || 0;
  const lost = Number(dealAgg.lost) || 0;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  // Top 계정 Health — 상세뷰와 동일한 신호·산식으로 계산해 등급 일치 보장
  const healthCfg = await getHealthConfig();
  const topAccounts = await Promise.all(
    acctRows.map(async a => {
      const sig = await gatherHealthSignals(a.id, a.name);
      const { grade } = computeHealth(sig, healthCfg);
      const risks = [];
      if (sig.capaShort) risks.push({ level: 'medium', label: 'CAPA 부족' });
      if (sig.openQuality > 0) risks.push({ level: 'high', label: `품질 ${sig.openQuality}` });
      return {
        id: a.id,
        name: a.name,
        weighted: Math.round(Number(a.weighted) || 0),
        active: Number(a.active) || 0,
        won: Number(a.won) || 0,
        health_grade: grade,
        risks,
      };
    })
  );
  // 평균 Health (Top 계정 기준 근사)
  const avgScore = topAccounts.length
    ? Math.round(
        topAccounts.reduce((s, a) => {
          const g = a.health_grade;
          return (
            s +
            (g === 'A+'
              ? 95
              : g === 'A'
                ? 85
                : g === 'B+'
                  ? 75
                  : g === 'B'
                    ? 65
                    : g === 'C'
                      ? 50
                      : 35)
          );
        }, 0) / topAccounts.length
      )
    : 0;

  return {
    kpis: {
      weighted_expected: Math.round(Number(wAgg.weighted) || 0),
      active_deals: Number(dealAgg.active) || 0,
      win_rate: winRate, // 마감 승률 = won/(won+lost)
      won_deals: won,
      lost_deals: lost,
      avg_health: healthGrade(avgScore, healthCfg.thresholds),
      open_quality: Number(qAgg.n) || 0,
      capa_short_accounts: capaShortIds.size,
    },
    stage_distribution: STAGE_ORDER.map(k => ({
      stage: k,
      label: STAGE_LABELS[k],
      count: Number((stageRows.find(s => s.s === k) || {}).n) || 0,
    })),
    top_accounts: topAccounts,
    risks: {
      capa_short: capaShortList.map(x => ({
        name: nameById.get(x.customer_id) || '-',
        gap: x.gap,
      })),
      quality: qTop.map(q => ({
        name: q.customer_name,
        title: q.title,
        severity: q.severity,
        type: q.type,
      })),
      eval_delay: evalRows.map(e => ({ name: e.customer_name, material: e.material_name })),
    },
  };
}

async function execSummary(req, res) {
  try {
    const data = await buildExecSummaryData();
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
}

// ── 임원 AI 브리핑 (전사 요약) — system_settings 에 최신 1건 캐시 ──
const EXEC_BRIEF_KEY = 'exec_brief_latest';

async function execBriefGet(req, res) {
  try {
    const [[row]] = await pool.query(
      'SELECT setting_value FROM system_settings WHERE setting_key=?',
      [EXEC_BRIEF_KEY]
    );
    let brief = null;
    if (row && row.setting_value) {
      try {
        brief = JSON.parse(row.setting_value);
      } catch (_) {
        brief = null;
      }
    }
    res.json({ success: true, data: brief });
  } catch (err) {
    handleError(res, err);
  }
}

async function execBriefPost(req, res) {
  try {
    const d = await buildExecSummaryData();
    const won = n => '₩' + (Math.round(Number(n) || 0) / 1_0000_0000).toFixed(1) + '억';
    const top = (d.top_accounts || [])
      .slice(0, 6)
      .map(
        a =>
          `${a.name}(Health ${a.health_grade}, 가중 ${won(a.weighted)}, 진행 ${a.active}, 리스크 ${(a.risks || []).map(r => r.label).join('/') || '없음'})`
      )
      .join('\n');
    const stages = (d.stage_distribution || []).map(s => `${s.label} ${s.count}`).join(' · ');
    const capa = (d.risks?.capa_short || [])
      .slice(0, 6)
      .map(x => `${x.name} 부족 ${Math.round(x.gap).toLocaleString('ko-KR')}`)
      .join(', ');
    const qual = (d.risks?.quality || [])
      .slice(0, 6)
      .map(q => `${q.name}·${q.title}(${q.severity})`)
      .join(', ');

    const prompt = `당신은 SK에코플랜트 머티리얼즈(반도체·디스플레이 소재) 영업 임원 보좌역입니다.
아래 '전사 집계 수치'만 근거로 임원용 요약 브리핑을 작성하세요. 수치를 지어내지 말고 주어진 값만 사용합니다.

[전사 KPI]
- 가중 예상매출: ${won(d.kpis.weighted_expected)} / 진행 딜: ${d.kpis.active_deals}건 / 마감 승률: ${d.kpis.win_rate ?? '-'}%${d.kpis.lost_deals === 0 ? ' (마감 실주 0)' : ''}
- 평균 Health: ${d.kpis.avg_health} / 품질 오픈: ${d.kpis.open_quality}건 / CAPA 부족 계정: ${d.kpis.capa_short_accounts}곳
[공정 라이프사이클 분포] ${stages}
[Top 계정]
${top || '없음'}
[리스크 — CAPA 부족] ${capa || '없음'}
[리스크 — 품질 오픈] ${qual || '없음'}

다음 JSON 형식으로만 응답하세요 (마크다운/설명 없이 JSON만):
{
  "headline": "전사 한 줄 요약 (50자 이내)",
  "key_points": ["핵심 포인트 3~5개 (각 40자 이내)"],
  "top_risks": ["가장 시급한 리스크 2~3개 (계정/사유 포함)"],
  "recommended_actions": ["임원 관점 권고 액션 2~3개 (구체적으로)"]
}`;

    const model = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 900,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const r = await model.generateContent(prompt);
    const txt = r.response.text();
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch {
      return res
        .status(502)
        .json({ success: false, error: 'AI 응답 파싱 실패', raw: String(txt).slice(0, 300) });
    }
    const brief = {
      headline: parsed.headline || '',
      key_points: Array.isArray(parsed.key_points) ? parsed.key_points : [],
      top_risks: Array.isArray(parsed.top_risks) ? parsed.top_risks : [],
      recommended_actions: Array.isArray(parsed.recommended_actions)
        ? parsed.recommended_actions
        : [],
      generated_at: new Date().toISOString(),
      generated_by: getUserId(req) || null,
    };
    // 캐시 저장 — best-effort (컬럼 길이 등으로 실패해도 생성 결과는 반환)
    try {
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
        [EXEC_BRIEF_KEY, JSON.stringify(brief)]
      );
    } catch (e) {
      console.warn('[exec-brief] 캐시 저장 실패(무시):', e.message);
    }
    res.json({ success: true, data: brief });
  } catch (err) {
    handleError(res, err);
  }
}

// ── 공정 단계 클릭 → 해당 단계 소재 + AI 진단 (모달) ──────────
async function execStageAnalyze(req, res) {
  try {
    const stage = String(req.params.stage || '');
    if (!STAGE_ORDER.includes(stage)) {
      return res.status(400).json({ success: false, error: '알 수 없는 단계' });
    }
    const [rows] = await pool.query(
      `SELECT m.id, m.material_name, m.business_type, m.win_probability, c.name AS customer_name,
              COALESCE(df.demand,0) AS demand, COALESCE(df.capacity,0) AS capacity,
              COALESCE(df.exp_order,0) AS expected_order, COALESCE(q.openq,0) AS open_quality
         FROM customer_materials m
         JOIN customers c ON c.id = m.customer_id
         LEFT JOIN (SELECT customer_material_id,
                      SUM(customer_forecast) demand, SUM(production_capacity) capacity,
                      SUM(expected_revenue * COALESCE(win_probability,0)/100) exp_order
                    FROM demand_forecasts WHERE month IN (?) GROUP BY customer_material_id) df
                ON df.customer_material_id = m.id
         LEFT JOIN (SELECT customer_material_id, COUNT(*) openq FROM quality_cases
                     WHERE status <> 'resolved' GROUP BY customer_material_id) q
                ON q.customer_material_id = m.id
        WHERE m.lifecycle_stage = ? AND m.status <> 'closed'
        ORDER BY expected_order DESC, m.id`,
      [FLOW_MONTHS, stage]
    );
    const materials = rows.map(r => ({
      customer_name: r.customer_name,
      material_name: r.material_name,
      business_type: r.business_type,
      win_probability: r.win_probability,
      capa_short: Number(r.capacity) > 0 && Number(r.capacity) < Number(r.demand),
      open_quality: Number(r.open_quality) || 0,
      expected_order: Math.round(Number(r.expected_order) || 0),
    }));
    const stats = {
      count: materials.length,
      capa_short: materials.filter(m => m.capa_short).length,
      open_quality: materials.reduce((s, m) => s + m.open_quality, 0),
      expected_order: materials.reduce((s, m) => s + m.expected_order, 0),
    };

    let ai = null;
    try {
      const won = n => '₩' + (Math.round(Number(n) || 0) / 1_0000_0000).toFixed(1) + '억';
      const listTxt = materials
        .slice(0, 12)
        .map(
          m =>
            `${m.customer_name}·${m.material_name.split(' · ')[0]}(${m.business_type}, 예상수주 ${won(m.expected_order)}${m.capa_short ? ', CAPA부족' : ''}${m.open_quality ? `, 품질${m.open_quality}` : ''})`
        )
        .join('\n');
      const prompt = `당신은 SK에코플랜트 머티리얼즈(반도체·디스플레이 소재) 영업 임원 보좌역입니다.
'${STAGE_LABELS[stage]}' 공정 단계의 소재 현황을 임원에게 진단·코칭하세요. 주어진 수치만 사용(추측 금지).

[단계] ${STAGE_LABELS[stage]} · 소재 ${stats.count}개 · CAPA 부족 ${stats.capa_short} · 품질 오픈 ${stats.open_quality} · 분기 예상수주 합 ${won(stats.expected_order)}
[소재]
${listTxt || '없음'}

다음 JSON 형식으로만 응답 (마크다운 없이 JSON):
{ "diagnosis": "이 단계 현황 진단 2~3문장", "actions": ["권고 액션 2~3개 (구체적으로)"] }`;
      const model = genAI.getGenerativeModel({
        model: MODEL_FAST,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: 600,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const r = await model.generateContent(prompt);
      const parsed = JSON.parse(r.response.text());
      ai = {
        diagnosis: parsed.diagnosis || '',
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      };
    } catch (e) {
      console.warn('[exec-stage] AI 진단 실패(무시):', e.message);
    }

    res.json({ success: true, data: { stage, label: STAGE_LABELS[stage], stats, materials, ai } });
  } catch (err) {
    handleError(res, err);
  }
}

// ── 임원 KPI 근거 — 전체 목록 (카드 클릭 시 lazy-load) ──────────
async function execKpiList(req, res) {
  try {
    const kpi = String(req.params.kpi || '');
    let items = [];
    let execKpiHealthDims = null;

    if (kpi === 'weighted') {
      // 계정별 가중 예상매출 (전체)
      const [rows] = await pool.query(
        `SELECT agg.customer_name AS name, agg.weighted, agg.active
           FROM ( SELECT l.customer_name,
                    COALESCE(SUM(CASE WHEN l.stage NOT IN ('won','lost','dropped')
                      THEN l.expected_amount * COALESCE(l.win_probability, ps.win_probability,0)/100 ELSE 0 END),0) AS weighted,
                    SUM(CASE WHEN l.stage NOT IN ('won','lost','dropped') THEN 1 ELSE 0 END) AS active
                  FROM leads l LEFT JOIN pipeline_stages ps ON ps.stage_key=l.stage
                  GROUP BY l.customer_name ) agg
          WHERE agg.weighted > 0
          ORDER BY agg.weighted DESC`
      );
      items = rows.map(r => ({
        name: r.name,
        weighted: Math.round(Number(r.weighted) || 0),
        active: Number(r.active) || 0,
      }));
    } else if (kpi === 'deals') {
      // 진행 딜 전체 명세
      const [rows] = await pool.query(
        `SELECT l.customer_name, l.project_name, l.stage, ps.label AS stage_label,
                COALESCE(l.expected_amount,0) AS expected_amount,
                COALESCE(l.expected_amount * COALESCE(l.win_probability, ps.win_probability,0)/100,0) AS weighted
           FROM leads l LEFT JOIN pipeline_stages ps ON ps.stage_key=l.stage
          WHERE l.stage NOT IN ('won','lost','dropped')
          ORDER BY weighted DESC, l.id DESC`
      );
      items = rows.map(r => ({
        customer_name: r.customer_name,
        project_name: r.project_name,
        stage_label: r.stage_label || r.stage,
        expected_amount: Math.round(Number(r.expected_amount) || 0),
        weighted: Math.round(Number(r.weighted) || 0),
      }));
    } else if (kpi === 'winrate') {
      // 마감(수주·실주) 딜 전체
      const [rows] = await pool.query(
        `SELECT l.customer_name, l.project_name, l.stage, COALESCE(l.expected_amount,0) AS expected_amount
           FROM leads l
          WHERE l.stage IN ('won','lost')
          ORDER BY FIELD(l.stage,'won','lost'), l.expected_amount DESC`
      );
      items = rows.map(r => ({
        customer_name: r.customer_name,
        project_name: r.project_name,
        result: r.stage,
        expected_amount: Math.round(Number(r.expected_amount) || 0),
      }));
    } else if (kpi === 'health') {
      // 파이프라인 보유 계정 전체의 Health (상세뷰와 동일 산식)
      const [rows] = await pool.query(
        `SELECT rep.id, agg.customer_name AS name, agg.weighted, agg.active, agg.won
           FROM ( SELECT l.customer_name,
                    COALESCE(SUM(CASE WHEN l.stage NOT IN ('won','lost','dropped')
                      THEN l.expected_amount * COALESCE(l.win_probability, ps.win_probability,0)/100 ELSE 0 END),0) AS weighted,
                    SUM(CASE WHEN l.stage NOT IN ('won','lost','dropped') THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN l.stage='won' THEN 1 ELSE 0 END) AS won
                  FROM leads l LEFT JOIN pipeline_stages ps ON ps.stage_key=l.stage
                  GROUP BY l.customer_name ) agg
           JOIN (SELECT name, MIN(id) AS id FROM customers GROUP BY name) rep ON rep.name=agg.customer_name
          WHERE agg.weighted > 0 OR agg.active > 0 OR agg.won > 0
          ORDER BY agg.weighted DESC
          LIMIT 80`
      );
      const healthCfg = await getHealthConfig();
      items = await Promise.all(
        rows.map(async a => {
          const sig = await gatherHealthSignals(a.id, a.name);
          const { grade, score, subs } = computeHealth(sig, healthCfg);
          return {
            name: a.name,
            grade,
            score,
            subs, // 축별 점수 (거래/회수/품질/공급)
            weighted: Math.round(Number(a.weighted) || 0),
            active: Number(a.active) || 0,
            won: Number(a.won) || 0,
          };
        })
      );
      items.sort((x, y) => y.score - x.score);
      // 축 메타(라벨·비중) 동봉 — 프론트 헤더/툴팁용
      execKpiHealthDims = HEALTH_DIM_KEYS.map(k => ({
        key: k,
        label: healthCfg.dimensions[k].label,
        weight: healthCfg.dimensions[k].weight,
      }));
    } else if (kpi === 'quality') {
      // 미해결 품질 케이스 전체
      const [rows] = await pool.query(
        `SELECT c.name AS customer_name, q.title, q.severity, q.type, q.opened_at
           FROM quality_cases q JOIN customers c ON c.id=q.customer_id
          WHERE q.status<>'resolved'
          ORDER BY FIELD(q.severity,'high','medium','low'), q.opened_at DESC`
      );
      items = rows.map(r => ({
        name: r.customer_name,
        title: r.title,
        severity: r.severity,
        type: r.type,
        opened_at: r.opened_at,
      }));
    } else if (kpi === 'capa') {
      // CAPA 부족 계정 전체
      const [rows] = await pool.query(
        `SELECT df.customer_id, c.name,
                COALESCE(SUM(df.customer_forecast),0) AS demand,
                COALESCE(SUM(df.production_capacity),0) AS capacity
           FROM demand_forecasts df JOIN customers c ON c.id=df.customer_id
          WHERE df.month IN (?)
          GROUP BY df.customer_id, c.name
         HAVING SUM(df.production_capacity) > 0
            AND SUM(df.production_capacity) < SUM(df.customer_forecast)
          ORDER BY (SUM(df.customer_forecast) - SUM(df.production_capacity)) DESC`,
        [FORECAST_MONTHS]
      );
      items = rows.map(r => ({
        name: r.name,
        demand: Math.round(Number(r.demand) || 0),
        capacity: Math.round(Number(r.capacity) || 0),
        gap: Math.round((Number(r.demand) || 0) - (Number(r.capacity) || 0)),
      }));
    } else {
      return res.status(400).json({ success: false, error: '알 수 없는 KPI' });
    }

    res.json({ success: true, data: { kpi, total: items.length, items, dims: execKpiHealthDims } });
  } catch (err) {
    handleError(res, err);
  }
}

// ── Account Health 기준 설정 — 조회/저장 ─────────────────────
async function healthConfigGet(req, res) {
  try {
    const config = await getHealthConfig(true);
    res.json({ success: true, data: { config, defaults: DEFAULT_HEALTH_CONFIG } });
  } catch (err) {
    handleError(res, err);
  }
}

async function healthConfigSave(req, res) {
  try {
    const { cfg, errs } = validateHealthConfig(req.body || {});
    if (errs.length) return res.status(400).json({ success: false, error: errs.join(' / ') });
    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
      [HEALTH_CFG_KEY, JSON.stringify(cfg)]
    );
    _healthCfg = cfg; // 캐시 즉시 반영
    _healthCfgAt = Date.now();
    res.json({ success: true, data: { config: cfg } });
  } catch (err) {
    handleError(res, err);
  }
}

// ── Phase 3: 샘플/평가 ───────────────────────────────────────
const SAMPLE_STATUS = ['requested', 'sent', 'evaluating', 'passed', 'conditional', 'failed'];

router.get('/:id/samples', validateId, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, m.material_name FROM sample_requests s
         LEFT JOIN customer_materials m ON m.id = s.customer_material_id
        WHERE s.customer_id=? ORDER BY s.requested_at DESC, s.id DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/samples', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.purpose && !b.customer_material_id)
      return res.status(400).json({ success: false, error: 'purpose 또는 소재 필수' });
    const sampleNo = b.sample_no || `SMP-${Date.now().toString().slice(-9)}`;
    const status = SAMPLE_STATUS.includes(b.status) ? b.status : 'requested';
    const [r] = await pool.query(
      `INSERT INTO sample_requests
         (sample_no, customer_id, customer_material_id, requested_at, purpose, lot_no,
          sent_at, qty, unit, status, result, eval_criteria, eval_equipment, fail_reason, resample, owner_id, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        sampleNo,
        req.params.id,
        b.customer_material_id || null,
        b.requested_at || null,
        b.purpose || null,
        b.lot_no || null,
        b.sent_at || null,
        b.qty ?? null,
        b.unit || 'kg',
        status,
        b.result || null,
        b.eval_criteria || null,
        b.eval_equipment || null,
        b.fail_reason || null,
        b.resample ? 1 : 0,
        getUserId(req),
        b.note || null,
      ]
    );
    res.json({ success: true, data: { id: r.insertId, sample_no: sampleNo } });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/samples/:id', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    const allow = [
      'customer_material_id',
      'requested_at',
      'purpose',
      'lot_no',
      'sent_at',
      'qty',
      'unit',
      'status',
      'result',
      'eval_criteria',
      'eval_equipment',
      'fail_reason',
      'resample',
      'note',
    ];
    const fields = [];
    const vals = [];
    for (const k of allow) {
      if (b[k] === undefined) continue;
      if (k === 'status' && !SAMPLE_STATUS.includes(b[k])) continue;
      fields.push(`${k}=?`);
      vals.push(b[k] === '' ? null : b[k]);
    }
    if (!fields.length) return res.status(400).json({ success: false, error: '수정할 필드 없음' });
    vals.push(req.params.id);
    const [r] = await pool.query(
      `UPDATE sample_requests SET ${fields.join(', ')} WHERE id=?`,
      vals
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, error: '샘플 없음' });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Phase 3: 품질 케이스 관리 ────────────────────────────────
const QUALITY_TYPES = ['VOC', 'NCR', 'Audit', 'PCN', 'CoA'];
const QUALITY_STATUS = ['open', 'in_progress', 'resolved'];

router.get('/:id/quality', validateId, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT q.*, m.material_name, t.name AS owner_name FROM quality_cases q
         LEFT JOIN customer_materials m ON m.id = q.customer_material_id
         LEFT JOIN team_members t ON t.id = q.owner_id
        WHERE q.customer_id=? ORDER BY FIELD(q.status,'open','in_progress','resolved'), q.opened_at DESC, q.id DESC`,
      [req.params.id]
    );
    // 권한별 상세 제한: team_lead(2) 미만은 상세 원인/분석(notes) 마스킹
    const restricted = userLevel(req) < 2;
    const data = rows.map(r => (restricted ? { ...r, notes: null } : r));
    res.json({ success: true, data, detail_restricted: restricted });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/quality', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ success: false, error: 'title 필수' });
    const caseNo = b.case_no || `Q-${Date.now().toString().slice(-9)}`;
    const type = QUALITY_TYPES.includes(b.type) ? b.type : 'VOC';
    const status = QUALITY_STATUS.includes(b.status) ? b.status : 'open';
    const [r] = await pool.query(
      `INSERT INTO quality_cases
         (case_no, customer_id, customer_material_id, type, severity, status, title, opened_at, owner_id, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        caseNo,
        req.params.id,
        b.customer_material_id || null,
        type,
        b.severity || 'medium',
        status,
        b.title,
        b.opened_at || null,
        getUserId(req),
        b.notes || null,
      ]
    );
    res.json({ success: true, data: { id: r.insertId, case_no: caseNo } });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/quality/:id', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    const allow = [
      'customer_material_id',
      'type',
      'severity',
      'status',
      'title',
      'opened_at',
      'resolved_at',
      'notes',
    ];
    const fields = [];
    const vals = [];
    for (const k of allow) {
      if (b[k] === undefined) continue;
      if (k === 'type' && !QUALITY_TYPES.includes(b[k])) continue;
      if (k === 'status' && !QUALITY_STATUS.includes(b[k])) continue;
      fields.push(`${k}=?`);
      vals.push(b[k] === '' ? null : b[k]);
    }
    if (!fields.length) return res.status(400).json({ success: false, error: '수정할 필드 없음' });
    vals.push(req.params.id);
    const [r] = await pool.query(`UPDATE quality_cases SET ${fields.join(', ')} WHERE id=?`, vals);
    if (!r.affectedRows) return res.status(404).json({ success: false, error: '품질 케이스 없음' });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Phase 3: 사업장 / 담당자 CRUD ────────────────────────────
router.post('/:id/sites', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.site_name) return res.status(400).json({ success: false, error: 'site_name 필수' });
    const [r] = await pool.query(
      `INSERT INTO customer_sites (customer_id, site_name, line, process, region, note) VALUES (?,?,?,?,?,?)`,
      [
        req.params.id,
        b.site_name,
        b.line || null,
        b.process || null,
        b.region || null,
        b.note || null,
      ]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/sites/:id', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    const allow = ['site_name', 'line', 'process', 'region', 'note'];
    const fields = [];
    const vals = [];
    for (const k of allow) {
      if (b[k] === undefined) continue;
      fields.push(`${k}=?`);
      vals.push(b[k] === '' ? null : b[k]);
    }
    if (!fields.length) return res.status(400).json({ success: false, error: '수정할 필드 없음' });
    vals.push(req.params.id);
    const [r] = await pool.query(`UPDATE customer_sites SET ${fields.join(', ')} WHERE id=?`, vals);
    if (!r.affectedRows) return res.status(404).json({ success: false, error: '사업장 없음' });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/sites/:id', requireLevel(1), validateId, async (req, res) => {
  try {
    await pool.query('DELETE FROM customer_sites WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/contacts', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ success: false, error: 'name 필수' });
    const [r] = await pool.query(
      `INSERT INTO customer_contacts (customer_id, name, role, dept, email, phone, is_primary, note)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        req.params.id,
        b.name,
        b.role || 'etc',
        b.dept || null,
        b.email || null,
        b.phone || null,
        b.is_primary ? 1 : 0,
        b.note || null,
      ]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/contacts/:id', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    const allow = ['name', 'role', 'dept', 'email', 'phone', 'is_primary', 'note'];
    const fields = [];
    const vals = [];
    for (const k of allow) {
      if (b[k] === undefined) continue;
      fields.push(`${k}=?`);
      vals.push(k === 'is_primary' ? (b[k] ? 1 : 0) : b[k] === '' ? null : b[k]);
    }
    if (!fields.length) return res.status(400).json({ success: false, error: '수정할 필드 없음' });
    vals.push(req.params.id);
    const [r] = await pool.query(
      `UPDATE customer_contacts SET ${fields.join(', ')} WHERE id=?`,
      vals
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, error: '담당자 없음' });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/contacts/:id', requireLevel(1), validateId, async (req, res) => {
  try {
    await pool.query('DELETE FROM customer_contacts WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 품질 문서이력 (CoA/MSDS/CoC) ─────────────────────────────
const DOC_TYPES = ['CoA', 'MSDS', 'CoC', '기타'];

router.get('/:id/documents', validateId, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.*, m.material_name FROM quality_documents d
         LEFT JOIN customer_materials m ON m.id = d.customer_material_id
        WHERE d.customer_id=? ORDER BY d.issued_at DESC, d.id DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/documents', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    const docType = DOC_TYPES.includes(b.doc_type) ? b.doc_type : 'CoA';
    const [r] = await pool.query(
      `INSERT INTO quality_documents
         (customer_id, customer_material_id, doc_type, doc_no, issued_at, valid_until, file_url, note, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        req.params.id,
        b.customer_material_id || null,
        docType,
        b.doc_no || null,
        b.issued_at || null,
        b.valid_until || null,
        b.file_url || null,
        b.note || null,
        getUserId(req),
      ]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/documents/:id', requireLevel(1), validateId, async (req, res) => {
  try {
    const b = req.body || {};
    const allow = [
      'customer_material_id',
      'doc_type',
      'doc_no',
      'issued_at',
      'valid_until',
      'file_url',
      'note',
    ];
    const fields = [];
    const vals = [];
    for (const k of allow) {
      if (b[k] === undefined) continue;
      if (k === 'doc_type' && !DOC_TYPES.includes(b[k])) continue;
      fields.push(`${k}=?`);
      vals.push(b[k] === '' ? null : b[k]);
    }
    if (!fields.length) return res.status(400).json({ success: false, error: '수정할 필드 없음' });
    vals.push(req.params.id);
    const [r] = await pool.query(
      `UPDATE quality_documents SET ${fields.join(', ')} WHERE id=?`,
      vals
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, error: '문서 없음' });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/documents/:id', requireLevel(1), validateId, async (req, res) => {
  try {
    await pool.query('DELETE FROM quality_documents WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 계약/매출/수금 (Forecast → 수주 → 매출인식 → 수금 → Gap) ──
router.get('/:id/revenue', validateId, async (req, res) => {
  try {
    const id = req.params.id;
    const [[c]] = await pool.query('SELECT id, name FROM customers WHERE id=?', [id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    const name = c.name;
    const byCust = '(customer_id = ? OR (customer_id IS NULL AND customer_name = ?))';
    const p = [id, name];

    const [[fc], [ord], [sal], [col], [ovd], [arSched]] = await Promise.all([
      // Forecast: 진행 딜 가중 예상매출
      pool
        .query(
          `SELECT COALESCE(SUM(l.expected_amount * COALESCE(l.win_probability, ps.win_probability, 0)/100),0) AS amt
             FROM leads l LEFT JOIN pipeline_stages ps ON ps.stage_key=l.stage
            WHERE l.customer_name=? AND l.stage NOT IN ('won','lost','dropped')`,
          [name]
        )
        .then(r => r[0]),
      // 수주(Order): 유효 계약
      pool
        .query(
          `SELECT COALESCE(SUM(contract_amount),0) AS amt, COUNT(*) AS cnt
             FROM contracts WHERE ${byCust} AND status IN ('active','signed','approved','completed')`,
          p
        )
        .then(r => r[0]),
      // 매출 인식(Sales): 수금 스케줄 중 인식 완료분 공급가
      pool
        .query(
          `SELECT COALESCE(SUM(CASE WHEN recognized_at IS NOT NULL THEN supply_amount ELSE 0 END),0) AS amt
             FROM payment_schedules WHERE ${byCust}`,
          p
        )
        .then(r => r[0]),
      // 수금(Collection): 실제 입금
      pool
        .query(
          `SELECT COALESCE(SUM(paid_amount),0) AS amt FROM payment_records WHERE customer_id=?`,
          [id]
        )
        .then(r => r[0]),
      // 연체
      pool
        .query(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(scheduled_amount),0) AS amt
             FROM payment_schedules WHERE ${byCust} AND status='overdue'`,
          p
        )
        .then(r => r[0]),
      // 미수(청구·예정 합계 - 수금)
      pool
        .query(
          `SELECT COALESCE(SUM(scheduled_amount),0) AS amt
             FROM payment_schedules WHERE ${byCust} AND status IN ('invoiced','partial','overdue','scheduled')`,
          p
        )
        .then(r => r[0]),
    ]);

    const forecast = Math.round(Number(fc.amt) || 0);
    const order = Math.round(Number(ord.amt) || 0);
    const sales = Math.round(Number(sal.amt) || 0);
    const collected = Math.round(Number(col.amt) || 0);
    const ar = Math.max(0, Math.round((Number(arSched.amt) || 0) - collected));
    const gap = forecast - order;
    const conversion = forecast > 0 ? Math.round((order / forecast) * 100) : null;

    res.json({
      success: true,
      data: {
        funnel: [
          { key: 'forecast', label: 'Forecast (가중 예상매출)', amount: forecast },
          { key: 'order', label: '수주 (유효 계약)', amount: order, count: Number(ord.cnt) || 0 },
          { key: 'sales', label: '매출 인식', amount: sales },
          { key: 'collection', label: '수금', amount: collected },
        ],
        ar,
        overdue: { count: Number(ovd.cnt) || 0, amount: Math.round(Number(ovd.amt) || 0) },
        gap,
        conversion,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
