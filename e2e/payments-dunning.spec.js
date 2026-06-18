// =============================================================
// E2E — 수금관리 > 미수금 탭 > 단계별 독촉(dunning) 패널 [P3-B]
//
// 검증(API 모킹):
//   미수금 탭 → 독촉 패널(#pay-dunning-panel) — 단계 칩 + 도래 단계 목록
//   → ✉ 미리보기 모달(렌더된 제목/본문) → ↻ 독촉 스캔 → 📜 이력 모달
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const DLIST = [
  {
    schedule_id: 501, contract_id: 70, customer_id: 1, customer_name: '연체알파',
    contract_name: '알파SI', stage_name: '잔금', due_date: '2026-05-20',
    overdue_days: 27, remaining: 3300000, currency: 'KRW', dunning_kind: 'dunning_2nd', dunning_label: '2차 경고',
  },
  {
    schedule_id: 502, contract_id: 71, customer_id: 2, customer_name: '연체베타',
    contract_name: '베타SI', stage_name: '중도금', due_date: '2026-06-05',
    overdue_days: 9, remaining: 1100000, currency: 'KRW', dunning_kind: 'dunning_1st', dunning_label: '1차 안내',
  },
  {
    schedule_id: 503, contract_id: 72, customer_id: 3, customer_name: '연체감마',
    contract_name: '감마SI', stage_name: '잔금', due_date: '2026-06-12',
    overdue_days: 3, remaining: 500000, currency: 'KRW', dunning_kind: null, dunning_label: '독촉 전',
  },
];

