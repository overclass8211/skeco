'use strict';
// =============================================================
// /api/report-builder — 사용자 정의 리포트 빌더 (Phase 2-B-3)
//
// 데이터 소스:
//   - leads (영업 리드) — 차원 8 / 지표 4
//   - projects (프로젝트) — 차원 8 / 지표 5
//   - customers (고객사) — 차원 5 / 지표 5 (LEFT JOIN leads 활용)
//   - activities (영업 활동) — 차원 6 / 지표 1 (활동 유형 한국어 변환 포함)
// 모든 필드 whitelist 기반 (SQL injection 방어)
//
// 권한: team_lead(level 2) 이상만 — RBAC 미들웨어에서 처리
// 데이터 스코프:
//   - leads / projects: manager 는 본인 데이터만 (assigned_to 필터)
//   - activities: manager 는 본인이 수행한 활동만 (performed_by 필터)
//   - customers: 전체 공개 (team_lead+ 만 접근 가능하므로 추가 제약 불필요)
//
// 엔드포인트:
//   GET    /fields              — 사용 가능한 필드 카탈로그
//   POST   /query               — config_json 으로 쿼리 실행 + 차트 데이터 반환
//   GET    /saved               — 본인 저장 리포트 목록
//   GET    /saved/:id           — 단건 조회
//   POST   /saved                 — 저장
//   PUT    /saved/:id           — 수정
//   DELETE /saved/:id           — 삭제
//
// config_json 형식:
//   {
//     datasource: 'leads',
//     rows:    ['stage'],
//     columns: ['region'],            // 선택
//     filters: [{ field, op, value }],
//     measures: ['count' | 'sum_expected_amount' | ...]
//     chartType: 'auto' | 'bar' | 'pie' | 'line' | 'stacked-bar'
//   }
// =============================================================

const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');

// 라우트 전체에 feature flag 적용 — crm.report_builder OFF 시 모든 엔드포인트 차단
router.use(requireFeature('crm.report_builder'));

// ── 자가 마이그레이션 (idempotent) ────────────────────────────
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_definitions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        description VARCHAR(500),
        config_json JSON NOT NULL,
        is_shared TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_report_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (_) {
    /* 이미 존재 — 무시 */
  }
}
const _migrationPromise = ensureSchema();

