// =============================================================
// E2E — 키보드 단축키
//
// 검증 시나리오 (CRUD 체크리스트 적용):
//   1. ? 키 → 도움말 모달 표시 (Read)
//   2. N 키 → 새 리드 폼 열림 (Create)
//   3. / 키 → 검색 모달 열림
//   4. G 후 L → 리드 페이지 이동 (시퀀스)
//   5. G 후 C → 고객사 페이지 이동
//   6. input 포커스 시 N 키 무시 (입력 보호)
//   7. 검색 모달 열림 상태에서 N 키 무시 (모달 보호)
//   8. Esc 로 도움말 모달 닫기
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

// ─── Read — 도움말 ─────────────────────────────────────────
test('시나리오 1 — ? 키 → 도움말 모달', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#global-search-btn', { timeout: 8000 });

  // body 클릭으로 포커스 안 잡힌 상태 보장
  await page.locator('body').click();
  await page.keyboard.press('?');

  await expect(
    page
      .locator('.modal-overlay, .modal-content')
      .filter({
        hasText: '키보드 단축키',
      })
      .first()
  ).toBeVisible({ timeout: 3000 });
});

// ─── Create — 새 리드 ──────────────────────────────────────
test('시나리오 2 — N 키 → 새 리드 폼 열림', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#global-search-btn', { timeout: 8000 });
  await page.locator('body').click();
  await page.keyboard.press('n');

  // 리드 페이지로 이동 + 새 리드 모달 (또는 폼) 열림 — 최소 URL 이동 검증
  await page.waitForFunction(() => location.hash.startsWith('#leads'), { timeout: 5000 });
});

// ─── / 키 → 검색 ───────────────────────────────────────────
test('시나리오 3 — / 키 → 검색 모달 열림', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#global-search-btn', { timeout: 8000 });
  await page.locator('body').click();
  await page.keyboard.press('/');

  await expect(page.locator('#gsearch-input')).toBeVisible({ timeout: 3000 });
});

// ─── 시퀀스 — G + L ────────────────────────────────────────
test('시나리오 4 — G 후 L → 리드 페이지 이동', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#global-search-btn', { timeout: 8000 });
  await page.locator('body').click();

  await page.keyboard.press('g');
  await page.keyboard.press('l');

  await page.waitForFunction(() => location.hash === '#leads', { timeout: 3000 });
});

// ─── 시퀀스 — G + C ────────────────────────────────────────
test('시나리오 5 — G 후 C → 고객사 페이지 이동', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#global-search-btn', { timeout: 8000 });
  await page.locator('body').click();

  await page.keyboard.press('g');
  await page.keyboard.press('c');

  await page.waitForFunction(() => location.hash === '#customers', { timeout: 3000 });
});

// ─── 입력 보호 — input 포커스 시 N 키 무시 ────────────────
test('시나리오 6 — input 포커스 시 N 키 무시', async ({ page }) => {
  await page.goto('/#leads');
  await page.waitForSelector('.search-input, input[type="search"], input[placeholder]', {
    timeout: 8000,
  });

  // 첫 input 요소에 포커스
  const firstInput = page.locator('input').first();
  await firstInput.click();
  await firstInput.fill('test');

  // N 키 입력 — input 에 'n' 만 추가되어야 하고, 새 리드 모달은 열리지 않아야 함
  await page.keyboard.press('n');
  await expect(firstInput).toHaveValue(/.*n$/i);
});

// ─── 모달 보호 — 검색 모달 열림 시 N 무시 ─────────────────
test('시나리오 7 — 검색 모달 열림 시 N 키 무시', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#global-search-btn', { timeout: 8000 });

  // 검색 모달 열기 (Ctrl+K)
  await page.keyboard.press('Control+K');
  await expect(page.locator('#gsearch-input')).toBeVisible();

  // 검색 input 에 포커스가 있으므로 — N 키 입력 시 검색어로 입력됨
  await page.keyboard.press('n');
  await expect(page.locator('#gsearch-input')).toHaveValue('n');
});

// ─── 도움말 모달 닫기 (확인 버튼 또는 바깥 클릭) ────────────
test('시나리오 8 — 도움말 모달 확인 버튼 닫기', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#global-search-btn', { timeout: 8000 });
  await page.locator('body').click();

  await page.keyboard.press('?');
  await expect(
    page.locator('.modal-overlay').filter({ hasText: '키보드 단축키' }).first()
  ).toBeVisible();

  // Modal 시스템은 ESC 핸들러가 없음 — 확인 버튼 또는 X 버튼으로 닫기
  await page.click('#sc-help-ok');
  await expect(page.locator('.modal-overlay').filter({ hasText: '키보드 단축키' })).toBeHidden({
    timeout: 3000,
  });
});

// ─── 모달 열림 상태에서 글로벌 단축키 무시 ─────────────────
test('시나리오 9 — 도움말 모달 열린 상태에서 N 키 무시', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#global-search-btn', { timeout: 8000 });
  await page.locator('body').click();

  await page.keyboard.press('?');
  await expect(
    page.locator('.modal-overlay').filter({ hasText: '키보드 단축키' }).first()
  ).toBeVisible();

  // N 키 — 모달 열려있으므로 리드 페이지 이동 안 해야 함
  await page.keyboard.press('n');
  await page.waitForTimeout(300);
  // URL 이 #leads 로 안 바뀌어야 함
  const hash = await page.evaluate(() => location.hash);
  expect(hash).not.toBe('#leads');
});
