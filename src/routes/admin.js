const router = require('express').Router();
const pool = require('../db');
const { handleError, friendlyError } = require('../middleware/errorHandler');
const { getClientCount } = require('../ws');
const { genAI, MODEL_FAST, SAFETY_SETTINGS } = require('../services/gemini');
const featureGuard = require('../middleware/featureGuard');

// ── DB 자동 마이그레이션 ───────────────────────────────────────
pool
  .query(
    `
  CREATE TABLE IF NOT EXISTS announcement_views (
    announcement_id INT NOT NULL,
    viewer_id       INT NOT NULL,
    viewed_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (announcement_id, viewer_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`
  )
  .catch(() => {});

// 토큰 자동충전 설정 컬럼
pool
  .query(
    `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auto_recharge_enabled   TINYINT(1) DEFAULT 0`
  )
  .catch(() => {});
pool
  .query(
    `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auto_recharge_threshold INT DEFAULT 80 COMMENT '% 사용시 충전 트리거'`
  )
  .catch(() => {});
pool
  .query(
    `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auto_recharge_amount    INT DEFAULT 100000 COMMENT '1회 충전 토큰 수'`
  )
  .catch(() => {});

// 토큰 충전 로그
pool
  .query(
    `
  CREATE TABLE IF NOT EXISTS token_recharge_log (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT         NOT NULL,
    recharge_amount INT         NOT NULL,
    new_limit       INT         NOT NULL,
    reason          VARCHAR(100) DEFAULT '자동충전',
    triggered_by    VARCHAR(20)  DEFAULT 'auto',
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_date (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`
  )
  .catch(() => {});

