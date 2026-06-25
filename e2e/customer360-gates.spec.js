// =============================================================
// E2E — 360뷰 PLM 게이트 타임라인 (Phase 2)
//
// 검증:
//   1) 고객 360 소재 카드에 게이트 타임라인(.lc-gates) 렌더
//   2) 게이트 키 MRD~MP 표시 + 셀 개수(소재수 × 게이트수)
//   3) 현재 게이트 강조(box-shadow) 1개 이상
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('360 게이트 타임라인 — 소재 카드에 MRD~MP 렌더 + 현재 강조', async ({ page }) => {
  // 딥링크 + 리로드로 특정 고객(id=1) 360 진입 (hash-only 라우팅 경합 회피)
  await page.goto('/#customer360/1');
  await page.reload();

  // 소재 카드 + 게이트 타임라인 렌더 대기
  await expect(page.locator('.lc-card').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.lc-gates').first()).toBeVisible({ timeout: 10000 });

  // 게이트 키 노출
  const firstGates = page.locator('.lc-gates').first();
  await expect(firstGates).toContainText('MRD');
  await expect(firstGates).toContainText('MP');

  // 셀 개수: 소재당 7게이트 → 7의 배수
  const cells = await page.locator('.lc-gate').count();
  expect(cells).toBeGreaterThanOrEqual(7);
  expect(cells % 7).toBe(0);

  // 현재 게이트 강조(파란 링) 최소 1개
  const highlighted = await page.locator('.lc-gate div[style*="box-shadow"]').count();
  expect(highlighted).toBeGreaterThanOrEqual(1);
});
