// =============================================================
// E2E — 고객사 모달 [🎯 360뷰] 탭
//
// 검증: 고객 360뷰 탭이 추가되어 모든 접점 통합 집계가 표시됨
//   - /api/customers (목록) + /:id/360view 는 mock (결정적)
//   - 로그인은 실서버, 프론트 정적파일은 디스크에서 신규 서빙
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const CID = 990360;
const CUST = { id: CID, name: 'E2E360테스트', region: '서울', industry: '소재', _isPrimary: 1 };

const VIEW360 = {
  success: true,
  data: {
    customer: { id: CID, name: 'E2E360테스트', industry: '소재', region: '서울' },
    summary: {
      deals: { count: 3, total_expected: 300000000 },
      quotes: { count: 2, total_amount: 50000000 },
      proposals: { count: 1, total_expected: 80000000 },
      contracts: { count: 1, total_amount: 120000000, active_count: 1 },
      payments: { count: 2, scheduled_total: 120000000, recognized_total: 60000000, overdue_count: 1 },
      support: { count: 1, open_count: 1 },
      activities: { count: 5 },
    },
    pipeline: [
      { stage: 'proposal', count: 2, amount: 160000000 },
      { stage: 'negotiation', count: 1, amount: 140000000 },
    ],
    timeline: [
      { type: 'contract', icon: '📜', title: '계약 C-2026-360 삼성전자 납품', date: '2026-06-10', amount: 120000000, status: 'approved' },
      { type: 'quote', icon: '💰', title: '견적 Q-360 초도물량', date: '2026-06-05', amount: 50000000, status: 'sent' },
    ],
  },
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/customers**', async (route, req) => {
    const url = req.url();
    if (/\/api\/customers\/\d+\/360view/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(VIEW360),
      });
    }
    if (/\/api\/customers\/\d+\/(quotes|proposals|contracts|payments)/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    }
    if (req.method() === 'GET' && /\/api\/customers(\?|$)/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [CUST], pagination: { total: 1 } }),
      });
    }
    return route.fallback();
  });
});

test('고객사 모달 — 360뷰 탭에 통합 집계 + 타임라인 표시', async ({ page }) => {
  await page.goto('/#customers');
  await page.waitForSelector('#cust-search', { timeout: 15000 });

  // 목록 로드(mock) 완료 대기 후 모달 직접 오픈 (행 클릭보다 안정적)
  await page.waitForFunction(
    () => typeof CustomersPage !== 'undefined' && CustomersPage.data && CustomersPage.data.length > 0,
    { timeout: 10000 }
  );
  await page.evaluate(id => CustomersPage.showCustomerModal(id), CID);

  // 360뷰 탭 버튼 표시 확인 → JS 클릭으로 전환 (다른 로더 토스트 간섭 회피)
  const tab = page.locator('.cust-mtab[data-mtab="view360"]');
  await expect(tab).toBeVisible({ timeout: 5000 });
  await page.evaluate(() =>
    document.querySelector('.cust-mtab[data-mtab="view360"]').click()
  );

  // 360뷰 콘텐츠 — KPI 요약 + 파이프라인 + 타임라인
  const wrap = page.locator('#cm-tab-view360');
  await expect(wrap).toContainText('진행 딜', { timeout: 5000 });
  await expect(wrap).toContainText('영업 파이프라인 분포');
  await expect(wrap).toContainText('최근 통합 타임라인');
  await expect(wrap).toContainText('계약 C-2026-360 삼성전자 납품');

  // 카운트 배지 = 전체 접점 합계 (3+2+1+1+2+1 = 10)
  await expect(page.locator('#cm-view360-cnt')).toHaveText('10', { timeout: 5000 });
});
