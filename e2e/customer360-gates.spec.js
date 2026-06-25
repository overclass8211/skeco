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

  // 소재 카드 + 게이트 스텝퍼(기존 ss-stepper 스타일) 렌더 대기
  await expect(page.locator('.lc-card').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.lc-card .ss-stepper').first()).toBeVisible({ timeout: 10000 });

  // 게이트 키 노출 (라벨)
  const firstStepper = page.locator('.lc-card .ss-stepper').first();
  await expect(firstStepper).toContainText('MRD');
  await expect(firstStepper).toContainText('MP');

  // 스텝 개수: 소재당 7게이트 → 7의 배수
  const steps = await page.locator('.lc-card .ss-step').count();
  expect(steps).toBeGreaterThanOrEqual(7);
  expect(steps % 7).toBe(0);

  // 현재 게이트 강조(ss-now) 최소 1개
  const nowSteps = await page.locator('.lc-card .ss-step.ss-now').count();
  expect(nowSteps).toBeGreaterThanOrEqual(1);
});

test('360 공급품목 수정 모달 — 단계 드롭다운이 현재 게이트로 표시 (회귀)', async ({ page }) => {
  // 🐛 모달의 "단계" 드롭다운이 레거시 6단계를 써서 현재 게이트와 어긋나던 버그 방지.
  //    이제 게이트(MRD~MP) 기반 + 카드의 현재 게이트가 선택되어야 함.
  await page.goto('/#customer360/1');
  await page.reload();
  const firstCard = page.locator('.lc-card').first();
  await expect(firstCard).toBeVisible({ timeout: 15000 });

  // 카드의 현재 게이트 키(.ss-now .ss-label) 읽기
  const curKey = (await firstCard.locator('.ss-step.ss-now .ss-label').first().textContent()).trim();
  expect(curKey).toBeTruthy();

  // 수정 버튼 → 모달
  await firstCard.locator('[data-edit-mat]').click();
  const gateSel = page.locator('#m-gate');
  await expect(gateSel).toBeVisible({ timeout: 5000 });

  // 드롭다운은 게이트 기반(MRD~MP) — 레거시 6단계가 아님
  const opts = await gateSel.locator('option').evaluateAll(els => els.map(e => e.value));
  expect(opts).toContain('MRD');
  expect(opts).toContain('MP');

  // 선택값 = 카드의 현재 게이트 (버그 핵심: 현재 단계로 표시)
  await expect(gateSel).toHaveValue(curKey);
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
