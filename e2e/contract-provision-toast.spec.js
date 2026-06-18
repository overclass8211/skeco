// =============================================================
// E2E — 계약 체결(completed) 시 자동 프로비저닝 토스트 [P2-C]
//
// 검증: approved 계약을 [🤝 계약 완료] 처리 → PATCH 응답 data.provision
//        (projectCreated/scheduleCreated) → "프로젝트·매출계획 자동 생성됨" 토스트
//   - 모든 API mock (결정적), 프론트 정적파일은 디스크에서 신규 서빙
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const CID = 4001;
const CONTRACT = {
  id: CID,
  contract_no: 'C-2026-4001',
  title: 'E2E체결테스트',
  status: 'approved',
  contract_type: 'service',
  contract_amount: 11000000,
  currency: 'KRW',
  customer_id: null,
  files: [],
  history: [{ action_type: 'create', created_at: '2026-06-01T09:00:00' }],
  latest_legal_review: null,
};

test.beforeEach(async ({ page }) => {
  // 온보딩 환영 모달 억제 (다른 e2e 표준 패턴)
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* ignore */
    }
  });
  await loginAsAdmin(page);

  // 대시보드 KPI
  await page.route('**/api/contracts/dashboard', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { total: 1, by_status: { draft: 0, review: 0, approved: 1, completed: 0 }, expiring_30: 0, expiring_60: 0, expiring_90: 0, no_end_date_active: 0, overdue: 0 },
      }),
    });
  });

  // 상태 전이 PATCH — provision 포함 응답 (P1 자동 생성 결과)
  await page.route('**/api/contracts/4001/status', async (route, req) => {
    if (req.method() === 'PATCH') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            ...CONTRACT,
            status: 'completed',
            provision: { projectId: 777, projectCreated: true, scheduleIds: [55], scheduleCreated: true },
          },
        }),
      });
    }
    return route.fallback();
  });

  // 계약 상세 GET (모달용) — /4001 (status 하위경로 제외)
  await page.route('**/api/contracts/4001', async (route, req) => {
    if (req.method() === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: CONTRACT }),
      });
    }
    return route.fallback();
  });

  // 목록 GET
  await page.route('**/api/contracts*', async (route, req) => {
    const url = req.url();
    if (req.method() === 'GET' && /\/api\/contracts(\?|$)/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [CONTRACT], pagination: { total: 1 } }),
      });
    }
    return route.fallback();
  });
});

test('계약 체결 시 프로젝트·매출계획 자동 생성 토스트 노출', async ({ page }) => {
  await page.goto('/#contracts');
  await page.waitForSelector('.ct-row', { timeout: 15000 });
  await page.click('.ct-edit');

  // approved → [🤝 계약 완료] 빠른 액션 버튼 노출
  const completeBtn = page.locator('.ct-quick-action[data-to="completed"]');
  await expect(completeBtn).toBeVisible({ timeout: 10000 });
  await expect(completeBtn).toContainText('계약 완료');

  // confirm 다이얼로그 수락 (체결 안내 메시지 포함)
  let dialogMsg = '';
  page.once('dialog', d => {
    dialogMsg = d.message();
    d.accept();
  });

  await completeBtn.click();

  // 자동 프로비저닝 결과 토스트
  const toast = page.locator('#toast-container .toast.success');
  await expect(toast).toContainText('계약 체결 완료', { timeout: 8000 });
  await expect(toast).toContainText('프로젝트·매출계획 자동 생성됨');

  // confirm 메시지에 사전 안내 포함되었는지
  expect(dialogMsg).toContain('자동 생성');
});
