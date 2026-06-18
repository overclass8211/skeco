// =============================================================
// E2E — 가져오기 모달 [취소] 버튼 (사용자 보고 버그 회귀 방지)
//
// 🐛 보고: [홈택스 세금계산서 가져오기] / [은행 거래내역 가져오기] 모달의
//   [취소] 클릭 시 무반응.
//   원인: 취소 버튼이 인라인 onclick="Modal.close()" 인데 ① CSP 가 인라인 핸들러
//        차단 + ② 이 버튼들은 onOpen(renderInput)에서 동적 렌더되어 Modal.open 의
//        1회성 재바인딩에도 안 잡힘.
//   수정: Modal.open 에 box 클릭 위임(delegation) → 동적 close 버튼까지 CSP-safe 처리.
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

async function mockApi(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/dashboard/.test(url))
      return json({ success: true, data: { kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 }, monthly_trend: [], overdue_by_customer: [] } });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'], notify_email: '' } });
    if (/\/notifications/.test(url)) return json({ success: true, data: [], unread_count: 0 });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (request.method() === 'GET') return json({ success: true, data: [] });
    return route.fallback();
  });

  // 세금계산서 탭은 수금관리→매출관리로 이동됨. 매출관리 진입을 위해 summary/schedules 최소 모킹.
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

test('은행 거래내역 가져오기 모달 — [취소] 클릭 시 닫힘', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-bank', { timeout: 20000 });

  await page.click('#pay-btn-bank');
  await page.waitForSelector('#bk-analyze', { timeout: 10000 }); // 모달 열림(입력 단계)

  await page.click('#bk-foot button.btn-secondary'); // [취소]
  await expect(page.locator('#bk-analyze')).toBeHidden({ timeout: 5000 });
});

test('홈택스 세금계산서 가져오기 모달 — [취소] 클릭 시 닫힘', async ({ page }) => {
  // 세금계산서 탭은 매출관리로 이동됨 → 매출관리 진입 후 탭 클릭
  await page.goto('/#revenue', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof RevenuePage !== 'undefined', { timeout: 20000 });
  await page.evaluate(() => App.navigate('revenue'));
  await page.waitForSelector('.rev-tab[data-tab="tax"]', { timeout: 20000 });

  // 세금계산서 탭 → [홈택스 가져오기]
  await page.click('.rev-tab[data-tab="tax"]');
  await page.waitForSelector('#tax-btn-import', { timeout: 10000 });
  await page.click('#tax-btn-import');
  await page.waitForSelector('#ht-analyze', { timeout: 10000 }); // 모달 열림(입력 단계)

  await page.click('#ht-foot button.btn-secondary'); // [취소]
  await expect(page.locator('#ht-analyze')).toBeHidden({ timeout: 5000 });
});
