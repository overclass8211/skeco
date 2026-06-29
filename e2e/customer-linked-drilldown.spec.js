// =============================================================
// E2E — 고객사 모달 연결탭(견적 등) 행 클릭 → 상세 모달 오픈 (회귀)
//
// 버그(사용자 보고): 고객사 모달의 견적 탭에서 견적 클릭 시 상세 모달이
//   안 뜨고 견적 목록 페이지로만 이동. 관련딜·견적·제안·계약·고객지원·수금
//   각 단계의 상세로 드릴다운이 안 됨.
// 원인: LinkedX 컴포넌트가 window.navigate(미정의) 사용 → else 분기
//   (location.hash 만 변경, 목록만 표시) → _openModal/openDetail 미호출.
// 수정: window.navigate = App.navigate 별칭 (public/js/app.js 부팅)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const CUST = 1; // 한국동서발전 — 연결 견적 보유

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('고객사 모달 견적 탭 → 견적 행 클릭 → 견적 상세 모달 오픈', async ({ page }) => {
  await page.goto('/#customers');
  // 온보딩 모달 닫기 (신규 세션마다 노출 — 있으면 닫음)
  try {
    await page.click('#onb-skip', { timeout: 5000 });
  } catch (e) {
    /* 온보딩 없음 */
  }
  await page.waitForFunction(
    () => typeof CustomersPage !== 'undefined' && CustomersPage.data && CustomersPage.data.length > 0,
    { timeout: 15000 }
  );

  // ── 수정 검증 1: window.navigate 가 함수로 정의됨 (이전엔 undefined) ──
  expect(await page.evaluate(() => typeof window.navigate)).toBe('function');

  // ── 고객 상세 → 견적 서브탭 → 견적 행 클릭 ──
  await page.evaluate(id => CustomersPage.showCustomerDetail(id), CUST);
  await page.waitForSelector('.cust-subtab[data-sub="quotes"]', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.cust-subtab[data-sub="quotes"]').click());
  await page.waitForSelector('#lq-customer .lq-row', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('#lq-customer .lq-row').click());

  // ── 수정 검증 2: 견적 상세 모달이 실제로 열림 (목록만 뜨던 버그 해소) ──
  await page.waitForSelector('.qt-modal, #qt-f-quote_no', { timeout: 10000 });
  await expect(page.locator('.qt-modal, #qt-f-quote_no').first()).toBeVisible();
});