// ── 데이터 소스 카탈로그 (Phase 2-B-1: leads + projects) ────
// 각 데이터 소스는 자체 필드 whitelist 보유 — SQL injection 방어 유지
// scope.manager: role='manager' 일 때 본인 데이터만 보이도록 필터링하는 컬럼
// joins: 차원/지표에서 외부 테이블 참조 시 사용
const DATASOURCES = {
  leads: {
    label: '영업 리드',
    table: 'leads',
    scope: { manager: 'leads.assigned_to' },
    joins: {
      team: 'LEFT JOIN team_members tm ON tm.id = leads.assigned_to',
    },
    fields: {
      // ─── 차원 ───────────────────────
      stage: {
        type: 'dimension',
        sql: 'leads.stage',
        label: '단계',
        dataType: 'text',
        chartHint: 'bar',
      },
      region: {
        type: 'dimension',
        sql: 'leads.region',
        label: '지역',
        dataType: 'text',
        chartHint: 'pie',
      },
      business_type: {
        type: 'dimension',
        sql: 'leads.business_type',
        label: '사업유형',
        dataType: 'text',
        chartHint: 'pie',
      },
      assigned_name: {
        type: 'dimension',
        sql: 'COALESCE(tm.name, "(미지정)")',
        label: '담당자',
        dataType: 'text',
        chartHint: 'bar',
        join: 'team',
      },
      currency: {
        type: 'dimension',
        sql: 'leads.currency',
        label: '통화',
        dataType: 'text',
        chartHint: 'pie',
      },
      source: {
        type: 'dimension',
        sql: 'COALESCE(leads.source, "(없음)")',
        label: '리드 소스',
        dataType: 'text',
        chartHint: 'pie',
      },
      year_created: {
        type: 'dimension',
        sql: 'YEAR(leads.created_at)',
        label: '등록 연도',
        dataType: 'date',
        chartHint: 'line',
      },
      month_created: {
        type: 'dimension',
        sql: 'DATE_FORMAT(leads.created_at, "%Y-%m")',
        label: '등록 월',
        dataType: 'date',
        chartHint: 'line',
      },
      // ─── 지표 ───────────────────────
      count: { type: 'measure', sql: 'COUNT(*)', label: '건수', dataType: 'number' },
      sum_expected_amount: {
        type: 'measure',
        sql: 'COALESCE(SUM(leads.expected_amount), 0)',
        label: '예상금액 합계',
        dataType: 'number',
      },
      avg_expected_amount: {
        type: 'measure',
        sql: 'COALESCE(AVG(leads.expected_amount), 0)',
        label: '예상금액 평균',
        dataType: 'number',
      },
      sum_capacity_mw: {
        type: 'measure',
        sql: 'COALESCE(SUM(leads.capacity_mw), 0)',
        label: '용량 합계(MW)',
        dataType: 'number',
      },
    },
  },

  // ─── projects (Phase 2-B-1 신규) ────────────────────────
  projects: {
    label: '프로젝트',
    table: 'projects',
    scope: { manager: 'projects.assigned_to' },
    joins: {
      team: 'LEFT JOIN team_members tm ON tm.id = projects.assigned_to',
    },
    fields: {
      // ─── 차원 ───────────────────────
      project_type: {
        type: 'dimension',
        sql: 'COALESCE(projects.project_type, "(미지정)")',
        label: '프로젝트 유형',
        dataType: 'text',
        chartHint: 'pie',
      },
      status: {
        type: 'dimension',
        sql: 'projects.status',
        label: '상태',
        dataType: 'text',
        chartHint: 'bar',
      },
      customer_name: {
        type: 'dimension',
        sql: 'COALESCE(projects.customer_name, "(미지정)")',
        label: '고객사',
        dataType: 'text',
        chartHint: 'bar',
      },
      assigned_name: {
        type: 'dimension',
        sql: 'COALESCE(tm.name, "(미지정)")',
        label: '담당자',
        dataType: 'text',
        chartHint: 'bar',
        join: 'team',
      },
      year_created: {
        type: 'dimension',
        sql: 'YEAR(projects.created_at)',
        label: '등록 연도',
        dataType: 'date',
        chartHint: 'line',
      },
      month_created: {
        type: 'dimension',
        sql: 'DATE_FORMAT(projects.created_at, "%Y-%m")',
        label: '등록 월',
        dataType: 'date',
        chartHint: 'line',
      },
      year_due: {
        type: 'dimension',
        sql: 'YEAR(projects.due_date)',
        label: '납기 연도',
        dataType: 'date',
        chartHint: 'line',
      },
      month_due: {
        type: 'dimension',
        sql: 'DATE_FORMAT(projects.due_date, "%Y-%m")',
        label: '납기 월',
        dataType: 'date',
        chartHint: 'line',
      },
      // ─── 지표 ───────────────────────
      count: { type: 'measure', sql: 'COUNT(*)', label: '건수', dataType: 'number' },
      sum_contract_amount: {
        type: 'measure',
        sql: 'COALESCE(SUM(projects.contract_amount), 0)',
        label: '계약금액 합계',
        dataType: 'number',
      },
      avg_contract_amount: {
        type: 'measure',
        sql: 'COALESCE(AVG(projects.contract_amount), 0)',
        label: '계약금액 평균',
        dataType: 'number',
      },
      sum_estimated_cost: {
        type: 'measure',
        sql: 'COALESCE(SUM(projects.estimated_cost), 0)',
        label: '산정 원가 합계',
        dataType: 'number',
      },
      avg_margin_pct: {
        type: 'measure',
        sql: 'COALESCE(AVG(projects.margin_pct), 0)',
        label: '평균 마진율(%)',
        dataType: 'number',
      },
    },
  },

  // ─── customers (Phase 2-B-2 신규) ──────────────────────────
  // 권한 스코프 없음 — team_lead+ 만 빌더 접근 가능하므로 customers 전체 공개
  // leads JOIN 활용 — 고객사 별 리드/매출 분석 가능
  // count 지표는 COUNT(DISTINCT customers.id) — LEFT JOIN 시 중복 방지
  customers: {
    label: '고객사',
    table: 'customers',
    scope: { manager: null }, // null = 스코프 없음 (자동 skip)
    joins: {
      leads: 'LEFT JOIN leads ON leads.customer_id = customers.id',
    },
    fields: {
      // ─── 차원 ───────────────────────
      region: {
        type: 'dimension',
        sql: 'customers.region',
        label: '지역(국내/해외)',
        dataType: 'text',
        chartHint: 'pie',
      },
      country: {
        type: 'dimension',
        sql: 'COALESCE(customers.country, "(미지정)")',
        label: '국가',
        dataType: 'text',
        chartHint: 'pie',
      },
      industry: {
        type: 'dimension',
        sql: 'COALESCE(customers.industry, "(미지정)")',
        label: '산업',
        dataType: 'text',
        chartHint: 'pie',
      },
      year_created: {
        type: 'dimension',
        sql: 'YEAR(customers.created_at)',
        label: '등록 연도',
        dataType: 'date',
        chartHint: 'line',
      },
      month_created: {
        type: 'dimension',
        sql: 'DATE_FORMAT(customers.created_at, "%Y-%m")',
        label: '등록 월',
        dataType: 'date',
        chartHint: 'line',
      },
      // ─── 지표 ───────────────────────
      // COUNT(DISTINCT customers.id) — leads LEFT JOIN 시 중복 방지
      count: {
        type: 'measure',
        sql: 'COUNT(DISTINCT customers.id)',
        label: '고객사 수',
        dataType: 'number',
      },
      // 아래 지표들은 leads JOIN 필요
      lead_count: {
        type: 'measure',
        sql: 'COUNT(leads.id)',
        label: '관련 리드 수',
        dataType: 'number',
        join: 'leads',
      },
      active_lead_count: {
        type: 'measure',
        sql: "SUM(CASE WHEN leads.stage NOT IN ('won','lost','dropped') THEN 1 ELSE 0 END)",
        label: '진행 중 리드 수',
        dataType: 'number',
        join: 'leads',
      },
      won_lead_count: {
        type: 'measure',
        sql: "SUM(CASE WHEN leads.stage = 'won' THEN 1 ELSE 0 END)",
        label: '수주 리드 수',
        dataType: 'number',
        join: 'leads',
      },
      sum_expected_amount: {
        type: 'measure',
        sql: 'COALESCE(SUM(leads.expected_amount), 0)',
        label: '예상금액 합계',
        dataType: 'number',
        join: 'leads',
      },
    },
  },

  // ─── activities (Phase 2-B-3 신규) ─────────────────────────
  // 영업 활동 분석 — 미팅/통화/방문/제안/입찰/메모 등 분포 + 담당자별 활동량 + 시간 추세
  // 권한 스코프: manager 는 본인이 수행한 활동만 (performed_by 필터)
  // 한국어 라벨 변환: activity_type 의 영문 키를 사용자 친화적 한국어로 표시
  activities: {
    label: '영업 활동',
    table: 'activities',
    scope: { manager: 'activities.performed_by' },
    joins: {
      team: 'LEFT JOIN team_members tm ON tm.id = activities.performed_by',
    },
    fields: {
      // ─── 차원 ───────────────────────
      activity_type: {
        type: 'dimension',
        sql: `CASE activities.activity_type
              WHEN 'meeting' THEN '미팅'
              WHEN 'site_visit' THEN '영업방문'
              WHEN 'proposal' THEN '제안'
              WHEN 'bidding' THEN '입찰'
              WHEN 'call' THEN '통화'
              WHEN 'email' THEN '이메일'
              WHEN 'note' THEN '메모'
              ELSE COALESCE(activities.activity_type, '(미지정)') END`,
        label: '활동 유형',
        dataType: 'text',
        chartHint: 'pie',
      },
      performed_by_name: {
        type: 'dimension',
        sql: 'COALESCE(tm.name, "(미지정)")',
        label: '담당자',
        dataType: 'text',
        chartHint: 'bar',
        join: 'team',
      },
      year_performed: {
        type: 'dimension',
        sql: 'YEAR(activities.performed_at)',
        label: '수행 연도',
        dataType: 'date',
        chartHint: 'line',
      },
      month_performed: {
        type: 'dimension',
        sql: 'DATE_FORMAT(activities.performed_at, "%Y-%m")',
        label: '수행 월',
        dataType: 'date',
        chartHint: 'line',
      },
      has_lead: {
        type: 'dimension',
        sql: "CASE WHEN activities.lead_id IS NOT NULL THEN 'Y' ELSE 'N' END",
        label: '리드 연결 여부',
        dataType: 'text',
        chartHint: 'pie',
      },
      has_project: {
        type: 'dimension',
        sql: "CASE WHEN activities.project_id IS NOT NULL THEN 'Y' ELSE 'N' END",
        label: '프로젝트 연결 여부',
        dataType: 'text',
        chartHint: 'pie',
      },
      // ─── 지표 ───────────────────────
      count: {
        type: 'measure',
        sql: 'COUNT(*)',
        label: '활동 건수',
        dataType: 'number',
      },
    },
  },

  // ─── support (고객지원 A/S — 리포트 연동) ─────────────────────
  // 상태/유형/우선순위/채널 라벨은 support_settings(설정형) JOIN 으로 실시간 반영
  //   → 관리자가 항목을 추가/이름변경해도 자동 반영 (CASE 하드코딩 회피)
  // 모든 JOIN 이 1:1 (UNIQUE(kind,item_key) / PK id) 이라 COUNT(*) 왜곡 없음
  support: {
    label: '고객지원(A/S)',
    table: 'support_tickets',
    scope: { manager: 'support_tickets.assigned_to' },
    joins: {
      team: 'LEFT JOIN team_members tm ON tm.id = support_tickets.assigned_to',
      creator: 'LEFT JOIN team_members cb ON cb.id = support_tickets.created_by',
      customer: 'LEFT JOIN customers cu ON cu.id = support_tickets.customer_id',
      st_status:
        "LEFT JOIN support_settings ss_st ON ss_st.kind='status' AND ss_st.item_key=support_tickets.status",
      st_type:
        "LEFT JOIN support_settings ss_ty ON ss_ty.kind='type' AND ss_ty.item_key=support_tickets.type",
      st_priority:
        "LEFT JOIN support_settings ss_pr ON ss_pr.kind='priority' AND ss_pr.item_key=support_tickets.priority",
      st_channel:
        "LEFT JOIN support_settings ss_ch ON ss_ch.kind='channel' AND ss_ch.item_key=support_tickets.channel",
    },
    fields: {
      // ─── 차원 ───────────────────────
      status: {
        type: 'dimension',
        sql: "COALESCE(ss_st.label, support_tickets.status, '(미지정)')",
        label: '상태',
        dataType: 'text',
        chartHint: 'bar',
        join: 'st_status',
      },
      status_category: {
        type: 'dimension',
        sql: "CASE ss_st.category WHEN 'open' THEN '진행' WHEN 'pending' THEN '보류' WHEN 'closed' THEN '종결' ELSE '(미지정)' END",
        label: '상태분류',
        dataType: 'text',
        chartHint: 'pie',
        join: 'st_status',
      },
      type: {
        type: 'dimension',
        sql: "COALESCE(ss_ty.label, support_tickets.type, '(미지정)')",
        label: '유형',
        dataType: 'text',
        chartHint: 'pie',
        join: 'st_type',
      },
      priority: {
        type: 'dimension',
        sql: "COALESCE(ss_pr.label, support_tickets.priority, '(미지정)')",
        label: '우선순위',
        dataType: 'text',
        chartHint: 'bar',
        join: 'st_priority',
      },
      channel: {
        type: 'dimension',
        sql: "COALESCE(ss_ch.label, support_tickets.channel, '(미지정)')",
        label: '접수채널',
        dataType: 'text',
        chartHint: 'pie',
        join: 'st_channel',
      },
      assigned_name: {
        type: 'dimension',
        sql: "COALESCE(tm.name, '(미지정)')",
        label: '처리담당자',
        dataType: 'text',
        chartHint: 'bar',
        join: 'team',
      },
      creator_name: {
        type: 'dimension',
        sql: "COALESCE(cb.name, '(미지정)')",
        label: '접수자',
        dataType: 'text',
        chartHint: 'bar',
        join: 'creator',
      },
      customer_name: {
        type: 'dimension',
        sql: "COALESCE(cu.name, '(미지정)')",
        label: '고객사',
        dataType: 'text',
        chartHint: 'bar',
        join: 'customer',
      },
      year_created: {
        type: 'dimension',
        sql: 'YEAR(support_tickets.created_at)',
        label: '접수 연도',
        dataType: 'date',
        chartHint: 'line',
      },
      month_created: {
        type: 'dimension',
        sql: 'DATE_FORMAT(support_tickets.created_at, "%Y-%m")',
        label: '접수 월',
        dataType: 'date',
        chartHint: 'line',
      },
      // ─── 지표 ───────────────────────
      count: { type: 'measure', sql: 'COUNT(*)', label: '건수', dataType: 'number' },
      open_count: {
        type: 'measure',
        sql: 'SUM(CASE WHEN COALESCE(ss_st.is_final, 0) = 0 THEN 1 ELSE 0 END)',
        label: '미해결 건수',
        dataType: 'number',
        join: 'st_status',
      },
      resolved_count: {
        type: 'measure',
        sql: 'SUM(CASE WHEN ss_st.is_final = 1 THEN 1 ELSE 0 END)',
        label: '종결 건수',
        dataType: 'number',
        join: 'st_status',
      },
      overdue_count: {
        type: 'measure',
        sql: 'SUM(CASE WHEN support_tickets.due_at IS NOT NULL AND support_tickets.due_at < NOW() AND COALESCE(ss_st.is_final, 0) = 0 THEN 1 ELSE 0 END)',
        label: '기한초과 건수',
        dataType: 'number',
        join: 'st_status',
      },
      avg_satisfaction: {
        type: 'measure',
        sql: 'ROUND(AVG(support_tickets.satisfaction), 2)',
        label: '평균 만족도(CSAT)',
        dataType: 'number',
      },
    },
  },
};

