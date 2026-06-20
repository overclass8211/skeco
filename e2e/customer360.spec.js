// =============================================================
// E2E — 고객·제품 360뷰 (라이프사이클) 메인메뉴 페이지
//
// 검증: 메뉴 진입 → 고객 선택 → 헤더 + 내러티브 + 라이프사이클 보드(리본)
//        + 수요·생산·수주 흐름 + 영업기회 탭 전환
//   - /api/customer360/* 은 mock (결정적)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const CID = 970360;
const LIST = {
  success: true,
  data: [{ id: CID, name: 'E2E360고객', industry: '반도체', region: '국내', country: '대한민국', open_deals: 2, pipeline_amount: 9000000000 }],
};
const DETAIL = {
  success: true,
  data: {
    customer: { id: CID, name: 'E2E360고객', industry: '반도체', region: '국내', country: '대한민국' },
    header: { health_score: 72, health_grade: 'B+', weighted_expected: 5500000000, won_count: 1, active_count: 2, contract_amount: 8800000000, revenue_breakdown: { month: 400000000, quarter: 1200000000, annual: 2400000000 }, risks: [{ level: 'high', label: 'CAPA 부족 6,000kg' }, { level: 'medium', label: '품질 이슈 1건' }] },
    summary: {
      deals: { count: 3, total_expected: 20000000000 },
      quotes: { count: 2, total_amount: 17600000000 },
      proposals: { count: 2, total_expected: 16000000000 },
      contracts: { count: 1, total_amount: 8800000000, active_count: 1 },
      payments: { count: 0, overdue_count: 0 },
      support: { count: 1, open_count: 1 },
      activities: { count: 4 },
    },
    materials: [],
    deals: [
      { id: 555, project_name: 'Fab12 식각가스 공급', business_type: '식각가스', stage: 'won', stage_label: '수주 완료', stage_role: 'won', expected_amount: 8800000000, probability: 100, weighted: 8800000000, expected_close_date: '2026-05-15', owner_name: '한해외' },
    ],
    pipeline: [{ stage: '수주 완료', role: 'won', count: 1, amount: 8800000000 }],
    timeline: [{ type: 'contract', title: '계약 C-2026-1003 Fab12', date: '2026-05-15', amount: 8800000000, status: 'active' }],
    lifecycle: {
      materials: [
        { id: 11, material_name: '식각가스 C4F6 · Fab12', business_type: '식각가스', fab_line: '평택 P3', lifecycle_stage: 'specin', lifecycle_label: 'Spec-in', lifecycle_index: 3, expected_mp_date: '2026-08-01', monthly_demand: 2000, demand_unit: 'kg', win_probability: 80, quarter_demand: 6000, quarter_capacity: 5000, quarter_expected_order: 4000000000, capa_short: true, open_quality: 1 },
      ],
      demand_flow: { demand: 6000, capacity: 5000, gap: 1000, expected_order: 4000000000, unit: 'kg', demand_label: '6,000kg', capacity_label: '5,000kg', gap_label: '1,000kg' },
      quality: [{ id: 1, case_no: 'Q-2026-2001', material_id: 11, type: 'VOC', severity: 'high', status: 'open', title: '식각가스 순도 편차', opened_at: '2026-06-10' }],
      actions: [{ icon: 'factory', text: '생산팀에 CAPA 재검토 요청 — 식각가스 C4F6 분기 수요 6,000kg 대비 부족' }],
    },
    organization: {
      sites: [{ id: 1, site_name: '평택', line: 'P3', process: '식각', region: '국내' }],
      contacts: [{ id: 1, name: '김구매', role: '구매', dept: '구매팀', email: 'kim@e2e.test', phone: '02-000', is_primary: 1 }],
    },
    brief: null,
  },
};

