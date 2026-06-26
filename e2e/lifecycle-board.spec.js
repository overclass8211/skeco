// =============================================================
// E2E — 전사 공정 라이프사이클 보드 (프로젝트 메뉴 재정의)
//
// 검증:
//   1) #projects 진입 → 보드 렌더(KPI + 게이트 진행 행)
//   2) '지연만' 필터 → 행 수 = 지연 KPI
//   3) 행 클릭 → 해당 고객 360 드릴다운(#customer360/:id)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('공정 라이프사이클 보드 — KPI + 행 렌더 + 지연 필터 + 드릴다운', async ({ page }) => {
  await page.goto('/#projects');
  await page.reload();

  // 보드 렌더 대기
  await expect(page.locator('.plc-kpi').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.plc-row').first()).toBeVisible({ timeout: 10000 });

  // KPI 3종(전체/지연/이번달) 노출
  expect(await page.locator('.plc-kpi').count()).toBe(3);

  // 행 = 게이트 진행 셀(소재당 N개) 렌더
  const rowsAll = await page.locator('.plc-row').count();
  expect(rowsAll).toBeGreaterThanOrEqual(1);
  expect(await page.locator('.plc-row').first().locator('.plc-cell').count()).toBeGreaterThanOrEqual(3);

  // '지연만' 필터 → 행 수 = 지연 KPI 값
  const delayedKpi = parseInt(
    (await page.locator('.plc-kpi').nth(1).locator('.plc-kpi-v').textContent()).trim(),
    10
  );
  await page.locator('#plc-delay').check();
  await expect(page.locator('.plc-row')).toHaveCount(delayedKpi);
  await page.locator('#plc-delay').uncheck();
  await expect(page.locator('.plc-row')).toHaveCount(rowsAll);

  // 행 클릭 → 해당 고객 360 드릴다운
  const firstRow = page.locator('.plc-row').first();
  const cust = await firstRow.getAttribute('data-cust');
  await firstRow.click();
  await expect(page).toHaveURL(new RegExp(`#customer360/${cust}$`));
});