async function mockApi(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

    // ── 독촉(dunning) ──
    if (/\/dunning\/list/.test(url)) return json({ success: true, data: DLIST });
    if (/\/dunning\/scan/.test(url) && method === 'POST')
      return json({ success: true, data: { scanned: 3, created: 2, by_stage: { dunning_1st: 1, dunning_2nd: 1 } } });
    if (/\/dunning\/preview/.test(url) && method === 'POST')
      return json({
        success: true,
        data: {
          schedule_id: 502,
          kind: 'dunning_1st',
          subject: '[OCI] 수금 안내 — 베타SI 중도금',
          body: '안녕하세요, 연체베타 담당자님.\n\n베타SI 건의 중도금 대금 1,100,000 KRW 의 결제 예정일(2026-06-05)이 9일 경과하였습니다.',
        },
      });
    if (/\/dunning\/history/.test(url))
      return json({
        success: true,
        data: [
          {
            id: 8001, schedule_id: 501, customer_name: '연체알파', kind: 'dunning_2nd',
            amount: 3300000, channel: 'inapp', status: 'unread', created_at: '2026-06-16T01:00:00',
          },
        ],
      });
    if (/\/dunning\/policy/.test(url) && method === 'GET')
      return json({
        success: true,
        data: {
          policy: [
            { kind: 'dunning_1st', label: '1차 안내', min_days: 7 },
            { kind: 'dunning_2nd', label: '2차 경고', min_days: 14 },
            { kind: 'dunning_3rd', label: '3차 최종통보', min_days: 30 },
          ],
          defaults: [],
        },
      });
    if (/\/dunning\/policy/.test(url) && method === 'PUT') return json({ success: true, data: [] });
    if (/\/dunning\/templates/.test(url) && method === 'GET')
      return json({
        success: true,
        data: {
          dunning_1st: { subject: '제목1', body: '본문1 {customer_name}' },
          dunning_2nd: { subject: '제목2', body: '본문2' },
          dunning_3rd: { subject: '제목3', body: '본문3' },
        },
      });
    if (/\/dunning\/templates/.test(url) && method === 'PUT') return json({ success: true, data: {} });
    if (/\/dunning\/send/.test(url) && method === 'POST')
      return json({ success: true, data: { sent: true, to: 'customer@corp.com', subject: '제목1' } });

    // ── 연체 알림/설정/기타 ──
    if (/\/notifications/.test(url) && method === 'GET') return json({ success: true, data: [], unread_count: 0 });
    if (/\/config/.test(url) && method === 'PUT') return json({ success: true });
    if (/\/config/.test(url))
      return json({
        success: true,
        data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'], notify_email: '' },
      });
    if (/\/dashboard/.test(url))
      return json({
        success: true,
        data: { kpi: { outstanding_amount: 0, this_month_scheduled: 0, overdue_amount: 0, overdue_count: 0, collection_rate: 0 }, monthly_trend: [], overdue_by_customer: [] },
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

test('미수금 탭 — 독촉 패널 + 미리보기 + 스캔 + 이력', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('.tab-bar', { timeout: 20000 });
  await page.click('.tab-btn[data-tab="overdue"]');

  // 독촉 패널 렌더 — 단계 칩 + 도래 단계 목록
  const panel = page.locator('#pay-dunning-panel');
  await expect(panel).toContainText('단계별 독촉', { timeout: 10000 });
  await expect(panel).toContainText('1차 안내');
  await expect(panel).toContainText('2차 경고');
  await expect(panel).toContainText('연체알파'); // dunning_2nd 행
  await expect(panel).toContainText('연체베타'); // dunning_1st 행
  // '독촉 전'(감마)는 도래 단계 테이블에는 미노출(칩만)
  await expect(panel.locator('.pay-dun-preview')).toHaveCount(2);

  // ✉ 미리보기 (베타 — dunning_1st) → 모달 렌더된 메시지
  await page.locator('.pay-dun-preview[data-id="502"]').click();
  await expect(page.locator('text=독촉 메시지 미리보기')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('text=[OCI] 수금 안내 — 베타SI 중도금')).toBeVisible();
  await expect(page.locator('text=연체베타 담당자님')).toBeVisible();
  // 모달 닫기
  await page.getByRole('button', { name: '닫기' }).click();

  // ↻ 독촉 스캔 → 버튼 복귀
  await page.click('#pay-dun-scan');
  await page.waitForSelector('#pay-dun-scan', { timeout: 10000 });
  await expect(page.locator('#pay-dun-scan')).toContainText('독촉 스캔');

  // 📜 이력 모달 — 생성일(2026-06-16)은 이력 행에만 존재(패널과 구분)
  await page.click('#pay-dun-history');
  await expect(page.locator('text=독촉 이력')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('2026-06-16', { exact: false })).toBeVisible();
});

test('독촉 설정 저장 + 미리보기 메일 발송', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('.tab-bar', { timeout: 20000 });
  await page.click('.tab-btn[data-tab="overdue"]');
  await page.waitForSelector('#pay-dunning-panel', { timeout: 10000 });

  // ⚙ 설정 모달 — 단계 일수 변경 후 저장 → 모달 닫힘
  //   (모달 제목 '⚙ 독촉 설정' 으로 한정 — 저장 토스트 '독촉 설정이 저장됐습니다' 와 구분)
  await page.click('#pay-dun-settings');
  await expect(page.locator('text=⚙ 독촉 설정')).toBeVisible({ timeout: 8000 });
  await page.locator('.pay-dun-mindays[data-kind="dunning_1st"]').fill('5');
  await page.click('#pay-dun-settings-save');
  await expect(page.locator('text=⚙ 독촉 설정')).toBeHidden({ timeout: 5000 });

  // ✉ 미리보기 → 수신 입력 → 발송(확인 수락) → 모달 닫힘
  await page.locator('.pay-dun-preview[data-id="502"]').click();
  await expect(page.locator('text=독촉 메시지 미리보기')).toBeVisible({ timeout: 8000 });
  await page.fill('#pay-dun-to', 'customer@corp.com');
  page.once('dialog', d => d.accept());
  await page.click('#pay-dun-send');
  await expect(page.locator('text=독촉 메시지 미리보기')).toBeHidden({ timeout: 5000 });
});
