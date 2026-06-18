const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');

// ── 공통 stats 핸들러 (GET / 와 GET /stats 공유) ────────────────
async function statsHandler(req, res) {
  try {
    const curYear = new Date().getFullYear();
    const year = parseInt(req.query.year) || curYear;
    const isCurrentYear = year === curYear;

    // 진행 중 파이프라인 (won/lost/dropped 제외) — 선택연도 created_at
    const [[totalLeads]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE stage NOT IN ('won','lost','dropped') AND YEAR(created_at) = ?`,
      [year]
    );

    // 이번달 or 선택연도 마지막달 신규
    const [[monthlyNew]] = isCurrentYear
      ? await pool.query(
          `SELECT COUNT(*) AS count FROM leads
           WHERE YEAR(created_at)=? AND MONTH(created_at)=MONTH(CURRENT_DATE())`,
          [year]
        )
      : await pool.query(
          `SELECT COUNT(*) AS count FROM leads
           WHERE YEAR(created_at)=? AND MONTH(created_at)=12`,
          [year]
        );

    // 수주 금액 — KRW 환산 (다국가 통화 통합)
    // amount_krw 컬럼 우선 사용, NULL인 경우 (백필 안 된 KRW 건)는 expected_amount fallback
    const [[wonAmount]] = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(amount_krw, IF(currency='KRW', expected_amount, 0))),0) AS amount
       FROM leads
       WHERE stage = 'won' AND YEAR(created_at) = ?`,
      [year]
    );

    // 입찰 진행 — 선택연도
    const [[bidding]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE stage='bidding' AND YEAR(created_at)=?`,
      [year]
    );

    // 국내/해외 (파이프라인)
    const [[domestic]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE region='국내' AND stage NOT IN ('won','lost','dropped') AND YEAR(created_at)=?`,
      [year]
    );
    const [[overseas]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE region='해외' AND stage NOT IN ('won','lost','dropped') AND YEAR(created_at)=?`,
      [year]
    );

    // 수주율 = 해당연도 생성 리드 중 수주 / 해당연도 전체 (created_at 기준 통일)
    const [[wonCount]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE stage='won' AND YEAR(created_at)=?`,
      [year]
    );
    const [[allCount]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE YEAR(created_at)=?`,
      [year]
    );

    // 전체 고객사 수 (연도 무관)
    const [[totalCustomers]] = await pool.query('SELECT COUNT(*) AS count FROM customers');

    res.json({
      success: true,
      data: {
        year,
        totalLeads: totalLeads.count,
        active_leads: totalLeads.count, // 별칭 (진행 중 파이프라인)
        monthlyNew: monthlyNew.count,
        wonAmount: parseFloat(wonAmount.amount),
        bidding: bidding.count,
        domestic: domestic.count,
        overseas: overseas.count,
        winRate: allCount.count > 0 ? ((wonCount.count / allCount.count) * 100).toFixed(1) : 0,
        total_customers: totalCustomers.count, // 전체 고객사 수
      },
    });
  } catch (err) {
    handleError(res, err);
  }
}

// 루트 경로 — GET /api/dashboard 직접 호출 시 stats 데이터 반환
router.get('/', statsHandler);

// /stats 경로 — 기존 클라이언트 호환 유지
router.get('/stats', statsHandler);

router.get('/funnel', async (req, res) => {
  try {
    const curYear = new Date().getFullYear();
    const year = parseInt(req.query.year) || curYear;
    const [rows] = await pool.query(
      `SELECT stage, COUNT(*) AS count, COALESCE(SUM(expected_amount),0) AS amount
       FROM leads WHERE YEAR(created_at) = ? GROUP BY stage`,
      [year]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/monthly', async (req, res) => {
  try {
    const curYear = new Date().getFullYear();
    const year = parseInt(req.query.year) || curYear;
    // period: annual | quarterly | monthly | recent6 (default)
    const period = req.query.period || 'recent6';

    let rows;
    if (period === 'annual') {
      // 연도별 집계 (전체 연도)
      [rows] = await pool.query(
        `SELECT YEAR(created_at) AS yr, business_type, COUNT(*) AS count
         FROM leads GROUP BY yr, business_type ORDER BY yr`
      );
    } else if (period === 'quarterly') {
      // 선택 연도의 분기별 집계
      [rows] = await pool.query(
        `SELECT CONCAT('Q', QUARTER(created_at)) AS qtr, business_type, COUNT(*) AS count
         FROM leads WHERE YEAR(created_at) = ?
         GROUP BY qtr, business_type ORDER BY qtr`,
        [year]
      );
    } else if (period === 'monthly') {
      // 선택 연도의 12개월 전체
      [rows] = await pool.query(
        `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, business_type, COUNT(*) AS count
         FROM leads WHERE YEAR(created_at) = ?
         GROUP BY month, business_type ORDER BY month`,
        [year]
      );
    } else {
      // recent6: 현재 기준 최근 6개월
      [rows] = await pool.query(
        `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, business_type, COUNT(*) AS count
         FROM leads WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
         GROUP BY month, business_type ORDER BY month`
      );
    }
    res.json({ success: true, data: rows, period, year });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/activities', async (req, res) => {
  try {
    const curYear = new Date().getFullYear();
    const year = parseInt(req.query.year) || curYear;
    const [rows] = await pool.query(
      `SELECT a.*, t.name AS performer_name, l.customer_name, l.project_name
       FROM activities a
       LEFT JOIN team_members t ON a.performed_by = t.id
       LEFT JOIN leads l ON a.lead_id = l.id
       WHERE YEAR(a.performed_at) = ?
       ORDER BY a.performed_at DESC LIMIT 10`,
      [year]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
