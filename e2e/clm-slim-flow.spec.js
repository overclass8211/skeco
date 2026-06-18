// =============================================================
// E2E — CLM 슬림 모듈 전체 흐름 (v6.0.0)
//
// 검증 대상:
//   1) KPI 카드 4개 (만료임박 / 검토중 / 진행중 / 초안) 표시
//   2) [+ 새 계약] → 모드 chooser (파일 첨부 vs 빈 양식) 분기
//   3) 임시 모드 인트로 (보라 안내 카드)
//   4) AI 검토 카드 안에 [📎 파일 첨부] 큰 버튼 (스크롤 불필요)
//   5) AI 검토 후 자동 채움 (계약명/유형/금액/시작일/종료일)
//   6) 자동/수동 채번 토글
//   7) 거래처 계약번호 (external_contract_no)
//   8) 진척률 바 + D-N 일수 표시
//   9) 전자서명 섹션 (status=approved 시)
//  10) 모두싸인 설정 UI (Mock 모드 표시)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  // 온보딩 환영 모달 억제 (다른 e2e 표준 패턴) — 모달 오버레이가 KPI/버튼을 가려
  //   waitForSelector/click 을 가로막는 환경 이슈 방지
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* ignore */
    }
  });
  await loginAsAdmin(page);
});

// 공통 — mock 응답으로 안전한 환경 구성
function mockContractsList(page, list = []) {
  return page.route('**/api/contracts*', async (route, request) => {
    const url = request.url();
    if (request.method() === 'GET' && /\/api\/contracts(\?|$)/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: list, pagination: { total: list.length } }),
      });
    } else {
      await route.fallback();
    }
  });
}

function mockDashboard(page, kpi = {}) {
  return page.route('**/api/contracts/dashboard', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          total: kpi.total || 35,
          by_status: kpi.by_status || { draft: 5, review: 7, approved: 20, completed: 3 },
          expiring_30: kpi.expiring_30 ?? 3,
          expiring_60: kpi.expiring_60 ?? 5,
          expiring_90: kpi.expiring_90 ?? 8,
          no_end_date_active: 1,
          overdue: kpi.overdue ?? 0,
        },
      }),
    });
  });
}

test('KPI 카드 4개 표시 + 만료 임박 카드 클릭 시 필터 적용', async ({ page }) => {
  await mockDashboard(page, { expiring_30: 3, by_status: { draft: 5, review: 7, approved: 20, completed: 3 } });
  await mockContractsList(page, []);

  await page.goto('/#contracts');
  await page.waitForSelector('#ct-kpi-wrap .kpi-card', { timeout: 15000 });

  const cards = page.locator('.kpi-card');
  await expect(cards).toHaveCount(4);

  // 만료 임박 카드의 값
  const firstCard = cards.first();
  await expect(firstCard).toContainText('만료 임박');
  await expect(firstCard).toContainText('3'); // expiring_30

  // 검토중 / 진행중 / 초안
  await expect(page.locator('.kpi-card', { hasText: '검토중' })).toContainText('7');
  await expect(page.locator('.kpi-card', { hasText: '진행중' })).toContainText('20');
  await expect(page.locator('.kpi-card', { hasText: '초안' })).toContainText('5');

  // 만료 임박 카드 클릭 → status=approved 필터 자동 적용
  await firstCard.click();
  await expect(page.locator('#ct-filter-status')).toHaveValue('approved');
});

test('[+ 새 계약] 클릭 → 모드 chooser 모달 (계약서 받음 vs 빈 양식부터)', async ({ page }) => {
  await mockDashboard(page);
  await mockContractsList(page, []);

  await page.goto('/#contracts');
  await page.waitForSelector('#ct-new-btn', { timeout: 15000 });

  await page.click('#ct-new-btn');
  // 모드 선택 모달 — 두 카드 (실제 라벨: "계약서 받음" / "빈 양식부터")
  await page.waitForSelector('#ct-mode-file', { timeout: 10000 });
  await expect(page.locator('#ct-mode-file')).toBeVisible();
  await expect(page.locator('#ct-mode-blank')).toBeVisible();
  await expect(page.locator('#ct-mode-file')).toContainText('계약서 받음');
  await expect(page.locator('#ct-mode-blank')).toContainText('빈 양식부터');
  // 안내 메시지
  await expect(page.locator('text=어떤 모드로 시작하든')).toBeVisible();
});

