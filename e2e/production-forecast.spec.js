// =============================================================
// E2E — 생산예측 탭 (Phase B)
//
// 검증: 매출 포캐스트 > 생산예측(마케팅) 탭 — 목록 렌더 + 수주 전환 호출
//   - /api/production-forecasts, /api/forecast, /api/team 은 mock (결정적)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const PF_ROWS = [
  { id: 5, customer_name: '삼성전자', product_name: '식각가스 C4F6', business_type: '식각가스',
    period: '2026-09', forecast_qty: 1500, unit: 'kg', unit_price: 1250000,
    expected_revenue: 1875000000, status: '예측', converted_lead_id: null },
];

const FORECAST_MIN = {
  success: true,
  data: {
    year: 2026, base_month: '2026-06', unit: '백만원',
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`, expected: 0, committed: 0, weighted: 0, prev_expected: 0,
    })),
    summary: { base_expected: 0, base_committed: 0, base_weighted: 0, year_expected: 0, year_committed: 0, year_weighted: 0, yoy_pct: null, deal_count: 0 },
    details: [],
  },
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/forecast**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(FORECAST_MIN),
  }));
  await page.route('**/api/team', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }),
  }));
  await page.route('**/api/production-forecasts/*/convert', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { lead_id: 999, expected_amount: 18.75 } }),
  }));
  await page.route('**/api/production-forecasts**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: PF_ROWS }),
  }));
});

test('생산예측 탭 — 목록 렌더 + 수주 전환 호출', async ({ page }) => {
  await page.goto('/#forecast');
  await expect(page.locator('.fcst-head h2')).toContainText('파이프라인 기반 예상 매출 FCST', { timeout: 15000 });

  // 생산예측 탭 전환
  await page.locator('.fcst-tab[data-tab="prod"]').click();
  const tbl = page.locator('#prod-table');
  await expect(tbl).toContainText('삼성전자', { timeout: 5000 });
  await expect(tbl).toContainText('식각가스 C4F6');
  await expect(tbl).toContainText('₩1,875,000,000');

  // 수주 전환 — confirm 다이얼로그 자동 수락 + convert API 호출 확인
  page.on('dialog', d => d.accept());
  const convertReq = page.waitForRequest('**/api/production-forecasts/*/convert');
  await page.locator('.prod-convert').first().click();
  await convertReq;
});
