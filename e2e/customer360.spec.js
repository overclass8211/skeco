// =============================================================
// E2E — 고객·제품 360뷰 (MVP) 메인메뉴 페이지
//
// 검증: 메뉴 진입 → 고객 선택 → 헤더(등급/가중매출) + 5탭 렌더 + 탭 전환
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
    header: { health_score: 79, health_grade: 'B+', weighted_expected: 5500000000, won_count: 1, active_count: 2, contract_amount: 8800000000, risks: [{ level: 'medium', label: '미해결 지원 1건' }] },
    summary: {
      deals: { count: 3, total_expected: 20000000000 },
      quotes: { count: 2, total_amount: 17600000000 },
      proposals: { count: 2, total_expected: 16000000000 },
      contracts: { count: 1, total_amount: 8800000000, active_count: 1 },
      payments: { count: 0, overdue_count: 0 },
      support: { count: 1, open_count: 1 },
      activities: { count: 4 },
    },
    materials: [
      { business_type: '식각가스', count: 1, total_expected: 8800000000, weighted: 8800000000, stages: { '수주 완료': 1 }, won: 1 },
    ],
    deals: [
      { id: 555, project_name: 'Fab12 식각가스 공급', business_type: '식각가스', stage: 'won', stage_label: '수주 완료', stage_role: 'won', expected_amount: 8800000000, probability: 100, weighted: 8800000000, expected_close_date: '2026-05-15', owner_name: '한해외' },
    ],
    pipeline: [{ stage: '수주 완료', role: 'won', count: 1, amount: 8800000000 }],
    timeline: [{ type: 'contract', title: '계약 C-2026-1003 Fab12', date: '2026-05-15', amount: 8800000000, status: 'active' }],
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

test('고객·제품 360뷰 — 고객 선택 → 헤더 + 5탭 렌더', async ({ page }) => {
  await page.goto('/#customer360');
  await page.waitForSelector('#c360-select', { timeout: 15000 });

  // 선택기 옵션 로드 대기 후 고객 선택
  await page.waitForFunction(
    () => document.querySelectorAll('#c360-select option').length > 1,
    { timeout: 10000 }
  );
  await page.selectOption('#c360-select', String(CID));

  // 헤더: 등급 + 가중 예상매출
  await expect(page.locator('.c360-grade')).toHaveText('B+', { timeout: 5000 });
  await expect(page.locator('.c360-head')).toContainText('가중 예상매출');
  await expect(page.locator('.c360-head')).toContainText('미해결 지원 1건');

  // 탭 5개
  await expect(page.locator('.c360-tab')).toHaveCount(5);

  // 요약 탭 KPI
  await expect(page.locator('#c360-tab-body')).toContainText('진행 딜');
  await expect(page.locator('#c360-tab-body')).toContainText('영업 파이프라인 분포');

  // 소재·제품 탭 전환
  await page.locator('.c360-tab[data-tab="materials"]').click();
  await expect(page.locator('#c360-tab-body')).toContainText('식각가스');

  // 영업기회 탭 전환
  await page.locator('.c360-tab[data-tab="deals"]').click();
  await expect(page.locator('#c360-tab-body')).toContainText('Fab12 식각가스 공급');
});
