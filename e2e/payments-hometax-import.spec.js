// =============================================================
// E2E — 매출관리 > 세금계산서 > 홈택스 가져오기 (붙여넣기 경로 — 탭 재배치)
//
// 백엔드 무변(기존 tax_invoices 재사용). API 모킹으로 결정적 검증:
//   세금계산서 탭 → [홈택스 가져오기] → 붙여넣기 → 분석 → 자동매핑 → 가져오기
//   → tax_invoices 일괄 등록(mock) → 목록에 반영
// ※ 파일 업로드(.csv/.xlsx) 경로는 vitest(POST /import/parse)에서 검증
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

async function mockPayments(page) {
  let taxStore = [];
  let nextId = 1;

  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

    // 홈택스 일괄 등록 (bulk) — taxStore 에 issued 로 추가
    if (/\/tax-invoices\/bulk/.test(url) && method === 'POST') {
      const body = request.postDataJSON() || {};
      const rows = Array.isArray(body.rows) ? body.rows : [];
      rows.forEach(r => {
        taxStore.unshift({
          id: nextId++,
          status: 'issued',
          customer_name: r.customer_name,
          invoice_no: r.invoice_no || null,
          supply_amount: Number(r.supply_amount || 0),
          tax_amount: Number(r.tax_amount || 0),
          total_amount: Number(r.supply_amount || 0) + Number(r.tax_amount || 0),
          issue_date: r.issue_date || null,
        });
      });
      return json({ success: true, data: { created: rows.length, duplicates: 0, errors: [] } });
    }
    if (/\/tax-invoices/.test(url) && method === 'GET') return json({ success: true, data: taxStore });
    if (/\/dashboard/.test(url))
      return json({
        success: true,
        data: { kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 }, monthly_trend: [], overdue_by_customer: [] },
      });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: [] });
    return route.fallback();
  });

  // 세금계산서 탭은 수금관리→매출관리로 이동됨. 매출관리 진입을 위해 summary/schedules 최소 모킹.
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

// 매출관리 진입 → 세금계산서 탭 클릭 (수금관리에서 이동됨)
async function gotoTaxTab(page) {
  await page.goto('/#revenue', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof RevenuePage !== 'undefined', { timeout: 20000 });
  await page.evaluate(() => App.navigate('revenue'));
  await page.waitForSelector('.rev-tab[data-tab="tax"]', { timeout: 20000 });
  await page.click('.rev-tab[data-tab="tax"]');
  await page.waitForSelector('#tax-btn-import', { timeout: 10000 });
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

test('홈택스 가져오기 — 붙여넣기 → 자동매핑 → 일괄 등록 → 목록 반영', async ({ page }) => {
  await gotoTaxTab(page);

  // 가져오기 모달 열기
  await page.click('#tax-btn-import');
  await page.waitForSelector('#ht-body', { timeout: 5000 });

  // 붙여넣기 탭으로 전환 후 표 붙여넣기 (탭 구분, 첫 행=헤더)
  await page.click('.ht-src[data-src="paste"]');
  await page.fill(
    '#ht-paste',
    '작성일자\t상호\t공급가액\t세액\t승인번호\n2026-05-10\tE2E세금상사\t3000000\t300000\tHTE2E-1'
  );
  await page.click('#ht-analyze');

  // 매핑 화면 — 자동 추정되어 바로 가져오기 가능
  await page.waitForSelector('#ht-import', { timeout: 5000 });
  await page.click('#ht-import');

  // 목록에 import된 건 반영
  await expect(page.locator('#rev-tab-content')).toContainText('E2E세금상사', { timeout: 5000 });
  await expect(page.locator('#rev-tab-content')).toContainText('발행완료');
});
