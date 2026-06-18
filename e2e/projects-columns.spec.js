// =============================================================
// E2E — 프로젝트 목록 컬럼 사용자 설정 (선택 컬럼 토글 + localStorage 유지)
//
// 검증 (API 모킹):
//   1) 기본 목록 — 핵심 컬럼만, 선택 컬럼(PM·담당고객) 미표시
//   2) ⚙️ 컬럼 설정 → PM·담당고객 추가 → 헤더·값 표시 + localStorage 저장 + 새로고침 유지
//   3) 기본값 복원 → 선택 컬럼 제거
//
// 참고: 각 테스트는 격리된 컨텍스트(빈 localStorage)에서 시작 →
//       oci_proj_columns 가 테스트 간 누수되지 않음 (별도 정리 불필요)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const STAGES = [
  { id: 1, stage_key: 'kickoff', label: '착수', sort_order: 10, color: '#93B4F9', requires_file: 0, is_active: 1 },
  { id: 2, stage_key: 'execution', label: '수행', sort_order: 20, color: '#7F77DD', requires_file: 0, is_active: 1 },
];

const PROJ = {
  id: 9,
  project_code: 'PRJ-2026-0009',
  name: '차세대 트레이딩 시스템',
  customer_name: '삼성증권㈜',
  customer_contact: '이대리',
  project_type: 'SI',
  contract_amount: 660000000,
  estimated_cost: 520000000,
  margin_pct: '21.21',
  status: '진행중',
  stage: 'execution',
  stage_label: '수행',
  start_date: '2026-05-02',
  end_date: '2026-09-15',
  due_date: '2026-09-30',
  assigned_name: '박영업',
  pm_name: '김피엠',
  headcount: 6,
  collaborators: JSON.stringify([{ id: 2, name: '최협업' }]),
  notes: '핵심 전략 프로젝트',
};

async function mockApis(page) {
  await page.route('**/api/projects**', async (route, request) => {
    const url = request.url();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/projects\/stages/.test(url)) return json({ success: true, data: STAGES });
    if (request.method() === 'GET')
      return json({ success: true, data: [PROJ], total: 1, page: 1, limit: 50 });
    return route.fallback();
  });
  await page.route('**/api/team**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [{ id: 1, name: '박영업', role: 'manager' }] }),
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

async function gotoProjects(page) {
  await page.goto('/#projects');
  await page.reload({ waitUntil: 'domcontentloaded' }); // cold-start 해시 라우터 경합 회피
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });
}

test('기본 목록 — 선택 컬럼(PM·담당고객) 미표시', async ({ page }) => {
  await gotoProjects(page);
  const head = page.locator('table.data-table thead');
  await expect(head).toContainText('프로젝트명'); // 핵심 컬럼
  await expect(head).toContainText('마진율'); // 핵심 컬럼
  await expect(head).not.toContainText('PM'); // 선택 컬럼 — 기본 OFF
  await expect(head).not.toContainText('담당고객'); // 선택 컬럼 — 기본 OFF
  // PM 이름(김피엠)은 기본 컬럼에 없음
  await expect(page.locator('tr[data-proj-id="9"]')).not.toContainText('김피엠');
});

test('컬럼 설정 — PM·담당고객 추가 → 표시 + localStorage 유지', async ({ page }) => {
  await gotoProjects(page);
  await page.click('#proj-cols-btn');
  await page.waitForSelector('#proj-col-apply', { timeout: 5000 });
  await page.locator('.proj-col-opt[value="pm"]').check();
  await page.locator('.proj-col-opt[value="customer_contact"]').check();
  await page.click('#proj-col-apply');

  // 헤더 + 값 표시
  const head = page.locator('table.data-table thead');
  await expect(head).toContainText('PM');
  await expect(head).toContainText('담당고객');
  await expect(page.locator('tr[data-proj-id="9"]')).toContainText('김피엠');
  await expect(page.locator('tr[data-proj-id="9"]')).toContainText('이대리');

  // localStorage 저장 확인
  const saved = await page.evaluate(() => localStorage.getItem('oci_proj_columns'));
  expect(saved).toContain('pm');
  expect(saved).toContain('customer_contact');

  // 새로고침 후에도 유지
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });
  await expect(page.locator('tr[data-proj-id="9"]')).toContainText('김피엠');
});

test('기본값 복원 — 선택 컬럼 모두 제거', async ({ page }) => {
  await gotoProjects(page);
  // 먼저 PM 추가
  await page.click('#proj-cols-btn');
  await page.waitForSelector('#proj-col-apply', { timeout: 5000 });
  await page.locator('.proj-col-opt[value="pm"]').check();
  await page.click('#proj-col-apply');
  await expect(page.locator('tr[data-proj-id="9"]')).toContainText('김피엠');

  // 기본값 복원
  await page.click('#proj-cols-btn');
  await page.waitForSelector('#proj-col-reset', { timeout: 5000 });
  await page.click('#proj-col-reset');
  await expect(page.locator('tr[data-proj-id="9"]')).not.toContainText('김피엠');
  const saved = await page.evaluate(() => localStorage.getItem('oci_proj_columns'));
  expect(saved).toBe('[]');
});
