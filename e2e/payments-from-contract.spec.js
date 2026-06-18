// =============================================================
// E2E — 수금관리 > [계약에서 생성] (계약 → 수금 일정 자동 생성)
//
// 휴면이던 백엔드 from-contract 를 UI 에 연결. 비율 템플릿 기반 자동 생성.
// 검증(API 모킹): [계약에서 생성] → 계약 검색·선택 → 템플릿 → 미리보기 단계 →
//   생성 → POST /from-contract 호출 → 모달 닫힘 + 목록 갱신
// 백엔드 무변(from-contract stages 경로 활용) → vitest skip, e2e 로 UI 검증
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const TEMPLATES = [
  {
    id: 1,
    name: '3단계 표준 (착수30/중도40/잔금30)',
    stages: [
      { name: '착수금', ratio: 30, offset_days: 0, note: '계약일 즉시' },
      { name: '중도금', ratio: 40, offset_days: 60, note: '계약 후 60일' },
      { name: '잔금', ratio: 30, offset_days: 0, note: '납품 완료 후' },
    ],
  },
];
const CONTRACT = {
  id: 77,
  title: '알파SI 구축',
  contract_no: 'C-2026-077',
  customer_id: 3,
  customer_name: '알파',
  contract_amount: 100000000,
};

async function mockApi(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/templates/.test(url) && method === 'GET') return json({ success: true, data: TEMPLATES });
    if (/\/from-contract\//.test(url) && method === 'POST')
      return json({ success: true, data: { created: 3, ids: [1, 2, 3] } });
    if (/\/dashboard/.test(url))
      return json({
        success: true,
        data: { kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 }, monthly_trend: [], overdue_by_customer: [] },
      });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: [] });
    return route.fallback();
  });
  await page.route('**/api/contracts**', async (route, request) => {
    if (request.method() === 'GET')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [CONTRACT] }) });
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

test('계약에서 생성 — 계약 검색·선택 → 템플릿 → 미리보기 → 생성', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-from-contract', { timeout: 20000 });

  await page.click('#pay-btn-from-contract');
  await page.waitForSelector('#fc-contract', { timeout: 10000 });

  // 템플릿 자동 로드
  await expect(page.locator('#fc-template')).toContainText('3단계');

  // 계약 검색 → 선택
  await page.fill('#fc-contract', '알파');
  await page.waitForSelector('.combobox-item', { timeout: 5000 });
  await page.locator('.combobox-item').first().click();

  // 계약 연결 표시 + 총액 자동 채움
  await expect(page.locator('#fc-contract-info')).toContainText('알파SI 구축');
  await expect(page.locator('#fc-amount')).toHaveValue('100000000');

  // 미리보기 — 3단계 표시 (비율 적용 금액)
  await expect(page.locator('#fc-preview')).toContainText('착수금');
  await expect(page.locator('#fc-preview')).toContainText('중도금');
  await expect(page.locator('#fc-preview')).toContainText('잔금');
  await expect(page.locator('#fc-preview')).toContainText('30,000,000'); // 착수금 30%

  // 생성 → 모달 닫힘 (성공 시 Modal.close)
  await page.click('#fc-create');
  await expect(page.locator('#fc-create')).toBeHidden({ timeout: 5000 });
});
