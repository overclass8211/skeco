// =============================================================
// E2E — 수급 FCST 데이터 관리 (Phase 4, 실무자 인라인 편집)
//
// 검증:
//   1) 진입 → 생산 Capa 탭 그리드(제품 행 + Nameplate·가동률 입력)
//   2) 가동률 인라인 편집 → POST /forecast-sc/capacity 저장 (편집 후 원복)
//   3) 수요·판가 탭 전환 → 수요 인라인 편집 → PUT /forecast-sc/demand 저장 (원복)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

async function gotoMng(page) {
  // hash-only goto 는 동일 문서라 라우팅 경합 → App.navigate 로 결정적 진입
  await page.evaluate(() => App.navigate('fcstmng'));
  await expect(page.locator('input[data-cap-util]').first()).toBeVisible({ timeout: 15000 });
}

test('관리 — 생산 Capa 탭 그리드 렌더', async ({ page }) => {
  await gotoMng(page);
  // 제품 행 + Nameplate + 가동률 입력 존재
  await expect(page.locator('#fm-body tbody tr').first()).toBeVisible();
  await expect(page.locator('input[data-cap-nameplate]').first()).toBeVisible();
  // 5제품 × 12월 = 60 가동률 입력
  await expect(page.locator('input[data-cap-util]')).toHaveCount(60);
});

test('관리 — 가동률 인라인 편집 → 저장(POST)', async ({ page }) => {
  await gotoMng(page);
  const util = page.locator('input[data-cap-util]').first();
  const orig = await util.inputValue();
  const next = orig === '0.5' ? '0.6' : '0.5';

  await util.fill(next);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/forecast-sc/capacity') && r.request().method() === 'POST'
    ),
    util.blur(),
  ]);
  expect(resp.status()).toBe(200);
  await expect(util).toHaveClass(/saved/);

  // 원복
  await util.fill(orig);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/forecast-sc/capacity') && r.request().method() === 'POST'
    ),
    util.blur(),
  ]);
});

test('관리 — 수요·판가 탭 + 수요 인라인 편집 → 저장(PUT)', async ({ page }) => {
  await gotoMng(page);
  await page.locator('.fm-tab[data-tab="demand"]').click();

  const qty = page.locator('input[data-dem-qty]:not([disabled])').first();
  await expect(qty).toBeVisible({ timeout: 10000 });
  await expect(page.locator('input[data-dem-price]').first()).toBeVisible();
  const orig = await qty.inputValue();
  const next = String((Number(orig) || 0) + 1);

  await qty.fill(next);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => /\/forecast-sc\/demand\/\d+/.test(r.url()) && r.request().method() === 'PUT'
    ),
    qty.blur(),
  ]);
  expect(resp.status()).toBe(200);

  // 원복
  await qty.fill(orig);
  await Promise.all([
    page.waitForResponse(
      (r) => /\/forecast-sc\/demand\/\d+/.test(r.url()) && r.request().method() === 'PUT'
    ),
    qty.blur(),
  ]);
});
