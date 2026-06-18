// =============================================================
// E2E — 리포트 페이지 사용자 정의 위젯 UI
//
// 백엔드 CRUD 는 tests/reports.test.mjs (vitest + supertest) 에서 검증
// 여기서는 UI 동작만 검증:
//   1) "+ 위젯 추가" 버튼 존재
//   2) 위젯 추가 핸들러 호출 → 모달 + "새 리포트 만들기" 버튼 표시
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('리포트 페이지 진입 → 내 위젯 영역 + [+ 위젯 추가] 버튼 표시', async ({ page }) => {
  await page.goto('/#reports');
  await page.waitForSelector('#rp-add-widget-btn', { timeout: 10000 });

  const addBtn = page.locator('#rp-add-widget-btn');
  await expect(addBtn).toBeVisible();
  await expect(addBtn).toHaveText(/위젯 추가/);

  // 위젯 그리드 영역도 표시
  const grid = page.locator('#rp-widgets-grid');
  await expect(grid).toBeVisible();
});

test('위젯 추가 모달 → "새 리포트 만들기" 버튼 표시', async ({ page }) => {
  await page.goto('/#reports');
  await page.waitForSelector('#rp-add-widget-btn', { timeout: 10000 });
  await page.waitForLoadState('networkidle');

  // 위젯 추가 핸들러 직접 호출 (UI 클릭 chain 의 timing 의존성 회피)
  await page.evaluate(() => window.ReportsPage._openAddWidgetModal());

  // 모달 안의 "새 리포트 만들기" 버튼 가시 (API 로드 후 표시)
  await expect(page.locator('#rp-add-new-btn')).toBeVisible({ timeout: 8000 });
});
