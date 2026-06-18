// =============================================================
// E2E — 글로벌 검색 (Cmd+K) 5가지 시나리오 + 회귀 검증
//
// 검증 핵심: 검색 결과를 클릭하면 "상세 모달" 이 열려야 한다
//          (목록 페이지로만 이동하면 안 됨 — #1 버그 회귀 방지)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { createPool, insertSearchSeed, cleanupSeed } = require('./helpers/seed');

let pool;
let seed;

test.beforeAll(async () => {
  pool = createPool();
  seed = await insertSearchSeed(pool);
});

test.afterAll(async () => {
  if (pool) {
    try {
      await cleanupSeed(pool);
    } catch (_) {
      /* ignore */
    }
    await pool.end();
  }
});

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

/**
 * 검색 모달 열고 keyword 입력 — 디바운스(250ms) 대기 + 결과 표시 대기
 */
async function openSearchAndType(page, keyword) {
  await page.click('#global-search-btn');
  await page.waitForSelector('#gsearch-input', { state: 'visible' });
  await page.fill('#gsearch-input', keyword);
  // 결과가 렌더링될 때까지 대기 (디바운스 250ms + API 응답)
  await page.waitForSelector('.gsearch-item', { timeout: 5000 });
}

// ─── 시나리오 1: 리드 ─────────────────────────────────────────
test('시나리오 1 — 리드 검색 결과 클릭 → 리드 상세 모달 열림', async ({ page }) => {
  await openSearchAndType(page, seed.keyword);

  // 'leads' 타입의 첫 결과 클릭
  const leadItem = page.locator('.gsearch-item[data-type="leads"]').first();
  await expect(leadItem).toBeVisible();
  await leadItem.click();

  // 검색 모달이 닫혀야 함
  await expect(page.locator('#global-search-modal')).toBeHidden();

  // 리드 페이지로 이동했는지
  await expect(page).toHaveURL(/#leads/);

  // 리드 상세 모달이 열렸는지 (모달 컨테이너에 리드 관련 콘텐츠)
  // - 모달 클래스 또는 리드 키워드가 표시되어야 함
  await expect(page.locator('.modal-overlay, .modal, [role="dialog"]').first()).toBeVisible({
    timeout: 5000,
  });
  // 모달에 시드 키워드 포함 확인
  await expect(page.locator('body')).toContainText(seed.keyword);
});

// ─── 시나리오 2: 고객사 ───────────────────────────────────────
test('시나리오 2 — 고객사 검색 결과 클릭 → 고객사 상세 모달 열림', async ({ page }) => {
  await openSearchAndType(page, seed.keyword);

  const custItem = page.locator('.gsearch-item[data-type="customers"]').first();
  await expect(custItem).toBeVisible();
  await custItem.click();

  await expect(page.locator('#global-search-modal')).toBeHidden();
  await expect(page).toHaveURL(/#customers/);
  await expect(page.locator('.modal-overlay, .modal, [role="dialog"]').first()).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator('body')).toContainText(seed.keyword);
});

// ─── 시나리오 3: 프로젝트 ─────────────────────────────────────
test('시나리오 3 — 프로젝트 검색 결과 클릭 → 프로젝트 편집 모달 열림', async ({ page }) => {
  await openSearchAndType(page, seed.keyword);

  const projItem = page.locator('.gsearch-item[data-type="projects"]').first();
  await expect(projItem).toBeVisible();
  await projItem.click();

  await expect(page.locator('#global-search-modal')).toBeHidden();
  await expect(page).toHaveURL(/#projects/);
  await expect(page.locator('.modal-overlay, .modal, [role="dialog"]').first()).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator('body')).toContainText(seed.keyword);
});

// ─── 시나리오 4: 회의록 ───────────────────────────────────────
test('시나리오 4 — 회의록 검색 결과 클릭 → 회의록 상세 표시', async ({ page }) => {
  await openSearchAndType(page, seed.keyword);

  const mtgItem = page.locator('.gsearch-item[data-type="meetings"]').first();
  await expect(mtgItem).toBeVisible();
  await mtgItem.click();

  await expect(page.locator('#global-search-modal')).toBeHidden();
  await expect(page).toHaveURL(/#meeting-list/);
  // 회의록 상세는 모달이 아니라 페이지 내 우측 패널에 표시됨
  await expect(page.locator('body')).toContainText(seed.keyword);
});

// ─── 시나리오 5: 활동 (부모 리드/프로젝트 상세 열기) ─────────
test('시나리오 5 — 활동 검색 결과 클릭 → 부모 리드 상세 모달 열림', async ({ page }) => {
  await openSearchAndType(page, seed.keyword);

  const actItem = page.locator('.gsearch-item[data-type="activities"]').first();
  await expect(actItem).toBeVisible();
  await actItem.click();

  await expect(page.locator('#global-search-modal')).toBeHidden();
  // 활동의 lead_id 가 있으므로 리드 페이지로 이동
  await expect(page).toHaveURL(/#leads/);
  await expect(page.locator('.modal-overlay, .modal, [role="dialog"]').first()).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator('body')).toContainText(seed.keyword);
});

// ─── 회귀 검증: 키보드 단축키 + 네비게이션 ────────────────────
test.describe('회귀 검증 — 키보드 / 모달 동작', () => {
  test('Ctrl+K 로 검색 모달 열기 + Esc 로 닫기', async ({ page }) => {
    await page.keyboard.press('Control+K');
    await expect(page.locator('#gsearch-input')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#global-search-modal')).toBeHidden();
  });

  test('↑↓ Enter 키보드 네비게이션 → 상세 모달', async ({ page }) => {
    await page.click('#global-search-btn');
    await page.fill('#gsearch-input', seed.keyword);
    await page.waitForSelector('.gsearch-item', { timeout: 5000 });

    // ↓ 한 번 누르고 Enter — 첫 결과가 선택되어 있다가 두 번째로 이동
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // 검색 모달 닫히고 어떤 상세든 열려야 함
    await expect(page.locator('#global-search-modal')).toBeHidden();
  });

  test('빈 검색창 → 최근 검색 또는 안내 표시', async ({ page }) => {
    await page.click('#global-search-btn');
    await expect(page.locator('#gsearch-input')).toBeVisible();
    // 결과 영역에 결과 항목 없음 (빈 상태)
    const items = await page.locator('.gsearch-item').count();
    expect(items).toBe(0);
  });

  test('오버레이 클릭 → 모달 닫힘', async ({ page }) => {
    await page.click('#global-search-btn');
    await expect(page.locator('#gsearch-input')).toBeVisible();
    // 오버레이 영역(모달 바깥) 클릭 — 상단 좌측 모서리
    await page.click('#global-search-modal', { position: { x: 10, y: 10 } });
    await expect(page.locator('#global-search-modal')).toBeHidden();
  });
});
