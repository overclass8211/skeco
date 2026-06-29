// =============================================================
// E2E — 영업딜 상세 > [고객사] 클릭 → 해당 고객사 프로필 표시
//
// 🐛 회귀 방지: 핸들러가 미정의 메서드(showCustomerModal)를 호출해
//    고객사 "목록"으로만 넘어가던 버그. 이제 showCustomerDetail 로 프로필 노출.
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('영업딜 상세 — 고객사 클릭 시 해당 고객사 프로필 표시', async ({ page }) => {
  // customer_id 가 연결된 영업딜(BOE) id 를 API 로 결정적으로 확보
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: 'admin1234!' },
  });
  const token = (await login.json()).token;
  const lr = await page.request.get('/api/leads?search=BOE', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const leads = (await lr.json()).data || [];
  const lead = leads.find(l => l.customer_name === 'BOE') || leads[0];
  expect(lead).toBeTruthy();

  await page.goto('/#leads/' + lead.id);
  await page.reload();

  // 고객사 링크(프로필 연결) 렌더 대기 → 클릭
  const custLink = page.locator('[data-cust-link]').first();
  await expect(custLink).toBeVisible({ timeout: 15000 });
  await custLink.click();

  // 목록이 아니라 해당 고객사 "상세 프로필"이 떠야 함
  await expect(page.locator('.cust-detail-head')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.cust-detail-title')).toContainText('BOE');
});