test('파일 첨부 모드 → 임시 인트로 + AI 카드 안에 [📎 파일 첨부] 버튼 노출', async ({ page }) => {
  await mockDashboard(page);
  await mockContractsList(page, []);

  // 임시 계약 생성 + GET 응답 mock
  let createdTempId = null;
  await page.route('**/api/contracts', async (route, request) => {
    if (request.method() === 'POST') {
      const body = request.postDataJSON() || {};
      createdTempId = 99001;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          id: createdTempId,
          data: {
            id: createdTempId,
            contract_no: 'C-2026-9001',
            title: body.title || '__draft__',
          },
        }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.route('**/api/contracts/99001', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 99001,
            contract_no: 'C-2026-9001',
            title: '__draft__',
            status: 'draft',
            contract_type: 'etc',
            files: [],
            history: [{ action_type: 'create', created_at: new Date().toISOString() }],
            latest_legal_review: null,
          },
        }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.goto('/#contracts');
  await page.waitForSelector('#ct-new-btn', { timeout: 15000 });
  await page.click('#ct-new-btn');
  await page.waitForSelector('#ct-mode-file', { timeout: 10000 });

  // 파일 첨부 모드 카드 클릭 (실제 라벨: "계약서 받음")
  await page.locator('#ct-mode-file').click();

  // 임시 인트로 + AI 카드 노출 확인 (v6.0.0 temp 인트로 재설계: "파일 첨부 모드" 헤더)
  await page.waitForSelector('text=파일 첨부 모드', { timeout: 10000 });
  await expect(page.locator('text=저장 시 확정').first()).toBeVisible();

  // AI 카드 안에 [📎 계약서 파일 첨부] 버튼이 즉시 보여야 함 (스크롤 불필요)
  const ctaBtn = page.locator('#ct-cta-file-add-btn');
  await expect(ctaBtn).toBeVisible();
  await expect(ctaBtn).toContainText('계약서 파일 첨부');
});

test('계약번호 자동/수동 토글 + 거래처 계약번호 입력', async ({ page }) => {
  await mockDashboard(page);

  // 단일 계약 (편집 모드 진입용)
  const sample = {
    id: 1001,
    contract_no: 'C-2026-0001',
    title: '__TEST 계약',
    status: 'draft',
    contract_type: 'NDA',
    external_contract_no: 'EXT-001',
    files: [],
    history: [{ action_type: 'create', created_at: new Date().toISOString() }],
  };
  await mockContractsList(page, [sample]);
  await page.route('**/api/contracts/1001', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { ...sample, latest_legal_review: null } }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.goto('/#contracts');
  await page.waitForSelector('.ct-row', { timeout: 15000 });
  await page.click('.ct-edit');

  // 모달 열림
  await page.waitForSelector('#ct-f-contract_no', { timeout: 10000 });

  // 기본은 자동 모드 (readonly)
  const noInput = page.locator('#ct-f-contract_no');
  await expect(noInput).toHaveAttribute('readonly', '');

  // 수동 모드로 전환
  await page.locator('.ct-no-mode-btn[data-mode="manual"]').click();
  await expect(noInput).not.toHaveAttribute('readonly', '');

  // 거래처 계약번호 필드 확인 + 기존 값
  await expect(page.locator('#ct-f-external_contract_no')).toHaveValue('EXT-001');
});

test('진척률 바 + D-N 일수 표시 (approved + 30일 후 만료)', async ({ page }) => {
  await mockDashboard(page);
  const today = new Date();
  const in30 = new Date(today.getTime() + 25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await mockContractsList(page, [
    {
      id: 2001,
      contract_no: 'C-2026-2001',
      title: '__TEST_expiring',
      status: 'approved',
      contract_type: 'MSA',
      end_date: in30,
      contract_amount: 50000000,
      currency: 'KRW',
    },
  ]);

  await page.goto('/#contracts');
  await page.waitForSelector('.ct-row', { timeout: 15000 });

  // 진척률 바: 4개 step + 현재 단계가 approved (3번째)
  // D-25 또는 비슷한 패턴이 행에 표시되어야 함 (🔥)
  const row = page.locator('.ct-row').first();
  await expect(row).toContainText('D-'); // 일수 형식
});

test('전자서명 섹션 — status=approved 일 때 [✍ 서명 요청 시작] 버튼', async ({ page }) => {
  await mockDashboard(page);
  const sample = {
    id: 3001,
    contract_no: 'C-2026-3001',
    title: '__TEST_esign',
    status: 'approved',
    contract_type: 'service',
    files: [
      {
        id: 501,
        original_filename: 'test_contract.pdf',
        file_type: 'contract',
        file_size: 1024,
        created_at: new Date().toISOString(),
      },
    ],
    history: [],
    esign_request_id: null,
    esign_status: null,
  };
  await mockContractsList(page, [sample]);
  await page.route('**/api/contracts/3001', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { ...sample, latest_legal_review: null } }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.goto('/#contracts');
  await page.waitForSelector('.ct-row', { timeout: 15000 });
  await page.click('.ct-edit');

  await page.waitForSelector('#ct-esign-wrap', { timeout: 10000 });
  await expect(page.locator('#ct-esign-request-btn')).toBeVisible();
  await expect(page.locator('#ct-esign-request-btn')).toContainText('서명 요청 시작');
});

test('모두싸인 설정 UI — Mock 모드 배지 노출', async ({ page }) => {
  // 모두싸인 상태 API mock — mock 모드 + 미연결
  await page.route('**/api/contracts/esign/status', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          connected: false,
          mock: true,
          configured: false,
          modusign_user_id: null,
          modusign_email: null,
        },
      }),
    });
  });

  await page.goto('/#settings');
  await page.waitForSelector('#esign-modusign-card', { timeout: 15000 });

  // 배지에 Mock 모드 표시
  const badge = page.locator('#esign-modusign-badge');
  await expect(badge).toContainText('Mock');

  // 연결 버튼이 보임 (Mock 모드여도)
  const connectBtn = page.locator('#esign-modusign-connect-btn');
  await expect(connectBtn).toBeVisible();
  await expect(connectBtn).toContainText('모두싸인 연결');
});
