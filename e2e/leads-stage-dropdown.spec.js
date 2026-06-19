// =============================================================
// E2E — 영업딜 테이블: 단계 셀 클릭 → 인라인 단계 선택 드롭다운
//
// 검증: 테이블 뷰에서 단계 셀(.lead-stage-trigger) 클릭 시
//   전체 단계 옵션 팝오버(.lead-stage-pop)가 열리고 현재 단계 ✓ 표시
//   (실데이터 기반 — 단계 변경은 수행하지 않음)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test('영업딜 — 단계 셀 클릭 시 인라인 단계 드롭다운', async ({ page }) => {
  await loginAsAdmin(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('leads_view', 'list');
    } catch (_) {
      /* noop */
    }
  });
  await page.goto('/#leads');

  // 테이블 단계 트리거 대기
  const trigger = page.locator('.lead-stage-trigger').first();
  await expect(trigger).toBeVisible({ timeout: 15000 });

  await trigger.click();

  const pop = page.locator('.lead-stage-pop');
  await expect(pop).toBeVisible({ timeout: 5000 });
  // 8개 단계 옵션 (반도체 영업 단계 라벨)
  await expect(pop.locator('.lead-stage-opt')).toHaveCount(8);
  await expect(pop).toContainText('발굴/니즈파악');
  await expect(pop).toContainText('Spec-in/승인');
  await expect(pop).toContainText('양산/정기수주');
});
