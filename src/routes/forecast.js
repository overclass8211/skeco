'use strict';
// =============================================================
// /api/forecast — 매출 포캐스트 (파이프라인 기반 가중 예측, Phase A)
//
//   GET  /                  월별 추이 + 요약 + 상세 (필터 적용)
//   GET  /probabilities     단계별 기본 수주확률
//   PUT  /probabilities     단계별 확률 일괄 저장 (team_lead+)
//
// 산출 규칙 (단위: 백만원, 월 버킷 = expected_close_date):
//   - 예상 매출(best)   = 진행(active)+수주(won) 딜의 금액 합
//   - 확정 매출(commit) = 수주(won) 딜의 금액 합
//   - Weighted FCST     = 금액 × 실효확률(딜 override ▷ 단계 기본 ▷ 0)
//   - 전년 예상         = 전년도 동월 예상 매출
//   ※ 금액 정규화: expected_amount(억) × 100 = 백만원 (PoC — 단일통화 KRW 기준)
//     다중통화(amount_krw·fx) 정밀 환산은 후속(Phase B).
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { requireLevel } = require('../middleware/rbac');

const ACTIVE_ROLES = ['active'];
const WON_ROLE = 'won';

// 억 → 백만원
function toMil(eokAmount) {
  return Math.round((Number(eokAmount) || 0) * 100);
}

