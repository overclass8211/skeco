// =============================================================
// E2E — 프로젝트 UX 개선
//   #2 ESC = [닫기] (상세 즉시 닫힘 / 편집폼 dirty 시 변경사항 컨펌)
//   #3 목록 컬럼 헤더 드래그로 순서 변경 (사용자별 localStorage)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const STAGES = [
  { id: 1, stage_key: 'kickoff', label: '착수', sort_order: 10, color: '#93B4F9', requires_file: 0, is_active: 1 },
];
const PROJ = {
  id: 9, project_code: 'PRJ-2026-0009', name: '차세대 시스템', customer_name: '삼성증권',
  project_type: 'SI', contract_amount: 660000000, status: '진행중', stage: 'kickoff', stage_label: '착수',
  assigned_name: '박영업',
};

async function mock(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('oci_onboarding_done', '1'); } catch (_) { /* */ }
  });
  await page.route('**/api/projects**', async (route, request) => {
    const url = request.url();
    const json = obj => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/projects\/stages/.test(url)) return json({ success: true, data: STAGES });
    if (/\/projects\/statuses/.test(url)) return json({ success: true, data: [{ status_key: '진행중', label: '진행중', color: 'blue', is_final: 0 }] });
    if (/\/projects\/9\/milestones(\?|$)/.test(url)) return json({ success: true, data: [] });
    if (/\/projects\/9(\?|$)/.test(url) && request.method() === 'GET') return json({ success: true, data: PROJ });
    if (request.method() === 'GET') return json({ success: true, data: [PROJ], total: 1, page: 1, limit: 50 });
    return route.fallback();
  });
  await page.route('**/api/payments**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route('**/api/team**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [{ id: 1, name: '박영업', role: 'manager' }] }) }));
}

async function gotoList(page) {
  await page.goto('/#projects-legacy');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });
}

test('#2 ESC — 상세 모달(읽기전용) 즉시 닫힘', async ({ page }) => {
  await mock(page);
  await loginAsAdmin(page);
  await gotoList(page);
  await page.locator('tr[data-proj-id="9"] td').nth(1).click();
  await page.waitForSelector('#modal-box', { timeout: 10000 });
  await expect(page.locator('#modal-overlay.active')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-overlay.active')).toHaveCount(0); // 닫힘
});

test('#2 ESC — 편집폼 수정 중에는 변경사항 컨펌 표시(즉시 안 닫힘)', async ({ page }) => {
  await mock(page);
  await loginAsAdmin(page);
  await gotoList(page);
  await page.click('#proj-open-form-btn');
  await page.waitForSelector('#p-name', { timeout: 5000 });
  await page.fill('#p-name', '수정중'); // dirty
  await page.keyboard.press('Escape');
  await expect(page.locator('#__modal-discard-overlay')).toBeVisible(); // 컨펌 표시
  await expect(page.locator('#modal-overlay.active')).toHaveCount(1); // 모달 유지
  // 컨펌에서 ESC = "계속 편집"(컨펌만 닫힘)
  await page.keyboard.press('Escape');
  await expect(page.locator('#__modal-discard-overlay')).toHaveCount(0);
  await expect(page.locator('#modal-overlay.active')).toHaveCount(1);
});

test('#3 컬럼 순서 — 저장된 순서가 헤더에 반영', async ({ page }) => {
  await mock(page);
  await page.addInitScript(() => {
    try { localStorage.setItem('oci_proj_col_order', JSON.stringify(['customer_name', 'name'])); } catch (_) { /* */ }
  });
  await loginAsAdmin(page);
  await gotoList(page);
  // 저장 순서대로 고객사(customer_name) 가 프로젝트명(name) 보다 앞
  const first = page.locator('thead th[data-col-key]').first();
  await expect(first).toHaveAttribute('data-col-key', 'customer_name');
});

test('#3 컬럼 순서 — 헤더 드래그로 순서 변경 + 저장', async ({ page }) => {
  await mock(page);
  await loginAsAdmin(page);
  await gotoList(page);
  // 기본: 첫 데이터 컬럼 = 프로젝트명(name)
  await expect(page.locator('thead th[data-col-key]').first()).toHaveAttribute('data-col-key', 'name');

  // 고객사(customer_name) 헤더를 프로젝트명(name) 앞으로 드래그 (Sortable forceFallback → 마우스 이벤트)
  const src = page.locator('thead th[data-col-key="customer_name"]');
  const dst = page.locator('thead th[data-col-key="name"]');
  const sb = await src.boundingBox();
  const db = await dst.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 4, { steps: 3 });
  await page.mouse.move(db.x + 4, db.y + db.height / 2, { steps: 12 });
  await page.mouse.up();

  // localStorage 저장 순서에서 customer_name 이 name 보다 앞
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const o = JSON.parse(localStorage.getItem('oci_proj_col_order') || '[]');
        return o.indexOf('customer_name') !== -1 && o.indexOf('customer_name') < o.indexOf('name');
      })
    )
    .toBe(true);
  // 재렌더 후 헤더에도 반영
  await expect(page.locator('thead th[data-col-key]').first()).toHaveAttribute('data-col-key', 'customer_name');
});