// ── 헬퍼 — datasource 기반 ──────────────────────────────────
function getDatasource(dsKey) {
  return DATASOURCES[dsKey] || null;
}
function fieldOf(dsKey, fieldKey) {
  return DATASOURCES[dsKey]?.fields?.[fieldKey] || null;
}
function isDimensionOf(dsKey, fieldKey) {
  return fieldOf(dsKey, fieldKey)?.type === 'dimension';
}
function isMeasureOf(dsKey, fieldKey) {
  return fieldOf(dsKey, fieldKey)?.type === 'measure';
}

// ── 필터 연산자 whitelist ───────────────────────────────────
const FILTER_OPS = {
  eq: '=',
  ne: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  like: 'LIKE',
  in: 'IN',
};

// ── 자동 차트 타입 추천 (datasource 인자 추가) ───────────────
function suggestChartType(dsKey, rows, columns, measures) {
  const rowCount = rows.length;
  const colCount = columns.length;
  const measureCount = measures.length;

  if (measureCount === 0) return 'bar';

  // 행 1개 + 열 1개 → stacked-bar
  if (rowCount === 1 && colCount === 1) return 'stacked-bar';

  // 행 1개 + 열 0개
  if (rowCount === 1 && colCount === 0) {
    const rowField = fieldOf(dsKey, rows[0]);
    if (rowField && rowField.dataType === 'date') return 'line';
    return rowField?.chartHint || 'bar';
  }

  return 'bar';
}

