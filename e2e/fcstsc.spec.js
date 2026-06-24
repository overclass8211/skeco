// =============================================================
// E2E — 반도체 수급 FCST 대시보드 (Phase 3)
//
// 검증:
//   1) 진입 → KPI 4종 + 메인 그래프(canvas) 렌더
//   2) 통화 $ ↔ ₩ 토글 → KPI 단위 전환
//   3) 위젯 표시/숨김 토글 (제품 믹스) + localStorage 저장
//   4) 로데이터 접기 → 월별 스프레드 테이블(고객×제품) 노출
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('수급 FCST — KPI + 메인 그래프 렌더', async ({ page }) => {
  // SPA 내비게이션 — hash-only goto 는 동일 문서라 라우팅 경합 → App.navigate 로 결정적 진입
  await page.evaluate(() => App.navigate('fcstsc'));
  // 데이터 로드 완료 게이트 — KPI 카드가 실제 값으로 채워질 때까지 대기 (경합 방지)
  await expect(page.locator('#fsc-kpis')).toContainText('L', { timeout: 15000 });

  // KPI 4개 카드
  await expect(page.locator('#fsc-kpis > div')).toHaveCount(4);
  // 수량 단위(L)·충족률(%) 노출
  await expect(page.locator('#fsc-kpis')).toContainText('L');
  await expect(page.locator('#fsc-kpis')).toContainText('%');
  // 메인 그래프 canvas
  await expect(page.locator('#fsc-main')).toBeVisible();
});

test('수급 FCST — 통화 $ ↔ ₩ 토글', async ({ page }) => {
  // SPA 내비게이션 — hash-only goto 는 동일 문서라 라우팅 경합 → App.navigate 로 결정적 진입
  await page.evaluate(() => App.navigate('fcstsc'));
  // 데이터 로드 완료 게이트 — KPI 카드가 실제 값으로 채워질 때까지 대기 (경합 방지)
  await expect(page.locator('#fsc-kpis')).toContainText('L', { timeout: 15000 });

  // 기본 USD → 매출 KPI 에 $ 표기
  await expect(page.locator('#fsc-kpis')).toContainText('$');
  // ₩ 전환
  await page.locator('#fsc-cur button[data-cur="KRW"]').click();
  await expect(page.locator('#fsc-kpis')).toContainText('억');
  await expect(page.locator('#fsc-rev-unit')).toHaveText('억원');
});

test('수급 FCST — 위젯 표시/숨김 토글', async ({ page }) => {
  // SPA 내비게이션 — hash-only goto 는 동일 문서라 라우팅 경합 → App.navigate 로 결정적 진입
  await page.evaluate(() => App.navigate('fcstsc'));
  // 데이터 로드 완료 게이트 — KPI 카드가 실제 값으로 채워질 때까지 대기 (경합 방지)
  await expect(page.locator('#fsc-kpis')).toContainText('L', { timeout: 15000 });

  const mixBox = page.locator('#fsc-w-mix');
  // 제품 믹스 위젯 켜기
  await page.locator('.fsc-wtoggle[data-w="mix"]').check();
  await expect(mixBox).toBeVisible();
  // localStorage 저장 확인
  const saved = await page.evaluate(() => localStorage.getItem('fcstsc.widgets'));
  expect(saved).toContain('"mix":true');
  // 끄기 → 숨김
  await page.locator('.fsc-wtoggle[data-w="mix"]').uncheck();
  await expect(mixBox).toBeHidden();
});

test('수급 FCST — 로데이터 접기 테이블', async ({ page }) => {
  // SPA 내비게이션 — hash-only goto 는 동일 문서라 라우팅 경합 → App.navigate 로 결정적 진입
  await page.evaluate(() => App.navigate('fcstsc'));
  // 데이터 로드 완료 게이트 — KPI 카드가 실제 값으로 채워질 때까지 대기 (경합 방지)
  await expect(page.locator('#fsc-kpis')).toContainText('L', { timeout: 15000 });

  // 기본 접힘
  await expect(page.locator('#fsc-table-box')).toBeHidden();
  // 펼치기 → 고객×제품 행 노출
  await page.locator('#fsc-fold').click();
  await expect(page.locator('#fsc-table-box')).toBeVisible();
  await expect(page.locator('#fsc-table tbody tr').first()).toBeVisible({ timeout: 5000 });
  // 지표 토글 (공급량)
  await page.locator('#fsc-metric button[data-m="supply"]').click();
  await expect(page.locator('#fsc-table thead')).toContainText('L');
});
