// =============================================================
// E2E — 수금 스케줄 모달 > 기존 계약 연결 (Combobox)
//
// "계약 미연결" 문제 해결: 모달에서 계약을 검색·선택하면
//   contract_id 연결 + 고객사/계약명 자동 채움 + "연결됨" 표시.
// 백엔드 batch 는 이미 shared.contract_id 를 영속(vitest 검증) →
//   여기서는 UI 동작(검색·선택·자동채움)만 검증 (API 모킹).
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const CONTRACT = {
  id: 501,
  title: '다음데이터 SI용역',
  contract_no: 'C-2026-051',
  customer_id: 7,
  customer_name: '다음데이터',
};

async function mockApi(page) {
  // 수금 페이지 로드용
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
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (request.method() === 'GET') return json({ success: true, data: [] });
    return route.fallback();
  });
  // 계약 검색
  await page.route('**/api/contracts**', async (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [CONTRACT] }),
      });
    }
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

test('수금 스케줄 모달 — 계약 검색→선택 시 contract_id 연결 + 고객사/계약명 자동 채움', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 20000 });

  // 신규 등록 모달 열기
  await page.click('#pay-btn-new');
  await page.waitForSelector('#pay-m-contract-link', { timeout: 10000 });

  // 기본은 미연결 안내
  await expect(page.locator('#pay-m-link-status')).toContainText('미연결');

  // 계약 검색(2글자) → Combobox 드롭다운 → 항목 선택
  await page.fill('#pay-m-contract-link', '다음');
  await page.waitForSelector('.combobox-item', { timeout: 5000 });
  await page.locator('.combobox-item').first().click();

  // 연결됨 표시 + 고객사/계약명 자동 채움
  await expect(page.locator('#pay-m-link-status')).toContainText('연결됨');
  await expect(page.locator('#pay-m-link-status')).toContainText('다음데이터 SI용역');
  await expect(page.locator('#pay-m-customer')).toHaveValue('다음데이터');
  await expect(page.locator('#pay-m-contract-name')).toHaveValue('다음데이터 SI용역');

  // 연결 해제 → 미연결 복귀
  await page.click('#pay-m-unlink');
  await expect(page.locator('#pay-m-link-status')).toContainText('미연결');
});
