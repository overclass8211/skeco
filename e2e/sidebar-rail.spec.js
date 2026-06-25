// =============================================================
// E2E — 사이드바 레일 모드(접이식 아이콘 전용) 토글
//
// 검증:
//   1) 레일 토글 클릭 → body.sidebar-rail + 사이드바 폭 축소 + 라벨 숨김
//   2) localStorage 저장 + 재진입 시 상태 유지
//   3) 다시 토글 → 펼침 복귀
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('사이드바 레일 모드 — 토글/저장/복원', async ({ page }) => {
  await page.waitForSelector('#rail-toggle', { timeout: 15000 });
  const sidebar = page.locator('.sidebar');
  const wExpanded = (await sidebar.boundingBox()).width;

  // 접기
  await page.locator('#rail-toggle').click();
  await expect(page.locator('body')).toHaveClass(/sidebar-rail/);
  const wRail = (await sidebar.boundingBox()).width;
  expect(wRail).toBeLessThan(wExpanded);
  expect(wRail).toBeLessThanOrEqual(80);
  // 라벨(텍스트) 페이드 아웃 — 슬라이딩(opacity 0). display:none 이 아니라 opacity 로 애니메이션
  await expect
    .poll(() =>
      page
        .locator('.sidebar-nav .nav-item span:not(.nav-badge)')
        .first()
        .evaluate(el => getComputedStyle(el).opacity)
    )
    .toBe('0');
  // 저장
  expect(await page.evaluate(() => localStorage.getItem('oci_rail'))).toBe('1');

  // 재진입(리로드) → 레일 상태 유지
  await page.reload();
  await page.waitForSelector('#rail-toggle', { timeout: 15000 });
  await expect(page.locator('body')).toHaveClass(/sidebar-rail/);

  // 펼치기 복귀
  await page.locator('#rail-toggle').click();
  await expect(page.locator('body')).not.toHaveClass(/sidebar-rail/);
  expect(await page.evaluate(() => localStorage.getItem('oci_rail'))).toBe('0');
});
