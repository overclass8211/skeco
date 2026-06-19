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
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.industry, c.region, c.country,
              (SELECT COUNT(*) FROM leads l
                 WHERE l.customer_name = c.name
                   AND l.stage NOT IN ('won','lost','dropped')) AS open_deals,
              (SELECT COALESCE(SUM(l.expected_amount),0) FROM leads l
                 WHERE l.customer_name = c.name
                   AND l.stage NOT IN ('lost','dropped')) AS pipeline_amount
         FROM customers c
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

    // ── 통합 타임라인 (type 만 부여, 아이콘은 프론트 SVG) ──
    const timeline = [
      ...recentActs.map(r => ({ type: 'activity', title: r.title || r.activity_type, date: r.dt })),
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

    // 간이 Account Health (0~100)
    let score = 60;
    score += Math.min(20, wonCount * 7); // 수주 실적
    score += Math.min(10, activeCount * 2); // 진행 파이프라인
    if (contractAmt > 0) score += 8; // 계약 보유
    score -= overdue * 8; // 연체 수금
    score -= openSupport * 5; // 미해결 지원
    score = Math.max(0, Math.min(100, score));
    const grade =
      score >= 90
        ? 'A+'
        : score >= 80
          ? 'A'
          : score >= 70
            ? 'B+'
            : score >= 60
              ? 'B'
              : score >= 45
                ? 'C'
                : 'D';

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
          weighted_expected: Math.round(Number(weightedAgg.weighted) || 0),
          won_count: wonCount,
          active_count: activeCount,
          contract_amount: contractAmt,
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

module.exports = router;
