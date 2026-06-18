// =============================================================
// E2E — 프로젝트 상태값 관리자 설정화 (project_statuses)
//
// 검증 (API 모킹):
//   1) 목록 — 커스텀 상태('보류', amber)가 배지 색·라벨로 렌더
//   2) 편집 폼 — 상태 드롭다운이 API(project_statuses)에서 로드
//   3) 관리자 🏷 프로젝트 상태 탭 — 목록 + 완료(🏁) + 추가 버튼
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const STAGES = [
  { id: 1, stage_key: 'kickoff', label: '착수', sort_order: 10, color: '#93B4F9', requires_file: 0, is_active: 1 },
  { id: 2, stage_key: 'execution', label: '수행', sort_order: 20, color: '#7F77DD', requires_file: 0, is_active: 1 },
];
const STATUSES = [
  { id: 1, status_key: '진행중', label: '진행중', color: 'blue', sort_order: 10, is_active: 1, is_final: 0 },
  { id: 2, status_key: '보류', label: '보류', color: 'amber', sort_order: 25, is_active: 1, is_final: 0 },
  { id: 5, status_key: '완료', label: '완료', color: 'green', sort_order: 40, is_active: 1, is_final: 1 },
];
const PROJ = {
  id: 9,
  project_code: 'PRJ-2026-0009',
  name: '커스텀 상태 프로젝트',
  customer_name: '테스트㈜',
  project_type: 'EPC',
  contract_amount: 100000000,
  estimated_cost: 80000000,
  margin_pct: '20.00',
  status: '보류',
  status_label: '보류',
  status_color: 'amber',
  stage: 'execution',
  stage_label: '수행',
  assigned_name: '박영업',
  pm_name: '김피엠',
};

async function mockProjectApis(page) {
  await page.route('**/api/projects**', async (route, request) => {
    const url = request.url();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/projects\/statuses/.test(url)) return json({ success: true, data: STATUSES });
    if (/\/projects\/stages/.test(url)) return json({ success: true, data: STAGES });
    if (/\/projects\/9(\?|$)/.test(url) && request.method() === 'GET')
      return json({ success: true, data: PROJ });
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
});

test('목록 — 커스텀 상태 배지(보류·amber) + 편집 폼 상태 드롭다운 API 로드', async ({ page }) => {
  await mockProjectApis(page);
  await loginAsAdmin(page);
  await page.goto('/#projects');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });

  // 1) 목록 배지 — status_color(amber) 클래스 + status_label(보류)
  await expect(page.locator('tr[data-proj-id="9"] .badge-amber')).toContainText('보류');

  // 2) 편집 폼 — 상태 드롭다운이 project_statuses 에서 로드 ('보류' 옵션 + 선택)
  await page.click('tr[data-proj-id="9"] [data-action="edit-proj"]');
  await page.waitForSelector('#p-status', { timeout: 10000 });
  await expect(page.locator('#p-status')).toContainText('보류');
  await expect(page.locator('#p-status')).toContainText('완료');
  await expect(page.locator('#p-status')).toHaveValue('보류');
});

test('목록 [⚙️ 단계·상태 관리] 모달 — 단계/상태 서브탭 + 인라인 추가 폼 (관리자)', async ({ page }) => {
  await mockProjectApis(page); // statuses·stages·projects·team 모킹 (관리 모달의 ?include=all 포함)
  await loginAsAdmin(page);
  await page.goto('/#projects');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });

  // 관리자 → [⚙️ 단계·상태 관리] 버튼 노출 → 모달 오픈
  await expect(page.locator('#proj-manage-btn')).toBeVisible();
  await page.click('#proj-manage-btn');
  await page.waitForSelector('#pm-panel', { timeout: 10000 });

  // 기본 단계 탭 — 단계 목록
  await expect(page.locator('#pm-panel')).toContainText('착수');
  await expect(page.locator('#pm-panel')).toContainText('수행');

  // 상태 서브탭 전환 — 커스텀 상태(보류) + 완료(🏁)
  await page.click('.pm-tab[data-pm="statuses"]');
  await expect(page.locator('#pm-panel')).toContainText('보류');
  await expect(page.locator('#pm-panel')).toContainText('완료');
  await expect(page.locator('#pm-panel')).toContainText('🏁');

  // + 상태 추가 → 인라인 폼 (중첩 모달 없이 #pm-panel 스왑)
  await page.click('#pm-add');
  await expect(page.locator('#pm-panel')).toContainText('새 상태 추가');
  await expect(page.locator('#pm-f-label')).toBeVisible();
  // 취소 → 목록 복귀
  await page.click('#pm-f-cancel');
  await expect(page.locator('#pm-panel')).toContainText('보류');
});
