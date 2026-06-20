// =============================================================
// E2E — 영업딜 상세: 모달 → 고객사식 풀페이지 분할 전환 (Phase 2)
//
// 검증:
//  1) 리드 클릭 시 모달이 아닌 풀페이지(.ld-page-head)로 렌더
//  2) 헤더에 ‹목록 / 좌우 분할 그리드 / 드래그 거터 존재
//  3) ‹목록 클릭 시 영업딜 목록으로 복귀
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test('영업딜 상세 — 풀페이지 분할로 열리고 목록 복귀', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 920 }); // 3분할(>1280)
  await loginAsAdmin(page);
  await page.goto('/#leads', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-lead-id]', { timeout: 8000 });

  await page.locator('[data-lead-id]').first().click();

  // 1) 풀페이지 헤더 + 분할 구조 (모달 아님)
  await expect(page.locator('.ld-page-head')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#ld-back')).toBeVisible();
  await expect(page.locator('#ld-split-gutter')).toHaveCount(1);
  await expect(page.locator('.ld-page-body .ld-modal-left')).toHaveCount(1);
  await expect(page.locator('.ld-page-body .ld-modal-right')).toHaveCount(1);
  // 모달 오버레이는 활성화되지 않아야 함
  await expect(page.locator('.modal-overlay.active')).toHaveCount(0);

  // 2) 3분할 그리드(좌 / 거터 / 우) — 3개 트랙
  const tracks = await page
    .locator('.ld-page-body .ld-modal-grid')
    .evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(tracks).toBe(3);

  // 3) ‹목록 → 영업딜 목록 복귀
  await page.locator('#ld-back').click();
  await expect(page.locator('.ld-page-head')).toHaveCount(0);
  await expect(page.locator('[data-lead-id]').first()).toBeVisible({ timeout: 8000 });
});
