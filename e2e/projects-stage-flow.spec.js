// =============================================================
// E2E — 프로젝트 마일스톤 편집: 노드 클릭 → 목표일·실제 도달일 입력 → 저장
//
// 검증 (API 모킹 — 상태 유지 mock):
//   1) 일반 단계 노드 클릭 → 편집 모달 → 목표일+실제일 입력 → 저장 → 현재 위치·Gap 갱신
//   2) 검수(requires_file) 단계 — 실제 도달일 입력 후 파일 없이 저장 시 프론트 게이트 차단
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const STAGES = [
  { id: 1, stage_key: 'kickoff', label: '착수', sort_order: 10, color: '#93B4F9', requires_file: 0, is_active: 1 },
  { id: 2, stage_key: 'execution', label: '수행', sort_order: 20, color: '#7F77DD', requires_file: 0, is_active: 1 },
  { id: 6, stage_key: 'inspection', label: '검수', sort_order: 60, color: '#E63329', requires_file: 1, is_active: 1 },
];
const LABEL = Object.fromEntries(STAGES.map(s => [s.stage_key, s.label]));

function baseProj(stage) {
  return {
    id: 9,
    project_code: 'PRJ-2026-0009',
    name: '차세대 트레이딩 시스템',
    customer_name: '삼성증권㈜',
    project_type: 'SI',
    contract_amount: 660000000,
    status: '진행중',
    due_date: null,
    start_date: '2026-05-02',
    end_date: '2026-09-15',
    assigned_name: '박영업',
    pm_name: '김피엠',
    headcount: 6,
    stage,
    stage_label: LABEL[stage] || '',
  };
}

async function mockApis(page) {
  // 초기 상태: 착수만 도달(실제일 있음), 수행·검수 미도달
  const state = {
    stage: 'execution',
    ms: {
      kickoff: { plan_date: '2026-05-01', actual_date: '2026-05-02', file_name: null },
      execution: { plan_date: null, actual_date: null, file_name: null },
      inspection: { plan_date: null, actual_date: null, file_name: null },
    },
  };
  const buildMilestones = () =>
    STAGES.map(s => ({
      stage_key: s.stage_key,
      label: s.label,
      sort_order: s.sort_order,
      color: s.color,
      requires_file: s.requires_file,
      deliverable_guide: s.stage_key === 'inspection' ? '검수확인서' : '계약서\n착수보고서',
      milestone_id: 1,
      plan_date: state.ms[s.stage_key].plan_date,
      actual_date: state.ms[s.stage_key].actual_date,
      note: null,
      file_count: state.ms[s.stage_key].file_count || 0,
      updated_by_name: '관리자',
      updated_at: '2026-06-10T12:00:00',
    }));
  const recompute = () => {
    let cur = null;
    for (const s of STAGES) {
      if (!state.ms[s.stage_key].actual_date) {
        cur = s.stage_key;
        break;
      }
    }
    state.stage = cur || STAGES[STAGES.length - 1].stage_key;
  };

  await page.route('**/api/projects**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

    if (/\/projects\/stages/.test(url)) return json({ success: true, data: STAGES });
    // 산출물 목록/업로드 (files 분리 엔드포인트)
    if (/\/projects\/9\/milestones\/\w+\/files/.test(url) && method === 'GET')
      return json({ success: true, data: [] });
    if (/\/projects\/9\/milestones\/\w+\/files/.test(url) && method === 'POST') {
      const key = url.match(/\/milestones\/(\w+)\/files/)[1];
      state.ms[key].file_count = (state.ms[key].file_count || 0) + 1;
      return json({ success: true, count: 1 });
    }
    if (/\/projects\/9\/milestones\/(\w+)$/.test(url) && method === 'PUT') {
      const key = url.match(/\/milestones\/(\w+)$/)[1];
      let payload = {};
      try {
        payload = JSON.parse(request.postData() || '{}');
      } catch (_) {
        payload = {};
      }
      // 증빙필수 + 실제일 + 산출물 0건 → 400 게이트 (백엔드 동작 모사)
      const reqFile = STAGES.find(s => s.stage_key === key)?.requires_file;
      if (payload.actual_date && reqFile && (state.ms[key].file_count || 0) === 0)
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: '증빙 산출물 필요', requires_file: true }),
        });
      state.ms[key] = {
        plan_date: payload.plan_date || null,
        actual_date: payload.actual_date || null,
        file_count: state.ms[key].file_count || 0,
      };
      recompute();
      return json({ success: true, data: { stage: state.stage, status_synced: false } });
    }
    if (/\/projects\/9\/milestones(\?|$)/.test(url))
      return json({ success: true, data: buildMilestones() });
    if (/\/projects\/9(\?|$)/.test(url) && method === 'GET')
      return json({ success: true, data: baseProj(state.stage) });
    if (method === 'GET')
      return json({ success: true, data: [baseProj(state.stage)], total: 1, page: 1, limit: 50 });
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

