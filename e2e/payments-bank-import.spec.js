// =============================================================
// E2E — 수금관리 > 🏦 은행 거래내역 가져오기 (자동 매칭)
//
// 백엔드 /bank/match·/bank/apply 를 UI 에 연결.
// 검증(API 모킹): 헤더 [🏦 은행 거래내역] → 붙여넣기 → 분석(컬럼 매핑) →
//   자동 매칭(/bank/match) → 매칭 확정 테이블 → 입금 등록(/bank/apply) → 모달 닫힘
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const MATCH = {
  success: true,
  data: {
    matches: [
      {
        row_index: 0,
        bank: { date: '2026-08-11', amount: 5610000, name: '가나상사', memo: '8월 잔금' },
        candidates: [
          {
            schedule_id: 501,
            customer_name: '가나상사',
            contract_name: '알파SI 구축',
            stage_name: '잔금',
            scheduled_amount: 5610000,
            remaining: 5610000,
            due_date: '2026-08-10',
            score: 150,
            reasons: ['잔액 정확 일치', '입금자명 일치'],
            confidence: 'high',
          },
        ],
        suggested_schedule_id: 501,
        suggested_amount: 5610000,
      },
    ],
    summary: { total: 1, matched: 1, unmatched: 0 },
  },
};

async function mockApi(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

    if (/\/bank\/match/.test(url) && method === 'POST') return json(MATCH);
    if (/\/bank\/apply/.test(url) && method === 'POST')
      return json({ success: true, data: { created: 1, results: [{ schedule_id: 501, new_status: 'collected' }] } });

    if (/\/dashboard/.test(url))
      return json({
        success: true,
        data: {
          kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 },
          monthly_trend: [],
          overdue_by_customer: [],
        },
      });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'], notify_email: '' } });
    if (/\/notifications/.test(url)) return json({ success: true, data: [], unread_count: 0 });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: [] });
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* 무시 */
    }
  });
  await mockApi(page);
  await loginAsAdmin(page);
});

test('은행 거래내역 — 붙여넣기 → 매핑 → 자동 매칭 → 입금 등록', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-bank', { timeout: 20000 });

  // 모달 열기
  await page.click('#pay-btn-bank');
  await page.waitForSelector('#bk-body', { timeout: 10000 });

  // 붙여넣기 모드 전환 → 데이터 입력
  await page.click('.bk-src[data-src="paste"]');
  await page.fill('#bk-paste', '입금일,입금액,입금자명,적요\n2026-08-11,5610000,가나상사,8월 잔금');
  await page.click('#bk-analyze');

  // 매핑 단계 (자동 추정) → 자동 매칭
  await page.waitForSelector('.bk-map', { timeout: 10000 });
  await page.click('#bk-match');

  // 매칭 확정 단계 — 후보 + 등록 금액 표시
  await page.waitForSelector('#bk-apply', { timeout: 10000 });
  await expect(page.locator('#bk-body')).toContainText('자동 매칭');
  await expect(page.locator('.bk-sched')).toContainText('가나상사');
  await expect(page.locator('.bk-sched')).toContainText('잔금');
  await expect(page.locator('.bk-amt')).toHaveValue('5610000');

  // 입금 등록 → 모달 닫힘
  await page.click('#bk-apply');
  await expect(page.locator('#bk-apply')).toBeHidden({ timeout: 5000 });
});
