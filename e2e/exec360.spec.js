// =============================================================
// E2E — 임원 360 요약 (전사 대시보드)
//
// 검증: 메뉴 진입 → KPI + 단계 분포 + Top 계정 + 리스크 + 드릴다운
//   - /api/customer360/exec-summary 는 mock (결정적)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SUMMARY = {
  success: true,
  data: {
    kpis: { weighted_expected: 48700000000, active_deals: 36, win_rate: 28, avg_health: 'B+', open_quality: 11, capa_short_accounts: 4 },
    stage_distribution: [
      { stage: 'discovery', label: '발굴', count: 5 },
      { stage: 'sample', label: '샘플', count: 6 },
      { stage: 'evaluation', label: '평가', count: 14 },
      { stage: 'specin', label: 'Spec-in', count: 5 },
      { stage: 'massprod', label: '양산', count: 3 },
      { stage: 'delivery', label: '납품', count: 0 },
    ],
    top_accounts: [
      { id: 990777, name: 'E2E임원고객', weighted: 12800000000, active: 5, won: 1, health_grade: 'A-', risks: [{ level: 'high', label: '품질 1' }] },
    ],
    risks: {
      capa_short: [{ name: 'SK하이닉스', gap: 6000 }],
      quality: [{ name: '삼성전자', title: '순도 편차', severity: 'high', type: 'VOC' }],
      eval_delay: [{ name: 'Intel', material: 'SOC 하드마스크 · PoC' }],
    },
  },
};

// KPI 카드 클릭 시 lazy-load 되는 /exec-kpi/:kpi 별 결정적 fixture
const KPI_LISTS = {
  weighted: { kpi: 'weighted', total: 1, items: [{ name: 'E2E임원고객', weighted: 12800000000, active: 5 }] },
  quality: { kpi: 'quality', total: 1, items: [{ name: '삼성전자', title: '순도 편차', severity: 'high', type: 'VOC' }] },
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/customer360/exec-summary', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY) })
  );
  await page.route('**/api/customer360/exec-kpi/**', route => {
    const kpi = route.request().url().split('/exec-kpi/')[1].split(/[?#]/)[0];
    const data = KPI_LISTS[kpi] || { kpi, total: 0, items: [] };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.route('**/api/customer360/health-config', route => {
    const config = {
      base: 60,
      weights: { won: 7, wonMax: 20, active: 2, activeMax: 10, contract: 8, overdue: 8, support: 5, quality: 5, capa: 8 },
      thresholds: { 'A+': 90, A: 80, 'B+': 70, B: 60, C: 45 },
    };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { config, defaults: config } }) });
  });
});

test('임원 360 요약 — KPI + 단계 분포 + Top 계정 + 리스크', async ({ page }) => {
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-kpi', { timeout: 15000 });

  await expect(page.locator('#ex-body')).toContainText('가중 예상매출');
  await expect(page.locator('#ex-body')).toContainText('CAPA 부족 계정');
  await expect(page.locator('#ex-body .ex-kpi')).toHaveCount(6);

  // 단계 분포 (6 단계 — 스트림/퍼널 그래픽, 클릭 가능)
  await expect(page.locator('#ex-body .ex-fn-col')).toHaveCount(6);

  // Top 계정 + 리스크
  await expect(page.locator('#ex-body')).toContainText('E2E임원고객');
  await expect(page.locator('#ex-body')).toContainText('순도 편차');

  // 드릴다운: 계정 행 클릭 → 고객·제품 360뷰로 이동
  await page.locator('#ex-body tr[data-acct]').first().click();
  await expect(page).toHaveURL(/#customer360/, { timeout: 5000 });
});

test('임원 360 요약 — KPI 카드 클릭 시 근거 모달', async ({ page }) => {
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-kpi[data-kpi]', { timeout: 15000 });

  // 가중 예상매출 카드 클릭 → 근거 모달 + 계정별 내역
  await page.locator('.ex-kpi[data-kpi="weighted"]').click();
  await expect(page.locator('#modal-overlay')).toContainText('가중 예상매출 — 근거');
  await expect(page.locator('#modal-overlay')).toContainText('E2E임원고객');
  await page.locator('#modal-overlay .modal-close, #modal-overlay [class*="close"]').first().click();

  // 품질 오픈 카드 클릭 → VOC/NCR 목록
  await page.locator('.ex-kpi[data-kpi="quality"]').click();
  await expect(page.locator('#modal-overlay')).toContainText('품질 오픈');
  await expect(page.locator('#modal-overlay')).toContainText('순도 편차');
});

test('임원 360 요약 — 평균 Health 모달의 기준 패널 + 편집 진입', async ({ page }) => {
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-kpi[data-kpi="health"]', { timeout: 15000 });

  await page.locator('.ex-kpi[data-kpi="health"]').click();
  // 산식 기준 패널 + 등급 라인 노출
  await expect(page.locator('#ex-health-cfg')).toContainText('등급 산식 기준');
  await expect(page.locator('#ex-health-cfg')).toContainText('A+ ≥90');

  // admin → '기준 설정' 편집 진입 → 입력 폼 노출
  await page.locator('#ex-hcfg-edit').click();
  await expect(page.locator('#ex-health-cfg [data-hf="base"]')).toBeVisible();
  await expect(page.locator('#ex-health-cfg [data-hf="t_C"]')).toBeVisible();
});