async function openDetail(page) {
  await page.goto('/#projects');
  await page.reload({ waitUntil: 'domcontentloaded' }); // cold-start 해시 라우터 경합 회피
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });
  await page.locator('tr[data-proj-id="9"] td').nth(1).click(); // 이름 셀 클릭 (체크박스 회피)
  await page.waitForSelector('[data-ms-stage]', { timeout: 10000 });
}

test('일반 단계 노드 클릭 → 목표일·실제일 입력 → 저장 → 갱신', async ({ page }) => {
  await openDetail(page);

  // 노드 3개 + 현재 = 수행(착수만 도달)
  await expect(page.locator('[data-ms-stage]')).toHaveCount(3);
  await expect(page.locator('#modal-box')).toContainText('현재 · 수행');
  await expect(page.locator('#modal-box')).toContainText('1/3 도달');

  // 수행 노드 클릭 → 마일스톤 편집 모달 (산출물 첨부 가능 · requires_file=0 → 필수 아님)
  await page.click('[data-ms-stage="execution"]');
  await page.waitForSelector('#ms-save', { timeout: 5000 });
  await expect(page.locator('#ms-plan')).toBeVisible();
  await expect(page.locator('#ms-actual')).toBeVisible();
  await expect(page.locator('#ms-files-input')).toBeVisible(); // 산출물 다중 첨부 입력

  // 목표 6/1 + 실제 6/5 입력 → 저장
  await page.fill('#ms-plan', '2026-06-01');
  await page.fill('#ms-actual', '2026-06-05');
  await page.click('#ms-save');

  // 상세 재오픈: 수행 도달 → 현재=검수, 2/3 도달, Gap '4일 지연'
  await page.waitForSelector('[data-ms-stage]', { timeout: 10000 });
  await expect(page.locator('#modal-box')).toContainText('현재 · 검수');
  await expect(page.locator('#modal-box')).toContainText('2/3 도달');
  await expect(page.locator('#modal-box')).toContainText('4일 지연');
});

test('검수(📎 필수) — 실제 도달일 입력 후 산출물 없이 저장 시 프론트 게이트 차단', async ({
  page,
}) => {
  await openDetail(page);

  await page.click('[data-ms-stage="inspection"]');
  await page.waitForSelector('#ms-save', { timeout: 5000 });
  // 검수 단계 = 산출물 입력 + "1건 이상 필수" 안내
  await expect(page.locator('#ms-files-input')).toBeVisible();
  await expect(page.locator('#modal-box')).toContainText('1건 이상 필수');
  // 예상 산출물 음영 가이드 노출
  await expect(page.locator('#modal-box')).toContainText('예상 산출물');

  // 실제 도달일 입력 후 산출물 없이 저장 → 게이트로 모달 잔류
  await page.fill('#ms-actual', '2026-06-25');
  await page.click('#ms-save');
  await expect(page.locator('#ms-files-input')).toBeVisible(); // 모달 유지
  await expect(page.locator('#ms-save')).toBeVisible();
});
