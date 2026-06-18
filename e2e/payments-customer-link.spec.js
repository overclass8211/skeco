// =============================================================
// E2E — 수금 스케줄 모달 > 고객사 마스터 연결 (Step 2-2)
//
// 신규 등록 시 고객사를 customers 마스터에서 검색·선택 → customer_id 연결.
// 검증(API 모킹): 모달 열기 → 고객사 입력(2글자+) → Combobox 제안(autocomplete) →
//   항목 선택 → #pay-m-customer 자동 채움 (동일 onSelect 가 _msCustomerId 설정)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const CUSTOMER = { id: 7, name: '테스트고객사', industry: 'IT서비스', region: '서울' };

async function mockApi(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/dashboard/.test(url))
      return json({
        success: true,
        data: { kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 }, monthly_trend: [], overdue_by_customer: [] },
      });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
    if (/\/notifications/.test(url)) return json({ success: true, data: [], unread_count: 0 });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (request.method() === 'GET') return json({ success: true, data: [] });
    return route.fallback();
  });
  // 고객사 autocomplete
  await page.route('**/api/customers**', async (route, request) => {
    if (request.method() === 'GET')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [CUSTOMER] }) });
    return route.fallback();
  });
  // 계약 검색(혹시 호출 시 빈 결과)
  await page.route('**/api/contracts**', async (route, request) => {
    if (request.method() === 'GET')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* 무시 */
    }
  });
  await mockApi(page);
  await loginAsAdmin(page);
});

test('수금 스케줄 모달 — 고객사 마스터 검색·선택 → 자동 채움', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 20000 });

  // 신규 등록 모달
  await page.click('#pay-btn-new');
  await page.waitForSelector('#pay-m-customer', { timeout: 10000 });

  // 고객사 입력(2글자+) → Combobox 제안
  await page.fill('#pay-m-customer', '테스트');
  await page.waitForSelector('.combobox-item', { timeout: 5000 });
  await expect(page.locator('.combobox-item').first()).toContainText('테스트고객사');

  // 선택 → 입력란 자동 채움 (onSelect 가 _msCustomerId=7 도 함께 설정)
  await page.locator('.combobox-item').first().click();
  await expect(page.locator('#pay-m-customer')).toHaveValue('테스트고객사');
});
