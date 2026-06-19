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
    header: { health_score: 72, health_grade: 'B+', weighted_expected: 5500000000, won_count: 1, active_count: 2, contract_amount: 8800000000, risks: [{ level: 'high', label: 'CAPA 부족 6,000kg' }, { level: 'medium', label: '품질 이슈 1건' }] },
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
    brief: null,
  },
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/customer360/customers**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIST) })
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
  await expect(page.locator('.lc-card .lc-now')).toContainText('Spec-in');
  await expect(page.locator('.lc-card')).toContainText('CAPA 부족');

  // 수요 → 생산 → 수주 흐름
  await expect(page.locator('.flow')).toContainText('6,000kg');
  await expect(page.locator('.flow')).toContainText('부족 CAPA');

  // AI 액션
  await expect(page.locator('.c360-act')).toContainText('CAPA 재검토');

  // 영업기회 탭
  await page.locator('.c360-tab[data-tab="deals"]').click();
  await expect(page.locator('#c360-tab-body')).toContainText('Fab12 식각가스 공급');
});