// GET /api/admin/users — 사용자 목록 (404 패턴 해소)
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, role, team, is_active, created_at
       FROM team_members
       ORDER BY is_active DESC, name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [[teamRow]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM team_members WHERE is_active=1'
    );
    const [[logRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM access_logs WHERE DATE(created_at)=CURRENT_DATE()`
    );
    const [[leadRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM leads');
    const [[actRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM activities');

    // DB 크기 조회 (information_schema) — 헬스체크 + 통계 카드용
    let dbSizeMb = null;
    try {
      const [[sizeRow]] = await pool.query(`
        SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
      `);
      dbSizeMb = sizeRow?.size_mb ?? null;
    } catch (_) {
      /* DB 권한 부족 등으로 실패 시 null — 헬스체크에서 '이상' 표시 */
    }

    const uptimeSec = process.uptime();
    const uptimeHours = Math.floor(uptimeSec / 3600);
    const uptimeMin = Math.floor((uptimeSec % 3600) / 60);

    res.json({
      success: true,
      data: {
        // 사용자 수 — UI 호환 위해 두 필드 모두 제공
        total_team: teamRow.cnt,
        total_users: teamRow.cnt,
        // API 호출
        api_calls_today: logRow.cnt,
        // 도메인 카운터
        total_leads: leadRow.cnt,
        total_activities: actRow.cnt,
        // DB 크기 (MB)
        db_size_mb: dbSizeMb,
        // 가동 시간 — 문자열 + 숫자 둘 다 제공
        uptime: `${uptimeHours}시간 ${uptimeMin}분`,
        uptime_hours: uptimeSec / 3600,
        // 런타임
        ws_connections: getClientCount(),
        node_version: process.version,
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/settings', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
    const data = {};
    rows.forEach(r => {
      data[r.setting_key] = r.setting_value;
    });
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/settings', async (req, res) => {
  try {
    const updates = req.body || {};
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, String(value)]
      );
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Phase 7: 공급사 기본 정보 (관리자 페이지) ─────────────────
// 견적서/제안서 PDF 출력 시 자동 표시되는 회사 정보.
// system_settings 의 quote_supplier_* 키 8개를 묶어서 관리.
// 권한: GET 은 인증 사용자 모두 (모듈에서 fetch 필요), PUT 은 admin+ (rbac autoLevel 자동)
const SUPPLIER_FIELD_KEYS = [
  'supplier_company_name', // 회사명 (필수)
  'supplier_address', // 주소
  'supplier_business_no', // 사업자등록번호
  'supplier_ceo', // 대표자
  'sales_rep_name', // 영업 담당자 이름
  'sales_rep_contact', // 영업 담당자 연락처
  'sales_rep_email', // 영업 담당자 이메일
];
const SUPPLIER_META_KEYS = [
  'supplier_updated_by_name', // 마지막 수정자 이름
  'supplier_updated_by_id', // 마지막 수정자 ID
];

function _isValidEmail(s) {
  if (!s) return true; // 빈 값 허용
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
}

// GET /api/admin/supplier-info — 공급사 정보 조회 (인증 사용자 모두)
router.get('/supplier-info', async (req, res) => {
  try {
    const allKeys = SUPPLIER_FIELD_KEYS.concat(SUPPLIER_META_KEYS).map(k => 'quote_' + k);
    const placeholders = allKeys.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value, updated_at
         FROM system_settings WHERE setting_key IN (${placeholders})`,
      allKeys
    );
    const data = {};
    let lastUpdatedAt = null;
    rows.forEach(r => {
      const shortKey = r.setting_key.replace(/^quote_/, '');
      data[shortKey] = r.setting_value;
      // 가장 최근 updated_at 추적 (모든 키 중)
      if (!lastUpdatedAt || new Date(r.updated_at) > new Date(lastUpdatedAt)) {
        lastUpdatedAt = r.updated_at;
      }
    });
    // 빈 키도 명시적으로 (UI 가 동일 구조로 받을 수 있도록)
    SUPPLIER_FIELD_KEYS.concat(SUPPLIER_META_KEYS).forEach(k => {
      if (data[k] === undefined) data[k] = '';
    });
    data._updated_at = lastUpdatedAt;
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /api/admin/supplier-info — 공급사 정보 저장 (admin+ 권한 — autoLevel 자동)
router.put('/supplier-info', async (req, res) => {
  try {
    const body = req.body || {};
    // 화이트리스트 — 허용된 필드만 (악의적 키 차단)
    const validUpdates = {};
    for (const k of SUPPLIER_FIELD_KEYS) {
      if (body[k] !== undefined) {
        validUpdates[k] = String(body[k] || '').slice(0, 255);
      }
    }
    if (Object.keys(validUpdates).length === 0) {
      return res.status(400).json({ success: false, error: '저장할 항목이 없습니다' });
    }
    // 검증
    if (
      validUpdates.supplier_company_name !== undefined &&
      !validUpdates.supplier_company_name.trim()
    ) {
      return res.status(400).json({ success: false, error: '회사명은 필수 입력입니다' });
    }
    if (validUpdates.sales_rep_email && !_isValidEmail(validUpdates.sales_rep_email)) {
      return res.status(400).json({ success: false, error: '이메일 형식이 유효하지 않습니다' });
    }

    // 마지막 수정자 메타 (req.user 가 NODE_ENV=test 면 null)
    const userId = req.user?.id || null;
    let userName = '시스템';
    if (userId) {
      try {
        const [[u]] = await pool.query(`SELECT name FROM team_members WHERE id = ?`, [userId]);
        userName = u?.name || `사용자 #${userId}`;
      } catch (_) {}
    }
    validUpdates.supplier_updated_by_id = String(userId || '');
    validUpdates.supplier_updated_by_name = userName;

    // 배치 INSERT...ON DUPLICATE
    for (const [shortKey, value] of Object.entries(validUpdates)) {
      const fullKey = 'quote_' + shortKey;
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [fullKey, value]
      );
    }

    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/token-usage-by-user', async (req, res) => {
  try {
    const [[def]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'default_monthly_token_limit'`
    );
    const defaultLimit = def ? parseInt(def.setting_value) : 0;
    const [rows] = await pool.query(`
      SELECT t.id, t.name, t.role, t.email, t.monthly_token_limit,
        COALESCE((SELECT SUM(total_tokens) FROM ai_usage WHERE user_id=t.id AND YEAR(created_at)=YEAR(CURRENT_DATE()) AND MONTH(created_at)=MONTH(CURRENT_DATE())), 0) AS used_this_month,
        COALESCE((SELECT COUNT(*) FROM ai_usage WHERE user_id=t.id AND YEAR(created_at)=YEAR(CURRENT_DATE()) AND MONTH(created_at)=MONTH(CURRENT_DATE())), 0) AS calls_this_month
      FROM team_members t WHERE t.is_active=1 ORDER BY used_this_month DESC, t.name`);
    res.json({ success: true, data: rows, defaultLimit });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/team-members/:id/token-limit', async (req, res) => {
  try {
    const { monthly_token_limit } = req.body;
    const limit =
      monthly_token_limit === '' ||
      monthly_token_limit === null ||
      monthly_token_limit === undefined
        ? null
        : parseInt(monthly_token_limit);
    await pool.query('UPDATE team_members SET monthly_token_limit=? WHERE id=?', [
      limit,
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/access-logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const [rows] = await pool.query(
      'SELECT * FROM access_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    const [[total]] = await pool.query('SELECT COUNT(*) AS cnt FROM access_logs');
    res.json({ success: true, data: rows, total: total.cnt });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/access-logs', async (req, res) => {
  try {
    await pool.query('DELETE FROM access_logs');
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/team-stats', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.name, t.role, t.email,
        (SELECT COUNT(*) FROM leads WHERE assigned_to=t.id) AS leads_count,
        (SELECT COUNT(*) FROM activities WHERE performed_by=t.id) AS activities_count,
        (SELECT MAX(performed_at) FROM activities WHERE performed_by=t.id) AS last_active
      FROM team_members t WHERE t.is_active=1 ORDER BY t.name`);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/daily-logs', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS cnt
      FROM access_logs WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      GROUP BY day ORDER BY day ASC`);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/top-paths', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT path, COUNT(*) AS cnt, ROUND(AVG(duration_ms)) AS avg_ms
      FROM access_logs GROUP BY path ORDER BY cnt DESC LIMIT 10`);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 게시판 통계 (월별/조직별) ──────────────────────────────────
router.get('/board-stats', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    // ① 팀원 전체 목록 (role=본부 구분, team=팀 구분)
    const [members] = await pool.query(
      `SELECT id, name, role, team FROM team_members WHERE is_active=1 ORDER BY role, team, name`
    );

    // ② 해당 월 게시글 수 (created_by 기준)
    const [posts] = await pool.query(
      `SELECT created_by AS member_id, COUNT(*) AS cnt
       FROM announcements
       WHERE YEAR(created_at)=? AND MONTH(created_at)=? AND created_by IS NOT NULL
       GROUP BY created_by`,
      [year, month]
    );

    // ③ 해당 월 댓글 수 (author_name → team_members.name JOIN)
    const [comments] = await pool.query(
      `SELECT t.id AS member_id, COUNT(c.id) AS cnt
       FROM comments c
       JOIN team_members t ON t.name = c.author_name AND t.is_active = 1
       WHERE YEAR(c.created_at)=? AND MONTH(c.created_at)=?
       GROUP BY t.id`,
      [year, month]
    );

    // ④ 해당 월 열람 수 — 반복 누계 제외 (PK 중복 방지로 unique per 공지)
    //    같은 공지를 몇 번 읽어도 1회로 집계
    const [views] = await pool.query(
      `SELECT viewer_id AS member_id, COUNT(*) AS cnt
       FROM announcement_views
       WHERE YEAR(viewed_at)=? AND MONTH(viewed_at)=?
       GROUP BY viewer_id`,
      [year, month]
    );

    // 맵 변환
    const postMap = Object.fromEntries(posts.map(r => [r.member_id, Number(r.cnt)]));
    const commentMap = Object.fromEntries(comments.map(r => [r.member_id, Number(r.cnt)]));
    const viewMap = Object.fromEntries(views.map(r => [r.member_id, Number(r.cnt)]));

    // 팀원별 집계
    const memberStats = members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role || '미지정',
      team: m.team || '미지정',
      posts: postMap[m.id] || 0,
      comments: commentMap[m.id] || 0,
      views: viewMap[m.id] || 0,
    }));

    // 팀별 소계
    const teamMap2 = {};
    memberStats.forEach(m => {
      const key = `${m.role}||${m.team}`;
      if (!teamMap2[key])
        teamMap2[key] = { role: m.role, team: m.team, posts: 0, comments: 0, views: 0 };
      teamMap2[key].posts += m.posts;
      teamMap2[key].comments += m.comments;
      teamMap2[key].views += m.views;
    });

    // 본부별 소계
    const roleMap = {};
    memberStats.forEach(m => {
      if (!roleMap[m.role]) roleMap[m.role] = { role: m.role, posts: 0, comments: 0, views: 0 };
      roleMap[m.role].posts += m.posts;
      roleMap[m.role].comments += m.comments;
      roleMap[m.role].views += m.views;
    });

    // 전체 합계
    const total = memberStats.reduce(
      (a, m) => ({
        posts: a.posts + m.posts,
        comments: a.comments + m.comments,
        views: a.views + m.views,
      }),
      { posts: 0, comments: 0, views: 0 }
    );

    // 월별 트렌드 (12개월치, 연도 고정)
    const [monthly] = await pool.query(
      `
      SELECT
        m_val AS month,
        COALESCE(p.cnt, 0) AS posts,
        COALESCE(c.cnt, 0) AS comments,
        COALESCE(v.cnt, 0) AS views
      FROM (
        SELECT 1 m_val UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8
        UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION SELECT 12
      ) months
      LEFT JOIN (
        SELECT MONTH(created_at) AS m, COUNT(*) AS cnt
        FROM announcements WHERE YEAR(created_at)=? GROUP BY m
      ) p ON p.m = months.m_val
      LEFT JOIN (
        SELECT MONTH(created_at) AS m, COUNT(*) AS cnt
        FROM comments WHERE YEAR(created_at)=? GROUP BY m
      ) c ON c.m = months.m_val
      LEFT JOIN (
        SELECT MONTH(viewed_at) AS m, COUNT(*) AS cnt
        FROM announcement_views WHERE YEAR(viewed_at)=? GROUP BY m
      ) v ON v.m = months.m_val
      ORDER BY months.m_val`,
      [year, year, year]
    );

    res.json({
      success: true,
      data: {
        year,
        month,
        members: memberStats,
        teams: Object.values(teamMap2),
        roles: Object.values(roleMap),
        total,
        monthly,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// 토큰 모니터링 (superadmin 전용)
// ══════════════════════════════════════════════════════════════

// 모델별 단가 (USD / 1M tokens)
const MODEL_PRICE = {
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  default: { input: 0.15, output: 0.6 },
};
function calcCost(model, promptTok, completionTok) {
  const p = MODEL_PRICE[model] || MODEL_PRICE['default'];
  return (promptTok * p.input + completionTok * p.output) / 1_000_000;
}

// ── 종합 통계 ────────────────────────────────────────────────
router.get('/token-monitor', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const [[def]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key='default_monthly_token_limit'`
    );
    const defaultLimit = def ? parseInt(def.setting_value) : 500000;

    // ① 이번 달 전체 요약
    const [[summary]] = await pool.query(
      `
      SELECT
        COALESCE(SUM(total_tokens),0)      AS month_tokens,
        COALESCE(SUM(prompt_tokens),0)     AS month_prompt,
        COALESCE(SUM(completion_tokens),0) AS month_completion,
        COALESCE(COUNT(*),0)               AS month_calls,
        COALESCE(COUNT(DISTINCT user_id),0) AS month_active_users
      FROM ai_usage WHERE YEAR(created_at)=? AND MONTH(created_at)=?`,
      [year, month]
    );

    // ② 오늘 요약
    const [[today]] = await pool.query(`
      SELECT COALESCE(SUM(total_tokens),0) AS today_tokens,
             COALESCE(COUNT(*),0) AS today_calls,
             COALESCE(COUNT(DISTINCT user_id),0) AS today_users
      FROM ai_usage WHERE DATE(created_at)=CURRENT_DATE()`);

    // ③ 일별 트렌드 (최근 30일)
    const [daily] = await pool.query(`
      SELECT DATE(created_at) AS day,
             SUM(prompt_tokens)     AS prompt,
             SUM(completion_tokens) AS completion,
             SUM(total_tokens)      AS total,
             COUNT(*)               AS calls,
             COUNT(DISTINCT user_id) AS users,
             model
      FROM ai_usage
      WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY)
      GROUP BY DATE(created_at), model
      ORDER BY day ASC`);

    // ④ 월별 트렌드 (12개월)
    const [monthly] = await pool.query(`
      SELECT YEAR(created_at) AS yr, MONTH(created_at) AS mo,
             SUM(prompt_tokens)     AS prompt,
             SUM(completion_tokens) AS completion,
             SUM(total_tokens)      AS total,
             COUNT(*)               AS calls,
             COUNT(DISTINCT user_id) AS users
      FROM ai_usage
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY yr, mo ORDER BY yr, mo`);

    // ⑤ 기능별(endpoint) 사용량
    const [byEndpoint] = await pool.query(
      `
      SELECT endpoint,
             SUM(total_tokens) AS total, COUNT(*) AS calls,
             ROUND(AVG(total_tokens)) AS avg_per_call
      FROM ai_usage WHERE YEAR(created_at)=? AND MONTH(created_at)=?
      GROUP BY endpoint ORDER BY total DESC`,
      [year, month]
    );

    // ⑥ 모델별 사용량
    const [byModel] = await pool.query(
      `
      SELECT model,
             SUM(prompt_tokens)     AS prompt,
             SUM(completion_tokens) AS completion,
             SUM(total_tokens)      AS total,
             COUNT(*)               AS calls
      FROM ai_usage WHERE YEAR(created_at)=? AND MONTH(created_at)=?
      GROUP BY model ORDER BY total DESC`,
      [year, month]
    );

    // ⑦ 사용자별 이번 달 사용량 + 한도 + 자동충전 설정
    const [users] = await pool.query(
      `
      SELECT t.id, t.name, t.role, t.email,
             t.monthly_token_limit,
             t.auto_recharge_enabled,
             t.auto_recharge_threshold,
             t.auto_recharge_amount,
             COALESCE(u.total, 0)      AS used_tokens,
             COALESCE(u.prompt, 0)     AS used_prompt,
             COALESCE(u.completion, 0) AS used_completion,
             COALESCE(u.calls, 0)      AS calls,
             u.last_call
      FROM team_members t
      LEFT JOIN (
        SELECT user_id,
               SUM(total_tokens)      AS total,
               SUM(prompt_tokens)     AS prompt,
               SUM(completion_tokens) AS completion,
               COUNT(*)               AS calls,
               MAX(created_at)        AS last_call
        FROM ai_usage
        WHERE YEAR(created_at)=? AND MONTH(created_at)=?
        GROUP BY user_id
      ) u ON u.user_id = t.id
      WHERE t.is_active=1
      ORDER BY COALESCE(u.total,0) DESC`,
      [year, month]
    );

    // ⑧ 최근 충전 로그 20건
    const [rechargeLogs] = await pool
      .query(
        `
      SELECT r.*, t.name AS user_name
      FROM token_recharge_log r
      LEFT JOIN team_members t ON r.user_id = t.id
      ORDER BY r.created_at DESC LIMIT 20`
      )
      .catch(() => [[]]);

    // 비용 계산
    const modelCosts = byModel.map(m => ({
      ...m,
      cost_usd: calcCost(m.model, Number(m.prompt), Number(m.completion)),
    }));
    const totalCostUsd = modelCosts.reduce((s, m) => s + m.cost_usd, 0);

    // 일별 비용 (model 기준)
    const dailyCostMap = {};
    daily.forEach(r => {
      const day = String(r.day).slice(0, 10);
      if (!dailyCostMap[day])
        dailyCostMap[day] = { day, prompt: 0, completion: 0, total: 0, calls: 0, cost_usd: 0 };
      dailyCostMap[day].prompt += Number(r.prompt);
      dailyCostMap[day].completion += Number(r.completion);
      dailyCostMap[day].total += Number(r.total);
      dailyCostMap[day].calls += Number(r.calls);
      dailyCostMap[day].cost_usd += calcCost(
        r.model || 'default',
        Number(r.prompt),
        Number(r.completion)
      );
    });
    const dailyAgg = Object.values(dailyCostMap).sort((a, b) => a.day.localeCompare(b.day));

    // 이번 달 예상 비용 (월 진행률로 환산)
    const today2 = new Date();
    const daysInMonth = new Date(today2.getFullYear(), today2.getMonth() + 1, 0).getDate();
    const dayOfMonth = today2.getDate();
    const projectedCost =
      dayOfMonth < daysInMonth ? totalCostUsd * (daysInMonth / dayOfMonth) : totalCostUsd;

    res.json({
      success: true,
      data: {
        year,
        month,
        defaultLimit,
        summary: {
          ...summary,
          today_tokens: Number(today.today_tokens),
          today_calls: Number(today.today_calls),
          today_users: Number(today.today_users),
          cost_usd: totalCostUsd,
          projected_cost_usd: projectedCost,
        },
        daily: dailyAgg,
        monthly,
        byEndpoint,
        byModel: modelCosts,
        users: users.map(u => ({
          ...u,
          used_tokens: Number(u.used_tokens),
          used_prompt: Number(u.used_prompt),
          used_completion: Number(u.used_completion),
          calls: Number(u.calls),
          eff_limit:
            u.monthly_token_limit !== null && u.monthly_token_limit !== undefined
              ? u.monthly_token_limit
              : defaultLimit,
          cost_usd: calcCost('default', Number(u.used_prompt), Number(u.used_completion)),
        })),
        rechargeLogs,
        totalCostUsd,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 자동충전 설정 저장 ────────────────────────────────────────
router.put('/token-recharge-settings/:id', async (req, res) => {
  try {
    const { auto_recharge_enabled, auto_recharge_threshold, auto_recharge_amount } = req.body;
    await pool.query(
      `UPDATE team_members SET
         auto_recharge_enabled   = ?,
         auto_recharge_threshold = ?,
         auto_recharge_amount    = ?
       WHERE id = ?`,
      [
        auto_recharge_enabled ? 1 : 0,
        parseInt(auto_recharge_threshold) || 80,
        parseInt(auto_recharge_amount) || 100000,
        req.params.id,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수동 충전 (관리자가 직접 토큰 추가) ─────────────────────────
router.post('/token-recharge/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const amount = parseInt(req.body.amount) || 0;
    if (amount <= 0)
      return res.status(400).json({ success: false, message: '충전량을 입력하세요' });

    const [[member]] = await pool.query(`SELECT monthly_token_limit FROM team_members WHERE id=?`, [
      userId,
    ]);
    const [[def]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key='default_monthly_token_limit'`
    );
    const current = member?.monthly_token_limit ?? parseInt(def?.setting_value || 500000);
    const newLimit = current + amount;

    await pool.query(`UPDATE team_members SET monthly_token_limit=? WHERE id=?`, [
      newLimit,
      userId,
    ]);
    await pool.query(
      `INSERT INTO token_recharge_log (user_id, recharge_amount, new_limit, reason, triggered_by)
       VALUES (?,?,?,?,?)`,
      [userId, amount, newLimit, '수동충전', 'admin']
    );
    res.json({ success: true, new_limit: newLimit });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 개발자 옵션 API  (superadmin 전용 미들웨어)
// ─────────────────────────────────────────────────────────────
function devOnly(req, res, next) {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: '개발자 옵션은 superadmin 전용입니다.' });
  }
  next();
}

// GET  /api/admin/dev/features
router.get('/dev/features', devOnly, async (req, res) => {
  try {
    const [features] = await pool.query(
      'SELECT * FROM dev_features ORDER BY category, feature_key'
    );
    res.json({ success: true, data: features });
  } catch (err) {
    handleError(res, err);
  }
});

// GET  /api/admin/dev/features/public  — 로그인 후 전체 유저가 읽는 플래그 (enabled 여부만)
router.get('/dev/features/public', async (req, res) => {
  try {
    const [features] = await pool.query('SELECT feature_key, is_enabled FROM dev_features');
    const flags = {};
    features.forEach(f => {
      flags[f.feature_key] = !!f.is_enabled;
    });
    res.json({ success: true, data: flags });
  } catch (err) {
    handleError(res, err);
  }
});

// PUT  /api/admin/dev/features/:key
router.put('/dev/features/:key', devOnly, async (req, res) => {
  try {
    const { is_enabled, reason } = req.body;
    const newEnabled = is_enabled ? 1 : 0;
    const userId = req.user?.id || null;
    const key = req.params.key;

    // 1) 현재 상태 + 의존성 정보 조회
    const [[current]] = await pool.query(
      'SELECT is_enabled, required_features, feature_name, risk_level FROM dev_features WHERE feature_key = ?',
      [key]
    );
    if (!current) {
      return res.status(404).json({ success: false, error: '기능을 찾을 수 없습니다' });
    }
    const oldEnabled = current.is_enabled;

    // 변경 없으면 no-op
    if (oldEnabled === newEnabled) {
      return res.json({ success: true, data: { unchanged: true } });
    }

    // 2) 의존성 체크 — 활성화 시 의존하는 feature 가 OFF 면 거부
    if (newEnabled === 1) {
      let required = [];
      try {
        required = JSON.parse(current.required_features || '[]');
      } catch (_) {}
      if (required.length > 0) {
        const placeholders = required.map(() => '?').join(',');
        const [deps] = await pool.query(
          `SELECT feature_key, feature_name, is_enabled FROM dev_features
            WHERE feature_key IN (${placeholders})`,
          required
        );
        const disabled = deps.filter(d => !d.is_enabled);
        if (disabled.length > 0) {
          return res.status(409).json({
            success: false,
            error: '의존 기능이 비활성화 상태입니다',
            unmet_dependencies: disabled.map(d => ({ key: d.feature_key, name: d.feature_name })),
          });
        }
      }
    }

    // 3) 비활성화 시 — 이 기능을 require 하는 다른 기능이 켜져 있으면 경고
    if (newEnabled === 0) {
      const [dependents] = await pool.query(
        `SELECT feature_key, feature_name FROM dev_features
          WHERE is_enabled = 1
            AND required_features IS NOT NULL
            AND JSON_CONTAINS(required_features, JSON_QUOTE(?))`,
        [key]
      );
      if (dependents.length > 0) {
        // confirm 플래그 없으면 경고만 — 강제 진행하려면 ?force=1
        if (req.query.force !== '1') {
          return res.status(409).json({
            success: false,
            error: '이 기능에 의존하는 다른 활성 기능이 있습니다',
            dependents: dependents.map(d => ({ key: d.feature_key, name: d.feature_name })),
            hint: '강제 진행하려면 ?force=1 쿼리 파라미터를 추가하세요',
          });
        }
      }
    }

    // 4) 변경 + audit 기록
    await pool.query(
      `UPDATE dev_features
          SET is_enabled = ?,
              last_changed_by = ?,
              last_changed_at = NOW()
        WHERE feature_key = ?`,
      [newEnabled, userId, key]
    );
    await pool.query(
      `INSERT INTO dev_features_audit (feature_key, old_enabled, new_enabled, changed_by, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [key, oldEnabled, newEnabled, userId, reason || null]
    );

    // featureGuard 캐시 즉시 무효화 → 다음 요청부터 새 상태 반영
    featureGuard.invalidate();

    res.json({ success: true, data: { feature_key: key, old: oldEnabled, new: newEnabled } });
  } catch (err) {
    handleError(res, err);
  }
});

// GET  /api/admin/dev/features/audit  — 변경 이력 조회 (최근 N건)
router.get('/dev/features/audit', devOnly, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const featureKey = req.query.feature_key;
    const where = featureKey ? 'WHERE a.feature_key = ?' : '';
    const params = featureKey ? [featureKey, limit] : [limit];
    const [rows] = await pool.query(
      `SELECT a.id, a.feature_key, a.old_enabled, a.new_enabled,
              a.changed_at, a.reason,
              u.username AS changed_by_username,
              u.full_name AS changed_by_name,
              f.feature_name
         FROM dev_features_audit a
         LEFT JOIN users u ON u.id = a.changed_by
         LEFT JOIN dev_features f ON f.feature_key = a.feature_key
         ${where}
        ORDER BY a.changed_at DESC
        LIMIT ?`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE  /api/admin/dev/features/:key  — Deprecated 기능 수동 정리
router.delete('/dev/features/:key', devOnly, async (req, res) => {
  try {
    const key = req.params.key;
    // 안전장치: deprecated 상태만 삭제 허용
    const [[row]] = await pool.query(
      'SELECT is_deprecated FROM dev_features WHERE feature_key = ?',
      [key]
    );
    if (!row) {
      return res.status(404).json({ success: false, error: '기능을 찾을 수 없습니다' });
    }
    if (!row.is_deprecated) {
      return res.status(400).json({
        success: false,
        error: 'Deprecated 상태가 아닌 기능은 삭제할 수 없습니다 (매니페스트에서 먼저 제거하세요)',
      });
    }
    await pool.query('DELETE FROM dev_features WHERE feature_key = ?', [key]);
    // audit 도 같이 정리 (감사 추적성 위해 옵션으로 유지하려면 주석 처리)
    await pool.query('DELETE FROM dev_features_audit WHERE feature_key = ?', [key]);
    // featureGuard 캐시 무효화
    featureGuard.invalidate();
    res.json({ success: true, data: { deleted: key } });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Configuration Preset API ──────────────────────────────
const { FEATURE_PRESETS, LOCKED_FEATURES, buildTargetState } = require('../data/featurePresets');

// GET /api/admin/dev/presets — 사용 가능한 프리셋 목록
router.get('/dev/presets', devOnly, (req, res) => {
  try {
    const list = Object.entries(FEATURE_PRESETS).map(([key, preset]) => ({
      key,
      label: preset.label,
      description: preset.description,
      target_audience: preset.target_audience,
      enabled_count: preset.enabled_features === '*' ? 'all' : preset.enabled_features?.length || 0,
      disabled_count: preset.enabled_features === '*' ? 0 : preset.disabled_features?.length || 0,
    }));
    res.json({
      success: true,
      data: {
        presets: list,
        locked_features: LOCKED_FEATURES,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/admin/dev/presets/:key/preview — 프리셋 적용 시 변경 사항 미리보기
router.get('/dev/presets/:key/preview', devOnly, async (req, res) => {
  try {
    const presetKey = req.params.key;
    if (!FEATURE_PRESETS[presetKey]) {
      return res.status(404).json({ success: false, error: '알 수 없는 프리셋' });
    }

    const [features] = await pool.query(
      'SELECT feature_key, feature_name, is_enabled, risk_level FROM dev_features WHERE is_deprecated = 0'
    );
    const target = buildTargetState(presetKey, features);

    const changes = [];
    features.forEach(f => {
      const desired = target.get(f.feature_key);
      const current = !!f.is_enabled;
      if (desired !== current) {
        changes.push({
          feature_key: f.feature_key,
          feature_name: f.feature_name,
          risk_level: f.risk_level,
          from: current,
          to: desired,
        });
      }
    });

    res.json({
      success: true,
      data: {
        preset: FEATURE_PRESETS[presetKey],
        total_features: features.length,
        change_count: changes.length,
        changes,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/admin/dev/presets/:key/apply — 프리셋 일괄 적용
router.post('/dev/presets/:key/apply', devOnly, async (req, res) => {
  try {
    const presetKey = req.params.key;
    if (!FEATURE_PRESETS[presetKey]) {
      return res.status(404).json({ success: false, error: '알 수 없는 프리셋' });
    }
    const userId = req.user?.id || null;

    const [features] = await pool.query(
      'SELECT feature_key, is_enabled FROM dev_features WHERE is_deprecated = 0'
    );
    const target = buildTargetState(presetKey, features);

    let applied = 0;
    let skipped = 0;
    const auditEntries = [];

    for (const f of features) {
      const desired = target.get(f.feature_key);
      const current = !!f.is_enabled;
      if (desired === current) {
        skipped++;
        continue;
      }
      const newEnabled = desired ? 1 : 0;
      await pool.query(
        `UPDATE dev_features
            SET is_enabled = ?, last_changed_by = ?, last_changed_at = NOW()
          WHERE feature_key = ?`,
        [newEnabled, userId, f.feature_key]
      );
      auditEntries.push([
        f.feature_key,
        f.is_enabled,
        newEnabled,
        userId,
        `프리셋 적용: ${presetKey}`,
      ]);
      applied++;
    }

    // audit 일괄 insert
    if (auditEntries.length > 0) {
      await pool.query(
        `INSERT INTO dev_features_audit
          (feature_key, old_enabled, new_enabled, changed_by, reason)
         VALUES ?`,
        [auditEntries]
      );
    }

    // featureGuard 캐시 무효화
    featureGuard.invalidate();

    res.json({
      success: true,
      data: {
        preset: presetKey,
        applied,
        skipped,
        total: features.length,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 스키마 서버사이드 캐시 (30초 TTL) ──────────────────────────
const _schemaCache = { schema: null, relations: null, ts: 0, relTs: 0 };
const SCHEMA_TTL = 30_000; // 30s

// GET  /api/admin/dev/schema  — 실시간 DB 스키마 조회 (캐시 30s)
router.get('/dev/schema', devOnly, async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (!force && _schemaCache.schema && Date.now() - _schemaCache.ts < SCHEMA_TTL) {
      return res.json({ success: true, data: _schemaCache.schema, cached: true });
    }
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const dbName = dbRow.db;
    // 두 쿼리 병렬 실행
    const [[tables], [columns]] = await Promise.all([
      pool.query(
        `SELECT TABLE_NAME, IFNULL(TABLE_ROWS,0) AS TABLE_ROWS,
                IFNULL(DATA_LENGTH,0) AS DATA_LENGTH, CREATE_TIME
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
        [dbName]
      ),
      pool.query(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
                COLUMN_KEY, COLUMN_DEFAULT, EXTRA
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [dbName]
      ),
    ]);
    const schema = {};
    tables.forEach(t => {
      schema[t.TABLE_NAME] = { meta: t, columns: [] };
    });
    columns.forEach(c => {
      if (schema[c.TABLE_NAME]) schema[c.TABLE_NAME].columns.push(c);
    });
    _schemaCache.schema = schema;
    _schemaCache.ts = Date.now();
    res.json({ success: true, data: schema });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD 동적 매핑 — 관리자가 미분류 테이블에 API 매핑 추가
//   GET    /dev/dfd-mappings              전체 매핑 목록
//   POST   /dev/dfd-mappings              upsert (단일 테이블)
//   DELETE /dev/dfd-mappings/:tableName   매핑 제거
// ─────────────────────────────────────────────────────────────
router.get('/dev/dfd-mappings', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT table_name, api_keys, added_by, added_at, updated_at
       FROM dfd_mappings ORDER BY table_name`
    );
    // JSON 파싱 (안전)
    const data = rows.map(r => {
      let apis;
      try {
        apis = JSON.parse(r.api_keys || '[]');
      } catch (_) {
        apis = [];
      }
      return { ...r, api_keys: apis };
    });
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-mappings', devOnly, async (req, res) => {
  try {
    const { table_name, api_keys } = req.body || {};
    if (!table_name || typeof table_name !== 'string') {
      return res.status(400).json({ success: false, error: 'table_name (string) 필요' });
    }
    if (!Array.isArray(api_keys)) {
      return res.status(400).json({ success: false, error: 'api_keys (array) 필요' });
    }
    // 안전: id-like 키만 통과 (api-leads, api-admin 등)
    const cleanKeys = api_keys
      .filter(k => typeof k === 'string' && /^api-[a-z0-9-]+$/i.test(k))
      .slice(0, 50); // 안전 상한
    await pool.query(
      `INSERT INTO dfd_mappings (table_name, api_keys, added_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         api_keys = VALUES(api_keys),
         added_by = COALESCE(VALUES(added_by), added_by)`,
      [table_name, JSON.stringify(cleanKeys), req.user?.id || null]
    );
    res.json({ success: true, data: { table_name, api_keys: cleanKeys } });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-mappings/:tableName', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_mappings WHERE table_name = ?', [req.params.tableName]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD 무시 목록 — 매핑 안 했지만 "알림 그만"으로 표시한 테이블
//   GET    /dev/dfd-dismissed              무시 목록
//   POST   /dev/dfd-dismissed              무시 등록 (body: {table_name})
//   DELETE /dev/dfd-dismissed/:tableName   다시 알림
// ─────────────────────────────────────────────────────────────
router.get('/dev/dfd-dismissed', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT table_name, dismissed_by, dismissed_at FROM dfd_dismissed ORDER BY dismissed_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-dismissed', devOnly, async (req, res) => {
  try {
    const { table_name } = req.body || {};
    if (!table_name || typeof table_name !== 'string') {
      return res.status(400).json({ success: false, error: 'table_name (string) 필요' });
    }
    await pool.query(
      `INSERT INTO dfd_dismissed (table_name, dismissed_by)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         dismissed_by = COALESCE(VALUES(dismissed_by), dismissed_by),
         dismissed_at = CURRENT_TIMESTAMP`,
      [table_name, req.user?.id || null]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-dismissed/:tableName', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_dismissed WHERE table_name = ?', [req.params.tableName]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 서버 등록 API 라우트 introspection (DFD API 자동 동기화)
// app._router.stack 을 walk → /api/* 마운트 추출
// ─────────────────────────────────────────────────────────────
router.get('/dev/registered-routes', devOnly, (req, res) => {
  try {
    const app = req.app;
    const found = new Set();
    const stack = app._router?.stack || app.router?.stack || [];
    for (const layer of stack) {
      if (!layer.regexp) continue;
      const src = layer.regexp.toString();
      // /api/<seg1>[/<seg2>] 패턴 추출
      const m = src.match(/\\\/api\\\/([a-zA-Z0-9_-]+)(?:\\\/([a-zA-Z0-9_-]+))?/);
      if (!m) continue;
      const seg1 = m[1];
      const seg2 = m[2];
      // /api/admin/<sub> → 'admin' 통합 (이미 api-admin 존재)
      if (seg2 && seg1 === 'admin') {
        found.add('/api/admin');
      } else if (seg2 && seg1 === 'pipeline') {
        // /api/pipeline/stages 같은 multi-segment
        found.add('/api/pipeline/' + seg2);
      } else {
        found.add('/api/' + seg1);
      }
    }
    res.json({ success: true, data: { routes: [...found].sort() } });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD API 동적 매핑 (테이블 매핑의 거울 구조 — API → 페이지)
// ─────────────────────────────────────────────────────────────
router.get('/dev/dfd-api-mappings', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT api_id, page_keys, added_by, added_at, updated_at
       FROM dfd_api_mappings ORDER BY api_id`
    );
    const data = rows.map(r => {
      let pages;
      try {
        pages = JSON.parse(r.page_keys || '[]');
      } catch (_) {
        pages = [];
      }
      return { ...r, page_keys: pages };
    });
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-api-mappings', devOnly, async (req, res) => {
  try {
    const { api_id, page_keys } = req.body || {};
    if (!api_id || typeof api_id !== 'string') {
      return res.status(400).json({ success: false, error: 'api_id 필요' });
    }
    if (!Array.isArray(page_keys)) {
      return res.status(400).json({ success: false, error: 'page_keys 배열 필요' });
    }
    const cleanKeys = page_keys
      .filter(k => typeof k === 'string' && /^pg-[a-z0-9-]+$/i.test(k))
      .slice(0, 50);
    await pool.query(
      `INSERT INTO dfd_api_mappings (api_id, page_keys, added_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         page_keys = VALUES(page_keys),
         added_by = COALESCE(VALUES(added_by), added_by)`,
      [api_id, JSON.stringify(cleanKeys), req.user?.id || null]
    );
    res.json({ success: true, data: { api_id, page_keys: cleanKeys } });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-api-mappings/:apiId', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_api_mappings WHERE api_id = ?', [req.params.apiId]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/dev/dfd-api-dismissed', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT api_id, dismissed_by, dismissed_at FROM dfd_api_dismissed ORDER BY dismissed_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-api-dismissed', devOnly, async (req, res) => {
  try {
    const { api_id } = req.body || {};
    if (!api_id || typeof api_id !== 'string') {
      return res.status(400).json({ success: false, error: 'api_id 필요' });
    }
    await pool.query(
      `INSERT INTO dfd_api_dismissed (api_id, dismissed_by)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         dismissed_by = COALESCE(VALUES(dismissed_by), dismissed_by),
         dismissed_at = CURRENT_TIMESTAMP`,
      [api_id, req.user?.id || null]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-api-dismissed/:apiId', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_api_dismissed WHERE api_id = ?', [req.params.apiId]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 페이지 파일 자동 발견 (public/js/pages/*.js)
// ─────────────────────────────────────────────────────────────
router.get('/dev/registered-pages', devOnly, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const pagesDir = path.join(__dirname, '..', '..', 'public', 'js', 'pages');
    if (!fs.existsSync(pagesDir)) return res.json({ success: true, data: { pages: [] } });

    const files = fs
      .readdirSync(pagesDir)
      .filter(f => f.endsWith('.js'))
      .sort();
    const pages = files.map(f => {
      const baseName = f.replace(/\.js$/, '');
      return {
        file: f,
        // 파일명 → page_id (예: meeting-list.js → pg-meeting-list)
        page_id: 'pg-' + baseName,
        base_name: baseName,
      };
    });
    res.json({ success: true, data: { pages } });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD 페이지 매핑 (라벨/아이콘/API 연결)
// ─────────────────────────────────────────────────────────────
router.get('/dev/dfd-page-mappings', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT page_id, label, icon, api_keys, added_by, added_at, updated_at
       FROM dfd_page_mappings ORDER BY page_id`
    );
    const data = rows.map(r => {
      let apis;
      try {
        apis = JSON.parse(r.api_keys || '[]');
      } catch (_) {
        apis = [];
      }
      return { ...r, api_keys: apis };
    });
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-page-mappings', devOnly, async (req, res) => {
  try {
    const { page_id, label, icon, api_keys } = req.body || {};
    if (!page_id || typeof page_id !== 'string') {
      return res.status(400).json({ success: false, error: 'page_id 필요' });
    }
    const cleanLabel = label ? String(label).slice(0, 100) : null;
    const cleanIcon = icon ? String(icon).slice(0, 20) : null;
    const cleanApis = Array.isArray(api_keys)
      ? api_keys.filter(k => typeof k === 'string' && /^api-[a-z0-9-]+$/i.test(k)).slice(0, 50)
      : [];
    await pool.query(
      `INSERT INTO dfd_page_mappings (page_id, label, icon, api_keys, added_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label    = VALUES(label),
         icon     = VALUES(icon),
         api_keys = VALUES(api_keys),
         added_by = COALESCE(VALUES(added_by), added_by)`,
      [page_id, cleanLabel, cleanIcon, JSON.stringify(cleanApis), req.user?.id || null]
    );
    res.json({
      success: true,
      data: { page_id, label: cleanLabel, icon: cleanIcon, api_keys: cleanApis },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-page-mappings/:pageId', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_page_mappings WHERE page_id = ?', [req.params.pageId]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/dev/dfd-page-dismissed', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT page_id, dismissed_by, dismissed_at FROM dfd_page_dismissed ORDER BY dismissed_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-page-dismissed', devOnly, async (req, res) => {
  try {
    const { page_id } = req.body || {};
    if (!page_id || typeof page_id !== 'string') {
      return res.status(400).json({ success: false, error: 'page_id 필요' });
    }
    await pool.query(
      `INSERT INTO dfd_page_dismissed (page_id, dismissed_by)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         dismissed_by = COALESCE(VALUES(dismissed_by), dismissed_by),
         dismissed_at = CURRENT_TIMESTAMP`,
      [page_id, req.user?.id || null]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-page-dismissed/:pageId', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_page_dismissed WHERE page_id = ?', [req.params.pageId]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// OpenAPI 통합 — 스펙 + 커버리지 + Operation 평탄화
// ─────────────────────────────────────────────────────────────
function _walkExpressRoutes(stack, basePath = '') {
  const results = [];
  for (const layer of stack) {
    if (layer.route) {
      const fullPath = basePath + (layer.route.path || '');
      const methods = Object.keys(layer.route.methods || {}).filter(m => layer.route.methods[m]);
      for (const method of methods) {
        results.push({ method: method.toUpperCase(), path: fullPath });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const src = layer.regexp.toString();
      const m = src.match(/\\\/([^\\?]+(?:\\\/[^\\?]+)*)/);
      let mountPath = '';
      if (m) mountPath = '/' + m[1].replace(/\\\//g, '/');
      results.push(..._walkExpressRoutes(layer.handle.stack, basePath + mountPath));
    }
  }
  return results;
}

router.get('/dev/openapi/spec', devOnly, (req, res) => {
  try {
    const apiSpec = require('../docs/openapi');
    // ?download=1 일 때만 attachment, 그 외엔 inline JSON
    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="openapi-spec.json"');
      return res.send(JSON.stringify(apiSpec, null, 2));
    }
    res.json({ success: true, data: apiSpec });
  } catch (err) {
    handleError(res, err);
  }
});

// HTML 형식 OpenAPI 문서 다운로드 — Swagger UI 단독 HTML 생성
router.get('/dev/openapi/export/html', devOnly, (req, res) => {
  try {
    const apiSpec = require('../docs/openapi');
    // Swagger UI CDN 기반 단독 HTML — 외부 사용자에게 전달 가능
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- 자체 CSP 명시: blob: 컨텍스트에서 부모 페이지의 strict CSP 가 상속되어
       Swagger UI 의 inline <script> 가 차단되는 문제 해결.
       이 페이지는 superadmin 만 접근 가능한 self-contained 문서이므로
       'unsafe-inline' 허용해도 안전. -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' data: blob: https:;">
  <title>${apiSpec.info?.title || 'API Documentation'}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .download-bar {
      position: sticky; top: 0; z-index: 1000;
      background: linear-gradient(135deg, #1664E5 0%, #4A90E2 100%);
      color: #fff; padding: 10px 20px;
      display: flex; align-items: center; gap: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,.15);
    }
    .download-bar strong { font-size: 14px; }
    .download-bar .meta { font-size: 11px; opacity: 0.85; }
    .download-bar button {
      margin-left: auto; padding: 6px 14px;
      background: rgba(255,255,255,0.2); color: #fff;
      border: 1px solid rgba(255,255,255,0.3); border-radius: 6px;
      cursor: pointer; font-size: 12px; font-weight: 500;
    }
    .download-bar button:hover { background: rgba(255,255,255,0.3); }
    @media print {
      .download-bar { display: none !important; }
      .swagger-ui .topbar { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="download-bar">
    <strong>📡 ${apiSpec.info?.title || 'API Documentation'}</strong>
    <span class="meta">v${apiSpec.info?.version || '1.0.0'} · 생성일: ${new Date().toLocaleDateString('ko-KR')}</span>
    <button onclick="window.print()">📕 PDF로 저장 (Ctrl+P)</button>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const spec = ${JSON.stringify(apiSpec).replace(/</g, '\\u003c')};
      SwaggerUIBundle({
        spec,
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        docExpansion: 'list',
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      });
    };
  </script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.query.download === '1') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="api-docs-${new Date().toISOString().slice(0, 10)}.html"`
      );
    }
    res.send(html);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/dev/openapi/coverage', devOnly, (req, res) => {
  try {
    const apiSpec = require('../docs/openapi');
    const specPaths = apiSpec.paths || {};
    const documented = [];
    for (const [pathKey, pathItem] of Object.entries(specPaths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        if (pathItem[method]) {
          documented.push({
            method: method.toUpperCase(),
            path: pathKey,
            tag: pathItem[method].tags?.[0] || null,
            summary: pathItem[method].summary || '',
          });
        }
      }
    }
    const docSet = new Set(documented.map(d => `${d.method} ${d.path}`));
    const stack = req.app._router?.stack || req.app.router?.stack || [];
    const allRoutes = _walkExpressRoutes(stack, '');
    const routesNormalized = allRoutes
      .filter(r => r.path.startsWith('/api/'))
      .map(r => ({ method: r.method, path: r.path.replace(/^\/api/, '') }));
    const routeSet = new Set();
    const undocumented = [];
    routesNormalized.forEach(r => {
      const key = `${r.method} ${r.path}`;
      if (routeSet.has(key)) return;
      routeSet.add(key);
      if (!docSet.has(key)) undocumented.push(r);
    });
    const stale = documented.filter(d => !routeSet.has(`${d.method} ${d.path}`));
    const totalRoutes = routeSet.size;
    const documentedAndExisting = documented.filter(d =>
      routeSet.has(`${d.method} ${d.path}`)
    ).length;
    const coverage = totalRoutes > 0 ? Math.round((documentedAndExisting / totalRoutes) * 100) : 0;
    res.json({
      success: true,
      data: {
        coverage,
        totals: {
          documented: documented.length,
          undocumented: undocumented.length,
          stale: stale.length,
          routes: totalRoutes,
        },
        documented,
        undocumented,
        stale,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/dev/openapi/operations', devOnly, async (req, res) => {
  try {
    const apiSpec = require('../docs/openapi');
    const specPaths = apiSpec.paths || {};

    // ── DFD 매핑 미리 로드 (양방향 동기화) ──────────────────────
    const [apiMaps] = await pool.query('SELECT api_id, page_keys FROM dfd_api_mappings');
    const [tblMaps] = await pool.query('SELECT table_name, api_keys FROM dfd_mappings');
    const apiToPages = {};
    apiMaps.forEach(r => {
      try {
        apiToPages[r.api_id] = JSON.parse(r.page_keys || '[]');
      } catch (_) {
        apiToPages[r.api_id] = [];
      }
    });
    const apiToTables = {};
    tblMaps.forEach(r => {
      try {
        JSON.parse(r.api_keys || '[]').forEach(apiId => {
          if (!apiToTables[apiId]) apiToTables[apiId] = [];
          apiToTables[apiId].push(r.table_name);
        });
      } catch (_) {
        /* skip */
      }
    });
    const pathToApiId = specPath => {
      const segs = specPath.split('/').filter(Boolean);
      if (segs.length === 0) return null;
      if (segs[0] === 'admin') return 'api-admin';
      if (segs[0] === 'pipeline' && segs[1]) return 'api-pipeline-' + segs[1];
      return 'api-' + segs[0];
    };
    const enrichWithDFD = pathKey => {
      const apiId = pathToApiId(pathKey);
      return {
        'x-dfd-api-id': apiId,
        'x-dfd-pages': apiToPages[apiId] || [],
        'x-dfd-tables': apiToTables[apiId] || [],
      };
    };

    const ops = [];
    for (const [pathKey, pathItem] of Object.entries(specPaths)) {
      const dfdMeta = enrichWithDFD(pathKey);
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        if (pathItem[method]) {
          const op = pathItem[method];
          ops.push({
            method: method.toUpperCase(),
            path: pathKey,
            full_path: '/api' + pathKey,
            tag: op.tags?.[0] || 'Misc',
            summary: op.summary || '',
            description: op.description || '',
            documented: true,
            ...dfdMeta,
          });
        }
      }
    }
    const stack = req.app._router?.stack || req.app.router?.stack || [];
    const allRoutes = _walkExpressRoutes(stack, '');
    const docKeys = new Set(ops.map(o => `${o.method} ${o.path}`));
    const seenAuto = new Set();
    allRoutes
      .filter(r => r.path.startsWith('/api/'))
      .forEach(r => {
        const stripPath = r.path.replace(/^\/api/, '');
        const key = `${r.method} ${stripPath}`;
        if (docKeys.has(key) || seenAuto.has(key)) return;
        seenAuto.add(key);
        const seg = stripPath.split('/').filter(Boolean)[0] || 'misc';
        const dfdMeta = enrichWithDFD(stripPath);
        ops.push({
          method: r.method,
          path: stripPath,
          full_path: r.path,
          tag: seg.charAt(0).toUpperCase() + seg.slice(1),
          summary: '(미문서화)',
          description: '',
          documented: false,
          ...dfdMeta,
        });
      });
    ops.sort((a, b) => {
      if (a.tag !== b.tag) return a.tag.localeCompare(b.tag);
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return a.method.localeCompare(b.method);
    });
    const byTag = {};
    ops.forEach(op => {
      if (!byTag[op.tag]) byTag[op.tag] = [];
      byTag[op.tag].push(op);
    });
    res.json({
      success: true,
      data: {
        operations: ops,
        by_tag: byTag,
        total: ops.length,
        documented_count: ops.filter(o => o.documented).length,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD ↔ OpenAPI 양방향 동기화 상태
//   GET /dev/openapi/sync-status
//   양쪽에서 발견되는 API 의 일관성 검증:
//     - both: 양쪽 모두에 있음 ✅
//     - spec_only: OpenAPI 에만 있음 (라우트 stale)
//     - route_only: 라우트만 있음 (OpenAPI 미문서화)
//     - dfd_mapped_no_doc: DFD 매핑은 있지만 OpenAPI 문서화 없음
// ─────────────────────────────────────────────────────────────
router.get('/dev/openapi/sync-status', devOnly, async (req, res) => {
  try {
    const apiSpec = require('../docs/openapi');
    const specPaths = apiSpec.paths || {};

    // 1) Spec API IDs (path → api-id 변환)
    const pathToApiId = specPath => {
      const segs = specPath.split('/').filter(Boolean);
      if (segs.length === 0) return null;
      if (segs[0] === 'admin') return 'api-admin';
      if (segs[0] === 'pipeline' && segs[1]) return 'api-pipeline-' + segs[1];
      return 'api-' + segs[0];
    };
    const specApiIds = new Set();
    Object.keys(specPaths).forEach(p => {
      const id = pathToApiId(p);
      if (id) specApiIds.add(id);
    });

    // 2) 등록 라우트 API IDs
    const stack = req.app._router?.stack || req.app.router?.stack || [];
    const allRoutes = _walkExpressRoutes(stack, '');
    const routeApiIds = new Set();
    allRoutes.forEach(r => {
      if (!r.path.startsWith('/api/')) return;
      const id = pathToApiId(r.path.replace(/^\/api/, ''));
      if (id) routeApiIds.add(id);
    });

    // 3) DFD 매핑된 API IDs
    const [mappedRows] = await pool.query('SELECT api_id FROM dfd_api_mappings');
    const dfdMappedIds = new Set(mappedRows.map(r => r.api_id));

    // 4) 카테고리별 분류
    const allIds = new Set([...specApiIds, ...routeApiIds, ...dfdMappedIds]);
    const both = [];
    const specOnly = []; // OpenAPI 에만 있음 — stale
    const routeOnly = []; // 라우트만 있음 — OpenAPI 미문서화
    const dfdMappedNoDoc = []; // DFD 매핑은 있지만 OpenAPI 미문서화

    allIds.forEach(id => {
      const inSpec = specApiIds.has(id);
      const inRoute = routeApiIds.has(id);
      const inDFD = dfdMappedIds.has(id);
      if (inSpec && inRoute) both.push(id);
      else if (inSpec && !inRoute) specOnly.push(id);
      else if (!inSpec && inRoute) routeOnly.push(id);
      // DFD 매핑이 있는데 spec 에 없으면 → 강한 경고
      if (inDFD && !inSpec) dfdMappedNoDoc.push(id);
    });

    const totalApis = routeApiIds.size;
    const coveragePct = totalApis > 0 ? Math.round((both.length / totalApis) * 100) : 0;

    res.json({
      success: true,
      data: {
        coverage_pct: coveragePct,
        totals: {
          all: allIds.size,
          spec: specApiIds.size,
          route: routeApiIds.size,
          dfd_mapped: dfdMappedIds.size,
        },
        both: both.sort(),
        spec_only: specOnly.sort(),
        route_only: routeOnly.sort(),
        dfd_mapped_no_doc: dfdMappedNoDoc.sort(),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 외부 서비스 자동 발견
//   GET /dev/external-deps
//   서버 + 프론트 코드에서 https?:// URL 을 추출하여
//   DFD.external 카탈로그와 substring 매칭 → 사용처 파일 반환.
// ─────────────────────────────────────────────────────────────
const EXTERNAL_URL_NOISE = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'opensource.org',
  'spdx.org',
  'json-schema.org',
  'www.w3.org',
  'github.com',
  'raw.githubusercontent.com',
]);

// ─────────────────────────────────────────────────────────────
// 소스 모니터 — 코드베이스 통계 (LOC, 파일 수, 카테고리 분포)
//   GET /dev/source-stats
// ─────────────────────────────────────────────────────────────
const SRC_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'coverage',
  'dist',
  '.claude',
  '.husky',
  '.vscode',
  '.idea',
]);
const SRC_INCLUDE_EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.sql', '.json']);

function _categorizeSource(relPath) {
  // OS 경로 구분자 정규화
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('src/routes/')) return 'routes';
  if (p.startsWith('src/services/')) return 'services';
  if (p.startsWith('src/middleware/')) return 'middleware';
  if (p.startsWith('src/docs/')) return 'docs';
  if (p.startsWith('src/data/')) return 'data';
  if (p.startsWith('src/utils/')) return 'utils';
  if (p.startsWith('src/')) return 'backend';
  if (p.startsWith('public/js/pages/')) return 'pages';
  if (p.startsWith('public/js/')) return 'client-utils';
  if (p.startsWith('public/css/')) return 'styles';
  if (p.startsWith('public/')) return 'public';
  if (p.startsWith('tests/')) return 'tests';
  if (p.startsWith('migrations/')) return 'migrations';
  if (p.startsWith('config/')) return 'config';
  if (p === 'server.js') return 'config';
  if (p === 'schema.sql') return 'schema';
  if (p.endsWith('.sql')) return 'schema';
  return 'other';
}

router.get('/dev/source-stats', devOnly, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const projectRoot = path.join(__dirname, '..', '..');

    const walk = (dir, baseRel = '', depth = 0) => {
      const out = [];
      if (depth > 5) return out;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return out;
      }
      for (const ent of entries) {
        if (SRC_EXCLUDE_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith('.')) continue; // 숨김 파일 스킵
        const fullPath = path.join(dir, ent.name);
        const relPath = baseRel ? `${baseRel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          out.push(...walk(fullPath, relPath, depth + 1));
        } else {
          const ext = path.extname(ent.name).toLowerCase();
          if (!SRC_INCLUDE_EXT.has(ext)) continue;
          let stat;
          try {
            stat = fs.statSync(fullPath);
          } catch (_) {
            continue;
          }
          if (stat.size > 5 * 1024 * 1024) continue; // 5MB 초과 스킵
          let content;
          try {
            content = fs.readFileSync(fullPath, 'utf8');
          } catch (_) {
            continue;
          }
          const allLines = content.split('\n');
          const totalLines = allLines.length;
          const nonBlankLines = allLines.filter(l => l.trim().length > 0).length;
          out.push({
            path: relPath.replace(/\\/g, '/'),
            ext,
            category: _categorizeSource(relPath),
            loc: nonBlankLines,
            total_lines: totalLines,
            size: stat.size,
          });
        }
      }
      return out;
    };

    const files = walk(projectRoot);

    // 통계
    const totals = files.reduce(
      (acc, f) => ({
        files: acc.files + 1,
        loc: acc.loc + f.loc,
        total_lines: acc.total_lines + f.total_lines,
        size: acc.size + f.size,
      }),
      { files: 0, loc: 0, total_lines: 0, size: 0 }
    );

    const byExtension = {};
    files.forEach(f => {
      if (!byExtension[f.ext]) byExtension[f.ext] = { files: 0, loc: 0, size: 0 };
      byExtension[f.ext].files++;
      byExtension[f.ext].loc += f.loc;
      byExtension[f.ext].size += f.size;
    });

    const byCategory = {};
    files.forEach(f => {
      if (!byCategory[f.category]) byCategory[f.category] = { files: 0, loc: 0, size: 0 };
      byCategory[f.category].files++;
      byCategory[f.category].loc += f.loc;
      byCategory[f.category].size += f.size;
    });

    res.json({
      success: true,
      data: {
        totals,
        by_extension: byExtension,
        by_category: byCategory,
        files,
        scanned_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 소스 모니터 — ESLint 품질 분석
//   GET /dev/source-eslint?refresh=1
//   - Node API 로 ESLint 실행 → 메시지 집계
//   - 60초 캐싱 (refresh=1 강제 재실행)
// ─────────────────────────────────────────────────────────────
let _eslintCache = { at: 0, data: null };
const ESLINT_CACHE_MS = 60 * 1000;

router.get('/dev/source-eslint', devOnly, async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (!force && _eslintCache.data && Date.now() - _eslintCache.at < ESLINT_CACHE_MS) {
      return res.json({ success: true, data: _eslintCache.data, cached: true });
    }

    const path = require('path');
    const projectRoot = path.join(__dirname, '..', '..');

    let ESLint;
    try {
      ({ ESLint } = require('eslint'));
    } catch (_) {
      return res.json({
        success: true,
        data: {
          available: false,
          reason: 'ESLint 모듈을 찾을 수 없습니다 (npm install --save-dev eslint).',
        },
      });
    }

    const eslint = new ESLint({ cwd: projectRoot, errorOnUnmatchedPattern: false });
    const results = await eslint.lintFiles(['src/**/*.js', 'server.js', 'public/js/**/*.js']);

    // 집계
    let totalErrors = 0,
      totalWarnings = 0,
      totalFixable = 0,
      totalFiles = 0;
    const byRule = {}; // ruleId → { errors, warnings, files: Set }
    const byFile = []; // { path, errors, warnings, fixable }
    const topMessages = []; // 상위 메시지 샘플

    for (const r of results) {
      const rel = path.relative(projectRoot, r.filePath).replace(/\\/g, '/');
      const fErrors = r.errorCount || 0;
      const fWarn = r.warningCount || 0;
      const fFix = (r.fixableErrorCount || 0) + (r.fixableWarningCount || 0);
      if (fErrors + fWarn === 0) continue;
      totalFiles++;
      totalErrors += fErrors;
      totalWarnings += fWarn;
      totalFixable += fFix;
      byFile.push({ path: rel, errors: fErrors, warnings: fWarn, fixable: fFix });

      for (const m of r.messages || []) {
        const rid = m.ruleId || '(parse)';
        if (!byRule[rid])
          byRule[rid] = { errors: 0, warnings: 0, files: new Set(), severity_max: 0 };
        if (m.severity === 2) byRule[rid].errors++;
        else byRule[rid].warnings++;
        if (m.severity > byRule[rid].severity_max) byRule[rid].severity_max = m.severity;
        byRule[rid].files.add(rel);
        if (topMessages.length < 200) {
          topMessages.push({
            path: rel,
            line: m.line || 0,
            col: m.column || 0,
            rule: rid,
            severity: m.severity,
            message: String(m.message || '').slice(0, 240),
          });
        }
      }
    }

    // Set → count 로 변환
    const rules = Object.entries(byRule)
      .map(([rule, v]) => ({
        rule,
        errors: v.errors,
        warnings: v.warnings,
        total: v.errors + v.warnings,
        files: v.files.size,
        severity_max: v.severity_max,
      }))
      .sort((a, b) => b.total - a.total);

    byFile.sort((a, b) => b.errors * 10 + b.warnings - (a.errors * 10 + a.warnings));

    const payload = {
      available: true,
      totals: {
        files_with_issues: totalFiles,
        errors: totalErrors,
        warnings: totalWarnings,
        fixable: totalFixable,
      },
      rules, // 규칙별 위반 (내림차순)
      files: byFile, // 파일별 위반 (errors 가중치)
      messages: topMessages, // 샘플 메시지 (최대 200)
      scanned_at: new Date().toISOString(),
    };

    _eslintCache = { at: Date.now(), data: payload };
    res.json({ success: true, data: payload, cached: false });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 소스 모니터 — npm audit 보안 취약점
//   GET /dev/source-audit?refresh=1
//   - npm audit --json 실행 → 심각도별 집계
//   - 10분 캐싱
// ─────────────────────────────────────────────────────────────
let _auditCache = { at: 0, data: null };
const AUDIT_CACHE_MS = 10 * 60 * 1000;

router.get('/dev/source-audit', devOnly, (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (!force && _auditCache.data && Date.now() - _auditCache.at < AUDIT_CACHE_MS) {
      return res.json({ success: true, data: _auditCache.data, cached: true });
    }

    const path = require('path');
    const projectRoot = path.join(__dirname, '..', '..');
    const { exec } = require('child_process');

    // Windows / Linux 모두 npm 실행 — 절대 경로 인자 없이 cwd 만 지정
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    // exec 사용 — shell 통해 안전한 인자 (사용자 입력 없음)
    exec(
      `${npmCmd} audit --json`,
      { cwd: projectRoot, maxBuffer: 8 * 1024 * 1024, timeout: 60000 },
      (err, stdout, stderr) => {
        // npm audit 은 취약점이 있으면 exit code 1+ 반환 → err 가 와도 stdout 은 정상
        let parsed;
        try {
          parsed = JSON.parse(stdout || '{}');
        } catch (_) {
          const payload = {
            available: false,
            reason: 'npm audit 출력을 파싱할 수 없습니다.',
            stderr: String(stderr || '').slice(0, 500),
          };
          _auditCache = { at: Date.now(), data: payload };
          return res.json({ success: true, data: payload, cached: false });
        }

        // npm audit v7+ 구조: { vulnerabilities: { pkg: { severity, via, fixAvailable, range, ... } }, metadata: { vulnerabilities: { info, low, moderate, high, critical, total }, dependencies: {...} } }
        const metaVuln = parsed.metadata?.vulnerabilities || {};
        const vulns = parsed.vulnerabilities || {};

        const packages = Object.entries(vulns)
          .map(([name, v]) => ({
            name,
            severity: v.severity || 'unknown',
            range: v.range || '',
            via: Array.isArray(v.via)
              ? v.via
                  .map(x => (typeof x === 'string' ? x : x.title || x.name || ''))
                  .filter(Boolean)
                  .slice(0, 5)
              : [],
            effects: Array.isArray(v.effects) ? v.effects.slice(0, 10) : [],
            fixAvailable: !!v.fixAvailable,
            is_direct: !!v.isDirect,
          }))
          .sort((a, b) => {
            const order = { critical: 4, high: 3, moderate: 2, low: 1, info: 0, unknown: -1 };
            return (order[b.severity] ?? -1) - (order[a.severity] ?? -1);
          });

        const payload = {
          available: true,
          by_severity: {
            critical: metaVuln.critical || 0,
            high: metaVuln.high || 0,
            moderate: metaVuln.moderate || 0,
            low: metaVuln.low || 0,
            info: metaVuln.info || 0,
            total: metaVuln.total || 0,
          },
          dependencies: parsed.metadata?.dependencies || {},
          packages,
          scanned_at: new Date().toISOString(),
        };

        _auditCache = { at: Date.now(), data: payload };
        res.json({ success: true, data: payload, cached: false });
      }
    );
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 소스 모니터 — 복잡도 분석 (espree AST 기반, zero-dep)
//   GET /dev/source-complexity?refresh=1
//   - 함수별 cyclomatic complexity, 길이, 중첩 깊이
//   - 60초 캐싱
// ─────────────────────────────────────────────────────────────
let _complexityCache = { at: 0, data: null };
const COMPLEXITY_CACHE_MS = 60 * 1000;

const _COMPLEXITY_NODES = new Set([
  'IfStatement',
  'ConditionalExpression',
  'SwitchCase', // case 라벨 (default 는 라벨 없음)
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'CatchClause',
]);
const _LOGICAL_OPS = new Set(['&&', '||', '??']);

function _analyzeFunction(fnNode) {
  let complexity = 1;
  let maxDepth = 0;
  let nestedFns = 0;

  // 분기 + 논리연산자 + 중첩 함수 카운트
  const _walkBranch = node => {
    if (!node || typeof node !== 'object') return;
    if (_COMPLEXITY_NODES.has(node.type)) {
      complexity++;
    } else if (node.type === 'LogicalExpression' && _LOGICAL_OPS.has(node.operator)) {
      complexity++;
    } else if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') &&
      node !== fnNode
    ) {
      nestedFns++;
      return; // 중첩 함수 내부는 별도로 분석되므로 깊이 들어가지 않음
    }
    for (const k of Object.keys(node)) {
      if (
        k === 'loc' ||
        k === 'range' ||
        k === 'parent' ||
        k === '_parentNode' ||
        k === '_parentKey'
      )
        continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === 'string') _walkBranch(c);
      } else if (v && typeof v === 'object' && typeof v.type === 'string') {
        _walkBranch(v);
      }
    }
  };
  _walkBranch(fnNode.body || fnNode);

  // 중첩 깊이
  const depthIncreasers = new Set([
    'IfStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'SwitchStatement',
    'TryStatement',
  ]);
  const _measureDepth = (node, d = 0) => {
    if (!node || typeof node !== 'object') return;
    const nextD = depthIncreasers.has(node.type) ? d + 1 : d;
    if (nextD > maxDepth) maxDepth = nextD;
    // 중첩 함수 내부는 별도로 처리되므로 진입 X
    if (
      node !== fnNode &&
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression')
    )
      return;
    for (const k of Object.keys(node)) {
      if (
        k === 'loc' ||
        k === 'range' ||
        k === 'parent' ||
        k === '_parentNode' ||
        k === '_parentKey'
      )
        continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === 'string') _measureDepth(c, nextD);
      } else if (v && typeof v === 'object' && typeof v.type === 'string') {
        _measureDepth(v, nextD);
      }
    }
  };
  _measureDepth(fnNode.body || fnNode, 0);

  const startLine = fnNode.loc?.start?.line || 0;
  const endLine = fnNode.loc?.end?.line || startLine;
  const lines = Math.max(1, endLine - startLine + 1);

  // 함수 이름 추론
  let name = '(anonymous)';
  if (fnNode.id?.name) name = fnNode.id.name;
  else if (fnNode._parentKey === 'value' && fnNode._parentNode?.key) {
    // ObjectMethod, Property 등의 value
    name = fnNode._parentNode.key.name || fnNode._parentNode.key.value || name;
  } else if (fnNode._parentKey === 'init' && fnNode._parentNode?.id?.name) {
    name = fnNode._parentNode.id.name;
  } else if (fnNode._parentNode?.type === 'MethodDefinition' && fnNode._parentNode.key?.name) {
    name = fnNode._parentNode.key.name;
  }

  return { name, complexity, depth: maxDepth, lines, nestedFns, startLine };
}

router.get('/dev/source-complexity', devOnly, (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (!force && _complexityCache.data && Date.now() - _complexityCache.at < COMPLEXITY_CACHE_MS) {
      return res.json({ success: true, data: _complexityCache.data, cached: true });
    }

    let espree;
    try {
      espree = require('espree');
    } catch (_) {
      return res.json({
        success: true,
        data: {
          available: false,
          reason: 'espree 모듈을 찾을 수 없습니다 (eslint가 설치되어 있어야 함).',
        },
      });
    }

    const fs = require('fs');
    const path = require('path');
    const projectRoot = path.join(__dirname, '..', '..');

    // 분석 대상 파일 수집 — JS 파일만
    const targets = [];
    const walk = (dir, baseRel = '', depth = 0) => {
      if (depth > 5) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const ent of entries) {
        if (SRC_EXCLUDE_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        const full = path.join(dir, ent.name);
        const rel = baseRel ? `${baseRel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(full, rel, depth + 1);
        else if (/\.(js|mjs|cjs)$/i.test(ent.name)) {
          let stat;
          try {
            stat = fs.statSync(full);
          } catch (_) {
            continue;
          }
          if (stat.size > 2 * 1024 * 1024) continue;
          targets.push({ full, rel: rel.replace(/\\/g, '/') });
        }
      }
    };
    walk(projectRoot);

    const fileResults = [];
    const allFunctions = [];
    let parseErrors = 0;

    for (const { full, rel } of targets) {
      let src;
      try {
        src = fs.readFileSync(full, 'utf8');
      } catch (_) {
        continue;
      }
      const isBrowser = rel.startsWith('public/');
      let ast;
      try {
        ast = espree.parse(src, {
          ecmaVersion: 2022,
          sourceType: isBrowser ? 'script' : 'commonjs',
          loc: true,
          allowReturnOutsideFunction: true,
        });
      } catch (_) {
        try {
          ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'module', loc: true });
        } catch (_e2) {
          parseErrors++;
          continue;
        }
      }

      const fns = [];
      const collect = (node, parent, parentKey) => {
        if (!node || typeof node !== 'object') return;
        if (
          node.type === 'FunctionDeclaration' ||
          node.type === 'FunctionExpression' ||
          node.type === 'ArrowFunctionExpression'
        ) {
          node._parentNode = parent;
          node._parentKey = parentKey;
          fns.push(node);
        }
        for (const k of Object.keys(node)) {
          if (
            k === 'loc' ||
            k === 'range' ||
            k === 'parent' ||
            k === '_parentNode' ||
            k === '_parentKey'
          )
            continue;
          const v = node[k];
          if (Array.isArray(v)) for (const c of v) collect(c, node, k);
          else if (v && typeof v === 'object' && typeof v.type === 'string') collect(v, node, k);
        }
      };
      collect(ast, null, null);

      let fileMaxCx = 0,
        fileSumCx = 0,
        fileMaxDepth = 0,
        fileSumLines = 0;
      for (const fn of fns) {
        const info = _analyzeFunction(fn);
        if (info.complexity > fileMaxCx) fileMaxCx = info.complexity;
        if (info.depth > fileMaxDepth) fileMaxDepth = info.depth;
        fileSumCx += info.complexity;
        fileSumLines += info.lines;
        allFunctions.push({ ...info, path: rel });
      }

      fileResults.push({
        path: rel,
        functions: fns.length,
        max_complexity: fileMaxCx,
        avg_complexity: fns.length ? +(fileSumCx / fns.length).toFixed(1) : 0,
        max_depth: fileMaxDepth,
        total_fn_lines: fileSumLines,
      });
    }

    fileResults.sort((a, b) => b.max_complexity - a.max_complexity);
    allFunctions.sort((a, b) => b.complexity - a.complexity);

    const totalFns = allFunctions.length;
    const avgComplexity = totalFns
      ? +(allFunctions.reduce((s, f) => s + f.complexity, 0) / totalFns).toFixed(1)
      : 0;

    const payload = {
      available: true,
      totals: {
        files: fileResults.length,
        functions: totalFns,
        avg_complexity: avgComplexity,
        over_moderate: allFunctions.filter(f => f.complexity > 10).length,
        over_complex: allFunctions.filter(f => f.complexity > 20).length,
        over_very: allFunctions.filter(f => f.complexity > 50).length,
        parse_errors: parseErrors,
      },
      files: fileResults,
      functions: allFunctions.slice(0, 200),
      scanned_at: new Date().toISOString(),
    };

    _complexityCache = { at: Date.now(), data: payload };
    res.json({ success: true, data: payload, cached: false });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 소스 모니터 — 스냅샷 (추이 추적)
//   POST /dev/source-snapshot        — 현재 stats/eslint/audit/complexity 캡처 → DB 저장
//   GET  /dev/source-snapshots       — 최근 100개 스냅샷 시계열
//   DELETE /dev/source-snapshots/:id — 단건 삭제
// ─────────────────────────────────────────────────────────────
router.post('/dev/source-snapshot', devOnly, async (req, res) => {
  try {
    const note = String(req.body?.note || '').slice(0, 200) || null;
    const userId = req.user?.id || null;

    // 캐시 우선 사용 (없으면 빈 값)
    const stats = _complexityCache.data; // 복잡도 캐시
    const elint = _eslintCache.data; // ESLint 캐시
    const audit = _auditCache.data; // audit 캐시

    // source-stats 는 매번 가벼우니 즉시 재계산 — 메인 통계는 항상 최신값으로 저장
    // 헬퍼: 인라인 walk
    const fs = require('fs');
    const path = require('path');
    const projectRoot = path.join(__dirname, '..', '..');

    let totalFiles = 0,
      totalLoc = 0,
      totalSize = 0;
    const byCategory = {};
    const _walk = (dir, baseRel = '', depth = 0) => {
      if (depth > 5) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const ent of entries) {
        if (SRC_EXCLUDE_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        const full = path.join(dir, ent.name);
        const rel = baseRel ? `${baseRel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) _walk(full, rel, depth + 1);
        else {
          const ext = path.extname(ent.name).toLowerCase();
          if (!SRC_INCLUDE_EXT.has(ext)) continue;
          let stat;
          try {
            stat = fs.statSync(full);
          } catch (_) {
            continue;
          }
          if (stat.size > 5 * 1024 * 1024) continue;
          let content;
          try {
            content = fs.readFileSync(full, 'utf8');
          } catch (_) {
            continue;
          }
          const loc = content.split('\n').filter(l => l.trim().length > 0).length;
          const cat = _categorizeSource(rel);
          totalFiles++;
          totalLoc += loc;
          totalSize += stat.size;
          if (!byCategory[cat]) byCategory[cat] = { files: 0, loc: 0 };
          byCategory[cat].files++;
          byCategory[cat].loc += loc;
        }
      }
    };
    _walk(projectRoot);

    const totalFns = stats?.totals?.functions || null;
    const avgCx = stats?.totals?.avg_complexity || null;
    const maxCx = stats?.functions?.[0]?.complexity || null;
    const cxOver10 = stats?.totals?.over_moderate ?? null;
    const cxOver20 = stats?.totals?.over_complex ?? null;
    const cxOver50 = stats?.totals?.over_very ?? null;

    const elintErrors = elint?.totals?.errors ?? null;
    const elintWarn = elint?.totals?.warnings ?? null;

    const auditCrit = audit?.by_severity?.critical ?? null;
    const auditHigh = audit?.by_severity?.high ?? null;
    const auditMod = audit?.by_severity?.moderate ?? null;
    const auditLow = audit?.by_severity?.low ?? null;
    const auditTot = audit?.by_severity?.total ?? null;

    const [r] = await pool.query(
      `INSERT INTO source_monitor_snapshots
        (total_files, total_loc, total_size,
         total_functions, avg_complexity, max_complexity,
         cx_over_10, cx_over_20, cx_over_50,
         eslint_errors, eslint_warnings,
         audit_critical, audit_high, audit_moderate, audit_low, audit_total,
         categories_json, recorded_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        totalFiles,
        totalLoc,
        totalSize,
        totalFns,
        avgCx,
        maxCx,
        cxOver10,
        cxOver20,
        cxOver50,
        elintErrors,
        elintWarn,
        auditCrit,
        auditHigh,
        auditMod,
        auditLow,
        auditTot,
        JSON.stringify(byCategory),
        userId,
        note,
      ]
    );

    res.json({
      success: true,
      data: {
        id: r.insertId,
        totals: { files: totalFiles, loc: totalLoc, size: totalSize },
        captured: {
          complexity: !!stats,
          eslint: !!elint,
          audit: !!audit,
        },
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/dev/source-snapshots', devOnly, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const [rows] = await pool.query(
      `SELECT id, total_files, total_loc, total_size,
              total_functions, avg_complexity, max_complexity,
              cx_over_10, cx_over_20, cx_over_50,
              eslint_errors, eslint_warnings,
              audit_critical, audit_high, audit_moderate, audit_low, audit_total,
              categories_json, recorded_at, recorded_by, note
         FROM source_monitor_snapshots
        ORDER BY recorded_at DESC
        LIMIT ?`,
      [limit]
    );
    // categories_json 파싱
    const out = rows.map(r => {
      let cats = null;
      try {
        cats = r.categories_json ? JSON.parse(r.categories_json) : null;
      } catch (_) {
        /* ignore */
      }
      return { ...r, categories: cats, categories_json: undefined };
    });
    res.json({ success: true, data: out });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/source-snapshots/:id', devOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    await pool.query(`DELETE FROM source_monitor_snapshots WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 소스 모니터 — 리포트 생성 (JSON / HTML)
//   GET /dev/source-report?format=json|html
// ─────────────────────────────────────────────────────────────
router.get('/dev/source-report', devOnly, async (req, res) => {
  try {
    const format = (req.query.format || 'json').toLowerCase();

    // 현재 캐시된 값을 모아 리포트 구성
    const payload = {
      generated_at: new Date().toISOString(),
      project: 'oci-crm',
      sections: {
        stats: null, // source-stats 즉시 계산
        complexity: _complexityCache.data || null,
        eslint: _eslintCache.data || null,
        audit: _auditCache.data || null,
      },
      recent_snapshots: [],
    };

    // 즉시 통계 계산
    const fs = require('fs');
    const path = require('path');
    const projectRoot = path.join(__dirname, '..', '..');
    let totalFiles = 0,
      totalLoc = 0,
      totalSize = 0;
    const byCategory = {};
    const _walk = (dir, baseRel = '', depth = 0) => {
      if (depth > 5) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const ent of entries) {
        if (SRC_EXCLUDE_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        const full = path.join(dir, ent.name);
        const rel = baseRel ? `${baseRel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) _walk(full, rel, depth + 1);
        else {
          const ext = path.extname(ent.name).toLowerCase();
          if (!SRC_INCLUDE_EXT.has(ext)) continue;
          let stat;
          try {
            stat = fs.statSync(full);
          } catch (_) {
            continue;
          }
          if (stat.size > 5 * 1024 * 1024) continue;
          let content;
          try {
            content = fs.readFileSync(full, 'utf8');
          } catch (_) {
            continue;
          }
          const loc = content.split('\n').filter(l => l.trim().length > 0).length;
          const cat = _categorizeSource(rel);
          totalFiles++;
          totalLoc += loc;
          totalSize += stat.size;
          if (!byCategory[cat]) byCategory[cat] = { files: 0, loc: 0 };
          byCategory[cat].files++;
          byCategory[cat].loc += loc;
        }
      }
    };
    _walk(projectRoot);
    payload.sections.stats = {
      total_files: totalFiles,
      total_loc: totalLoc,
      total_size: totalSize,
      by_category: byCategory,
    };

    // 최근 스냅샷 (시계열)
    try {
      const [rows] = await pool.query(
        `SELECT id, total_files, total_loc, total_functions, avg_complexity,
                cx_over_10, cx_over_20, cx_over_50,
                eslint_errors, eslint_warnings,
                audit_critical, audit_high, audit_moderate, audit_low,
                recorded_at, note
           FROM source_monitor_snapshots
          ORDER BY recorded_at DESC LIMIT 30`
      );
      payload.recent_snapshots = rows;
    } catch (_) {
      /* 테이블 없으면 무시 */
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="source-report-${Date.now()}.json"`
      );
      return res.send(JSON.stringify(payload, null, 2));
    }

    // HTML 리포트
    const fmtBytes = b => {
      if (b === null || b === undefined) return '-';
      if (b < 1024) return `${b} B`;
      if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${(b / 1024 / 1024).toFixed(2)} MB`;
    };
    const fmtNum = n => Number(n || 0).toLocaleString();
    const escHtml = s =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const cx = payload.sections.complexity;
    const el = payload.sections.eslint;
    const au = payload.sections.audit;
    const cats = Object.entries(byCategory)
      .map(([k, v]) => ({ name: k, ...v }))
      .sort((a, b) => b.loc - a.loc);

    const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';">
<title>Source Monitor Report — ${escHtml(new Date(payload.generated_at).toLocaleString('ko-KR'))}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; max-width: 1100px; margin: 24px auto; padding: 0 16px; color: #111; line-height: 1.5; }
  h1 { font-size: 22px; border-bottom: 2px solid #e63329; padding-bottom: 6px; }
  h2 { font-size: 17px; margin-top: 28px; color: #1f2937; border-left: 3px solid #e63329; padding-left: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #f9fafb; font-weight: 600; font-size: 11px; text-transform: uppercase; color: #6b7280; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-top: 12px; }
  .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
  .card-label { font-size: 11px; color: #6b7280; text-transform: uppercase; }
  .card-value { font-size: 22px; font-weight: 700; color: #111; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .meta { color: #6b7280; font-size: 12px; }
  .red { color: #dc2626; } .orange { color: #f59e0b; } .green { color: #10b981; }
</style></head><body>
  <h1>📊 Source Monitor Report</h1>
  <div class="meta">생성: ${escHtml(new Date(payload.generated_at).toLocaleString('ko-KR'))} · 프로젝트: ${escHtml(payload.project)}</div>

  <h2>📦 코드베이스 통계</h2>
  <div class="grid">
    <div class="card"><div class="card-label">총 파일</div><div class="card-value">${fmtNum(totalFiles)}</div></div>
    <div class="card"><div class="card-label">총 LOC</div><div class="card-value">${fmtNum(totalLoc)}</div></div>
    <div class="card"><div class="card-label">총 용량</div><div class="card-value">${fmtBytes(totalSize)}</div></div>
    <div class="card"><div class="card-label">카테고리</div><div class="card-value">${cats.length}</div></div>
  </div>

  <h3>카테고리 분포</h3>
  <table>
    <thead><tr><th>카테고리</th><th class="num">파일</th><th class="num">LOC</th><th class="num">%</th></tr></thead>
    <tbody>
      ${cats
        .map(
          c => `<tr>
        <td>${escHtml(c.name)}</td>
        <td class="num">${fmtNum(c.files)}</td>
        <td class="num">${fmtNum(c.loc)}</td>
        <td class="num">${((c.loc / totalLoc) * 100).toFixed(1)}%</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>

  ${
    cx?.available
      ? `
  <h2>🧠 복잡도 분석</h2>
  <div class="grid">
    <div class="card"><div class="card-label">총 함수</div><div class="card-value">${fmtNum(cx.totals.functions)}</div></div>
    <div class="card"><div class="card-label">평균 복잡도</div><div class="card-value">${cx.totals.avg_complexity}</div></div>
    <div class="card"><div class="card-label orange">> 10 (보통)</div><div class="card-value orange">${fmtNum(cx.totals.over_moderate)}</div></div>
    <div class="card"><div class="card-label red">> 20 (복잡)</div><div class="card-value red">${fmtNum(cx.totals.over_complex)}</div></div>
    <div class="card"><div class="card-label red">> 50 (매우복잡)</div><div class="card-value red">${fmtNum(cx.totals.over_very)}</div></div>
  </div>
  <h3>상위 20개 복잡 함수</h3>
  <table>
    <thead><tr><th class="num">CX</th><th>함수</th><th>위치</th><th class="num">줄</th><th class="num">깊이</th></tr></thead>
    <tbody>
      ${cx.functions
        .slice(0, 20)
        .map(
          f => `<tr>
        <td class="num"><strong class="${f.complexity > 20 ? 'red' : f.complexity > 10 ? 'orange' : 'green'}">${f.complexity}</strong></td>
        <td><code>${escHtml(f.name || '(anon)')}</code></td>
        <td><code>${escHtml(f.path)}:${f.startLine}</code></td>
        <td class="num">${fmtNum(f.lines)}</td>
        <td class="num">${f.depth}</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>
  `
      : ''
  }

  ${
    el?.available
      ? `
  <h2>🔍 ESLint 품질</h2>
  <div class="grid">
    <div class="card"><div class="card-label red">오류</div><div class="card-value red">${fmtNum(el.totals.errors)}</div></div>
    <div class="card"><div class="card-label orange">경고</div><div class="card-value orange">${fmtNum(el.totals.warnings)}</div></div>
    <div class="card"><div class="card-label green">자동수정 가능</div><div class="card-value green">${fmtNum(el.totals.fixable)}</div></div>
    <div class="card"><div class="card-label">이슈 있는 파일</div><div class="card-value">${fmtNum(el.totals.files_with_issues)}</div></div>
  </div>
  <h3>상위 15개 규칙별 위반</h3>
  <table>
    <thead><tr><th>규칙</th><th class="num">오류</th><th class="num">경고</th><th class="num">파일</th></tr></thead>
    <tbody>
      ${el.rules
        .slice(0, 15)
        .map(
          r => `<tr>
        <td><code>${escHtml(r.rule)}</code></td>
        <td class="num red">${fmtNum(r.errors)}</td>
        <td class="num orange">${fmtNum(r.warnings)}</td>
        <td class="num">${fmtNum(r.files)}</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>
  `
      : ''
  }

  ${
    au?.available
      ? `
  <h2>🔒 보안 (npm audit)</h2>
  <div class="grid">
    <div class="card"><div class="card-label red">치명적</div><div class="card-value red">${fmtNum(au.by_severity.critical)}</div></div>
    <div class="card"><div class="card-label red">높음</div><div class="card-value red">${fmtNum(au.by_severity.high)}</div></div>
    <div class="card"><div class="card-label orange">중간</div><div class="card-value orange">${fmtNum(au.by_severity.moderate)}</div></div>
    <div class="card"><div class="card-label">낮음</div><div class="card-value">${fmtNum(au.by_severity.low)}</div></div>
    <div class="card"><div class="card-label">합계</div><div class="card-value">${fmtNum(au.by_severity.total)}</div></div>
  </div>
  ${
    au.packages.length > 0
      ? `
  <h3>취약 패키지 (상위 20)</h3>
  <table>
    <thead><tr><th>심각도</th><th>패키지</th><th>버전</th><th>직접</th><th>수정 가능</th></tr></thead>
    <tbody>
      ${au.packages
        .slice(0, 20)
        .map(
          p => `<tr>
        <td><span class="pill ${p.severity === 'critical' || p.severity === 'high' ? 'red' : p.severity === 'moderate' ? 'orange' : ''}">${escHtml(p.severity)}</span></td>
        <td><code>${escHtml(p.name)}</code></td>
        <td><code>${escHtml(p.range || '-')}</code></td>
        <td>${p.is_direct ? '✓' : '-'}</td>
        <td>${p.fixAvailable ? '✓' : '-'}</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>
  `
      : '<p class="green">✅ 취약점이 발견되지 않았습니다.</p>'
  }
  `
      : ''
  }

  ${
    payload.recent_snapshots.length > 0
      ? `
  <h2>📈 추이 (최근 30개 스냅샷)</h2>
  <table>
    <thead><tr><th>시각</th><th class="num">파일</th><th class="num">LOC</th><th class="num">함수</th><th class="num">평균 CX</th><th class="num">>20</th><th class="num">오류</th><th class="num">취약</th><th>메모</th></tr></thead>
    <tbody>
      ${payload.recent_snapshots
        .map(
          s => `<tr>
        <td>${escHtml(new Date(s.recorded_at).toLocaleString('ko-KR'))}</td>
        <td class="num">${fmtNum(s.total_files)}</td>
        <td class="num">${fmtNum(s.total_loc)}</td>
        <td class="num">${fmtNum(s.total_functions || 0)}</td>
        <td class="num">${s.avg_complexity ?? '-'}</td>
        <td class="num">${s.cx_over_20 ?? '-'}</td>
        <td class="num red">${fmtNum(s.eslint_errors || 0)}</td>
        <td class="num">${fmtNum((s.audit_critical || 0) + (s.audit_high || 0))}</td>
        <td class="meta">${escHtml(s.note || '')}</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>
  `
      : ''
  }

  <p class="meta" style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:10px">
    OCI CRM Source Monitor · 자동 생성 리포트
  </p>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="source-report-${Date.now()}.html"`);
    res.send(html);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/dev/external-deps', devOnly, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const projectRoot = path.join(__dirname, '..', '..');

    const scanTargets = [
      { dir: path.join(projectRoot, 'src'), label: 'src' },
      { file: path.join(projectRoot, 'server.js'), label: 'server.js' },
      { file: path.join(projectRoot, 'public', 'index.html'), label: 'index.html' },
      { file: path.join(projectRoot, 'public', 'js', 'utils.js'), label: 'public/js/utils.js' },
      { dir: path.join(projectRoot, 'public', 'js', 'pages'), label: 'public/js/pages' },
    ];

    const walkDir = (dir, baseLabel, depth = 0) => {
      const out = [];
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return [];
      }
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (depth >= 3) continue;
          if (['node_modules', '.git', 'coverage', 'dist'].includes(ent.name)) continue;
          out.push(...walkDir(p, baseLabel + '/' + ent.name, depth + 1));
        } else if (/\.(js|mjs|cjs|html|json)$/.test(ent.name)) {
          out.push({ path: p, label: baseLabel + '/' + ent.name });
        }
      }
      return out;
    };

    const allFiles = [];
    for (const t of scanTargets) {
      if (t.file && fs.existsSync(t.file)) allFiles.push({ path: t.file, label: t.label });
      else if (t.dir) allFiles.push(...walkDir(t.dir, t.label));
    }
    const uniqByPath = new Map();
    for (const f of allFiles) if (!uniqByPath.has(f.path)) uniqByPath.set(f.path, f);

    const URL_RE = /https?:\/\/([a-zA-Z0-9.-]+(?::\d+)?)/g;
    const acc = new Map(); // host → Set<evidence>
    let scanned = 0;
    for (const file of uniqByPath.values()) {
      let content;
      try {
        content = fs.readFileSync(file.path, 'utf8');
      } catch (_) {
        continue;
      }
      scanned++;
      const seenInFile = new Set();
      let m;
      while ((m = URL_RE.exec(content)) !== null) {
        const host = m[1].toLowerCase().split(':')[0];
        if (EXTERNAL_URL_NOISE.has(host)) continue;
        if (seenInFile.has(host)) continue;
        seenInFile.add(host);
        if (!acc.has(host)) acc.set(host, new Set());
        acc.get(host).add(file.label);
      }
    }

    const discovered = [];
    for (const [host, evidenceSet] of acc) {
      discovered.push({ host, evidence: [...evidenceSet].sort(), count: evidenceSet.size });
    }
    discovered.sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));

    res.json({
      success: true,
      data: {
        discovered,
        scanned: { files: scanned, hosts: discovered.length },
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD 매핑 자동 추론
//   GET /dev/infer-mappings
//     src/routes/*.js 파일들을 분석해 SQL 쿼리에서 테이블명 추출 →
//     실제 DB 테이블과 교차검증 후 제안 매핑 반환.
//     이미 매핑된/무시된 테이블은 제외.
//     응답: { suggestions: [{table_name, api_keys:[...], evidence:[...]}, ...] }
// ─────────────────────────────────────────────────────────────
// 파일명 → API ID 매핑 (예외: meetings.js → api-meeting)
const ROUTE_FILE_TO_API = {
  leads: 'api-leads',
  customers: 'api-customers',
  activities: 'api-activities',
  dashboard: 'api-dashboard',
  calendar: 'api-calendar',
  meetings: 'api-meeting',
  projects: 'api-projects',
  team: 'api-team',
  ai: 'api-ai',
  board: 'api-board',
  auth: 'api-auth',
  admin: 'api-admin',
  notifications: 'api-notifications',
  products: 'api-products',
  google: 'api-google',
};

// SQL 키워드 — table name 추출 시 노이즈로 잡힐 수 있는 단어
const SQL_NOISE_WORDS = new Set([
  'select',
  'where',
  'and',
  'or',
  'on',
  'using',
  'as',
  'is',
  'not',
  'null',
  'order',
  'group',
  'by',
  'having',
  'limit',
  'offset',
  'union',
  'all',
  'distinct',
  'values',
  'set',
  'inner',
  'left',
  'right',
  'outer',
  'cross',
  'natural',
  'use',
  'index',
  'force',
  'ignore',
  'partition',
  'dual',
  'tables',
  'columns',
  'information_schema',
  'mysql',
  'sys',
  'performance_schema',
]);

router.get('/dev/infer-mappings', devOnly, async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const routesDir = path.join(__dirname);

    // 1) 실제 DB 테이블 목록 (교차검증용)
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const [tables] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [dbRow.db]
    );
    const realTableSet = new Set(tables.map(t => t.TABLE_NAME.toLowerCase()));

    // 2) 이미 매핑되었거나 무시된 테이블 — 제안 대상에서 제외
    const [mappedRows] = await pool.query('SELECT table_name FROM dfd_mappings');
    const [dismissedRows] = await pool.query('SELECT table_name FROM dfd_dismissed');
    const skipSet = new Set([
      ...mappedRows.map(r => r.table_name),
      ...dismissedRows.map(r => r.table_name),
    ]);

    // 3) 정적 카탈로그(DFD.tables)에 이미 있는 테이블은 클라이언트가 알고 있으므로
    //    서버는 의식하지 않고 모두 추출 — 클라이언트가 필터.

    // 4) 라우트 파일 스캔
    const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
    // table_name → Map<api_key, evidenceFile[]>
    const accumulator = new Map();

    const TABLE_RE =
      /\b(?:from|join|into|update|alter\s+table|delete\s+from)\s+`?([a-z_][a-z0-9_]*)`?/gi;

    for (const file of files) {
      const baseName = file.replace(/\.js$/, '');
      const apiKey = ROUTE_FILE_TO_API[baseName];
      if (!apiKey) continue; // ROUTE_FILE_TO_API 에 없는 파일 스킵 (errorHandler 등)

      let content;
      try {
        content = fs.readFileSync(path.join(routesDir, file), 'utf8');
      } catch (_) {
        continue;
      }

      const seenInFile = new Set();
      let m;
      while ((m = TABLE_RE.exec(content)) !== null) {
        const tableName = m[1].toLowerCase();
        if (SQL_NOISE_WORDS.has(tableName)) continue;
        if (!realTableSet.has(tableName)) continue; // 실제 DB 테이블만
        if (skipSet.has(tableName)) continue; // 이미 처리됨
        if (seenInFile.has(`${apiKey}:${tableName}`)) continue;
        seenInFile.add(`${apiKey}:${tableName}`);

        if (!accumulator.has(tableName)) accumulator.set(tableName, new Map());
        const apis = accumulator.get(tableName);
        if (!apis.has(apiKey)) apis.set(apiKey, []);
        apis.get(apiKey).push(file);
      }
    }

    // 5) 결과 정리 (테이블 매핑)
    const suggestions = [];
    for (const [tableName, apis] of accumulator) {
      const apiList = [];
      for (const [apiKey, evidence] of apis) {
        apiList.push({ api_key: apiKey, evidence_files: evidence });
      }
      apiList.sort((a, b) => a.api_key.localeCompare(b.api_key));
      suggestions.push({ table_name: tableName, api_keys: apiList });
    }
    suggestions.sort((a, b) => a.table_name.localeCompare(b.table_name));

    // ── 6) 페이지 파일 스캔 → p2a (페이지 → API) 추론 ──────────────
    const pagesDir = path.join(__dirname, '..', '..', 'public', 'js', 'pages');
    // 카탈로그 페이지 (정확한 매핑 — 일부 파일은 동일 페이지로 통합)
    const CATALOG_PAGE_MAP = {
      dashboard: 'pg-dashboard',
      pipeline: 'pg-pipeline',
      leads: 'pg-leads',
      customers: 'pg-customers',
      calendar: 'pg-calendar',
      meeting: 'pg-meeting',
      'meeting-list': 'pg-meeting', // alias
      projects: 'pg-projects',
      team: 'pg-team',
      reports: 'pg-reports',
      board: 'pg-board',
      admin: 'pg-admin',
    };
    // 동적 페이지 ID 생성기 (카탈로그에 없으면 파일명 기반 ID)
    const fileToPageId = baseName => CATALOG_PAGE_MAP[baseName] || 'pg-' + baseName;

    // 무시된 페이지는 추론 제외
    const [dismissedPageRows] = await pool.query('SELECT page_id FROM dfd_page_dismissed');
    const dismissedPageSet = new Set(dismissedPageRows.map(r => r.page_id));

    // 호출 경로 → api_id 변환
    // '/leads' or '/api/leads' → 'api-leads'
    // '/admin/users' → 'api-admin' (부모 통합)
    // '/menu/sidebar' → 'api-menu'
    // '/pipeline/stages' → 'api-pipeline-stages' (multi-segment)
    const pathToApiId = callPath => {
      let p = callPath.trim();
      if (!p) return null;
      // /api/ 프리픽스 제거
      p = p.replace(/^\/?(api\/)?/, '');
      // 쿼리스트링·해시·파라미터 제거
      p = p.split(/[?#]/)[0];
      // 첫 세그먼트
      const segs = p.split('/').filter(Boolean);
      if (segs.length === 0) return null;
      const seg1 = segs[0];
      const seg2 = segs[1];
      // /admin/* → api-admin (정적 카탈로그와 일관)
      if (seg1 === 'admin') return 'api-admin';
      // /pipeline/<sub> 는 동적 라우트 (api-pipeline-stages 등)
      if (seg1 === 'pipeline' && seg2) return 'api-pipeline-' + seg2;
      return 'api-' + seg1;
    };

    // 이미 매핑된 / 무시된 API
    const [apiMappedRows] = await pool.query('SELECT api_id FROM dfd_api_mappings');
    const [apiDismissedRows] = await pool.query('SELECT api_id FROM dfd_api_dismissed');
    const apiSkipSet = new Set([
      ...apiMappedRows.map(r => r.api_id),
      ...apiDismissedRows.map(r => r.api_id),
    ]);

    let pagesScanned = 0;
    const pageFiles = fs.existsSync(pagesDir)
      ? fs.readdirSync(pagesDir).filter(f => f.endsWith('.js'))
      : [];

    // api_id → Map<page_id, evidenceFile[]>
    const pageAccumulator = new Map();
    // API.{get,post,put,delete,patch,request}('/path' ...) 또는 fetch('/api/path' ...)
    const API_CALL_RE = /\bAPI\.(?:get|post|put|delete|patch|request)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    const FETCH_RE = /\bfetch\s*\(\s*['"`](\/api\/[^'"`]+)['"`]/g;

    for (const file of pageFiles) {
      const baseName = file.replace(/\.js$/, '');
      const pageId = fileToPageId(baseName);
      // 무시된 페이지는 추론 제외 — 신규 페이지도 모두 분석 (이전엔 카탈로그만)
      if (dismissedPageSet.has(pageId)) continue;

      let content;
      try {
        content = fs.readFileSync(path.join(pagesDir, file), 'utf8');
      } catch (_) {
        continue;
      }
      pagesScanned++;

      const seenInFile = new Set();
      const _collectCall = callPath => {
        const apiId = pathToApiId(callPath);
        if (!apiId) return;
        if (apiSkipSet.has(apiId)) return;
        if (seenInFile.has(`${apiId}:${pageId}`)) return;
        seenInFile.add(`${apiId}:${pageId}`);
        if (!pageAccumulator.has(apiId)) pageAccumulator.set(apiId, new Map());
        const pages = pageAccumulator.get(apiId);
        if (!pages.has(pageId)) pages.set(pageId, []);
        pages.get(pageId).push(file);
      };

      let m;
      while ((m = API_CALL_RE.exec(content)) !== null) {
        // API.request('GET', '/path') 의 경우 m[1] 이 'GET' 일 수 있음 — '/' 시작만 통과
        if (!m[1].startsWith('/')) {
          // request 함수 케이스 — 두 번째 인자 확인 (직후의 quoted string)
          const after = content.slice(m.index + m[0].length, m.index + m[0].length + 200);
          const m2 = after.match(/['"`]([^'"`]+)['"`]/);
          if (m2 && m2[1].startsWith('/')) _collectCall(m2[1]);
        } else {
          _collectCall(m[1]);
        }
      }
      while ((m = FETCH_RE.exec(content)) !== null) _collectCall(m[1]);
    }

    // p2a 제안 결과 정리
    const apiSuggestions = [];
    for (const [apiId, pages] of pageAccumulator) {
      const pageList = [];
      for (const [pageId, evidence] of pages) {
        pageList.push({ page_key: pageId, evidence_files: evidence });
      }
      pageList.sort((a, b) => a.page_key.localeCompare(b.page_key));
      apiSuggestions.push({ api_id: apiId, page_keys: pageList });
    }
    apiSuggestions.sort((a, b) => a.api_id.localeCompare(b.api_id));

    res.json({
      success: true,
      data: {
        suggestions,
        api_suggestions: apiSuggestions,
        scanned: { routes: files.length, pages: pagesScanned },
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GET  /api/admin/dev/perf  — 최근 24h 성능 지표
router.get('/dev/perf', devOnly, async (req, res) => {
  try {
    const [hourly] = await pool.query(
      `SELECT DATE_FORMAT(created_at,'%H:00') AS hour,
              COUNT(*)                          AS requests,
              ROUND(AVG(duration_ms),1)         AS avg_ms,
              MAX(duration_ms)                  AS max_ms,
              SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS srv_err,
              SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) AS cli_err
       FROM access_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY hour ORDER BY hour`
    );
    const [topRoutes] = await pool.query(
      `SELECT method, path,
              COUNT(*) AS calls, ROUND(AVG(duration_ms),1) AS avg_ms,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
       FROM access_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY method, path ORDER BY calls DESC LIMIT 20`
    );
    res.json({ success: true, data: { hourly, topRoutes } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── access_logs 조치 상태 컬럼 자동 마이그레이션 ───────────────
pool
  .query(`ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resolved      TINYINT(1)   DEFAULT 0`)
  .catch(() => {});
pool
  .query(`ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resolved_by   INT          DEFAULT NULL`)
  .catch(() => {});
pool
  .query(`ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resolved_at   TIMESTAMP    DEFAULT NULL`)
  .catch(() => {});
pool
  .query(`ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resolve_note  VARCHAR(255) DEFAULT NULL`)
  .catch(() => {});

// ══════════════════════════════════════════════════════════════
// GET /api/admin/dev/error-logs  — 에러 로그 조회 (4xx/5xx, 페이지네이션)
// Query params:
//   filter    : all | 4xx | 5xx
//   sc        : 특정 상태코드 (401, 404 ...) — 상단 배지 클릭 시 사용
//   resolved  : all | pending | resolved  (default: all)
//   path      : 경로 검색어
//   hours     : 1~168
//   page / limit
// ══════════════════════════════════════════════════════════════
router.get('/dev/error-logs', devOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const filter = req.query.filter || 'all'; // 'all' | '4xx' | '5xx'
    const scFilter = parseInt(req.query.sc) || null; // 특정 상태코드
    const resolvedFilter = req.query.resolved || 'all'; // 'all' | 'pending' | 'resolved'
    const pathQ = req.query.path || '';
    // hours: 0이면 전체 기간, 그 외 최대 8760(=1년)로 상한
    const rawHours = parseInt(req.query.hours);
    const hours =
      Number.isFinite(rawHours) && rawHours === 0
        ? 0
        : Math.min(8760, rawHours > 0 ? rawHours : 24);
    const allTime = hours === 0;

    // WHERE 절 — al. prefix로 JOIN ambiguous 방지
    const conditions = [];
    const params = [];
    if (!allTime) {
      conditions.push(`al.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`);
      params.push(hours);
    }

    // 상태코드 범위 필터
    if (scFilter) {
      conditions.push('al.status_code = ?');
      params.push(scFilter);
    } else if (filter === '4xx') {
      conditions.push('al.status_code >= 400 AND al.status_code < 500');
    } else if (filter === '5xx') {
      conditions.push('al.status_code >= 500');
    } else {
      conditions.push('al.status_code >= 400');
    }

    // 조치 상태 필터
    if (resolvedFilter === 'pending') {
      conditions.push('(al.resolved IS NULL OR al.resolved = 0)');
    } else if (resolvedFilter === 'resolved') {
      conditions.push('al.resolved = 1');
    }

    if (pathQ) {
      conditions.push('al.path LIKE ?');
      params.push(`%${pathQ}%`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // 전체 건수 + 페이지 행 병렬 조회
    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM access_logs al ${where}`, params),
      pool.query(
        `SELECT al.id, al.user_id, al.method, al.path, al.status_code,
                al.duration_ms, al.ip, al.created_at,
                al.resolved, al.resolved_at, al.resolve_note,
                rb.full_name AS resolved_by_name,
                tm.name AS user_name, tm.email AS user_email
         FROM access_logs al
         LEFT JOIN team_members tm ON tm.id = al.user_id
         LEFT JOIN users        rb ON rb.id = al.resolved_by
         ${where}
         ORDER BY al.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);

    // 상태코드별 분포 — 조치 상태 포함 (resolved 컬럼이 없는 레거시 환경 대응)
    const timeWhere = allTime ? '' : 'created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR) AND ';
    const timeParam = allTime ? [] : [hours];
    const [dist] = await pool.query(
      `SELECT status_code,
              COUNT(*) AS cnt,
              SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END) AS resolved_cnt
       FROM access_logs
       WHERE ${timeWhere}status_code >= 400
       GROUP BY status_code ORDER BY cnt DESC`,
      timeParam
    );

    // 잔여/조치완료 총합
    const [[summaryRow]] = await pool.query(
      `SELECT
         SUM(CASE WHEN (resolved IS NULL OR resolved = 0) THEN 1 ELSE 0 END) AS pending_cnt,
         SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END)                       AS resolved_cnt
       FROM access_logs
       WHERE ${timeWhere}status_code >= 400`,
      timeParam
    );

    res.json({
      success: true,
      data: {
        rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        dist,
        summary: {
          pending: Number(summaryRow?.pending_cnt ?? total),
          resolved: Number(summaryRow?.resolved_cnt ?? 0),
        },
        hours,
        filter,
        scFilter,
        resolvedFilter,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/admin/dev/error-logs/resolve
//   body: { ids: [1,2,3], note: '...' }           — 개별 ID 목록
//     or: { pattern: { sc, method, path }, note }  — 동일 패턴 일괄
//     or: { resolveAll: true, hours, filter }       — 현재 필터 전체
// ══════════════════════════════════════════════════════════════
router.patch('/dev/error-logs/resolve', devOnly, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const { ids, pattern, resolveAll, hours = 24, filter = 'all', note = '' } = req.body;
    let affected = 0;

    if (resolveAll) {
      // 현재 필터 기준 미조치 전체 조치완료
      const cond = [
        'status_code >= 400',
        `created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
        '(resolved IS NULL OR resolved = 0)',
      ];
      const p = [hours];
      if (filter === '4xx') {
        cond.push('status_code < 500');
      } else if (filter === '5xx') {
        cond.push('status_code >= 500');
      }
      const [r] = await pool.query(
        `UPDATE access_logs SET resolved=1, resolved_by=?, resolved_at=NOW(), resolve_note=?
         WHERE ${cond.join(' AND ')}`,
        [userId, note || null, ...p]
      );
      affected = r.affectedRows;
    } else if (pattern) {
      const [r] = await pool.query(
        `UPDATE access_logs SET resolved=1, resolved_by=?, resolved_at=NOW(), resolve_note=?
         WHERE status_code=? AND method=? AND path=? AND (resolved IS NULL OR resolved=0)`,
        [userId, note || null, pattern.sc, pattern.method, pattern.path]
      );
      affected = r.affectedRows;
    } else if (Array.isArray(ids) && ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const [r] = await pool.query(
        `UPDATE access_logs SET resolved=1, resolved_by=?, resolved_at=NOW(), resolve_note=?
         WHERE id IN (${placeholders})`,
        [userId, note || null, ...ids]
      );
      affected = r.affectedRows;
    } else {
      return res
        .status(400)
        .json({ success: false, error: 'ids, pattern, resolveAll 중 하나 필요' });
    }

    res.json({ success: true, affected });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/admin/dev/error-logs/unresolve
//   body: { ids: [1,2,3] }
// ══════════════════════════════════════════════════════════════
router.patch('/dev/error-logs/unresolve', devOnly, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ success: false, error: 'ids 배열 필요' });
    const placeholders = ids.map(() => '?').join(',');
    const [r] = await pool.query(
      `UPDATE access_logs SET resolved=0, resolved_by=NULL, resolved_at=NULL, resolve_note=NULL
       WHERE id IN (${placeholders})`,
      ids
    );
    res.json({ success: true, affected: r.affectedRows });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/admin/dev/error-logs/detect
//   클릭 시점에 시스템 헬스 프로브 — 미리 정의된 핵심 엔드포인트들을
//   내부 HTTP 호출하여 4xx/5xx 발생 시 access_logs 미들웨어가 자동 등록.
//   결과: { tested, failed, registered, errors:[{endpoint,status}] }
// ══════════════════════════════════════════════════════════════
router.post('/dev/error-logs/detect', devOnly, async (req, res) => {
  try {
    const http = require('http');
    const auth = req.headers.authorization || '';
    const port = req.socket?.localPort || require('../../config').port || 3001;

    // 시스템 핵심 GET 엔드포인트 — 4xx/5xx 응답은 미들웨어가 access_logs 자동 INSERT
    const endpoints = [
      ['GET', '/api/dashboard'],
      ['GET', '/api/dashboard/stats'],
      ['GET', '/api/dashboard/funnel'],
      ['GET', '/api/dashboard/monthly'],
      ['GET', '/api/dashboard/activities'],
      ['GET', '/api/leads?limit=1'],
      ['GET', '/api/customers?limit=1'],
      ['GET', '/api/products?limit=1'],
      ['GET', '/api/projects?limit=1'],
      ['GET', '/api/team'],
      ['GET', '/api/activities?limit=1'],
      ['GET', '/api/calendar'],
      ['GET', '/api/meetings'],
      ['GET', '/api/board'],
      ['GET', '/api/admin/users'],
    ];

    const probe = (method, path) =>
      new Promise(resolve => {
        const r = http.request(
          {
            host: '127.0.0.1',
            port,
            method,
            path,
            headers: { Authorization: auth },
            timeout: 4000,
          },
          resp => {
            resp.on('data', () => {});
            resp.on('end', () => resolve({ status: resp.statusCode }));
          }
        );
        r.on('error', e => resolve({ status: 0, error: e.message }));
        r.on('timeout', () => {
          r.destroy();
          resolve({ status: 0, error: 'timeout' });
        });
        r.end();
      });

    // ID 기반 카운팅 — timezone 영향 없이 정확
    const [[beforeRow]] = await pool.query('SELECT COALESCE(MAX(id),0) AS max_id FROM access_logs');
    const beforeMaxId = Number(beforeRow.max_id);

    const probedAt = new Date();
    const results = await Promise.all(endpoints.map(([m, p]) => probe(m, p)));

    const errors = results
      .map((r, i) => ({ endpoint: endpoints[i].join(' '), status: r.status, error: r.error }))
      .filter(r => r.status === 0 || r.status >= 400);

    // 미들웨어 res.on('finish') INSERT 반영 대기
    await new Promise(r => setTimeout(r, 500));

    const [[newRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM access_logs
       WHERE id > ? AND status_code >= 400`,
      [beforeMaxId]
    );

    res.json({
      success: true,
      tested: endpoints.length,
      failed: errors.length,
      registered: Number(newRow.cnt),
      probedAt,
      errors,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/admin/dev/error-logs/auto-classify
//   known-fix 패턴을 자동으로 조치완료 처리 + 미리보기(dryRun)
//   body: { dryRun: bool, hours: 24 }
// ══════════════════════════════════════════════════════════════
router.post('/dev/error-logs/auto-classify', devOnly, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const dryRun = req.body?.dryRun !== false; // default: dryRun=true (미리보기)
    const hours = Math.min(168, parseInt(req.body?.hours) || 24 * 7);

    // ── 자동 분류 규칙 정의 ─────────────────────────────────────
    // { label, note, conditions: [sql_fragment, ...params] }
    const rules = [
      {
        label: '로그아웃 상태 폴링 (근본 원인: SKIP_LOG_PATHS 적용 완료)',
        note: '폴링 경로 SKIP 처리로 신규 발생 차단됨',
        sql: `status_code=401 AND method='GET'
                AND path IN ('/api/ai/usage/today','/api/notifications','/api/briefing/today')
                AND (resolved IS NULL OR resolved=0)`,
        params: [],
      },
      {
        label: '개발·테스트 중 발생한 인증 오류 (현재 정상)',
        note: '서버 재시작 및 개발 테스트 세션 중 발생',
        sql: `status_code=401
                AND path LIKE '/api/admin/dev/%'
                AND (resolved IS NULL OR resolved=0)`,
        params: [],
      },
      {
        label: '테스트 데이터로 인한 404 (존재하지 않는 ID·경로)',
        note: '테스트 코드의 더미 ID/경로 요청',
        sql: `status_code=404
                AND (path LIKE '%99999%' OR path LIKE '%nonexistent%'
                     OR path REGEXP '^/api/[0-9]+$')
                AND (resolved IS NULL OR resolved=0)`,
        params: [],
      },
      {
        label: '테스트 데이터로 인한 400 (잘못된 경로)',
        note: '테스트 코드의 유효하지 않은 경로 요청',
        sql: `status_code=400
                AND (path='/api/abc' OR path='/api/0' OR path='/api/-1'
                     OR path='/api/' OR path='/api')
                AND (resolved IS NULL OR resolved=0)`,
        params: [],
      },
    ];

    const results = [];
    for (const rule of rules) {
      const timeCond = `created_at >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)`;
      const fullSql = `${rule.sql} AND ${timeCond}`;

      const [[{ cnt }]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM access_logs WHERE ${fullSql}`,
        rule.params
      );
      const count = Number(cnt);

      if (!dryRun && count > 0) {
        await pool.query(
          `UPDATE access_logs
             SET resolved=1, resolved_by=?, resolved_at=NOW(), resolve_note=?
           WHERE ${fullSql}`,
          [userId, rule.note, ...rule.params]
        );
      }
      results.push({ label: rule.label, note: rule.note, count, applied: !dryRun && count > 0 });
    }

    const totalAffected = results.reduce((s, r) => s + (r.applied ? r.count : 0), 0);
    const totalPreview = results.reduce((s, r) => s + r.count, 0);

    res.json({
      success: true,
      dryRun,
      totalAffected,
      totalPreview,
      results,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
// 스키마 스냅샷 영구 저장 (페이지 새로고침/서버 재시작 견딤)
//   GET  /dev/schema/snapshot/latest   — 마지막 스냅샷 조회
//   POST /dev/schema/snapshot          — 새 스냅샷 저장 + 백필
//                                         body: { snapshot, is_first }
//                                         is_first=true 면 backfill 모드:
//                                           current 의 모든 테이블 중
//                                           schema_change_log 에 한 번도 등장
//                                           안 한 테이블을 'new_table' 로 기록
// ─────────────────────────────────────────────────────────────
router.get('/dev/schema/snapshot/latest', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, snapshot_json, recorded_at FROM schema_snapshots ORDER BY id DESC LIMIT 1`
    );
    if (rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    const row = rows[0];
    let snapshot = null;
    try {
      snapshot = JSON.parse(row.snapshot_json);
    } catch (_) {
      snapshot = null;
    }
    res.json({ success: true, data: { id: row.id, snapshot, recorded_at: row.recorded_at } });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/schema/snapshot', devOnly, async (req, res) => {
  try {
    const { snapshot, is_first } = req.body || {};
    if (!snapshot || typeof snapshot !== 'object') {
      return res.status(400).json({ success: false, error: 'snapshot 객체 필요' });
    }
    let backfilled = 0;
    if (is_first === true) {
      // 백필: schema_change_log 에 한 번도 등장하지 않은 테이블 식별 → 기록
      const [logged] = await pool.query(
        `SELECT DISTINCT table_name FROM schema_change_log WHERE table_name IS NOT NULL`
      );
      const loggedSet = new Set(logged.map(r => r.table_name));
      const currentTables = Object.keys(snapshot);
      const untracked = currentTables.filter(t => !loggedSet.has(t));
      if (untracked.length > 0) {
        for (const t of untracked) {
          await pool.query(
            `INSERT INTO schema_change_log
               (change_type, table_name, column_name, risk, message, mitigation,
                before_def, after_def, detected_by)
             VALUES ('new_table', ?, NULL, 'LOW',
                     CONCAT('신규 테이블 감지(백필): ', ?),
                     '백필: 영구 스냅샷 도입 이전에 추가된 테이블이 후행 기록됨. 관련 API/페이지 매핑 점검 권장.',
                     NULL, NULL, ?)`,
            [t, t, req.user?.id || null]
          );
          backfilled++;
        }
      }
    }
    // 새 스냅샷 저장 (최근 10개만 유지)
    await pool.query(`INSERT INTO schema_snapshots (snapshot_json, recorded_by) VALUES (?, ?)`, [
      JSON.stringify(snapshot),
      req.user?.id || null,
    ]);
    await pool.query(`
      DELETE FROM schema_snapshots WHERE id NOT IN (
        SELECT id FROM (SELECT id FROM schema_snapshots ORDER BY id DESC LIMIT 10) t
      )
    `);
    res.json({ success: true, backfilled });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/admin/dev/schema/history  — 스키마 변경 이력 기록
//   body: { changes: [{ type, table, col, risk, msg, mitigation, before, after }] }
// ══════════════════════════════════════════════════════════════
router.post('/dev/schema/history', devOnly, async (req, res) => {
  try {
    const { changes } = req.body || {};
    if (!Array.isArray(changes) || !changes.length) return res.json({ success: true, recorded: 0 });
    const userId = req.user?.id || null;

    // 인코딩 깨진 데이터(U+FFFD replacement char) INSERT 거부
    const hasMojibake = s => typeof s === 'string' && /�/.test(s);

    let recorded = 0;
    for (const c of changes) {
      if (!c.type || !c.table || !c.msg) continue;
      if (
        hasMojibake(c.msg) ||
        hasMojibake(c.mitigation) ||
        hasMojibake(c.table) ||
        hasMojibake(c.col)
      ) {
        console.warn('[schema-history] 인코딩 깨진 데이터 INSERT 거부:', c.msg);
        continue;
      }
      // 중복 방지: 동일 (type, table, col, msg) 가 최근 5분 내 있으면 스킵
      const [[dup]] = await pool.query(
        `SELECT id FROM schema_change_log
         WHERE change_type=? AND table_name=? AND COALESCE(column_name,'')=COALESCE(?,'')
           AND message=? AND changed_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
         LIMIT 1`,
        [c.type, c.table, c.col || null, String(c.msg).slice(0, 500)]
      );
      if (dup) continue;

      await pool.query(
        `INSERT INTO schema_change_log
         (change_type, table_name, column_name, risk, message, mitigation, before_def, after_def, detected_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          c.type,
          String(c.table).slice(0, 100),
          c.col ? String(c.col).slice(0, 100) : null,
          c.risk || 'LOW',
          String(c.msg).slice(0, 500),
          c.mitigation ? String(c.mitigation).slice(0, 2000) : null,
          c.before ? String(c.before).slice(0, 500) : null,
          c.after ? String(c.after).slice(0, 500) : null,
          userId,
        ]
      );
      recorded++;
    }
    res.json({ success: true, recorded });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/admin/dev/schema/history  — 변경 이력 조회 (시간 역순)
//   ?table=&type=&risk=&limit=100
// ══════════════════════════════════════════════════════════════
router.get('/dev/schema/history', devOnly, async (req, res) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit) || 100);
    const cond = [];
    const params = [];
    if (req.query.table) {
      cond.push('table_name=?');
      params.push(req.query.table);
    }
    if (req.query.type) {
      cond.push('change_type=?');
      params.push(req.query.type);
    }
    if (req.query.risk) {
      cond.push('risk=?');
      params.push(req.query.risk);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

    const [rows] = await pool.query(
      `SELECT scl.*, tm.name AS detected_by_name
       FROM schema_change_log scl
       LEFT JOIN team_members tm ON scl.detected_by = tm.id
       ${where}
       ORDER BY scl.changed_at DESC LIMIT ?`,
      [...params, limit]
    );

    // 통계
    const [[stats]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN risk='HIGH' THEN 1 ELSE 0 END) AS high_cnt,
              SUM(CASE WHEN risk='MEDIUM' THEN 1 ELSE 0 END) AS medium_cnt,
              SUM(CASE WHEN risk='LOW' THEN 1 ELSE 0 END) AS low_cnt,
              MIN(changed_at) AS first_at, MAX(changed_at) AS last_at
       FROM schema_change_log`
    );

    res.json({ success: true, data: rows, stats });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/admin/dev/schema/coach  — 변경 사항에 대한 AI 영향 분석 + 사전 조치 코칭
//   body: { change_id }
// ══════════════════════════════════════════════════════════════
router.post('/dev/schema/coach', devOnly, async (req, res) => {
  try {
    const { change_id } = req.body || {};
    if (!Number.isFinite(Number(change_id)))
      return res.status(400).json({ success: false, error: 'change_id 필요' });

    const [[change]] = await pool.query('SELECT * FROM schema_change_log WHERE id=?', [change_id]);
    if (!change) return res.status(404).json({ success: false, error: '변경 이력 없음' });

    // 영향 영역 자동 수집: FK 관계 + 컬럼 동시 보유 테이블
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const dbName = dbRow.db;

    const [fkOut] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME=?`,
      [dbName, change.table_name]
    );
    const [fkIn] = await pool.query(
      `SELECT REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_col, COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [dbName, change.table_name]
    );

    // 동일 컬럼명을 가진 다른 테이블 (논리적 연결 가능성)
    let sameNameTables = [];
    if (change.column_name) {
      const [r] = await pool.query(
        `SELECT TABLE_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA=? AND COLUMN_NAME=? AND TABLE_NAME != ?`,
        [dbName, change.column_name, change.table_name]
      );
      sameNameTables = r;
    }

    const ctx = `
[변경 정보]
- 유형: ${change.change_type}
- 테이블: ${change.table_name}
- 컬럼: ${change.column_name || '(없음)'}
- 영향도: ${change.risk}
- 변경 내용: ${change.message}
- 기존 정의: ${change.before_def || '(N/A)'}
- 변경 후: ${change.after_def || '(N/A)'}

[참조 관계 — 이 테이블을 FK로 참조하는 다른 테이블 ${fkOut.length}개]
${fkOut.map(f => `  - ${f.TABLE_NAME}.${f.COLUMN_NAME}`).join('\n') || '  (없음)'}

[이 테이블이 FK로 참조하는 외부 테이블 ${fkIn.length}개]
${fkIn.map(f => `  - ${f.ref_table}.${f.ref_col} ← ${f.COLUMN_NAME}`).join('\n') || '  (없음)'}

[동일 컬럼명을 가진 다른 테이블 ${sameNameTables.length}개]
${sameNameTables.map(t => `  - ${t.TABLE_NAME}.${change.column_name} (${t.COLUMN_TYPE})`).join('\n') || '  (없음)'}`;

    const prompt = `당신은 시니어 DB 아키텍트입니다. CRM 시스템의 DB 스키마 변경 사항을 검토하고, 영향 분석 + 사전 조치 가이드를 제공합니다.
${ctx}

다음 JSON 형식으로만 응답하세요 (마크다운/설명 없이 순수 JSON):
{
  "impact_summary": "이 변경의 영향을 한 줄로 (40자 이내)",
  "affected_areas": [
    { "area": "DB / API / 프론트엔드 / 데이터무결성 등 영역", "description": "구체적 영향 (50자 이내)", "risk": "high" | "medium" | "low" }
  ],
  "pre_action_steps": [
    "변경 전 반드시 수행할 사전 조치 1",
    "변경 전 사전 조치 2",
    "..."
  ],
  "post_action_steps": [
    "변경 후 검증할 항목 1",
    "..."
  ],
  "rollback_plan": "롤백이 필요할 때의 절차 (50자 이내)",
  "test_scenarios": [
    "QA에서 반드시 테스트할 시나리오 1",
    "..."
  ]
}

작성 기준:
- 한국어로 작성, 실무적이고 구체적
- pre_action_steps는 2~5개, post_action_steps는 2~4개
- 영향 없는 영역은 affected_areas에 포함하지 않음
- HIGH 변경은 rollback_plan을 반드시 상세하게`;

    const model = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 1200,
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
        .json({ success: false, error: 'AI 파싱 실패', raw: txt.slice(0, 200) });
    }

    res.json({
      success: true,
      data: {
        ...parsed,
        meta: {
          fk_in_count: fkIn.length,
          fk_out_count: fkOut.length,
          same_name_count: sameNameTables.length,
        },
      },
    });
  } catch (err) {
    console.error('Schema coach error:', err.message);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/admin/dev/schema-relations  — FK + 인덱스 상세 정보 (캐시 30s)
// ══════════════════════════════════════════════════════════════
router.get('/dev/schema-relations', devOnly, async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (!force && _schemaCache.relations && Date.now() - _schemaCache.relTs < SCHEMA_TTL) {
      return res.json({ success: true, data: _schemaCache.relations, cached: true });
    }
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const dbName = dbRow.db;

    // 3개 쿼리 병렬 실행 (information_schema 직렬 → 병렬, ~90ms → ~35ms)
    const [[fks], [indexes], [colComments]] = await Promise.all([
      pool.query(
        `
        SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.CONSTRAINT_NAME,
               kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
               rc.UPDATE_RULE, rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
        WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME`,
        [dbName]
      ),
      pool.query(
        `
        SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME,
               NON_UNIQUE, INDEX_TYPE, SEQ_IN_INDEX
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        [dbName]
      ),
      pool.query(
        `
        SELECT TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND COLUMN_COMMENT != ''
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [dbName]
      ),
    ]);

    const result = { fks, indexes, colComments };
    _schemaCache.relations = result;
    _schemaCache.relTs = Date.now();
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/admin/dev/schema-alter  — DDL 실행 (superadmin, 안전 검증 포함)
// ══════════════════════════════════════════════════════════════
router.post('/dev/schema-alter', devOnly, async (req, res) => {
  try {
    const { sql, dryRun } = req.body;
    if (!sql) return res.status(400).json({ success: false, error: 'SQL이 필요합니다.' });

    const trimmed = sql.trim().toUpperCase();

    // 파괴적 명령 차단
    const BLOCKED = ['DROP TABLE', 'TRUNCATE TABLE', 'DROP DATABASE', 'DROP SCHEMA', 'DELETE FROM'];
    for (const b of BLOCKED) {
      if (trimmed.startsWith(b) || trimmed.includes(' ' + b)) {
        return res.status(400).json({
          success: false,
          error: `'${b}' 명령은 보안상 허용되지 않습니다. DB 관리자에게 문의하세요.`,
        });
      }
    }

    // 허용 명령만 통과
    const ALLOWED = [
      'ALTER TABLE',
      'CREATE TABLE',
      'CREATE INDEX',
      'CREATE UNIQUE INDEX',
      'DROP INDEX',
    ];
    const allowed = ALLOWED.some(a => trimmed.startsWith(a));
    if (!allowed) {
      return res
        .status(400)
        .json({ success: false, error: `허용된 DDL: ALTER TABLE / CREATE TABLE / CREATE INDEX` });
    }

    // Dry-run: 트랜잭션 내 실행 후 ROLLBACK → 실제 변경 없이 구문/권한 검증
    if (dryRun) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(sql); // 구문 오류면 여기서 throw
        await conn.rollback(); // 성공해도 즉시 롤백
        return res.json({ success: true, dryRun: true, sql });
      } catch (dryErr) {
        await conn.rollback().catch(() => {});
        return res.status(400).json({ success: false, dryRun: true, error: dryErr.message });
      } finally {
        conn.release();
      }
    }

    await pool.query(sql);

    // 캐시 즉시 무효화 (DDL 변경 후 /schema 재조회 시 최신 반영)
    _schemaCache.ts = 0;
    _schemaCache.relTs = 0;

    // 스키마 변경 웹소켓 브로드캐스트 (영향도 분석 트리거)
    try {
      const { wsBroadcast } = require('../ws');
      wsBroadcast({ type: 'schema_changed', sql, changedAt: new Date().toISOString() });
    } catch (_) {}

    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
