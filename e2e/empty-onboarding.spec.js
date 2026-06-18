// =============================================================
// E2E — 빈 상태 UI + 온보딩 환영 모달
//
// 검증 시나리오:
//   [빈 상태]
//   1. 리드 페이지에 잘못된 필터 → 빈 상태 UI 표시
//   2. 빈 상태의 액션 버튼 클릭 → 폼 열림 (필터 없을 때만)
//   3. 검색어로 0건 → "조건에 맞는 데이터 없음" 표시
//
//   [온보딩]
//   4. 첫 로그인 (localStorage flag X) → 환영 모달 자동 표시
//   5. 5단계 체크리스트 항목 클릭 → 해당 페이지로 이동
//   6. "다시 보지 않기" → flag 저장
//   7. 두 번째 로그인 → 모달 자동 표시 안 함
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

// ─── 빈 상태 (필터 결과 0건) ───────────────────────────────
test('시나리오 1 — 잘못된 필터 → 빈 상태 UI 표시', async ({ page }) => {
  // 온보딩 모달이 뜨지 않도록 flag 미리 설정
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('oci_onboarding_done', '1'));
  await page.goto('/#leads');
  // 페이지가 완전히 로드될 때까지 — 검색 input 보이면 OK
  await page.waitForSelector('#leads-search, input[placeholder*="검색"]', { timeout: 15000 });

  const searchInput = page.locator('#leads-search, input[placeholder*="검색"]').first();
  await searchInput.fill('__NEVER_EXISTS_XYZ_123__');
  // 입력 디바운스 + 로드 대기
  await page.waitForTimeout(1000);

  // 빈 상태 UI 표시 — filter preset
  await expect(page.locator('.empty-state').first()).toBeVisible({ timeout: 8000 });
});

// ─── 온보딩 모달 자동 표시 ─────────────────────────────────
test('시나리오 2 — 첫 로그인 시 온보딩 환영 모달 표시', async ({ page }) => {
  // localStorage flag 제거 → 첫 로그인 시뮬레이션
  await page.evaluate(() => localStorage.removeItem('oci_onboarding_done'));
  await page.goto('/');
  // 1초 지연 후 표시되도록 설정됨 — 충분히 대기
  await expect(
    page.locator('.modal-overlay').filter({ hasText: '환영합니다' }).first()
  ).toBeVisible({ timeout: 5000 });
});

// ─── 5단계 체크리스트 표시 + 각 단계 클릭 ──────────────────
test('시나리오 3 — 온보딩 체크리스트 5단계 표시', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('oci_onboarding_done'));
  await page.goto('/');
  await expect(
    page.locator('.modal-overlay').filter({ hasText: '환영합니다' }).first()
  ).toBeVisible({ timeout: 5000 });

  const stepBtns = page.locator('.onboarding-step');
  expect(await stepBtns.count()).toBe(5);
});

test('시나리오 4 — 체크리스트 항목 클릭 → 페이지 이동', async ({ page }) => {
  // flag 제거 후 reload — 깨끗한 첫 로그인 상태 보장
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('oci_onboarding_done'));
  await page.reload();
  await expect(
    page.locator('.modal-overlay').filter({ hasText: '환영합니다' }).first()
  ).toBeVisible({ timeout: 6000 });

  // "고객사 등록" 클릭
  await page.locator('.onboarding-step[data-onb-goto="customers"]').click();
  await page.waitForFunction(() => location.hash === '#customers', { timeout: 5000 });
});

// ─── "다시 보지 않기" → flag 저장 ──────────────────────────
test('시나리오 5 — "다시 보지 않기" 클릭 시 localStorage flag', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('oci_onboarding_done'));
  await page.reload();
  await expect(
    page.locator('.modal-overlay').filter({ hasText: '환영합니다' }).first()
  ).toBeVisible({ timeout: 6000 });

  await page.click('#onb-skip');
  // 모달 닫힘 대기 (active 클래스 제거 + display:none 적용까지)
  await page.waitForTimeout(500);

  const flag = await page.evaluate(() => localStorage.getItem('oci_onboarding_done'));
  expect(flag).toBeTruthy();
});

// ─── 두 번째 로그인 → 모달 자동 표시 안 함 ─────────────────
test('시나리오 6 — flag 있으면 모달 자동 표시 안 함', async ({ page }) => {
  await page.goto('/');
  // flag 설정 + reload — 두 번째 로그인 시뮬레이션
  await page.evaluate(() => localStorage.setItem('oci_onboarding_done', '1'));
  await page.reload();
  await page.waitForSelector('#global-search-btn', { timeout: 10000 });
  // 2초 대기 (자동 표시 지연 1초 + 여유)
  await page.waitForTimeout(2000);
  // 환영 모달이 없어야 함
  const cnt = await page.locator('.modal-overlay.active').filter({ hasText: '환영합니다' }).count();
  expect(cnt).toBe(0);
});
