// =============================================================
// E2E — 매출 포캐스트 (파이프라인 가중 예측, Phase A)
//
// 검증: 메인 섹션 "매출 포캐스트" 페이지 — 필터·KPI·차트·상세 테이블
//   - /api/forecast, /api/team 은 mock (결정적)
//   - 로그인은 실서버, 프론트 정적파일은 디스크 신규 서빙
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const FORECAST = {
  success: true,
  data: {
    year: 2026,
    base_month: '2026-07',
    unit: '백만원',
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      expected: i === 6 ? 39000 : 4000,
      committed: i === 4 ? 2400 : 0,
      weighted: i === 6 ? 26700 : 2000,
      prev_expected: 0,
    })),
    summary: {
      base_expected: 39000, base_committed: 0, base_weighted: 26700,
      year_expected: 87400, year_committed: 2400, year_weighted: 45920,
      yoy_pct: null, deal_count: 2,
    },
    details: [
      { lead_id: 1, project_name: '평택 P4 식각가스 C4F6 연간공급', customer: '삼성전자',
        business_type: '식각가스', region: '국내', assignee: '이식각', dept: '식각가스',
        expected_amount: 12000, probability: 65, weighted: 7800,
        expected_close_month: '2026-07', last_activity_at: '2026-06-12', status: '입찰', stage_role: 'active' },
      { lead_id: 2, project_name: 'A6 OLED 블루도판트 공급', customer: '삼성디스플레이',
        business_type: '디스플레이소재', region: '국내', assignee: '정디스플', dept: '디스플레이소재',
        expected_amount: 6000, probability: 80, weighted: 4800,
        expected_close_month: '2026-08', last_activity_at: '2026-06-10', status: '협상', stage_role: 'active' },
    ],
  },
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/forecast**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(FORECAST),
  }));
  await page.route('**/api/team', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [
      { id: 1, name: '이식각', team: '식각가스' },
      { id: 3, name: '정디스플', team: '디스플레이소재' },
    ] }),
  }));
});

test('매출 포캐스트 — KPI·차트·상세 테이블 렌더 + 요약 토글', async ({ page }) => {
  await page.goto('/#forecast');

  // 헤더
  await expect(page.locator('.fcst-head h2')).toContainText('파이프라인 기반 예상 매출 FCST', { timeout: 15000 });

  // KPI — 연간 예상매출 87,400
  await expect(page.locator('#fcst-kpis')).toContainText('87,400', { timeout: 5000 });
  await expect(page.locator('#fcst-kpis')).toContainText('45,920'); // Weighted

  // 차트 캔버스 존재
  await expect(page.locator('#fcst-chart')).toBeVisible();

  // 상세 테이블 — 딜 표시
  const table = page.locator('#fcst-table');
  await expect(table).toContainText('평택 P4 식각가스 C4F6 연간공급');
  await expect(table).toContainText('삼성디스플레이');
  await expect(page.locator('#fcst-table tbody tr')).toHaveCount(2);

  // 요약 보기 토글 → 사업구분 집계
  await page.locator('.fcst-toggle[data-mode="summary"]').click();
  await expect(table).toContainText('식각가스');
  await expect(table).toContainText('디스플레이소재');
});
