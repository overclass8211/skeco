// =============================================================
// E2E — 고객사 모달 [💳 수금] 탭 (모듈 간 연동 마무리)
//
// 검증: 고객사 모달에 수금 탭이 추가되어 연결된 수금일정이 표시됨
//   - /api/customers (목록) + /:id/payments 는 mock (결정적)
//   - 로그인은 실서버, 프론트 정적파일은 디스크에서 신규 서빙
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const CID = 990101;
const CUST = { id: CID, name: 'E2E수금연동테스트', region: '서울', industry: 'IT', _isPrimary: 1 };
const SCHEDULES = [
  { id: 1, contract_name: 'E2E계약', stage_name: '계약금', scheduled_amount: 1000000, currency: 'KRW', due_date: '2026-07-01', status: '예정' },
  { id: 2, contract_name: 'E2E계약', stage_name: '잔금', scheduled_amount: 2000000, currency: 'KRW', due_date: '2026-09-01', status: '완료' },
];

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/customers**', async (route, req) => {
    const url = req.url();
    if (/\/api\/customers\/\d+\/payments/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: SCHEDULES }),
      });
    }
    if (/\/api\/customers\/\d+\/(quotes|proposals|contracts)/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    }
    if (req.method() === 'GET' && /\/api\/customers(\?|$)/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [CUST], pagination: { total: 1 } }),
      });
    }
    return route.fallback();
  });
});

test('고객사 모달 — 수금 탭에 연결된 수금일정 표시', async ({ page }) => {
  await page.goto('/#customers');
  await page.waitForSelector('#cust-search', { timeout: 15000 });

  // 목록 로드(mock) 완료 대기 후 모달 직접 오픈 (행 클릭보다 안정적)
  await page.waitForFunction(
    () => typeof CustomersPage !== 'undefined' && CustomersPage.data && CustomersPage.data.length > 0,
    { timeout: 10000 }
  );
  await page.evaluate(id => CustomersPage.showCustomerDetail(id), CID);

  // 수금 서브탭 표시 확인 → JS 클릭으로 전환
  // (다른 로더가 가짜 고객 id 를 실서버 조회해 띄우는 토스트가
  //  실제 마우스 클릭을 가로막을 수 있어, 탭 전환 핸들러를 직접 트리거)
  const payTab = page.locator('.cust-subtab[data-sub="payments"]');
  await expect(payTab).toBeVisible({ timeout: 5000 });
  await page.evaluate(() =>
    document.querySelector('.cust-subtab[data-sub="payments"]').click()
  );

  // 수금 탭 내용 — 연결된 수금일정 렌더
  const wrap = page.locator('#lpay-customer');
  await expect(wrap).toContainText('연결된 수금일정', { timeout: 5000 });
  await expect(wrap).toContainText('계약금');
  await expect(wrap).toContainText('잔금');

  // 카운트 배지 = 2
  await expect(page.locator('#cm-payments-cnt')).toHaveText('2', { timeout: 5000 });
});