const FORECAST = {
  success: true,
  data: {
    months: ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'],
    materials: [
      {
        id: 11, material_name: '식각가스 C4F6 · Fab12', business_type: '식각가스', unit: 'kg',
        rows: {
          '2026-07': { customer_forecast: 2000, internal_forecast: 1800, production_capacity: 1900, gap: -100, expected_revenue: 400000000, win_probability: 80 },
          '2026-08': { customer_forecast: 2200, internal_forecast: 2000, production_capacity: 2100, gap: -100, expected_revenue: 400000000, win_probability: 80 },
          '2026-09': { customer_forecast: 0, internal_forecast: 0, production_capacity: null, gap: null, expected_revenue: 0, win_probability: null },
          '2026-10': { customer_forecast: 0, internal_forecast: 0, production_capacity: null, gap: null, expected_revenue: 0, win_probability: null },
          '2026-11': { customer_forecast: 0, internal_forecast: 0, production_capacity: null, gap: null, expected_revenue: 0, win_probability: null },
          '2026-12': { customer_forecast: 0, internal_forecast: 0, production_capacity: null, gap: null, expected_revenue: 0, win_probability: null },
        },
      },
    ],
    totals: {
      '2026-07': { customer: 2000, internal: 1800, capacity: 1900, expected: 400000000 },
      '2026-08': { customer: 2200, internal: 2000, capacity: 2100, expected: 400000000 },
      '2026-09': { customer: 0, internal: 0, capacity: 0, expected: 0 },
      '2026-10': { customer: 0, internal: 0, capacity: 0, expected: 0 },
      '2026-11': { customer: 0, internal: 0, capacity: 0, expected: 0 },
      '2026-12': { customer: 0, internal: 0, capacity: 0, expected: 0 },
    },
    versions: [{ id: 7, label: '2026-06 기준본', version_type: 'baseline', note: null, created_at: '2026-06-15', item_count: 6 }],
  },
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/customer360/customers**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIST) })
  );
  await page.route(`**/api/customer360/${CID}/forecast`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FORECAST) })
  );
  await page.route(`**/api/customer360/${CID}/revenue`, route =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          funnel: [
            { key: 'forecast', label: 'Forecast (가중 예상매출)', amount: 6160000000 },
            { key: 'order', label: '수주 (유효 계약)', amount: 8800000000, count: 1 },
            { key: 'sales', label: '매출 인식', amount: 5600000000 },
            { key: 'collection', label: '수금', amount: 2640000000 },
          ],
          ar: 3520000000, overdue: { count: 0, amount: 0 }, gap: -2640000000, conversion: 143,
        },
      }),
    })
  );
  await page.route(`**/api/customer360/${CID}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAIL) })
  );
});

test('고객·제품 360뷰 — 라이프사이클 보드 + 수요·생산·수주 + 탭', async ({ page }) => {
  await page.goto('/#customer360');
  await page.waitForSelector('#c360-select', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#c360-select option').length > 1, { timeout: 10000 });
  await page.selectOption('#c360-select', String(CID));

  // 헤더 + 내러티브
  await expect(page.locator('.c360-grade')).toHaveText('B+', { timeout: 5000 });
  await expect(page.locator('.c360-narr')).toContainText('양산 승인 임박');
  await expect(page.locator('.c360-head')).toContainText('CAPA 부족');

  // 라이프사이클 보드(소재 카드 + 리본)
  await expect(page.locator('.lc-card')).toHaveCount(1);
  await expect(page.locator('.lc-card')).toContainText('식각가스 C4F6');
  await expect(page.locator('.lc-card .ss-now')).toContainText('Spec-in');
  await expect(page.locator('.lc-card')).toContainText('CAPA 부족');

  // 수요 → 생산 → 수주 흐름
  await expect(page.locator('.flow')).toContainText('6,000kg');
  await expect(page.locator('.flow')).toContainText('부족 CAPA');

  // AI 액션
  await expect(page.locator('.c360-act')).toContainText('CAPA 재검토');

  // 상거래 탭 = 영업기회 + 포캐스트 + 계약/매출/수금 (통합)
  await page.locator('.c360-tab[data-tab="commercial"]').click();
  // 영업기회
  await expect(page.locator('#c360-tab-body')).toContainText('Fab12 식각가스 공급');
  // 포캐스트 — 고객/내부 분리 + 버전 + 합계
  await expect(page.locator('#c360-fc')).toContainText('고객 Forecast', { timeout: 5000 });
  await expect(page.locator('#c360-fc')).toContainText('내부 보정');
  await expect(page.locator('#fc-ver')).toBeVisible();
  await expect(page.locator('#fc-snapshot')).toBeVisible();
  await expect(page.locator('#c360-fc')).toContainText('2026-06 기준본');
  // 계약/매출/수금 — Forecast→수주→매출→수금 funnel
  await expect(page.locator('#c360-rev')).toContainText('Forecast → 수주', { timeout: 5000 });
  await expect(page.locator('#c360-rev')).toContainText('매출 인식');
  await expect(page.locator('#c360-rev')).toContainText('수금');

  // 관계 탭 = 조직 + 활동 (통합) — 사업장 + 담당자
  await page.locator('.c360-tab[data-tab="relationship"]').click();
  await expect(page.locator('#c360-tab-body')).toContainText('평택');
  await expect(page.locator('#c360-tab-body')).toContainText('김구매');
  await expect(page.locator('#site-add')).toBeVisible();
});
