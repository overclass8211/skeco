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

module.exports = router;
