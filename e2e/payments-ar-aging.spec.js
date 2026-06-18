// =============================================================
// E2E — 매출관리 > 매출분석 탭 > AR aging (미수금 연령분석) [P4-A · 탭 재배치]
//
// 검증(API 모킹): 매출분석 탭 진입 → AR aging 섹션(#pay-ar-aging)
//   버킷 카드 + 버킷 바 차트(#pay-chart-aging) + 고객사별 연령 테이블
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const DASHBOARD = {
  kpi: { outstanding_amount: 14000000, this_month_scheduled: 6000000, overdue_amount: 11000000, overdue_count: 3, collection_rate: 42 },
  monthly_trend: [{ month: '2026-05', scheduled: 6000000, collected: 0 }],
  overdue_by_customer: [{ customer_name: '감마건설', overdue_amount: 8000000, count: 2 }],
};

const AR_AGING = {
  buckets: [
    { key: 'not_due', label: '미도래', amount: 2000000, count: 1 },
    { key: 'd30', label: '1-30일', amount: 5000000, count: 1 },
    { key: 'd60', label: '31-60일', amount: 4000000, count: 1 },
    { key: 'd90', label: '61-90일', amount: 0, count: 0 },
    { key: 'd90p', label: '90일+', amount: 3000000, count: 1 },
  ],
  total_outstanding: 14000000,
  by_customer: [
    { customer_id: 1, customer_name: 'ACME전자', total: 9000000, not_due: 2000000, d30: 5000000, d60: 0, d90: 0, d90p: 2000000 },
    { customer_id: 2, customer_name: '감마건설', total: 5000000, not_due: 0, d30: 0, d60: 4000000, d90: 0, d90p: 1000000 },
  ],
};

async function mockPayments(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/ar-aging/.test(url)) return json({ success: true, data: AR_AGING });
    if (/\/dashboard/.test(url)) return json({ success: true, data: DASHBOARD });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: [] });
    return route.fallback();
  });

  // 매출분석 탭은 매출관리로 이동됨. 매출관리 진입을 위해 summary/schedules 최소 모킹.
  await page.route('**/api/revenue/**', async (route, request) => {
    const url = request.url();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/summary/.test(url))
      return json({
        success: true,
        data: {
          kpi: { 예정: { cnt: 0, amount: 0 }, 확정: { cnt: 0, amount: 0 }, 취소: { cnt: 0, amount: 0 } },
          monthly: { planned: [], confirmed: [] },
        },
      });
    if (/\/schedules/.test(url)) return json({ success: true, data: [], pagination: { total: 0 } });
    return route.fallback();
  });
}

// 매출관리 진입 → 매출분석 탭 클릭 (수금관리에서 이동됨)
async function gotoAnalysisTab(page) {
  await page.goto('/#revenue', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof RevenuePage !== 'undefined', { timeout: 20000 });
  await page.evaluate(() => App.navigate('revenue'));
  await page.waitForSelector('.rev-tab[data-tab="analysis"]', { timeout: 20000 });
  await page.click('.rev-tab[data-tab="analysis"]');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* 무시 */
    }
  });
  await mockPayments(page);
  await loginAsAdmin(page);
});

test('매출분석 탭 — AR aging 섹션(버킷 카드 + 차트 + 고객사 연령 테이블)', async ({ page }) => {
  await gotoAnalysisTab(page);
  // 분석 탭이 dashboard 로드 후 완전 렌더돼야 #pay-ar-aging div 존재 (콜드스타트 타이밍 허용)
  await page.waitForSelector('#pay-chart-trend', { timeout: 15000 });

  // AR aging 섹션 렌더 (비동기 채움)
  const ar = page.locator('#pay-ar-aging');
  await expect(ar).toContainText('미수금 연령분석', { timeout: 15000 });
  await expect(ar).toContainText('총 미수');
  await expect(ar).toContainText('미도래');
  await expect(ar).toContainText('90일+');
  await expect(ar).toContainText('14,000,000'); // 총 미수
  await expect(ar).toContainText('5,000,000'); // d30 버킷

  // 버킷 바 차트 캔버스
  await expect(page.locator('#pay-chart-aging')).toBeVisible();

  // 고객사별 연령 테이블
  await expect(ar).toContainText('ACME전자');
  await expect(ar).toContainText('감마건설');
});
