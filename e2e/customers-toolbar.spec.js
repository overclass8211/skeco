// =============================================================
// E2E — 고객사 툴바: 엑셀 ▾ 드롭다운 + 표시 컬럼 설정
//
// 검증:
//   1) "엑셀" 버튼 클릭 → 다운로드(.xlsx)/CSV/가져오기 메뉴 노출
//   2) "표시 컬럼" 버튼 → 이메일 체크 해제 시 해당 컬럼 숨김 + localStorage 영속
//   - /api/customers (목록) 은 mock (결정적)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const CUSTS = [
  { id: 9101, name: 'E2E툴바테스트', region: '국내', country: '대한민국', industry: '반도체',
    contact_person: '홍길동', phone: '02-000-0000', email: 'tb@e2e.test', _isPrimary: 1 },
];

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/customers**', async (route, req) => {
    const url = req.url();
    if (req.method() === 'GET' && /\/api\/customers(\?|$)/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: CUSTS, pagination: { total: 1 } }),
      });
    }
    return route.fallback();
  });
});

test('엑셀 ▾ 드롭다운 — 다운로드/CSV/가져오기 항목', async ({ page }) => {
  await page.goto('/#customers');
  await page.waitForSelector('#cust-excel-btn', { timeout: 15000 });

  await page.locator('#cust-excel-btn').click();
  const menu = page.locator('.cust-pop-menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await expect(menu).toContainText('엑셀 다운로드');
  await expect(menu).toContainText('CSV 다운로드');
  await expect(menu).toContainText('엑셀 가져오기');
});

test('표시 컬럼 — 이메일 숨김 + localStorage 영속', async ({ page }) => {
  await page.goto('/#customers');
  await page.waitForSelector('#cust-cols-btn', { timeout: 15000 });

  // 테이블 뷰 보장 (저장된 뷰가 카드일 수 있음)
  await page.evaluate(() => CustomersPage.switchView('table'));
  await page.waitForSelector('.data-table thead th[data-col="email"]', { timeout: 5000 });

  // 컬럼 메뉴 열고 이메일 체크 해제
  await page.locator('#cust-cols-btn').click();
  const menu = page.locator('.cust-pop-menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await page.locator('.cust-pop-check input[data-col-key="email"]').uncheck();

  // 이메일 컬럼(헤더+셀) 숨김
  await expect(page.locator('.data-table thead th[data-col="email"]')).toBeHidden();
  await expect(page.locator('.data-table tbody td[data-col="email"]').first()).toBeHidden();

  // localStorage 영속
  const persisted = await page.evaluate(() => localStorage.getItem('cust_cols_hidden'));
  expect(persisted).toContain('email');
});
