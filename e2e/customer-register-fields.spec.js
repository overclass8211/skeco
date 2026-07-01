// =============================================================
// E2E — 고객사 등록 모달 신규 필드 + 상세 [+ 딜 등록] 연동
//
// 검증(사용자 요청):
//   1) 등록 모달: 상태(잠재/활성화) 드롭다운 + 직책(20) + 소속팀(20)
//   2) 바깥 클릭 시 편집중 컨펌(기존 메시지 재사용)
//   3) 상세 [+ 딜 등록] → 영업딜 신규 모달 + 고객사 프리필
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* noop */
    }
  });
  await loginAsAdmin(page);
});

test('고객사 등록 모달 — 상태/직책/소속팀 필드 + 바깥클릭 편집중 컨펌', async ({ page }) => {
  await page.evaluate(() => App.navigate('customers'));
  await page.waitForSelector('#cust-add-btn, button:has-text("고객사 등록")', { timeout: 15000 });
  await page.locator('button:has-text("고객사 등록")').first().click();
  await page.waitForSelector('#cust-form', { timeout: 8000 });

  // 1) 신규 필드
  const status = page.locator('#cust-form [name="status"]');
  await expect(status).toBeVisible();
  await expect(status.locator('option')).toHaveText(['잠재', '활성화']);
  await expect(page.locator('#cust-form [name="contact_position"]')).toHaveAttribute('maxlength', '20');
  await expect(page.locator('#cust-form [name="contact_team"]')).toHaveAttribute('maxlength', '20');

  // 2) 입력 후 바깥 클릭 → 편집중 컨펌(기존 메시지)
  await page.locator('#reg-name-input').fill('__E2E_편집중__');
  await page.locator('#modal-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#__modal-discard-overlay')).toContainText('변경사항이 저장되지 않습니다', {
    timeout: 4000,
  });
  await page.locator('#__modal-discard-stay').click(); // 계속 편집
});

test('고객사 상세 — [+ 딜 등록] 클릭 시 영업딜 신규 모달에 고객사 프리필', async ({ page }) => {
  await page.evaluate(() => App.navigate('customers'));
  await page.waitForSelector('[data-cust-id]', { timeout: 15000 });

  const { id, name } = await page.evaluate(() => {
    const c = CustomersPage._allData[0];
    CustomersPage.showCustomerDetail(c.id);
    return { id: c.id, name: c.name };
  });
  await page.waitForSelector('#cm-deal-btn', { timeout: 8000 });
  await page.locator('#cm-deal-btn').click();

  await expect(page.locator('#lead-form')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#lead-customer-input')).toHaveValue(name);
  await expect(page.locator('#lead-customer-id')).toHaveValue(String(id));
});
