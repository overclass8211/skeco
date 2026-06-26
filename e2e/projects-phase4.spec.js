// =============================================================
// E2E — 프로젝트 마일스톤 재구성: 단계별 목표일 vs 실제 도달일 + Gap 3-state
//
// 검증 (API 모킹):
//   1) 목록 — 행에 단계 진척바 + D-day/지연 배지 (변경 없음)
//   2) 상세 — 마일스톤 노드(목표 vs 실제) + Gap 배지(지연/빠름) + 일정 Gap 요약 + 단계별 일정표
//             + 수금 연계 카드(미수금) + 수금관리 이동
//   3) 방어 — /milestones 가 실패해도 상세(메타/수금)는 표시
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const STAGES = [
  { id: 1, stage_key: 'kickoff', label: '착수', sort_order: 10, color: '#93B4F9', requires_file: 0, is_active: 1 },
  { id: 2, stage_key: 'execution', label: '수행', sort_order: 20, color: '#7F77DD', requires_file: 0, is_active: 1 },
  { id: 6, stage_key: 'inspection', label: '검수', sort_order: 60, color: '#E63329', requires_file: 1, is_active: 1 },
  { id: 7, stage_key: 'done', label: '완료', sort_order: 70, color: '#0F7A3F', requires_file: 0, is_active: 1 },
];

const PROJ = {
  id: 9,
  project_code: 'PRJ-2026-0009',
  name: '차세대 트레이딩 시스템',
  customer_name: '삼성증권㈜',
  project_type: 'SI',
  contract_amount: 660000000,
  status: '진행중',
  stage: 'inspection', // 현재 = 검수 (도달 안 된 첫 단계)
  stage_label: '검수',
  end_date: '2026-05-30', // 과거 → 목록 지연 배지
  contract_id: 1207,
  customer_id: 88, // 고객사 링크
  lead_id: 55, // 관련 영업리드 링크
  lead_name: '삼성증권 차세대 시스템 구축', // JOIN 으로 채워진 딜명
  assigned_name: '박영업',
  pm_name: '김피엠',
  headcount: 6,
};

// 마일스톤: 착수(빠름 -2, 산출물 2건), 수행(지연 +4, 1건), 검수(현재·미도달), 완료(미설정)
const MILESTONES = [
  { stage_key: 'kickoff', label: '착수', sort_order: 10, color: '#93B4F9', requires_file: 0, deliverable_guide: '계약서\n착수보고서\nWBS', milestone_id: 1, plan_date: '2026-05-03', actual_date: '2026-05-01', note: null, file_count: 2, updated_by_name: '관리자', updated_at: '2026-05-01T09:00:00' },
  { stage_key: 'execution', label: '수행', sort_order: 20, color: '#7F77DD', requires_file: 0, deliverable_guide: '중간보고서', milestone_id: 2, plan_date: '2026-06-01', actual_date: '2026-06-05', note: null, file_count: 1, updated_by_name: '관리자', updated_at: '2026-06-05T09:00:00' },
  { stage_key: 'inspection', label: '검수', sort_order: 60, color: '#E63329', requires_file: 1, deliverable_guide: '검수확인서', milestone_id: 3, plan_date: '2026-06-20', actual_date: null, note: null, file_count: 0, updated_by_name: null, updated_at: null },
  { stage_key: 'done', label: '완료', sort_order: 70, color: '#0F7A3F', requires_file: 0, deliverable_guide: '종료보고서', milestone_id: null, plan_date: null, actual_date: null, note: null, file_count: 0, updated_by_name: null, updated_at: null },
];

async function mockApis(page, opts = {}) {
  await page.route('**/api/projects**', async (route, request) => {
    const url = request.url();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/projects\/stages/.test(url)) return json({ success: true, data: STAGES });
    if (/\/projects\/9\/milestones/.test(url)) {
      if (opts.milestonesFails) return route.fulfill({ status: 404, body: 'Not Found' });
      return json({ success: true, data: MILESTONES });
    }
    if (/\/projects\/9(\?|$)/.test(url) && request.method() === 'GET')
      return json({ success: true, data: PROJ });
    if (request.method() === 'GET')
      return json({ success: true, data: [PROJ], total: 1, page: 1, limit: 50 });
    return route.fallback();
  });
  await page.route('**/api/payments**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          { id: 1, scheduled_amount: 330000000, paid_amount: 100000000, status: 'partial' },
          { id: 2, scheduled_amount: 330000000, paid_amount: 0, status: 'scheduled' },
        ],
      }),
    })
  );
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

test('목록 진척바 + 지연 배지', async ({ page }) => {
  await mockApis(page);
  await loginAsAdmin(page);
  await page.goto('/#projects-legacy');
  await page.reload({ waitUntil: 'domcontentloaded' }); // cold-start 해시 라우터 경합 회피
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });
  const row = page.locator('tr[data-proj-id="9"]');
  await expect(row).toContainText('검수');
  await expect(row).toContainText('지연');
});

