// =============================================================
// E2E — 매출분석 > 월별 수금 현황 토글 (월별 막대 ↔ 누적 라인)
//
// 백엔드 무변 — 이미 로드된 monthly_trend 를 클라이언트에서 누적 합산.
// 검증 (API 모킹):
//   1) 기본 = 월별 막대(bar) → [누적] 클릭 → line 타입 + 누적 합산 데이터 + 제목 변경
//   2) [월별] 복귀 → bar 타입 복원
//   3) localStorage(oci_pay_trendmode) 기억 → 새로고침 후에도 누적 모드 유지
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const DASHBOARD = {
  kpi: { outstanding_amount: 14000000, this_month_scheduled: 6000000, overdue_amount: 11000000, overdue_count: 3, collection_rate: 42 },
  monthly_trend: [
    { month: '2026-03', scheduled: 5000000, collected: 5000000 },
    { month: '2026-04', scheduled: 8000000, collected: 3000000 },
    { month: '2026-05', scheduled: 6000000, collected: 0 },
  ],
  overdue_by_customer: [],
};

const SCHEDULES = [
  { id: 1, contract_id: 101, customer_name: 'ACME전자', contract_name: '스마트팩토리', stage_name: '착수금', scheduled_amount: 2000000, paid_amount: 2000000, due_date: '2026-03-05', status: 'collected', currency: 'KRW' },
];

async function mockPayments(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/dashboard/.test(url)) return json({ success: true, data: DASHBOARD });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
    if (/\/notifications/.test(url)) return json({ success: true, data: [], unread_count: 0 });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: SCHEDULES });
    return route.fallback();
  });

  // 매출분석 탭은 매출관리로 이동됨. 매출관리 진입을 위해 summary/schedules 최소 모킹.
  await page.route('**/api/revenue/**', async (route, request) => {
    const url = request.url();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/summary/.test(url))
      return json({
        success: true,
        data: {
          kpi: { 예정: { cnt: 0, amount: 0 }, 확정: { cnt: 0, amount: 0 }, 취소: { cnt: 0, amount: 0 } },
          monthly: { planned: [], confirmed: [] },
        },
      });
    if (/\/schedules/.test(url)) return json({ success: true, data: [], pagination: { total: 0 } });
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* 무시 */
    }
  });
  await mockPayments(page);
  await loginAsAdmin(page);
});

async function gotoAnalysis(page) {
  // 매출분석 탭은 수금관리→매출관리로 이동됨
  await page.goto('/#revenue', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof RevenuePage !== 'undefined', { timeout: 20000 });
  await page.evaluate(() => App.navigate('revenue'));
  await page.waitForSelector('.rev-tab[data-tab="analysis"]', { timeout: 20000 });
  await page.click('.rev-tab[data-tab="analysis"]');
  await page.waitForSelector('#pay-chart-trend', { timeout: 10000 });
}

// 현재 trend 차트의 타입 + dataset 데이터 추출 (Chart.js v3+ getChart)
const chartInfo = page =>
  page.evaluate(() => {
    const ch = Chart.getChart(document.getElementById('pay-chart-trend'));
    return ch ? { type: ch.config.type, data: ch.data.datasets.map(d => d.data) } : null;
  });

test('[누적] 토글 — line 차트 + 누적 합산 데이터 + 제목/버튼 동기화', async ({ page }) => {
  await gotoAnalysis(page);

  // 기본 = 월별 막대 (원본 월별 값)
  await expect(page.locator('#pay-trend-title')).toContainText('월별 수금 현황');
  let info = await chartInfo(page);
  expect(info.type).toBe('bar');
  expect(info.data[0]).toEqual([5000000, 8000000, 6000000]); // 예정 (월별)

  // [누적] 클릭 → 라인 + 누적 합산
  await page.click('#pay-trend-cum');
  await expect(page.locator('#pay-trend-title')).toContainText('누적 수금 현황');
  info = await chartInfo(page);
  expect(info.type).toBe('line');
  expect(info.data[0]).toEqual([5000000, 13000000, 19000000]); // 누적 예정
  expect(info.data[1]).toEqual([5000000, 8000000, 8000000]); // 누적 실적

  // [월별] 복귀 → 막대 복원
  await page.click('#pay-trend-monthly');
  await expect(page.locator('#pay-trend-title')).toContainText('월별 수금 현황');
  info = await chartInfo(page);
  expect(info.type).toBe('bar');
  expect(info.data[1]).toEqual([5000000, 3000000, 0]); // 실적 (월별 원복)
});

test('누적 모드 localStorage 기억 — 새로고침 후 유지', async ({ page }) => {
  await gotoAnalysis(page);
  await page.click('#pay-trend-cum');
  await expect(page.locator('#pay-trend-title')).toContainText('누적 수금 현황');

  // 새 로드(매출관리 재진입) → 누적 모드 유지 (localStorage 기억)
  await gotoAnalysis(page);

  await expect(page.locator('#pay-trend-title')).toContainText('누적 수금 현황');
  const info = await chartInfo(page);
  expect(info.type).toBe('line');
});
