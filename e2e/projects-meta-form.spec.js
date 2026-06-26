// =============================================================
// E2E — 프로젝트 모듈 개선 Phase 2: 메타 폼 + 영업리드 자동 채움
//
// 검증 (API 모킹):
//   1) 신규 폼 — 확장 필드(코드/리드/기간/PM/협업/투입인원/담당고객) 렌더
//   2) 관련 영업리드 2글자 검색 → 제안(수주 배지) → 선택 시 자동 채움
//      (고객사/customer_id/프로젝트명/계약금액/유형/담당영업 + 연결 계약 자동 탐색)
//   3) 저장 — POST 페이로드에 확장 메타 포함
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const STAGES = [
  { id: 1, stage_key: 'kickoff', label: '착수', sort_order: 10, color: '#93B4F9', requires_file: 0, is_active: 1 },
  { id: 2, stage_key: 'execution', label: '수행', sort_order: 20, color: '#7F77DD', requires_file: 0, is_active: 1 },
  { id: 6, stage_key: 'inspection', label: '검수', sort_order: 60, color: '#E63329', requires_file: 1, is_active: 1 },
];

const TEAM = [
  { id: 1, name: '박영업', role: 'manager' },
  { id: 2, name: '김피엠', role: 'team_lead' },
];

const WON_LEAD = {
  id: 88,
  customer_id: 7,
  customer_name: '삼성증권㈜',
  project_name: '차세대 트레이딩 시스템',
  stage: 'won',
  business_type: 'SI',
  region: '서울',
  expected_amount: 660000000,
  currency: 'KRW',
  assigned_to: 1,
};

async function mockApis(page) {
  await page.route('**/api/projects**', async (route, request) => {
    const url = request.url();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/projects\/stages/.test(url)) return json({ success: true, data: STAGES });
    if (request.method() === 'POST')
      return json({ success: true, id: 555, project_code: 'PRJ-2026-0001' });
    if (request.method() === 'GET')
      return json({ success: true, data: [], total: 0, page: 1, limit: 50 });
    return route.fallback();
  });
  await page.route('**/api/team**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: TEAM }),
    })
  );
  await page.route('**/api/leads**', async (route, request) => {
    const url = request.url();
    if (/autocomplete=1/.test(url))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [WON_LEAD] }),
      });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
  await page.route('**/api/contracts**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ id: 1207, contract_no: 'C-2026-0042', title: '트레이딩 시스템 계약' }],
      }),
    })
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* 무시 */
    }
  });
  await mockApis(page);
  await loginAsAdmin(page);
});

test('신규 폼 — 확장 메타 필드 렌더 + 단계 옵션 로드', async ({ page }) => {
  await page.goto('/#projects-legacy');
  await page.waitForSelector('#proj-open-form-btn', { timeout: 20000 });
  await page.click('#proj-open-form-btn');
  await page.waitForSelector('#p-code', { timeout: 10000 });

  for (const sel of ['#p-lead', '#p-start', '#p-end', '#p-pm', '#p-collab', '#p-headcount', '#p-customer-contact', '#p-stage']) {
    await expect(page.locator(sel)).toBeVisible();
  }
  // 단계 select 에 project_stages 옵션 로드 (첫 옵션 = 착수)
  await expect(page.locator('#p-stage option').first()).toHaveText('착수');
});

test('영업리드 선택 → 메타 자동 채움 + 계약 자동 연결 + 저장 페이로드', async ({ page }) => {
  await page.goto('/#projects-legacy');
  await page.waitForSelector('#proj-open-form-btn', { timeout: 20000 });
  await page.click('#proj-open-form-btn');
  await page.waitForSelector('#p-lead', { timeout: 10000 });

  // 2글자+ 검색 → 제안 (수주 배지)
  await page.fill('#p-lead', '삼성');
  await page.waitForSelector('.combobox-item', { timeout: 5000 });
  await expect(page.locator('.combobox-item').first()).toContainText('수주');
  await page.locator('.combobox-item').first().click();

  // ── 자동 채움 검증 ──
  await expect(page.locator('#p-lead-id')).toHaveValue('88');
  await expect(page.locator('#p-customer')).toHaveValue('삼성증권㈜');
  await expect(page.locator('#p-customer-id')).toHaveValue('7');
  await expect(page.locator('#p-name')).toHaveValue('차세대 트레이딩 시스템');
  await expect(page.locator('#p-amount')).toHaveValue('660000000');
  await expect(page.locator('#p-type')).toHaveValue('SI');
  await expect(page.locator('#p-assigned')).toHaveValue('1');
  // 연결 계약 자동 탐색
  await expect(page.locator('#p-contract-id')).toHaveValue('1207');
  await expect(page.locator('#p-contract-info')).toContainText('C-2026-0042');

  // ── 추가 입력 후 저장 → POST 페이로드 확장 메타 검증 ──
  await page.fill('#p-headcount', '6');
  await page.fill('#p-customer-contact', '김담당 과장');
  await page.fill('#p-start', '2026-07-01');

  const postPromise = page.waitForRequest(
    r => r.url().includes('/api/projects') && r.method() === 'POST'
  );
  await page.click('#proj-form-save-btn');
  const req = await postPromise;
  const body = req.postDataJSON();

  expect(body.lead_id).toBe(88);
  expect(body.customer_id).toBe(7);
  expect(body.contract_id).toBe(1207);
  expect(body.headcount).toBe(6);
  expect(body.customer_contact).toBe('김담당 과장');
  expect(body.start_date).toBe('2026-07-01');
  expect(body.stage).toBe('kickoff');
  expect(body.name).toBe('차세대 트레이딩 시스템');
});
