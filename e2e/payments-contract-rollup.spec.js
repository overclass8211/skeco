// =============================================================
// E2E — 수금현황 계약별 정합성 인사이트 (Step 3)
//
// 그룹(계약) 부모행에 계약금액 vs 수금계획 갭 표시:
//   계약금액 > 수금계획 → ▲ 미편성, 동일 → ✓ 계획일치
// (프론트 계산 — contract_amount 는 Step 1 JOIN 으로 목록에 포함)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SCHEDULES = [
  // 계약 A — 계약금액 1,000만 / 수금계획 합 800만 → 미편성 200만
  { id: 1, contract_id: 301, customer_name: '알파', contract_name: '알파구축', contract_no: 'C-301', contract_amount: 10000000, stage_name: '착수금', stage_order: 1, scheduled_amount: 5000000, paid_amount: 0, due_date: '2026-07-01', status: 'scheduled', currency: 'KRW' },
  { id: 2, contract_id: 301, customer_name: '알파', contract_name: '알파구축', contract_no: 'C-301', contract_amount: 10000000, stage_name: '잔금', stage_order: 2, scheduled_amount: 3000000, paid_amount: 0, due_date: '2026-08-01', status: 'scheduled', currency: 'KRW' },
  // 계약 B — 계약금액 5,000,000 / 수금계획 5,000,000 → 계획일치
  { id: 3, contract_id: 302, customer_name: '베타', contract_name: '베타납품', contract_no: 'C-302', contract_amount: 5000000, stage_name: '일시불', stage_order: 1, scheduled_amount: 5000000, paid_amount: 0, due_date: '2026-07-15', status: 'scheduled', currency: 'KRW' },
];

async function mockPayments(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/dashboard/.test(url))
      return json({ success: true, data: { kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 }, monthly_trend: [], overdue_by_customer: [] } });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
    if (/\/notifications/.test(url)) return json({ success: true, data: [], unread_count: 0 });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: SCHEDULES });
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
      localStorage.removeItem('oci_pay_groupview'); // 기본(그룹)
    } catch (_) {
      /* 무시 */
    }
  });
  await mockPayments(page);
  await loginAsAdmin(page);
});

test('계약별 정합성 — 미편성 / 계획일치 배지 표시', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-view-group', { timeout: 20000 });
  await expect(page.locator('.pay-grp')).toHaveCount(2);

  const content = page.locator('#pay-tab-content');
  // 계약금액 표기
  await expect(content).toContainText('계약금 ₩10,000,000');
  await expect(content).toContainText('계약금 ₩5,000,000');
  // 갭: 계약 A 미편성 200만 · 계약 B 계획일치
  await expect(content).toContainText('미편성 ₩2,000,000');
  await expect(content).toContainText('계획일치');
});
