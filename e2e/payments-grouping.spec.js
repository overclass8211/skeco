// =============================================================
// E2E — 수금현황 계약별 그룹핑 (Parent 계약 / Child 단계)
//
// 백엔드 무변 — 프론트 렌더 레이어 그룹핑만 검증 (API 라우트 모킹):
//   1) 기본 = 계약별 그룹: 부모 계약행 + 자식 단계행 + footer(계약N·단계M)
//   2) [☰ 전체] 토글 → 그룹 사라지고 평면 행, 다시 [📂 계약별] 복귀
//   3) 부모행 클릭 → 자식 펼침/접힘 (DOM display 토글)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SCHEDULES = [
  { id: 1, contract_id: 101, customer_name: 'ACME전자', contract_name: '스마트팩토리', contract_no: 'C-101', stage_name: '착수금', stage_order: 1, scheduled_amount: 2000000, paid_amount: 2000000, due_date: '2026-06-05', status: 'collected', currency: 'KRW' },
  { id: 2, contract_id: 101, customer_name: 'ACME전자', contract_name: '스마트팩토리', contract_no: 'C-101', stage_name: '중도금', stage_order: 2, scheduled_amount: 3000000, paid_amount: 1500000, due_date: '2026-07-03', status: 'partial', currency: 'KRW' },
  { id: 3, contract_id: 101, customer_name: 'ACME전자', contract_name: '스마트팩토리', contract_no: 'C-101', stage_name: '잔금', stage_order: 3, scheduled_amount: 5000000, paid_amount: 0, due_date: '2026-08-16', status: 'scheduled', currency: 'KRW' },
  { id: 4, contract_id: 102, customer_name: '베타물산', contract_name: 'ESS 납품', contract_no: 'C-102', stage_name: '착수금', stage_order: 1, scheduled_amount: 4000000, paid_amount: 0, due_date: '2026-06-20', status: 'scheduled', currency: 'KRW' },
  { id: 5, contract_id: 102, customer_name: '베타물산', contract_name: 'ESS 납품', contract_no: 'C-102', stage_name: '잔금', stage_order: 2, scheduled_amount: 4000000, paid_amount: 0, due_date: '2026-09-01', status: 'scheduled', currency: 'KRW' },
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
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: SCHEDULES });
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  // 온보딩 투어 억제 (오버레이 클릭 가로채기 방지)
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
      localStorage.removeItem('oci_pay_groupview'); // 기본(그룹) 보장
    } catch (_) {
      /* 무시 */
    }
  });
  await mockPayments(page);
  await loginAsAdmin(page);
});

test('계약별 그룹 기본 표시 — 부모 계약행 + 자식 단계행 + footer', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 20000 }); // 페이지 셸 로드(콜드 부트스트랩 흡수)
  await page.waitForSelector('#pay-view-group', { timeout: 10000 }); // 데이터 로드 후 그룹뷰 렌더

  // 부모 계약행 2개 (ACME / 베타물산)
  await expect(page.locator('.pay-grp')).toHaveCount(2);
  await expect(page.locator('#pay-tab-content')).toContainText('ACME전자');
  await expect(page.locator('#pay-tab-content')).toContainText('베타물산');
  await expect(page.locator('#pay-tab-content')).toContainText('스마트팩토리');

  // 자식 단계행 5개 (기본 펼침 → 표시)
  await expect(page.locator('.pay-row[data-gi]')).toHaveCount(5);
  await expect(page.locator('.pay-row[data-gi]').first()).toBeVisible();

  // footer: 계약 2건 · 단계 5건
  await expect(page.locator('#pay-tab-content')).toContainText('계약 2건');
  await expect(page.locator('#pay-tab-content')).toContainText('단계 5건');
});

test('뷰 토글 — [☰ 전체] 평면 ↔ [📂 계약별] 그룹', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 20000 }); // 페이지 셸 로드(콜드 부트스트랩 흡수)
  await page.waitForSelector('#pay-view-group', { timeout: 10000 }); // 데이터 로드 후 그룹뷰 렌더
  await expect(page.locator('.pay-grp')).toHaveCount(2);

  // 평면 전환 → 그룹 사라지고 5개 단계행만
  await page.click('#pay-view-flat');
  await expect(page.locator('.pay-grp')).toHaveCount(0);
  await expect(page.locator('.pay-row')).toHaveCount(5);
  await expect(page.locator('#pay-tab-content')).toContainText('합계 5건');

  // 계약별 복귀
  await page.click('#pay-view-group');
  await expect(page.locator('.pay-grp')).toHaveCount(2);
});

test('부모행 클릭 → 자식 단계 펼침/접힘', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 20000 }); // 페이지 셸 로드(콜드 부트스트랩 흡수)
  await page.waitForSelector('#pay-view-group', { timeout: 10000 }); // 데이터 로드 후 그룹뷰 렌더

  // 첫 그룹 자식들 — 처음엔 펼침(표시)
  const firstChildren = page.locator('.pay-row[data-gi="0"]');
  await expect(firstChildren.first()).toBeVisible();

  // 부모행 클릭 → 접힘 (숨김)
  await page.locator('.pay-grp').first().click();
  await expect(firstChildren.first()).toBeHidden();

  // 다시 클릭 → 펼침 (표시)
  await page.locator('.pay-grp').first().click();
  await expect(firstChildren.first()).toBeVisible();
});
