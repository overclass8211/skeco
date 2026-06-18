const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { requireFeature } = require('../middleware/featureGuard');

// 알림 시스템 전체에 feature flag 적용
router.use(requireFeature('crm.notifications'));

router.get('/', async (req, res) => {
  try {
    // extended=true 이면 더 넓은 범위·더 많은 수량으로 조회 (전체 목록 페이지용)
    const ext = req.query.extended === 'true';
    const lim = ext ? 30 : 5; // 일반 limit
    const evtLim = ext ? 50 : 8; // 일정 limit
    const dayWin = ext ? 30 : 7; // 입찰/납기 임박 일 창
    const closeWin = ext ? 7 : 3; // 마감 임박 일 창
    const hrWin = ext ? 168 : 48; // 단계변경 시간 창 (7일 vs 48h)
    const dateWin = ext ? 30 : 0; // 오늘 등록 창(0=오늘만, 30=30일 이내)

    // ──────────────────────────────────────────────────────────
    // ① 마감 초과
    // ──────────────────────────────────────────────────────────
    const [overdue] = await pool.query(
      `
      SELECT id, customer_name, project_name, stage,
             expected_close_date AS due_date, '마감초과' AS type,
             DATEDIFF(CURRENT_DATE(), expected_close_date) AS days_left
      FROM leads
      WHERE expected_close_date IS NOT NULL
        AND expected_close_date < CURRENT_DATE()
        AND stage NOT IN ('won','lost','dropped')
      ORDER BY expected_close_date ASC
      LIMIT ?`,
      [lim]
    );

    // ──────────────────────────────────────────────────────────
    // ② 입찰마감 임박
    // ──────────────────────────────────────────────────────────
    const [biddingDeadlines] = await pool.query(
      `
      SELECT id, customer_name, project_name, stage,
             bidding_deadline AS due_date, '입찰마감' AS type,
             DATEDIFF(bidding_deadline, CURRENT_DATE()) AS days_left
      FROM leads
      WHERE bidding_deadline IS NOT NULL
        AND bidding_deadline BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL ? DAY)
        AND stage NOT IN ('won','lost','dropped')
      ORDER BY bidding_deadline ASC
      LIMIT ?`,
      [dayWin, lim]
    );

    // ──────────────────────────────────────────────────────────
    // ③ 마감 임박
    // ──────────────────────────────────────────────────────────
    const [closeDeadlines] = await pool.query(
      `
      SELECT id, customer_name, project_name, stage,
             expected_close_date AS due_date, '마감임박' AS type,
             DATEDIFF(expected_close_date, CURRENT_DATE()) AS days_left
      FROM leads
      WHERE expected_close_date IS NOT NULL
        AND expected_close_date BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL ? DAY)
        AND stage NOT IN ('won','lost','dropped')
      ORDER BY expected_close_date ASC
      LIMIT ?`,
      [closeWin, lim]
    );

    // ──────────────────────────────────────────────────────────
    // ④ 프로젝트 납기 임박
    // ──────────────────────────────────────────────────────────
    const [projectDeadlines] = await pool.query(
      `
      SELECT id, COALESCE(customer_name,'') AS customer_name,
             name AS project_name, status AS stage,
             due_date, '납기임박' AS type,
             DATEDIFF(due_date, CURRENT_DATE()) AS days_left,
             lead_id
      FROM projects
      WHERE due_date IS NOT NULL
        AND due_date BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL ? DAY)
        AND status NOT IN ('완료','취소')
      ORDER BY due_date ASC
      LIMIT ?`,
      [dayWin, lim]
    );

    // ──────────────────────────────────────────────────────────
    // ⑤ 오늘/최근 캘린더 일정 (미완료)
    // ──────────────────────────────────────────────────────────
    const calWhere = ext
      ? `DATE(start_datetime) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY)`
      : `DATE(start_datetime) = CURRENT_DATE()`;
    const [todayEvents] = await pool.query(
      `
      SELECT id, COALESCE(customer_name,'') AS customer_name,
             title AS project_name, event_type AS stage,
             start_datetime AS due_date, '오늘일정' AS type, 0 AS days_left
      FROM calendar_events
      WHERE ${calWhere} AND status = 'planned'
      ORDER BY start_datetime ASC
      LIMIT ?`,
      [evtLim]
    );

    // ──────────────────────────────────────────────────────────
    // ⑥ 수주 완료
    // ──────────────────────────────────────────────────────────
    const wonWhere = ext
      ? `a.performed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
      : `DATE(a.performed_at) = CURRENT_DATE()`;
    const [wonToday] = await pool.query(
      `
      SELECT l.id, l.customer_name, l.project_name, l.stage,
             a.performed_at AS due_date, '수주완료' AS type, 0 AS days_left
      FROM activities a
      JOIN leads l ON a.lead_id = l.id
      WHERE a.activity_type IN ('수주','stage_change')
        AND l.stage = 'won'
        AND ${wonWhere}
      ORDER BY a.performed_at DESC
      LIMIT ?`,
      [lim]
    );

    // ──────────────────────────────────────────────────────────
    // ⑦ 단계 변경
    // ──────────────────────────────────────────────────────────
    const [stageChanges] = await pool.query(
      `
      SELECT l.id, l.customer_name, l.project_name, l.stage,
             a.title AS stage_detail,
             a.performed_at AS due_date, '단계변경' AS type, 0 AS days_left
      FROM activities a
      JOIN leads l ON a.lead_id = l.id
      WHERE (
              a.activity_type = 'stage_change'
              OR (a.activity_type = '기타' AND a.title LIKE '단계 변경:%')
            )
        AND l.stage NOT IN ('won')
        AND a.performed_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      ORDER BY a.performed_at DESC
      LIMIT ?`,
      [hrWin, lim]
    );

    // ──────────────────────────────────────────────────────────
    // ⑧ 회의록 등록
    // ──────────────────────────────────────────────────────────
    const meetWhere = ext
      ? `created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
      : `DATE(created_at) = CURRENT_DATE()`;
    const [meetings] = await pool.query(
      `
      SELECT id, COALESCE(customer_name,'') AS customer_name,
             title AS project_name, '' AS stage,
             created_at AS due_date, '회의록등록' AS type, 0 AS days_left
      FROM meeting_minutes
      WHERE ${meetWhere}
      ORDER BY created_at DESC
      LIMIT ?`,
      [lim]
    );

    // ──────────────────────────────────────────────────────────
    // ⑨ 신규 리드 등록
    // ──────────────────────────────────────────────────────────
    const leadWhere = ext
      ? `created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`
      : `DATE(created_at) = CURRENT_DATE()`;
    const [newLeads] = await pool.query(
      `SELECT id, customer_name, project_name, stage,
              created_at AS due_date, '리드등록' AS type, 0 AS days_left
       FROM leads
       WHERE ${leadWhere}
       ORDER BY created_at DESC
       LIMIT ?`,
      ext ? [dateWin, lim] : [lim]
    );

    // ──────────────────────────────────────────────────────────
    // ⑩ 신규 고객사 등록
    // ──────────────────────────────────────────────────────────
    const custWhere = ext
      ? `created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`
      : `DATE(created_at) = CURRENT_DATE()`;
    const [newCustomers] = await pool.query(
      `SELECT id, name AS customer_name, '' AS project_name, '' AS stage,
              created_at AS due_date, '고객사등록' AS type, 0 AS days_left
       FROM customers
       WHERE ${custWhere}
       ORDER BY created_at DESC
       LIMIT ?`,
      ext ? [dateWin, lim] : [lim]
    );

    // ──────────────────────────────────────────────────────────
    // ⑪ 영업 활동 등록
    // ──────────────────────────────────────────────────────────
    const actWhere = ext
      ? `a.performed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`
      : `DATE(a.performed_at) = CURRENT_DATE()`;
    const [newActivities] = await pool.query(
      `SELECT a.id, COALESCE(l.customer_name, p.customer_name, '') AS customer_name,
              COALESCE(l.project_name, p.name, a.title, '') AS project_name,
              a.activity_type AS stage,
              a.performed_at AS due_date, '활동등록' AS type, 0 AS days_left,
              a.lead_id
       FROM activities a
       LEFT JOIN leads    l ON a.lead_id    = l.id
       LEFT JOIN projects p ON a.project_id = p.id
       WHERE ${actWhere}
         AND a.activity_type NOT IN ('stage_change','수주','드롭')
       ORDER BY a.performed_at DESC
       LIMIT ?`,
      ext ? [dateWin, lim] : [lim]
    );

    // ──────────────────────────────────────────────────────────
    // 우선순위별 정렬
    // ──────────────────────────────────────────────────────────
    const PRIORITY = {
      마감초과: 1,
      입찰마감: 2,
      마감임박: 3,
      납기임박: 4,
      오늘일정: 5,
      수주완료: 6,
      단계변경: 7,
      회의록등록: 8,
      리드등록: 9,
      고객사등록: 10,
      활동등록: 11,
    };

    const all = [
      ...overdue,
      ...biddingDeadlines,
      ...closeDeadlines,
      ...projectDeadlines,
      ...todayEvents,
      ...wonToday,
      ...stageChanges,
      ...meetings,
      ...newLeads,
      ...newCustomers,
      ...newActivities,
    ].sort((a, b) => (PRIORITY[a.type] || 99) - (PRIORITY[b.type] || 99));

    res.json({ success: true, data: all, total: all.length });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
