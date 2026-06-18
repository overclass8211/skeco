// =============================================================
// E2E — 계약 페이지 UI (Phase 0: 기본 CRUD)
//
// 백엔드는 tests/contracts.test.mjs (vitest 14건) 에서 검증
// 여기서는 UI 동작만:
//   1) 페이지 진입 → [+ 새 계약] 버튼 + 필터 + 목록 영역
//   2) 빈 목록 안내 표시 (mock empty list)
//   3) 신규 모달 열기 → 필수 필드 + [➕ 등록] 버튼
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('계약 페이지 진입 → 헤더 + 필터 + 목록 영역 표시', async ({ page }) => {
  // mock 빈 목록
  await page.route('**/api/contracts*', async (route, request) => {
    const url = request.url();
    if (request.method() === 'GET' && /\/api\/contracts(\?|$)/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], pagination: { total: 0 } }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.goto('/#contracts');
  await page.waitForSelector('#ct-new-btn', { timeout: 15000 });

  await expect(page.locator('#ct-new-btn')).toBeVisible();
  await expect(page.locator('#ct-new-btn')).toContainText('새 계약');
  await expect(page.locator('#ct-search')).toBeVisible();
  await expect(page.locator('#ct-filter-status')).toBeVisible();
  await expect(page.locator('#ct-filter-type')).toBeVisible();
  await expect(page.locator('#ct-list-wrap')).toBeVisible();
});

test('빈 목록 시 안내 메시지 표시', async ({ page }) => {
  await page.route('**/api/contracts*', async (route, request) => {
    if (request.method() === 'GET' && /\/api\/contracts(\?|$)/.test(request.url())) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], pagination: { total: 0 } }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.goto('/#contracts');
  await page.waitForSelector('#ct-list-wrap', { timeout: 15000 });

  // "등록된 계약이 없습니다" 텍스트 확인
  await expect(page.locator('#ct-list-wrap')).toContainText('등록된 계약이 없습니다');
});

test('[+ 새 계약] 클릭 → 모달 열림 + 필수 필드(계약명) + [➕ 등록] 버튼', async ({ page }) => {
  await page.route('**/api/contracts*', async (route, request) => {
    const url = request.url();
    if (request.method() === 'GET' && /next-contract-no/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { contract_no: 'C-2026-0001', year: 2026 },
        }),
      });
    } else if (request.method() === 'GET' && /\/api\/contracts(\?|$)/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], pagination: { total: 0 } }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.goto('/#contracts');
  await page.waitForSelector('#ct-new-btn', { timeout: 15000 });
  await page.click('#ct-new-btn');

  // 모달 폼 필드 확인
  await page.waitForSelector('#ct-f-title', { timeout: 5000 });
  await expect(page.locator('#ct-f-title')).toBeVisible();
  await expect(page.locator('#ct-f-contract_type')).toBeVisible();
  await expect(page.locator('#ct-f-status')).toBeVisible();
  await expect(page.locator('#ct-f-customer_name')).toBeVisible();
  await expect(page.locator('#ct-f-currency')).toBeVisible();

  // 자동 채번된 계약번호 (readonly)
  await expect(page.locator('#ct-f-contract_no')).toHaveValue('C-2026-0001');

  // 등록 버튼
  await expect(page.locator('text=➕ 등록')).toBeVisible();
});
