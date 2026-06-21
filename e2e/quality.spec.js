// =============================================================
// E2E — 전사 품질관리 (Quality Inbox)
//   메뉴 진입 → KPI + 목록 + 상세 모달 (API mock 결정적)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SUMMARY = { success: true, data: { open_total: 11, high_open: 11, in_progress: 0, new_this_month: 11, avg_resolve_days: null } };
const CASES = {
  success: true,
  detail_restricted: false,
  data: [
    {
      id: 1, case_no: 'Q-TEST-1', customer_id: 1, customer_name: 'E2E품질고객',
      customer_material_id: null, material_name: null, type: 'NCR', severity: 'high',
      status: 'open', title: '순도 편차 NCR', opened_at: '2026-06-01', resolved_at: null,
      owner_id: null, owner_name: null, age_days: 11,
    },
  ],
};
const CUSTOMERS = { success: true, data: [{ id: 1, name: 'E2E품질고객' }] };

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/customer360/customers', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CUSTOMERS) })
  );
  await page.route('**/api/quality/summary', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY) })
  );
  await page.route('**/api/quality/cases**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CASES) })
  );
});

test('전사 품질관리 — KPI + 목록 + 상세 모달', async ({ page }) => {
  await page.goto('/#quality');
  await page.waitForSelector('#ql-list .data-table', { timeout: 15000 });

  // KPI
  await expect(page.locator('.ql-kpis')).toContainText('미해결');
  await expect(page.locator('.ql-kpis')).toContainText('High 심각도');

  // 목록
  await expect(page.locator('#ql-list')).toContainText('E2E품질고객');
  await expect(page.locator('#ql-list')).toContainText('순도 편차 NCR');

  // 행 클릭 → 상세 모달 (편집 필드)
  await page.locator('#ql-list tbody tr').first().click();
  await expect(page.locator('#modal-overlay')).toContainText('품질 케이스');
  await expect(page.locator('#qd-status')).toBeVisible();
});
