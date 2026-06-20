// =============================================================
// E2E — 영업딜 상세 노션식 필드별 자동저장 (Phase A)
//
// 검증: 저장 버튼 클릭 없이 필드 수정 후 blur → 자동 저장 + 상태칩,
//   재진입 시 값 영속. (변경 후 원복하여 데이터 비파괴)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test('영업딜 상세 — 필드 blur 자동저장 + 영속', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 920 });
  await loginAsAdmin(page);
  await page.goto('/#leads', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-lead-id]', { timeout: 8000 });

  // 첫 리드 id 확보 후 상세 진입
  const id = await page.locator('[data-lead-id]').first().getAttribute('data-lead-id');
  await page.evaluate(i => App.openLeadDetail(parseInt(i)), id);
  await expect(page.locator('#ld-edit-form')).toBeVisible({ timeout: 8000 });

  const comp = page.locator('#ld-edit-form [name="competitor"]');
  const orig = await comp.inputValue();
  const marker = '__E2E_AUTOSAVE__';

  // 저장 버튼 클릭 없이: 값 입력 후 blur
  await comp.fill(marker);
  await comp.blur();
  await expect(page.locator('#ld-save-status')).toContainText('저장', { timeout: 6000 });

  // 재진입 → 영속 확인
  await page.evaluate(i => App.openLeadDetail(parseInt(i)), id);
  await expect(page.locator('#ld-edit-form [name="competitor"]')).toHaveValue(marker, {
    timeout: 8000,
  });

  // 원복 (데이터 비파괴)
  const comp2 = page.locator('#ld-edit-form [name="competitor"]');
  await comp2.fill(orig);
  await comp2.blur();
  await expect(page.locator('#ld-save-status')).toContainText('저장', { timeout: 6000 });
});
