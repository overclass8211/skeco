// =============================================================
// E2E — 수금현황 계약별 기준 통일 + 고객사 컬럼 분리 (Step 1)
//
// 검증(API 모킹):
//   1) 1열=계약 / 2열=고객사 분리 헤더
//   2) 연결 계약은 contracts 신뢰값(contract_title/linked_customer_name) 표시
//      (비정규화 드리프트 — 옛 customer_name/contract_name 대신 신뢰값)
//   3) 미연결(직접 등록) 행은 '직접 등록' 라벨
//   4) 평면뷰에서도 계약/고객사 분리 유지
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SCHEDULES = [
  // 연결 계약 — 신뢰값(contract_title/linked_customer_name)이 비정규화값과 다름(드리프트)
  {
    id: 1,
    contract_id: 201,
    customer_name: '옛고객명',
    contract_name: '옛계약명',
    contract_no: 'C-201',
    contract_title: '신뢰계약명',
    linked_customer_name: '신뢰고객사',
    stage_name: '착수금',
    stage_order: 1,
    scheduled_amount: 1000000,
    paid_amount: 0,
    due_date: '2026-07-01',
    status: 'scheduled',
    currency: 'KRW',
  },
  // 미연결(직접 등록) — contract_id 없음
  {
    id: 2,
    contract_id: null,
    customer_name: '직접고객',
    contract_name: '',
    contract_no: null,
    stage_name: '기타',
    stage_order: 1,
    scheduled_amount: 500000,
    paid_amount: 0,
    due_date: '2026-07-10',
    status: 'scheduled',
    currency: 'KRW',
  },
];

async function mockPayments(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/dashboard/.test(url))
      return json({
        success: true,
        data: {
          kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 },
          monthly_trend: [],
          overdue_by_customer: [],
        },
      });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
    if (/\/notifications/.test(url)) return json({ success: true, data: [], unread_count: 0 });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: SCHEDULES });
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
      localStorage.removeItem('oci_pay_groupview'); // 기본(그룹)
    } catch (_) {
      /* 무시 */
    }
  });
  await mockPayments(page);
  await loginAsAdmin(page);
});

test('계약별 기준 — 계약/고객사 컬럼 분리 + 신뢰값 + 직접 등록 (그룹뷰)', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-view-group', { timeout: 20000 });

  // 헤더: 계약 / 고객사 분리 컬럼
  await expect(page.locator('#pay-th-contract')).toContainText('계약');
  await expect(page.locator('#pay-th-cust')).toContainText('고객사');

  // 연결 계약 → contracts 신뢰값 표시 (드리프트된 옛 값 아님)
  await expect(page.locator('#pay-tab-content')).toContainText('신뢰계약명');
  await expect(page.locator('#pay-tab-content')).toContainText('신뢰고객사');
  await expect(page.locator('#pay-tab-content')).not.toContainText('옛계약명');
  await expect(page.locator('#pay-tab-content')).not.toContainText('옛고객명');

  // 미연결 → '직접 등록' 라벨 + 고객사 표시
  await expect(page.locator('#pay-tab-content')).toContainText('직접 등록');
  await expect(page.locator('#pay-tab-content')).toContainText('직접고객');
});

test('평면뷰 — 계약/고객사 분리 유지 + 신뢰값', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-view-flat', { timeout: 20000 });

  await page.click('#pay-view-flat');
  await expect(page.locator('.pay-grp')).toHaveCount(0);

  // 평면뷰 헤더도 계약/고객사 분리
  await expect(page.locator('#pay-th-contract')).toContainText('계약');
  await expect(page.locator('#pay-th-cust')).toContainText('고객사');

  // 행에 신뢰값 표시
  await expect(page.locator('#pay-tab-content')).toContainText('신뢰계약명');
  await expect(page.locator('#pay-tab-content')).toContainText('신뢰고객사');
});
