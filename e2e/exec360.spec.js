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

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/customer360/exec-summary', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY) })
  );
});

test('임원 360 요약 — KPI + 단계 분포 + Top 계정 + 리스크', async ({ page }) => {
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-kpi', { timeout: 15000 });

  await expect(page.locator('#ex-body')).toContainText('가중 예상매출');
  await expect(page.locator('#ex-body')).toContainText('CAPA 부족 계정');
  await expect(page.locator('#ex-body .ex-kpi')).toHaveCount(6);

  // 단계 분포 (6 단계 — 가로 흐름형)
  await expect(page.locator('#ex-body .ex-fstep')).toHaveCount(6);

  // Top 계정 + 리스크
  await expect(page.locator('#ex-body')).toContainText('E2E임원고객');
  await expect(page.locator('#ex-body')).toContainText('순도 편차');

  // 드릴다운: 계정 행 클릭 → 고객·제품 360뷰로 이동
  await page.locator('#ex-body tr[data-acct]').first().click();
  await expect(page).toHaveURL(/#customer360/, { timeout: 5000 });
});