// ── 조회 ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const baseMonth = /^\d{4}-\d{2}$/.test(req.query.base_month || '')
      ? req.query.base_month
      : `${year}-01`;
    const compare = req.query.compare === 'none' ? 'none' : 'yoy';

    // ── 필터 ──
    const where = ['l.expected_close_date IS NOT NULL', 'YEAR(l.expected_close_date) IN (?, ?)'];
    const params = [year, year - 1];
    if (req.query.assignee) {
      where.push('l.assigned_to = ?');
      params.push(req.query.assignee);
    }
    if (req.query.business_type) {
      where.push('l.business_type = ?');
      params.push(req.query.business_type);
    }
    if (req.query.region) {
      where.push('l.region = ?');
      params.push(req.query.region);
    }
    if (req.query.dept) {
      where.push('tm.team = ?');
      params.push(req.query.dept);
    }
    if (req.query.q) {
      where.push('(l.project_name LIKE ? OR l.customer_name LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }

    const [rows] = await pool.query(
      `SELECT l.id, l.project_name, l.customer_name, l.business_type, l.region,
              l.expected_amount, l.currency, l.stage, l.expected_close_date, l.updated_at,
              ps.role AS stage_role, ps.label AS stage_label,
              COALESCE(l.win_probability, ps.win_probability, 0) AS prob,
              tm.name AS assignee_name, tm.team AS dept
         FROM leads l
         LEFT JOIN pipeline_stages ps ON l.stage = ps.stage_key
         LEFT JOIN team_members tm ON l.assigned_to = tm.id
        WHERE ${where.join(' AND ')}
        ORDER BY l.expected_close_date ASC`,
      params
    );

    // ── 월별 집계 ──
    const mk = () => ({ expected: 0, committed: 0, weighted: 0 });
    const cur = {}; // 'YYYY-MM' → {expected,committed,weighted}
    const prev = {}; // 전년 동월 expected
    for (let m = 1; m <= 12; m++) {
      cur[`${year}-${String(m).padStart(2, '0')}`] = mk();
      prev[`${year - 1}-${String(m).padStart(2, '0')}`] = mk();
    }

    const details = [];
    for (const r of rows) {
      const ym = `${r.expected_close_date.getFullYear?.() || new Date(r.expected_close_date).getFullYear()}-${String(
        (r.expected_close_date.getMonth?.() ?? new Date(r.expected_close_date).getMonth()) + 1
      ).padStart(2, '0')}`;
      const isActive = ACTIVE_ROLES.includes(r.stage_role);
      const isWon = r.stage_role === WON_ROLE;
      if (!isActive && !isWon) continue; // lost/dropped 제외

      const amt = toMil(r.expected_amount);
      const weighted = Math.round((amt * Number(r.prob)) / 100);
      const bucket = ym.startsWith(String(year)) ? cur[ym] : prev[ym];
      if (bucket) {
        bucket.expected += amt;
        bucket.weighted += weighted;
        if (isWon) bucket.committed += amt;
      }

      // 상세는 당해년도 active+won 딜만
      if (ym.startsWith(String(year))) {
        details.push({
          lead_id: r.id,
          project_name: r.project_name,
          customer: r.customer_name,
          business_type: r.business_type,
          region: r.region,
          assignee: r.assignee_name || '-',
          dept: r.dept || '-',
          expected_amount: amt,
          probability: Number(r.prob),
          weighted,
          expected_close_month: ym,
          last_activity_at: r.updated_at,
          status: r.stage_label || r.stage,
          stage_role: r.stage_role,
        });
      }
    }

    // ── 월별 시리즈 (백만원) ──
    const monthly = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const pym = `${year - 1}-${String(m).padStart(2, '0')}`;
      monthly.push({
        month: ym,
        expected: cur[ym].expected,
        committed: cur[ym].committed,
        weighted: cur[ym].weighted,
        prev_expected: compare === 'yoy' ? prev[pym].expected : 0,
      });
    }

    // ── 요약 (기준월 + 연간 합계) ──
    const baseRow = monthly.find(x => x.month === baseMonth) || mk();
    const yearExpected = monthly.reduce((s, x) => s + x.expected, 0);
    const yearWeighted = monthly.reduce((s, x) => s + x.weighted, 0);
    const yearCommitted = monthly.reduce((s, x) => s + x.committed, 0);
    const prevYearExpected = monthly.reduce((s, x) => s + (x.prev_expected || 0), 0);
    const yoyPct =
      prevYearExpected > 0
        ? Math.round(((yearExpected - prevYearExpected) / prevYearExpected) * 1000) / 10
        : null;

    res.json({
      success: true,
      data: {
        year,
        base_month: baseMonth,
        unit: '백만원',
        monthly,
        summary: {
          base_expected: baseRow.expected || 0,
          base_committed: baseRow.committed || 0,
          base_weighted: baseRow.weighted || 0,
          year_expected: yearExpected,
          year_committed: yearCommitted,
          year_weighted: yearWeighted,
          yoy_pct: yoyPct,
          deal_count: details.length,
        },
        details,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 단계 확률 조회 ─────────────────────────────────────────────
router.get('/probabilities', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT stage_key, label, role, sort_order, win_probability
         FROM pipeline_stages WHERE is_active = 1 ORDER BY sort_order ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 단계 확률 저장 (team_lead+ — requireLevel 2) ──────────────
router.put('/probabilities', requireLevel(2), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    for (const it of items) {
      if (!it.stage_key) continue;
      const p = Math.max(0, Math.min(100, parseInt(it.win_probability, 10) || 0));
      await pool.query('UPDATE pipeline_stages SET win_probability=? WHERE stage_key=?', [
        p,
        it.stage_key,
      ]);
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 월별 스냅샷 저장 (team_lead+) — 정밀 전년/추세 비교용 ────────
router.post('/snapshot', requireLevel(2), async (req, res) => {
  try {
    const year = parseInt(req.body?.year, 10) || new Date().getFullYear();
    const snapMonth = /^\d{4}-\d{2}$/.test(req.body?.snapshot_month || '')
      ? req.body.snapshot_month
      : null;
    if (!snapMonth) {
      return res.status(400).json({ success: false, error: 'snapshot_month(YYYY-MM) 필요' });
    }
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(l.expected_close_date,'%Y-%m') AS ym, ps.role AS role,
              COALESCE(SUM(l.expected_amount),0) AS eok,
              COALESCE(SUM(l.expected_amount * COALESCE(l.win_probability, ps.win_probability, 0) / 100),0) AS w_eok,
              COALESCE(SUM(CASE WHEN ps.role='won' THEN l.expected_amount ELSE 0 END),0) AS c_eok
         FROM leads l LEFT JOIN pipeline_stages ps ON l.stage = ps.stage_key
        WHERE l.expected_close_date IS NOT NULL AND YEAR(l.expected_close_date)=?
          AND ps.role IN ('active','won')
        GROUP BY ym, ps.role`,
      [year]
    );
    // ym 별 합산 (원 단위 = 억 × 1e8)
    const agg = {};
    for (const r of rows) {
      const a = (agg[r.ym] = agg[r.ym] || { e: 0, w: 0, c: 0 });
      a.e += Number(r.eok) * 1e8;
      a.w += Number(r.w_eok) * 1e8;
      a.c += Number(r.c_eok) * 1e8;
    }
    let n = 0;
    for (const [ym, a] of Object.entries(agg)) {
      await pool.query(
        `INSERT INTO forecast_snapshots (snapshot_month, target_month, expected_krw, weighted_krw, committed_krw)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE expected_krw=VALUES(expected_krw), weighted_krw=VALUES(weighted_krw), committed_krw=VALUES(committed_krw)`,
        [snapMonth, ym, Math.round(a.e), Math.round(a.w), Math.round(a.c)]
      );
      n++;
    }
    res.json({ success: true, data: { snapshot_month: snapMonth, months: n } });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
