// =============================================================
// E2E — 수금관리 > 미수금 탭 > 연체 알림 (B1-2)
//
// 백엔드 B1-1(payment_notifications + scan + 재무팀 메일)을 UI 에 연결.
// 검증(API 모킹):
//   ⚠️ 미수금 탭 → 액션바(🔔 연체 알림 배지 · ↻ 지금 스캔 · 📧 재무팀 메일 설정) 표시
//   → 재무팀 메일 입력·저장 → 지금 스캔 → 알림 모달 열기(목록 항목) → 모두 읽음
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const NOTIF = {
  id: 9001,
  schedule_id: 555,
  contract_id: 77,
  customer_name: '연체상사',
  kind: 'overdue',
  overdue_days: 42,
  amount: 3300000,
  channel: 'inapp',
  status: 'unread',
  payload_json: JSON.stringify({
    stage: '잔금',
    contract_name: '알파SI 구축',
    due_date: '2026-04-20',
    currency: 'KRW',
  }),
};

async function mockApi(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

    // ── 연체 알림 ──
    if (/\/notifications\/scan/.test(url) && method === 'POST')
      return json({
        success: true,
        data: { overdue_total: 1, created_inapp: 1, created_email: 1, emailed: false },
      });
    if (/\/notifications\/.*\/read/.test(url) && method === 'PUT') return json({ success: true });
    if (/\/notifications/.test(url) && method === 'GET') {
      if (/status=unread/.test(url)) return json({ success: true, data: [], unread_count: 2 });
      return json({ success: true, data: [NOTIF], unread_count: 2 });
    }

    // ── 설정 ──
    if (/\/config/.test(url) && method === 'PUT') return json({ success: true });
    if (/\/config/.test(url))
      return json({
        success: true,
        data: {
          stage_types: ['착수금', '중도금', '잔금', '기타'],
          default_currency: 'KRW',
          allowed_currencies: ['KRW'],
          notify_email: '',
        },
      });

    // ── 기타 ──
    if (/\/dashboard/.test(url))
      return json({
        success: true,
        data: {
          kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 },
          monthly_trend: [],
          overdue_by_customer: [],
        },
      });
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

test('미수금 탭 — 알림 액션바 + 재무팀 메일 저장 + 스캔 + 알림 모달', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('.tab-bar', { timeout: 20000 });

  // ⚠️ 미수금 탭으로 전환
  await page.click('.tab-btn[data-tab="overdue"]');
  await page.waitForSelector('#pay-btn-alerts', { timeout: 10000 });

  // 미읽음 배지 (2)
  await expect(page.locator('#pay-alert-badge')).toBeVisible();
  await expect(page.locator('#pay-alert-badge')).toHaveText('2');

  // 재무팀 메일 입력 + 저장 (PUT /config mock success — 에러 없이 진행)
  await page.fill('#pay-notify-email', 'finance@corp.com');
  await page.click('#pay-notify-save');
  await expect(page.locator('#pay-notify-email')).toHaveValue('finance@corp.com');

  // 지금 스캔 → 버튼 비활성→복귀 (재렌더 후 다시 표시)
  await page.click('#pay-btn-scan');
  await page.waitForSelector('#pay-btn-scan', { timeout: 10000 });
  await expect(page.locator('#pay-btn-scan')).toContainText('지금 스캔');

  // 알림 모달 열기 → 목록 항목 표시
  await page.click('#pay-btn-alerts');
  await page.waitForSelector('#pay-alerts-list', { timeout: 10000 });
  await expect(page.locator('#pay-alerts-list')).toContainText('연체상사');
  await expect(page.locator('#pay-alerts-list')).toContainText('알파SI 구축');
  await expect(page.locator('#pay-alerts-list')).toContainText('D+42');
  await expect(page.locator('#pay-alerts-list')).toContainText('3,300,000');

  // 모두 읽음 → 모달 닫힘
  await page.click('#pay-alerts-readall');
  await expect(page.locator('#pay-alerts-list')).toBeHidden({ timeout: 5000 });
});