// ── 사용자 권한 → 데이터 스코프 결정 ───────────────────────
async function getUserScope(userId) {
  if (!userId) return { isManager: true };
  const [[u]] = await pool.query('SELECT role FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!u) return { isManager: true };
  return { isManager: u.role === 'manager' };
}

// ── GET /fields — 필드 카탈로그 (datasource 별) ──────────────
// Query param: ?datasource=leads|projects (default: leads)
router.get('/fields', (req, res) => {
  try {
    const dsKey = String(req.query.datasource || 'leads');
    const ds = getDatasource(dsKey);
    if (!ds) {
      return res.status(400).json({ success: false, error: `지원하지 않는 데이터 소스: ${dsKey}` });
    }

    const dimensions = [];
    const measures = [];
    for (const [key, def] of Object.entries(ds.fields)) {
      const item = { key, label: def.label, dataType: def.dataType };
      if (def.chartHint) item.chartHint = def.chartHint;
      if (def.type === 'dimension') dimensions.push(item);
      else measures.push(item);
    }
    res.json({
      success: true,
      data: {
        datasource: dsKey,
        datasources: Object.entries(DATASOURCES).map(([k, v]) => ({ key: k, label: v.label })),
        dimensions,
        measures,
        filter_ops: Object.keys(FILTER_OPS),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /values — 필터용 차원 distinct 값 목록 ─────────────
// Query: ?datasource=leads&field=stage&limit=100
// 응답: { success: true, data: ['lead','review','won',...] }
// 권한: manager 는 본인 데이터 범위에서만 distinct 값 추출 (스코프 적용)
// 보안: 차원 필드 whitelist 검증 (SQL injection 방어)
router.get('/values', async (req, res) => {
  try {
    const userId = getUserId(req);
    const dsKey = String(req.query.datasource || 'leads');
    const fieldKey = String(req.query.field || '');
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));

    const ds = getDatasource(dsKey);
    if (!ds) {
      return res.status(400).json({ success: false, error: `지원하지 않는 데이터 소스: ${dsKey}` });
    }
    if (!isDimensionOf(dsKey, fieldKey)) {
      return res
        .status(400)
        .json({ success: false, error: `차원 필드가 아니거나 알 수 없는 필드: ${fieldKey}` });
    }

    const fld = fieldOf(dsKey, fieldKey);

    // JOIN 빌더 — 필드가 외부 join 의존 시 함께 적용 (예: leads.assigned_name → team)
    let fromClause = `FROM ${ds.table}`;
    if (fld.join && ds.joins?.[fld.join]) {
      fromClause += ' ' + ds.joins[fld.join];
    }

    // 권한 스코프
    const whereParts = [];
    const params = [];
    const scope = await getUserScope(userId);
    if (scope.isManager && ds.scope?.manager) {
      whereParts.push(`${ds.scope.manager} = (SELECT id FROM team_members WHERE id = ? LIMIT 1)`);
      params.push(userId);
    }
    // NULL 제외 (DISTINCT 시 NULL 도 한 값으로 잡히므로 명시적 제외)
    whereParts.push(`${fld.sql} IS NOT NULL`);
    const whereSql = `WHERE ${whereParts.join(' AND ')}`;
    params.push(limit);

    const sql = `
      SELECT DISTINCT ${fld.sql} AS value
      ${fromClause}
      ${whereSql}
      ORDER BY value ASC
      LIMIT ?
    `;
    const [rows] = await pool.query(sql, params);
    res.json({
      success: true,
      data: rows.map(r => r.value).filter(v => v !== null && v !== ''),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 공통 헬퍼: config 검증 + SQL 빌드 + 실행 ─────────────────
// query/export 모두 동일한 검증/스코프/SQL 로직 사용
// 반환: { ok: true, dsKey, ds, rows, columns, filters, measures, data } 또는
//      { ok: false, status, error }
async function _buildAndRunQuery(config, userId) {
  const dsKey = config.datasource || 'leads';
  const ds = getDatasource(dsKey);
  if (!ds) {
    return { ok: false, status: 400, error: `지원하지 않는 데이터 소스: ${dsKey}` };
  }

  // datasource 별 whitelist 필터링 — 다른 소스 키가 섞여도 자동 drop
  const rows = Array.isArray(config.rows) ? config.rows.filter(k => isDimensionOf(dsKey, k)) : [];
  const columns = Array.isArray(config.columns)
    ? config.columns.filter(k => isDimensionOf(dsKey, k))
    : [];
  const filters = Array.isArray(config.filters) ? config.filters : [];
  const measures = Array.isArray(config.measures)
    ? config.measures.filter(k => isMeasureOf(dsKey, k))
    : [];

  if (rows.length === 0 && measures.length === 0) {
    return { ok: false, status: 400, error: '최소 1개의 차원(행) 또는 지표가 필요합니다' };
  }
  if (rows.length > 1) {
    return { ok: false, status: 400, error: '행(Row)은 1개만 지원됩니다 (Phase 1)' };
  }
  if (columns.length > 1) {
    return { ok: false, status: 400, error: '열(Column)은 1개만 지원됩니다 (Phase 1)' };
  }
  if (measures.length > 3) {
    return { ok: false, status: 400, error: '지표는 최대 3개까지 지원됩니다' };
  }

  // ── SELECT 절 ────────────────────────────────────────
  const selectParts = [];
  const groupParts = [];
  if (rows[0]) {
    selectParts.push(`${fieldOf(dsKey, rows[0]).sql} AS row_key`);
    groupParts.push(fieldOf(dsKey, rows[0]).sql);
  }
  if (columns[0]) {
    selectParts.push(`${fieldOf(dsKey, columns[0]).sql} AS col_key`);
    groupParts.push(fieldOf(dsKey, columns[0]).sql);
  }
  for (const m of measures) {
    selectParts.push(`${fieldOf(dsKey, m).sql} AS ${m}`);
  }

  // ── FROM + JOIN (다중 join 키 지원) ──────────────────
  const usedJoins = new Set();
  [...rows, ...columns, ...measures].forEach(k => {
    const jn = fieldOf(dsKey, k)?.join;
    if (jn) usedJoins.add(jn);
  });
  filters.forEach(f => {
    const jn = fieldOf(dsKey, f?.field)?.join;
    if (jn) usedJoins.add(jn);
  });
  let fromClause = `FROM ${ds.table}`;
  for (const jn of usedJoins) {
    if (ds.joins?.[jn]) fromClause += ' ' + ds.joins[jn];
  }

  // ── WHERE 절 (권한 스코프 + 사용자 필터) ──────────────
  const whereParts = [];
  const params = [];
  const scope = await getUserScope(userId);
  if (scope.isManager && ds.scope?.manager) {
    whereParts.push(`${ds.scope.manager} = (SELECT id FROM team_members WHERE id = ? LIMIT 1)`);
    params.push(userId);
  }
  for (const f of filters) {
    if (!f || !isDimensionOf(dsKey, f.field) || !FILTER_OPS[f.op]) continue;
    const fSql = fieldOf(dsKey, f.field).sql;
    const op = FILTER_OPS[f.op];
    if (f.op === 'in' && Array.isArray(f.value)) {
      if (f.value.length === 0) continue;
      const placeholders = f.value.map(() => '?').join(',');
      whereParts.push(`${fSql} IN (${placeholders})`);
      params.push(...f.value);
    } else if (f.op === 'like') {
      whereParts.push(`${fSql} ${op} ?`);
      params.push(`%${f.value}%`);
    } else {
      whereParts.push(`${fSql} ${op} ?`);
      params.push(f.value);
    }
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const groupSql = groupParts.length ? `GROUP BY ${groupParts.join(', ')}` : '';
  const orderSql = groupParts.length ? `ORDER BY ${groupParts[0]}` : '';

  const sql = `
    SELECT ${selectParts.join(', ')}
    ${fromClause}
    ${whereSql}
    ${groupSql}
    ${orderSql}
    LIMIT 500
  `;
  const [data] = await pool.query(sql, params);
  return { ok: true, dsKey, ds, rows, columns, filters, measures, data };
}

// ── POST /query — 리포트 실행 (datasource 동적 빌드) ─────────
router.post('/query', async (req, res) => {
  try {
    const userId = getUserId(req);
    const config = req.body || {};
    const result = await _buildAndRunQuery(config, userId);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: result.error });
    }
    const { dsKey, rows, columns, filters, measures, data } = result;

    // ── 차트 타입 결정 ────────────────────────────────────
    const chartType =
      config.chartType === 'auto' || !config.chartType
        ? suggestChartType(dsKey, rows, columns, measures)
        : config.chartType;

    res.json({
      success: true,
      data: {
        rows: data,
        config: { datasource: dsKey, rows, columns, filters, measures, chartType },
        meta: {
          rowCount: data.length,
          fields: [...rows, ...columns, ...measures].map(k => ({
            key: k,
            label: fieldOf(dsKey, k).label,
          })),
        },
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /export — 리포트 내보내기 (Excel / CSV / JSON)
//
// Body: config_json (저장된 리포트와 동일 구조)
// Query: ?format=xlsx|csv|json (기본 xlsx)
//        ?name=<filename without ext> (기본: report_YYYYMMDD)
//
// 권한: team_lead 이상 (autoLevel 미들웨어 자동 적용)
// 보안: _buildAndRunQuery 헬퍼 재사용 — 동일한 whitelist + scope 검증
// ─────────────────────────────────────────────────────────────
router.post('/export', async (req, res) => {
  try {
    const userId = getUserId(req);
    const config = req.body || {};
    const format = normalizeFormat(req.query.format);
    const result = await _buildAndRunQuery(config, userId);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: result.error });
    }
    const { dsKey, rows, columns, measures, data } = result;

    // 컬럼 정의 — exportHelper.sendExport 의 columns 형식: [{ key, label }]
    const exportColumns = [];
    if (rows[0]) exportColumns.push({ key: 'row_key', label: fieldOf(dsKey, rows[0]).label });
    if (columns[0]) exportColumns.push({ key: 'col_key', label: fieldOf(dsKey, columns[0]).label });
    for (const m of measures) {
      exportColumns.push({ key: m, label: fieldOf(dsKey, m).label });
    }

    // 파일명 — 사용자 지정 또는 기본 (report_YYYYMMDD)
    const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rawName = String(req.query.name || '').trim() || `report_${yyyymmdd}`;
    const filename = rawName;
    const sheetName = String(req.query.name || '리포트').slice(0, 30); // Excel sheet 이름 30자 제한

    await sendExport(res, {
      columns: exportColumns,
      rows: data,
      sheetName,
      filename,
      format,
      meta: {
        datasource: getDatasource(dsKey)?.label || dsKey,
        rowCount: data.length,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /saved — 본인 저장 리포트 목록 ───────────────────────
router.get('/saved', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });

    const [rows] = await pool.query(
      `SELECT id, name, description, config_json, is_shared, created_at, updated_at
         FROM report_definitions
        WHERE user_id = ?
        ORDER BY updated_at DESC`,
      [userId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /saved/:id — 단건 조회 ───────────────────────────────
router.get('/saved/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [[row]] = await pool.query(
      `SELECT id, name, description, config_json, is_shared, created_at, updated_at
         FROM report_definitions
        WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (!row) return res.status(404).json({ success: false, error: '리포트를 찾을 수 없음' });
    res.json({ success: true, data: row });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /saved — 신규 저장 ──────────────────────────────────
router.post('/saved', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });

    const { name, description, config_json } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: '리포트 이름이 필요합니다' });
    }
    if (!config_json || typeof config_json !== 'object') {
      return res
        .status(400)
        .json({ success: false, error: '리포트 설정(config_json)이 필요합니다' });
    }

    const [result] = await pool.query(
      `INSERT INTO report_definitions (user_id, name, description, config_json, is_shared)
       VALUES (?, ?, ?, ?, 0)`,
      [
        userId,
        String(name).slice(0, 150),
        description ? String(description).slice(0, 500) : null,
        JSON.stringify(config_json),
      ]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── PUT /saved/:id — 수정 ────────────────────────────────────
router.put('/saved/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const { name, description, config_json } = req.body || {};
    const updates = [];
    const params = [];
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(String(name).slice(0, 150));
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? String(description).slice(0, 500) : null);
    }
    if (config_json !== undefined) {
      updates.push('config_json = ?');
      params.push(JSON.stringify(config_json));
    }
    if (!updates.length) {
      return res.status(400).json({ success: false, error: '변경 사항이 없습니다' });
    }
    params.push(id, userId);

    const [result] = await pool.query(
      `UPDATE report_definitions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, error: '리포트를 찾을 수 없거나 권한이 없습니다' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── DELETE /saved/:id — 삭제 ─────────────────────────────────
router.delete('/saved/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [result] = await pool.query(
      'DELETE FROM report_definitions WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, error: '리포트를 찾을 수 없거나 권한이 없습니다' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
module.exports._migrationPromise = _migrationPromise;
