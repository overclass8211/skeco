// =============================================================
// E2E — 고객·제품 360 > 공급 자격 > 샘플/평가·품질 행 드릴다운
//
// 검증: 행 클릭 → 읽기전용 세부 모달(샘플 상세 / 품질 케이스 상세)
//   - 실데이터(고객 id=1: 샘플·품질 케이스 시드) 사용, 라벨 기반 단언으로 견고
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('360 공급 자격 — 샘플·품질 행 클릭 시 세부 드릴다운 모달', async ({ page }) => {
  await page.goto('/#customer360/1');
  await page.reload();
  await expect(page.locator('.lc-card').first()).toBeVisible({ timeout: 15000 });

  // 공급 자격 탭
  await page.locator('.c360-tab[data-tab="qualification"]').click();

  // ── 샘플/평가 행 → 상세 모달 ──
  const smpRow = page.locator('[data-smp-row]').first();
  await expect(smpRow).toBeVisible({ timeout: 10000 });
  await smpRow.click();
  const modal = page.locator('#modal-overlay');
  await expect(modal).toContainText('샘플 상세', { timeout: 5000 });
  await expect(modal).toContainText('평가 기준');
  await expect(modal).toContainText('결과');
  await page.locator('#sd-close').click();
  await expect(page.locator('#modal-overlay')).toBeHidden();

  // ── 품질 케이스 행 → 상세 모달(8D/NCR 세부) ──
  const qRow = page.locator('[data-q-row]').first();
  await expect(qRow).toBeVisible({ timeout: 10000 });
  await qRow.click();
  const qModal = page.locator('#modal-overlay');
  await expect(qModal).toContainText('품질 케이스 상세', { timeout: 5000 });
  await expect(qModal).toContainText('원인 분석');
  await expect(qModal).toContainText('봉쇄/응급조치');
  await expect(qModal).toContainText('예방조치');
  await expect(qModal).toContainText('일정');
  await page.locator('#qd-close').click();
  await expect(page.locator('#modal-overlay')).toBeHidden();
});
