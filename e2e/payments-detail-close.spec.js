// =============================================================
// E2E — 수금 상세 모달 [닫기] 버튼 (사용자 보고 버그 회귀 방지)
//
// 🐛 보고: 수금 상세 모달에서 [닫기] 클릭 시 무반응
//   원인: 닫기 버튼이 인라인 onclick="Modal.close()" 인데, CSP(script-src-attr)가
//         인라인 이벤트 핸들러 실행 자체를 차단 → 클릭해도 아무 일도 안 일어남.
//   수정: utils.js Modal.open 에 box 클릭 위임(delegation) →
//         [onclick*="Modal.close()"] 요소 클릭 시 Modal.close() 호출 (CSP-safe).
//   본 테스트: 행 클릭 → 상세 모달 → [닫기] → 모달 닫힘.
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SCHEDULE = {
  id: 1,
  contract_id: null,
  customer_name: '테스트상사',
  contract_name: '샘플계약',
  contract_no: null,
  stage_name: '착수금',
  stage_order: 1,
  scheduled_amount: 3960000,
  paid_amount: 0,
  due_date: '2026-06-07',
  status: 'scheduled',
  currency: 'KRW',
};

async function mockApi(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

    // 상세 조회 GET /payments/<id> (records/tax_invoices 포함)
    if (/\/payments\/\d+(\?|$)/.test(url) && method === 'GET')
      return json({ success: true, data: { ...SCHEDULE, records: [], tax_invoices: [] } });

    if (/\/dashboard/.test(url))
      return json({ success: true, data: { kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 }, monthly_trend: [], overdue_by_customer: [] } });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
    if (/\/notifications/.test(url)) return json({ success: true, data: [], unread_count: 0 });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: [SCHEDULE] });
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
      localStorage.setItem('oci_pay_groupview', '0'); // 평면뷰(행 클릭 단순화)
    } catch (_) {
      /* 무시 */
    }
  });
  await mockApi(page);
  await loginAsAdmin(page);
});

test('수금 상세 모달 — [닫기] 클릭 시 모달 닫힘 (인라인 onclick 회복)', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 20000 }); // 페이지 셸(콜드 부트 흡수)
  await page.waitForSelector('.pay-row', { timeout: 10000 }); // 데이터 로드 후 행

  // 행 클릭 → 수금 상세 모달
  await page.locator('.pay-row').first().click();
  await page.waitForSelector('#sd-close', { timeout: 10000 });
  await expect(page.locator('#sd-close')).toBeVisible(); // 상세 모달 열림 확인

  // [닫기] → 모달 닫힘 (Modal.close — 인라인 onclick 회복)
  await page.click('#sd-close');
  await expect(page.locator('#sd-close')).toBeHidden({ timeout: 5000 });
});
