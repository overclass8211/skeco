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

test('360 게이트 설정 모달 — 정의 편집 UI (team_lead+)', async ({ page }) => {
  await page.goto('/#customer360/1');
  await page.reload();
  await expect(page.locator('.lc-card').first()).toBeVisible({ timeout: 15000 });

  // 설정 버튼(admin 로그인 → 노출) → 모달
  await page.locator('#c360-gate-cfg').click();
  await expect(page.locator('#gc-body')).toBeVisible({ timeout: 5000 });
  const before = await page.locator('#gc-body tr[data-grow]').count();
  expect(before).toBeGreaterThanOrEqual(7);
  // 게이트 키는 input value → 텍스트가 아닌 값으로 검증
  const keys = await page.locator('#gc-body .gc-key').evaluateAll(els => els.map(e => e.value));
  expect(keys).toContain('MRD');

  // 게이트 추가 → 행 +1 (저장은 안 함 — UI 검증)
  await page.locator('#gc-add').click();
  await expect(page.locator('#gc-body tr[data-grow]')).toHaveCount(before + 1);

  // 삭제(✕) → 다시 원래 개수
  await page.locator('#gc-body tr[data-grow]').last().locator('.gc-del').click();
  await expect(page.locator('#gc-body tr[data-grow]')).toHaveCount(before);

  await page.locator('#gc-cancel').click();
  await expect(page.locator('#gc-body')).toHaveCount(0);
});