test('컬럼 선택기 — 관련 영업리드/연결 계약 추가 + 활성화 시 목록 표시', async ({ page }) => {
  await mockApis(page);
  await loginAsAdmin(page);
  await page.goto('/#projects-legacy');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });

  // 컬럼 설정 모달 → 신규 선택 컬럼 노출 확인
  await page.click('#proj-cols-btn');
  await page.waitForSelector('#proj-col-apply', { timeout: 5000 });
  await expect(page.locator('#modal-box')).toContainText('관련 영업리드');
  await expect(page.locator('#modal-box')).toContainText('연결 계약');

  // 관련 영업리드 컬럼 체크 → 적용 → 목록 행에 딜명 표시
  await page.check('.proj-col-opt[value="lead_name"]');
  await page.click('#proj-col-apply');
  await expect(page.locator('tr[data-proj-id="9"]')).toContainText('삼성증권 차세대 시스템 구축');
});

test('상세 — 마일스톤 목표 vs 실제 + Gap + 일정표 + 수금 연계', async ({ page }) => {
  await mockApis(page);
  await loginAsAdmin(page);
  await page.goto('/#projects-legacy');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });
  await page.locator('tr[data-proj-id="9"] td').nth(1).click();
  await page.waitForSelector('[data-ms-stage]', { timeout: 10000 });

  // 마일스톤 노드 4개 + 현재 위치(검수) + 도달 카운트
  await expect(page.locator('[data-ms-stage]')).toHaveCount(4);
  await expect(page.locator('#modal-box')).toContainText('진행 단계');
  await expect(page.locator('#modal-box')).toContainText('현재 · 검수');
  await expect(page.locator('#modal-box')).toContainText('2/4 도달');

  // 메타 — 관련 영업리드 컬럼 추가 + 고객사/리드 클릭 링크 (data-go-*)
  await expect(page.locator('#modal-box')).toContainText('관련 영업리드');
  await expect(page.locator('#modal-box [data-go-lead="55"]')).toContainText(
    '삼성증권 차세대 시스템 구축'
  );
  await expect(page.locator('#modal-box [data-go-customer="88"]')).toContainText('삼성증권㈜');

  // 목표일 표시 + Gap 3-state
  await expect(page.locator('#modal-box')).toContainText('2026-05-03'); // 착수 목표일
  await expect(page.locator('#modal-box')).toContainText('2026-06-01'); // 수행 목표일
  await expect(page.locator('#modal-box')).toContainText('2일 빠름'); // 착수: 실제 5/1 - 목표 5/3 = -2
  await expect(page.locator('#modal-box')).toContainText('4일 지연'); // 수행: 실제 6/5 - 목표 6/1 = +4

  // 일정 Gap 요약 카드 (목표+실제 모두 있는 단계 2개 집계)
  await expect(page.locator('#modal-box')).toContainText('일정 Gap');
  await expect(page.locator('#modal-box')).toContainText('누적 지연');
  await expect(page.locator('#modal-box')).toContainText('비교 단계');

  // 단계별 일정 표 (목표 vs 실제 도달 + 산출물 건수)
  await expect(page.locator('#modal-box')).toContainText('단계별 일정');
  await expect(page.locator('#pd-sched')).toContainText('2026-05-01'); // 착수 실제 도달일
  await expect(page.locator('#pd-sched')).toContainText('2건'); // 착수 산출물 2건

  // 수금 연계 카드 — 미수금 = 660,000,000 - 100,000,000 = 560,000,000
  await expect(page.locator('#modal-box')).toContainText('수금 연계');
  await expect(page.locator('#modal-box')).toContainText('미수금 ₩560,000,000');
  await expect(page.locator('#pd-go-pay')).toBeVisible();

  // 수금관리 이동
  await page.click('#pd-go-pay');
  await expect.poll(() => page.url()).toContain('#payments');
});

test('방어 — /milestones 실패해도 상세(메타·수금)는 표시', async ({ page }) => {
  await mockApis(page, { milestonesFails: true });
  await loginAsAdmin(page);
  await page.goto('/#projects-legacy');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('tr[data-proj-id="9"]', { timeout: 20000 });
  await page.locator('tr[data-proj-id="9"] td').nth(1).click();

  // milestones 404 여도 상세 모달 + 메타 + 단계별 일정(빈 상태) 렌더
  await page.waitForSelector('#pd-sched', { timeout: 10000 });
  await expect(page.locator('#modal-box')).toContainText('차세대 트레이딩 시스템');
  await expect(page.locator('#pd-sched')).toContainText('등록된 단계가 없습니다');
  await expect(page.locator('[data-ms-stage]')).toHaveCount(0);
  // 수금 연계는 계약 기준이라 정상 표시
  await expect(page.locator('#modal-box')).toContainText('수금 연계');
});
