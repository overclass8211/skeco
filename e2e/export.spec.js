// =============================================================
// E2E — 데이터 익스포트 (드롭다운 + 포맷별 다운로드)
//
// 검증 시나리오:
//   1. 리드 페이지 → 내보내기 → 드롭다운 표시
//   2. 드롭다운 3개 옵션 (Excel / CSV / JSON)
//   3. CSV 다운로드 — content-type 검증 (직접 API 호출)
//   4. JSON 다운로드 — 응답 형식 검증
//   5. 고객사 페이지 익스포트 메뉴
//   6. 회의록 페이지 익스포트 버튼 + 드롭다운
//   7. 팀 페이지 익스포트 버튼 + 드롭다운
//   8. 잘못된 format → xlsx fallback
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

// ─── UI — 드롭다운 동작 ───────────────────────────────────
test('시나리오 1 — 리드 페이지에서 내보내기 드롭다운 열림', async ({ page }) => {
  await page.goto('/#leads');
  await page.waitForSelector('#leads-export-btn', { timeout: 10000 });
  await page.click('#leads-export-btn');

  // 드롭다운 표시
  await expect(page.locator('.export-menu-pop.is-open')).toBeVisible({ timeout: 3000 });
  // 3개 옵션
  await expect(page.locator('.export-menu-item[data-format="xlsx"]')).toBeVisible();
  await expect(page.locator('.export-menu-item[data-format="csv"]')).toBeVisible();
  await expect(page.locator('.export-menu-item[data-format="json"]')).toBeVisible();
});

test('시나리오 2 — 드롭다운 바깥 클릭 시 닫힘', async ({ page }) => {
  await page.goto('/#leads');
  await page.waitForSelector('#leads-export-btn', { timeout: 10000 });
  await page.click('#leads-export-btn');
  await expect(page.locator('.export-menu-pop.is-open')).toBeVisible();

  // open() 직후 250ms 동안은 outside-click 무시 (bubble race 방지) — 그 후 대기
  await page.waitForTimeout(300);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.export-menu-pop.is-open')).toHaveCount(0, { timeout: 3000 });
});

// ─── 직접 API 호출 — 포맷별 검증 ─────────────────────────
test('시나리오 3 — CSV 다운로드 응답 헤더', async ({ page }) => {
  // 인증된 page.request 사용 (browser context 가 token 보유)
  const resp = await page.request.get('/api/leads/export?format=csv', {
    headers: {
      Authorization:
        'Bearer ' +
        (await page.evaluate(
          () => localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || ''
        )),
    },
  });
  expect(resp.status()).toBe(200);
  expect(resp.headers()['content-type']).toMatch(/text\/csv/);
  expect(resp.headers()['content-disposition']).toContain('.csv');
});

test('시나리오 4 — JSON 다운로드 응답 형식', async ({ page }) => {
  const resp = await page.request.get('/api/customers/export?format=json', {
    headers: {
      Authorization:
        'Bearer ' +
        (await page.evaluate(
          () => localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || ''
        )),
    },
  });
  expect(resp.status()).toBe(200);
  expect(resp.headers()['content-type']).toMatch(/application\/json/);
  const body = await resp.json();
  expect(body).toHaveProperty('exported_at');
  expect(body).toHaveProperty('count');
  expect(Array.isArray(body.rows)).toBe(true);
  expect(Array.isArray(body.columns)).toBe(true);
});

// ─── 추가 페이지 ─────────────────────────────────────────
test('시나리오 5 — 고객사 페이지 익스포트 메뉴', async ({ page }) => {
  await page.goto('/#customers');
  await page.waitForSelector('#cust-excel-export-btn', { timeout: 10000 });
  await page.click('#cust-excel-export-btn');
  await expect(page.locator('.export-menu-pop.is-open')).toBeVisible();
  await expect(page.locator('.export-menu-item[data-format="csv"]')).toBeVisible();
});

test('시나리오 6 — 회의록 페이지 익스포트 버튼 표시', async ({ page }) => {
  await page.goto('/#meeting-list');
  await page.waitForSelector('#ml-export-btn', { timeout: 10000 });
  await page.click('#ml-export-btn');
  await expect(page.locator('.export-menu-pop.is-open')).toBeVisible();
});

test('시나리오 7 — 팀 페이지 익스포트 버튼 표시', async ({ page }) => {
  await page.goto('/#team');
  await page.waitForSelector('#team-export-btn', { timeout: 10000 });
  await page.click('#team-export-btn');
  await expect(page.locator('.export-menu-pop.is-open')).toBeVisible();
});

// ─── 안전성 ───────────────────────────────────────────────
test('시나리오 8 — 잘못된 format → xlsx fallback', async ({ page }) => {
  const resp = await page.request.get('/api/projects/export?format=pdf', {
    headers: {
      Authorization:
        'Bearer ' +
        (await page.evaluate(
          () => localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || ''
        )),
    },
  });
  expect(resp.status()).toBe(200);
  expect(resp.headers()['content-type']).toMatch(/spreadsheetml/);
});
