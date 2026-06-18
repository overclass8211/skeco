// =============================================================
// E2E — 매출관리 > 매출분석 탭 Chart.js 차트 (수금관리에서 이동 — 탭 재배치)
//
// 백엔드 무변 — 기존 /payments/dashboard 데이터를 Chart.js 로 시각화.
// 매출분석은 매출관리(RevenuePage) 탭으로 이동, 수금관리(PaymentsPage)
// 렌더를 매출관리 컨테이너(#rev-tab-content)로 위임.
// 검증 (API 모킹):
//   1) 매출분석 탭 진입 → 3개 캔버스(월별/상태별/연체) + 섹션 헤더
//   2) 탭 왕복(분석→청구차수→분석) 후에도 차트 재생성 정상 (인스턴스 파기/재생성)
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
  overdue_by_customer: [
    { customer_name: '감마건설', overdue_amount: 8000000, count: 2 },
    { customer_name: '델타상사', overdue_amount: 3000000, count: 1 },
  ],
};

const SCHEDULES = [
  { id: 1, contract_id: 101, customer_name: 'ACME전자', contract_name: '스마트팩토리', stage_name: '착수금', scheduled_amount: 2000000, paid_amount: 2000000, due_date: '2026-03-05', status: 'collected', currency: 'KRW' },
  { id: 2, contract_id: 101, customer_name: 'ACME전자', contract_name: '스마트팩토리', stage_name: '중도금', scheduled_amount: 3000000, paid_amount: 1500000, due_date: '2026-04-03', status: 'partial', currency: 'KRW' },
  { id: 3, contract_id: 102, customer_name: '감마건설', contract_name: '태양광 EPC', stage_name: '착수금', scheduled_amount: 8000000, paid_amount: 0, due_date: '2026-04-20', status: 'overdue', currency: 'KRW' },
  { id: 4, contract_id: 103, customer_name: '베타물산', contract_name: 'ESS 납품', stage_name: '잔금', scheduled_amount: 6000000, paid_amount: 0, due_date: '2026-05-16', status: 'scheduled', currency: 'KRW' },
];

async function mockPayments(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/dashboard/.test(url)) return json({ success: true, data: DASHBOARD });
    if (/\/ar-aging/.test(url)) return json({ success: true, data: { buckets: [], by_customer: [] } });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
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

// 매출관리 진입 → 매출분석 탭 클릭 (수금관리에서 이동됨)
async function gotoAnalysisTab(page) {
  await page.goto('/#revenue', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof RevenuePage !== 'undefined', { timeout: 20000 });
  await page.evaluate(() => App.navigate('revenue'));
  await page.waitForSelector('.rev-tab[data-tab="analysis"]', { timeout: 20000 });
  await page.click('.rev-tab[data-tab="analysis"]');
  await page.waitForSelector('#pnl-open', { timeout: 10000 }); // 분석 콘텐츠(시뮬레이터 요약) 마커
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

test('매출분석 탭 — 3개 Chart.js 캔버스 + 섹션 헤더', async ({ page }) => {
  await gotoAnalysisTab(page);
  await page.waitForSelector('#pay-chart-trend', { timeout: 10000 });

  await expect(page.locator('#pay-chart-trend')).toBeVisible();
  await expect(page.locator('#pay-chart-status')).toBeVisible();
  await expect(page.locator('#pay-chart-overdue')).toBeVisible();

  await expect(page.locator('#rev-tab-content')).toContainText('월별 수금 현황');
  await expect(page.locator('#rev-tab-content')).toContainText('상태별 수금예정액 비중');
  await expect(page.locator('#rev-tab-content')).toContainText('연체 미수금 TOP 5');
});

test('탭 왕복(분석→청구차수→분석) 후 차트 재생성 정상', async ({ page }) => {
  await gotoAnalysisTab(page);
  await page.waitForSelector('#pay-chart-trend', { timeout: 10000 });

  // 청구차수로 이동 → 분석 차트 파기
  await page.click('.rev-tab[data-tab="schedules"]');
  await expect(page.locator('#pay-chart-trend')).toHaveCount(0, { timeout: 10000 });

  // 다시 매출분석 → 차트 재생성
  await page.click('.rev-tab[data-tab="analysis"]');
  await page.waitForSelector('#pay-chart-trend', { timeout: 10000 });
  await expect(page.locator('#pay-chart-trend')).toBeVisible();
});

// 슬라이더(input[type=range]) 값 설정 + input 이벤트 발화
const setRange = (page, sel, v) =>
  page.locator(sel).evaluate((el, val) => {
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);

test('손익 시뮬레이터 (A+B) — 탭=한 줄 요약, 도구=모달 + 실시간 반영', async ({ page }) => {
  await gotoAnalysisTab(page);

  // 탭에는 입력 폼 없음(경영진 뷰) — 요약 바만 (기본 70/10 → 영업이익 20.0%)
  await expect(page.locator('#pnl-rev')).toHaveCount(0);
  await expect(page.locator('#pnl-summary')).toContainText('영업이익');
  await expect(page.locator('#pnl-summary')).toContainText('20.0%');

  // [시뮬레이터 열기] → 모달: 매출 기본값 = 수금 예정 합계, 천단위 콤마 포맷
  await page.click('#pnl-open');
  await page.waitForSelector('#pnl-rev', { timeout: 5000 });
  await expect(page.locator('#pnl-rev')).toHaveValue('19,000,000');
  await expect(page.locator('#pnl-out')).toContainText('영업이익');
  await expect(page.locator('#pnl-out')).toContainText('시나리오');
  await expect(page.locator('#pnl-out')).toContainText('보수');
  await expect(page.locator('#pnl-out')).toContainText('낙관');

  // 슬라이더 원가율 90 + 판관비 10 → 영업이익 0원(0.0%) 실시간 반영
  await setRange(page, '#pnl-cost', 90);
  await setRange(page, '#pnl-sga', 10);
  await expect(page.locator('#pnl-out')).toContainText('0.0%');

  // [닫기](인라인 onclick → 위임 처리) → 모달 닫힘 + 탭 요약 바가 변경 비율로 동기화
  await page.click('#pnl-close');
  await expect(page.locator('#pnl-rev')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#pnl-summary')).toContainText('원가율 90%');
  await expect(page.locator('#pnl-summary')).toContainText('0.0%');
});

test('손익 시뮬레이터 — 변경 비율 localStorage 기억 (새 로드 후 요약 유지)', async ({ page }) => {
  await gotoAnalysisTab(page);

  await page.click('#pnl-open');
  await page.waitForSelector('#pnl-cost', { timeout: 5000 });
  await setRange(page, '#pnl-cost', 60); // 60/10 → 영업이익률 30.0%
  await page.click('#pnl-close');

  // 새 로드(매출관리 재진입) 후 localStorage 비율 유지
  await gotoAnalysisTab(page);
  await page.waitForSelector('#pnl-summary', { timeout: 10000 });
  await expect(page.locator('#pnl-summary')).toContainText('원가율 60%');
  await expect(page.locator('#pnl-summary')).toContainText('30.0%');
});
