// =============================================================
// E2E — 제안 페이지 UI (Phase 1 + Phase 2 + Phase 8-C 3탭 통합)
//
// 백엔드 CRUD 는 tests/proposals.test.mjs (vitest) 에서 검증
// 여기서는 UI 동작만:
//   1) 페이지 진입 → [+ 제안 등록] 버튼 + 목록 영역
//   2) 신규 모달 → 기본정보 탭만 활성 (나머지 탭 disabled)
//   3) 편집 모달 — 3개 탭 표시 (기본정보 / 자료&견적 / 발송&이력) + AI 섹션 기본탭 통합
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('제안 페이지 진입 → [+ 제안 등록] 버튼 + 목록 영역 표시', async ({ page }) => {
  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 15000 });

  await expect(page.locator('#pr-new-btn')).toBeVisible();
  await expect(page.locator('#pr-new-btn')).toContainText('제안 등록');
  await expect(page.locator('#pr-search')).toBeVisible();
  await expect(page.locator('#pr-status')).toBeVisible();
  await expect(page.locator('#pr-due-soon')).toBeVisible();
  await expect(page.locator('#pr-list-wrap')).toBeVisible();
});

test('Phase 9-2 — [+제안등록] → 임시 제안 자동 생성 → 3개 탭 모두 활성 + RFP 섹션 노출', async ({
  page,
}) => {
  // mock — POST (임시 제안 생성) + GET (상세 조회)
  await page.route('**/api/proposals', async (route, request) => {
    if (request.method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { id: 99999, proposal_no: 'P-2026-TEMP', status: 'draft' },
        }),
      });
    } else {
      await route.fallback();
    }
  });
  await page.route('**/api/proposals/99999', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 99999,
            proposal_no: 'P-2026-TEMP',
            proposal_title: '(임시)',
            customer_name: '(임시)',
            proposal_date: '2026-05-23',
            status: 'draft',
            version_no: 1,
            currency: 'KRW',
            lead: null,
            quote: null,
            files: [],
            revisions: [],
            email_logs: [],
            history: [],
          },
        }),
      });
    } else if (request.method() === 'DELETE') {
      // 닫기 시 임시 제안 자동 삭제
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    } else {
      await route.fallback();
    }
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.ProposalsPage._openModal(null));
  await expect(page.locator('#pr-f-proposal_title')).toBeVisible({ timeout: 10000 });
  // 임시 placeholder 값 비움 (저장 시 사용자 실제 입력 필요)
  await expect(page.locator('#pr-f-proposal_title')).toHaveValue('');
  await expect(page.locator('#pr-f-customer_name')).toHaveValue('');

  // Phase 9-2: 3개 탭 모두 활성 (임시 제안 = 편집 모드와 동일 동작)
  await expect(page.locator('.pr-tab')).toHaveCount(3);
  const activeTabs = await page.locator('.pr-tab:not([disabled])').count();
  expect(activeTabs).toBe(3);

  // 기본 탭 활성 + RFP 드롭존 노출 (워크플로우 첫 단계)
  await expect(page.locator('.pr-tab.active')).toContainText('기본정보');
  await expect(page.locator('#pr-rfp-dropzone')).toBeVisible();

  await page.unroute('**/api/proposals');
  await page.unroute('**/api/proposals/99999');
});

test('Phase 2 — 편집 모달: 모든 탭 활성 + 탭 전환 동작', async ({ page }) => {
  // route mock — 완전한 제안 상세 (lead/quote/files/history/email_logs/revisions)
  await page.route('**/api/proposals/77001', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77001,
          proposal_no: 'P-2026-7001',
          proposal_title: '__E2E_TAB__제안',
          customer_name: '__E2E_TAB__고객사',
          proposal_date: '2026-05-21',
          status: 'review',
          version_no: 1,
          currency: 'KRW',
          expected_amount: 50000000,
          rfp_title: '__E2E__RFP_타이틀',
          rfp_summary: 'RFP 핵심 요약 텍스트',
          rfp_received_date: '2026-05-15',
          rfp_due_date: '2026-06-15',
          ai_strategy_md: '## 1. RFP 핵심 요약\n- 테스트 결과',
          ai_strategy_generated_at: '2026-05-20T10:00:00',
          lead: null,
          quote: {
            id: 999,
            quote_no: 'Q-2026-9999',
            name: '__E2E__견적명',
            total_amount: 110000000,
            subtotal: 100000000,
            vat_amount: 10000000,
            vat_included: 1,
            status: 'sent',
          },
          files: [
            {
              id: 1,
              file_type: 'proposal',
              original_filename: 'proposal_v1.pdf',
              revision_no: 1,
              is_final: 1,
              include_in_email: 1,
              file_size: 1024000,
              created_at: '2026-05-20T10:00:00',
            },
            {
              id: 2,
              file_type: 'rfp',
              original_filename: 'rfp_doc.pdf',
              revision_no: 1,
              is_final: 0,
              include_in_email: 0,
              file_size: 204800,
              created_at: '2026-05-19T10:00:00',
            },
          ],
          revisions: [
            { id: 1, revision_no: 1, title: '초안', description: '첫 작성', created_at: '2026-05-20T10:00:00' },
          ],
          email_logs: [],
          history: [
            { id: 1, action_type: 'create', description: '제안 생성', created_at: '2026-05-20T10:00:00', created_by_name: '관리자' },
            { id: 2, action_type: 'status_change', old_value: 'draft', new_value: 'review', description: '상태 변경', created_at: '2026-05-20T11:00:00' },
          ],
        },
      }),
    });
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.ProposalsPage._openModal(77001));
  // Phase 8-C: 3-탭 구조 (기본정보 / 자료&견적 / 발송&이력)
  await expect(page.locator('.pr-tab')).toHaveCount(3);
  // 모든 탭이 활성 (편집 모드)
  const allTabs = await page.locator('.pr-tab:not([disabled])').count();
  expect(allTabs).toBe(3);

  // 기본 탭 (활성 상태) — RFP 섹션이 맨위 + RFP 메타 입력 표시
  await expect(page.locator('#pr-f-rfp_title')).toBeVisible();
  await expect(page.locator('#pr-f-rfp_title')).toHaveValue('__E2E__RFP_타이틀');
  // Phase 8-C: AI 제안전략 요약은 기본탭 하단 textarea (비고 자리 통합)
  await expect(page.locator('#pr-f-ai_strategy_md')).toBeVisible();
  await expect(page.locator('#pr-f-ai_strategy_md')).toHaveValue(/RFP 핵심 요약/);
  // RFP 섹션의 AI 분석 버튼 (RFP 파일 1건 있으므로 활성)
  await expect(page.locator('#pr-ai-analyze-btn')).toBeEnabled();
  // 미리보기 토글 + 복사 버튼 (결과 있으면)
  await expect(page.locator('#pr-ai-preview-btn')).toBeVisible();
  await expect(page.locator('#pr-ai-copy-btn')).toBeVisible();

  // 자료&견적 탭 → 견적 정보 + 파일 표시 (force: true 로 레이아웃 안정성 회피)
  await page.locator('.pr-tab[data-tab="content"]').click({ force: true });
  await expect(page.locator('#pr-tab-content')).toContainText('Q-2026-9999');
  await expect(page.locator('#pr-tab-content')).toContainText('__E2E__견적명');
  await expect(page.locator('#pr-tab-content')).toContainText('proposal_v1.pdf');

  // 발송&이력 탭 → 리비전 + 히스토리 통합 표시
  await page.locator('.pr-tab[data-tab="send"]').click({ force: true });
  await expect(page.locator('#pr-tab-content')).toContainText('v1');
  await expect(page.locator('#pr-tab-content')).toContainText('초안');
  await expect(page.locator('#pr-tab-content')).toContainText('status_change');

  await page.unroute('**/api/proposals/77001');
});

test('Phase 4-C — RFP/자료 탭 드롭존 + AI 분석 버튼 표시', async ({ page }) => {
  // mock — RFP 파일 1건 + 일반 파일 1건
  await page.route('**/api/proposals/77002', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77002,
          proposal_no: 'P-2026-7002',
          proposal_title: '__E2E_DZ__제안',
          customer_name: '__E2E_DZ__고객',
          proposal_date: '2026-05-21',
          status: 'draft',
          version_no: 1,
          currency: 'KRW',
          lead: null,
          quote: null,
          files: [
            {
              id: 11,
              file_type: 'rfp',
              original_filename: 'rfp_korean_한글.pdf',
              revision_no: 1,
              is_final: 0,
              include_in_email: 0,
              file_size: 102400,
              created_at: '2026-05-20T10:00:00',
            },
            {
              id: 12,
              file_type: 'proposal',
              original_filename: 'proposal_v1.pdf',
              revision_no: 1,
              is_final: 0,
              include_in_email: 0,
              file_size: 51200,
              created_at: '2026-05-20T11:00:00',
            },
          ],
          revisions: [],
          email_logs: [],
          history: [],
        },
      }),
    });
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.ProposalsPage._openModal(77002));

  // Phase 8-C: 기본 탭 상단에 RFP 섹션 — 모달 열자마자 RFP 드롭존 표시
  await expect(page.locator('#pr-rfp-dropzone')).toBeVisible();
  // 기본 탭 전체 렌더 완료까지 대기 (상단 RFP + 하단 AI 요약 모두 가시 → 레이아웃 안정화)
  await expect(page.locator('#pr-f-ai_strategy_md')).toBeVisible();
  await expect(page.locator('#pr-rfp-dropzone')).toContainText('파일 추가');
  await expect(page.locator('#pr-rfp-dropzone')).toContainText('끌어다 놓으세요');
  // RFP 파일은 AI 분석 버튼 노출
  await expect(page.locator('.pr-file-ai[data-id="11"]')).toBeVisible();
  // 한글 파일명 그대로 표시 (latin1 → utf8 디코딩 회귀 방지)
  await expect(page.locator('#pr-tab-content')).toContainText('rfp_korean_한글.pdf');
  // Phase 8-C: RFP 섹션 통합 AI 분석 버튼 활성 (분석 가능 RFP 파일 1건)
  await expect(page.locator('#pr-ai-analyze-btn')).toBeEnabled();

  // 자료&견적 탭 → 드롭존 + 일반 파일 (AI 버튼 없음) — force: true 로 안정성 회피
  await page.locator('.pr-tab[data-tab="content"]').click({ force: true });
  await expect(page.locator('#pr-files-dropzone')).toBeVisible();
  await expect(page.locator('#pr-files-dropzone')).toContainText('파일 추가');
  await expect(page.locator('#pr-tab-content')).toContainText('proposal_v1.pdf');
  // 일반 파일은 AI 분석 버튼 없음
  await expect(page.locator('.pr-file-ai[data-id="12"]')).toHaveCount(0);

  await page.unroute('**/api/proposals/77002');
});

test('Phase 8-C — 기본탭 AI 섹션: RFP 파일 없으면 분석 버튼 비활성 + 안내', async ({ page }) => {
  // mock — RFP 파일 없음 + ai_strategy_md 도 없음
  await page.route('**/api/proposals/77003', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77003,
          proposal_no: 'P-2026-7003',
          proposal_title: '__E2E_AI__빈',
          customer_name: '__E2E_AI__고객',
          proposal_date: '2026-05-21',
          status: 'draft',
          version_no: 1,
          currency: 'KRW',
          lead: null,
          quote: null,
          files: [],
          revisions: [],
          email_logs: [],
          history: [],
        },
      }),
    });
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.ProposalsPage._openModal(77003));

  // Phase 8-C: 기본탭에 RFP 섹션 + AI 섹션 통합 노출 (탭 전환 없음)
  // 모달 전체 렌더 완료 대기 — 가장 마지막에 렌더되는 textarea 가 DOM 에 붙을 때까지
  await expect(page.locator('#pr-f-ai_strategy_md')).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator('#pr-rfp-dropzone')).toBeVisible();
  // RFP 파일 없음 → 분석 버튼 비활성 + 안내 문구
  await expect(page.locator('#pr-ai-analyze-btn')).toBeDisabled();
  await expect(page.locator('#pr-tab-content')).toContainText('분석 가능한 RFP 파일을 먼저 업로드');
  // 결과 없음 → 복사 버튼 미노출
  await expect(page.locator('#pr-ai-copy-btn')).toHaveCount(0);
  // AI 제안전략 요약 textarea 는 빈 상태 (placeholder 만)
  await expect(page.locator('#pr-f-ai_strategy_md')).toBeVisible();
  await expect(page.locator('#pr-f-ai_strategy_md')).toHaveValue('');

  await page.unroute('**/api/proposals/77003');
});

test('Phase 5-D — 이메일/공유 탭: 발송 폼 + 첨부 체크박스 + 공유 링크 발급', async ({ page }) => {
  // mock — 파일 2건 + 공유 링크 미발급 상태
  await page.route('**/api/proposals/77004', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77004,
          proposal_no: 'P-2026-7004',
          proposal_title: '__E2E_EM__제안',
          customer_name: '__E2E_EM__고객',
          proposal_date: '2026-05-21',
          status: 'draft',
          version_no: 1,
          currency: 'KRW',
          share_token: null,
          shared_until: null,
          lead: null,
          quote: null,
          files: [
            {
              id: 21,
              file_type: 'proposal',
              original_filename: 'proposal_v1.pdf',
              revision_no: 1,
              is_final: 1,
              include_in_email: 1,
              file_size: 512000,
              created_at: '2026-05-20T10:00:00',
            },
            {
              id: 22,
              file_type: 'reference',
              original_filename: 'company_profile.pdf',
              revision_no: 1,
              is_final: 0,
              include_in_email: 0,
              file_size: 256000,
              created_at: '2026-05-19T10:00:00',
            },
          ],
          revisions: [],
          email_logs: [],
          history: [],
        },
      }),
    });
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.ProposalsPage._openModal(77004));

  // 기본 탭 렌더 완료 대기 → send 탭으로 (force: true 안정성)
  await expect(page.locator('#pr-f-ai_strategy_md')).toBeVisible();
  await page.locator('.pr-tab[data-tab="send"]').click({ force: true });

  // 이메일 발송 폼 — 받는사람/참조/제목/본문 입력 필드
  await expect(page.locator('#pr-email-to')).toBeVisible();
  await expect(page.locator('#pr-email-cc')).toBeVisible();
  await expect(page.locator('#pr-email-subject')).toHaveValue(/제안서 송부/);
  await expect(page.locator('#pr-email-body')).toContainText('__E2E_EM__고객');
  // 본문 템플릿에 제안명 포함
  await expect(page.locator('#pr-email-body')).toContainText('__E2E_EM__제안');
  // 발송 버튼 노출
  await expect(page.locator('#pr-email-send-btn')).toBeVisible();

  // 첨부 파일 체크박스 — 2개 표시 + include_in_email=1 인 것만 기본 체크
  await expect(page.locator('.pr-email-file')).toHaveCount(2);
  await expect(page.locator('.pr-email-file[value="21"]')).toBeChecked(); // include_in_email=1
  await expect(page.locator('.pr-email-file[value="22"]')).not.toBeChecked(); // =0

  // 공유 링크 영역 — 미발급 상태
  await expect(page.locator('#pr-share-create-btn')).toBeVisible();
  await expect(page.locator('#pr-share-expires')).toBeVisible();
  // 발급된 상태 UI는 없어야 함
  await expect(page.locator('#pr-share-url')).toHaveCount(0);
  await expect(page.locator('#pr-share-copy-btn')).toHaveCount(0);

  // 발송 이력 — 비어있음
  await expect(page.locator('#pr-tab-content')).toContainText('아직 발송 이력 없음');

  await page.unroute('**/api/proposals/77004');
});

// ── Phase 5-E: 외부 공유 페이지 ──────────────────────────────
test('Phase 5-E — proposal-share.html: 잘못된 토큰 → "유효하지 않은 링크" 안내', async ({ page }) => {
  // 백엔드 404 응답 (실제 서버 호출 — 토큰 미존재)
  await page.goto('/proposal-share.html?t=INVALID_TOKEN_TEST_1234567890ABC');
  await expect(page.locator('.ps-error h1')).toContainText('유효하지 않은 링크', { timeout: 10000 });
  await expect(page.locator('.ps-error')).toContainText('무효화');
});

test('Phase 5-E — proposal-share.html: 토큰 누락 → "잘못된 링크"', async ({ page }) => {
  await page.goto('/proposal-share.html');
  await expect(page.locator('.ps-error h1')).toContainText('잘못된 링크', { timeout: 10000 });
  await expect(page.locator('.ps-error')).toContainText('?t=');
});

test('Phase 5-E — proposal-share.html: mock 200 응답 → 정상 렌더 (메타 + 요약 + 파일)', async ({ page }) => {
  // 백엔드 응답을 mock (별도 토큰 발급 없이 UI 렌더 검증)
  await page.route('**/api/proposals/share/MOCK_E2E_TOKEN_FOR_RENDER_TEST', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          proposal_no: 'P-2026-7777',
          proposal_title: '__E2E_SHARE__ 공유 페이지 테스트',
          customer_name: '__E2E_SHARE__고객',
          proposal_date: '2026-05-21',
          rfp_title: '__E2E_SHARE__ RFP 제목',
          rfp_summary: '__E2E_SHARE__ RFP 핵심 요약 — 외부 공개 정보',
          shared_until: '2026-12-31T23:59:59',
          files: [
            {
              id: 1,
              original_filename: 'proposal_v1.pdf',
              file_size: 512000,
              mime_type: 'application/pdf',
              revision_no: 1,
              file_type: 'proposal',
              download_url: '/api/proposals/share/MOCK_E2E_TOKEN_FOR_RENDER_TEST/files/1/download',
            },
          ],
        },
      }),
    });
  });

  await page.goto('/proposal-share.html?t=MOCK_E2E_TOKEN_FOR_RENDER_TEST');
  // 제안번호 / 제목 / 고객 / 작성일
  await expect(page.locator('.ps-no')).toContainText('P-2026-7777');
  await expect(page.locator('.ps-title')).toContainText('__E2E_SHARE__ 공유 페이지 테스트');
  await expect(page.locator('.ps-meta')).toContainText('__E2E_SHARE__고객');
  await expect(page.locator('.ps-meta')).toContainText('__E2E_SHARE__ RFP 제목');
  // RFP 요약
  await expect(page.locator('.ps-summary')).toContainText('외부 공개 정보');
  // 파일 1건 + 다운로드 링크
  await expect(page.locator('.ps-file')).toHaveCount(1);
  await expect(page.locator('.ps-file-name')).toContainText('proposal_v1.pdf');
  await expect(page.locator('.ps-file-download')).toHaveAttribute(
    'href',
    '/api/proposals/share/MOCK_E2E_TOKEN_FOR_RENDER_TEST/files/1/download'
  );
  // 만료일 안내
  await expect(page.locator('.ps-footer-expires')).toContainText('2026.12.31');

  await page.unroute('**/api/proposals/share/MOCK_E2E_TOKEN_FOR_RENDER_TEST');
});

test('Phase 5-E — proposal-share.html: mock 410 응답 → "만료된 링크"', async ({ page }) => {
  await page.route('**/api/proposals/share/MOCK_EXPIRED_TOKEN_XXXXXXXXXX', async route => {
    await route.fulfill({
      status: 410,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: '공유 링크가 만료되었습니다' }),
    });
  });

  await page.goto('/proposal-share.html?t=MOCK_EXPIRED_TOKEN_XXXXXXXXXX');
  await expect(page.locator('.ps-error h1')).toContainText('만료된 링크', { timeout: 10000 });
  await expect(page.locator('.ps-error')).toContainText('재발급');

  await page.unroute('**/api/proposals/share/MOCK_EXPIRED_TOKEN_XXXXXXXXXX');
});

test('Phase 5-D — 이메일/공유 탭: 공유 링크 발급된 상태 + URL 표시', async ({ page }) => {
  // mock — 공유 링크 발급된 상태
  await page.route('**/api/proposals/77005', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77005,
          proposal_no: 'P-2026-7005',
          proposal_title: '__E2E_SH__제안',
          customer_name: '__E2E_SH__고객',
          proposal_date: '2026-05-21',
          status: 'draft',
          version_no: 1,
          currency: 'KRW',
          share_token: 'ABCDEF12345_test_token_67890XYZ',
          shared_until: '2026-05-28T18:00:00',
          lead: null,
          quote: null,
          files: [],
          revisions: [],
          email_logs: [
            {
              id: 1,
              sent_at: '2026-05-20T15:00:00',
              to_emails: 'client@example.com',
              subject: '제안서 송부 안내',
              send_status: 'sent',
              sent_by_name: '관리자',
            },
          ],
          history: [],
        },
      }),
    });
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.ProposalsPage._openModal(77005));

  // 기본 탭 렌더 완료 대기 → send 탭으로 (force: true 안정성)
  await expect(page.locator('#pr-f-ai_strategy_md')).toBeVisible();
  await page.locator('.pr-tab[data-tab="send"]').click({ force: true });

  // 공유 링크 발급된 상태 — URL input + 복사/재발급/무효화 버튼
  const urlInput = page.locator('#pr-share-url');
  await expect(urlInput).toBeVisible();
  await expect(urlInput).toHaveValue(/proposal-share\.html\?t=ABCDEF12345_test_token_67890XYZ/);
  await expect(page.locator('#pr-share-copy-btn')).toBeVisible();
  await expect(page.locator('#pr-share-renew-btn')).toBeVisible();
  await expect(page.locator('#pr-share-revoke-btn')).toBeVisible();
  // 미발급 UI 는 없어야 함
  await expect(page.locator('#pr-share-create-btn')).toHaveCount(0);

  // 발송 이력 — 1건 표시
  await expect(page.locator('#pr-tab-content')).toContainText('client@example.com');
  await expect(page.locator('#pr-tab-content')).toContainText('제안서 송부 안내');

  await page.unroute('**/api/proposals/77005');
});

// ── Phase 6-C: AI 제안서 평가 UI ────────────────────────────
test('Phase 6-C — 자료 탭: 호환 파일에만 [📊] 버튼 노출, 비호환은 — 표시', async ({ page }) => {
  await page.route('**/api/proposals/77006', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77006,
          proposal_no: 'P-2026-7006',
          proposal_title: '__E2E_EV__평가',
          customer_name: '__E2E_EV__고객',
          proposal_date: '2026-05-21',
          status: 'draft',
          version_no: 1,
          currency: 'KRW',
          share_token: null,
          shared_until: null,
          lead: null,
          quote: null,
          files: [
            // 자료 — PDF (호환, 평가 가능)
            {
              id: 31,
              file_type: 'proposal',
              original_filename: 'proposal_v1.pdf',
              revision_no: 1,
              is_final: 0,
              include_in_email: 0,
              file_size: 512000,
              created_at: '2026-05-20T10:00:00',
            },
            // 자료 — PPT (비호환, 평가 불가)
            {
              id: 32,
              file_type: 'company_profile',
              original_filename: 'company.pptx',
              revision_no: 1,
              is_final: 0,
              include_in_email: 0,
              file_size: 1024000,
              created_at: '2026-05-19T10:00:00',
            },
          ],
          revisions: [],
          email_logs: [],
          history: [],
        },
      }),
    });
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.ProposalsPage._openModal(77006));

  // 기본 탭 렌더 완료 대기 → 자료 & 견적 탭으로 (force: true 안정성)
  await expect(page.locator('#pr-f-ai_strategy_md')).toBeVisible();
  await page.locator('.pr-tab[data-tab="content"]').click({ force: true });

  // PDF 자료 — [📊] 평가 버튼 노출
  await expect(page.locator('.pr-file-evaluate[data-id="31"]')).toBeVisible();
  // PPTX 자료 — [📊] 미노출 (비호환)
  await expect(page.locator('.pr-file-evaluate[data-id="32"]')).toHaveCount(0);

  await page.unroute('**/api/proposals/77006');
});

test('Phase 6-C — AI 평가 mock 호출 → 결과 카드 렌더 (커버율 / 충족 / 누락 / 개선)', async ({
  page,
}) => {
  await page.route('**/api/proposals/77007', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77007,
          proposal_no: 'P-2026-7007',
          proposal_title: '__E2E_EV2__평가',
          customer_name: '__E2E_EV2__고객',
          proposal_date: '2026-05-21',
          status: 'draft',
          version_no: 1,
          currency: 'KRW',
          share_token: null,
          shared_until: null,
          lead: null,
          quote: null,
          files: [
            {
              id: 41,
              file_type: 'proposal',
              original_filename: 'proposal_for_eval.pdf',
              revision_no: 1,
              is_final: 1,
              include_in_email: 0,
              file_size: 800000,
              created_at: '2026-05-20T10:00:00',
            },
          ],
          revisions: [],
          email_logs: [],
          history: [],
        },
      }),
    });
  });

  // 평가 API mock — 결정적 응답
  await page.route('**/api/proposals/77007/evaluate', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 1,
          proposal_id: 77007,
          target_file_id: 41,
          rfp_file_id: 99,
          target_filename: 'proposal_for_eval.pdf',
          rfp_filename: 'rfp_doc.pdf',
          coverage_score: 78,
          covered_count: 12,
          missing_count: 3,
          covered_items: [
            { requirement: '__E2E_EV__ 클라우드 인프라', evidence: '__E2E_EV__ 제안서 3.1절' },
          ],
          missing_items: [
            {
              requirement: '__E2E_EV__ 보안 인증',
              severity: 'high',
              suggestion: '__E2E_EV__ 인증 보유 현황 명시',
            },
          ],
          improvement_suggestions: [
            { section: '__E2E_EV__ 5장 가격', suggestion: '__E2E_EV__ 경쟁사 비교표 추가' },
          ],
          overall_assessment: '## 1. 종합 평가\n- __E2E_EV__ 좋음',
          // Phase 8-D: 수주확률 + 정성 메트릭 + 승리/리스크 요인
          win_probability: 72,
          quality_metrics: {
            clarity: 8,
            completeness: 7,
            differentiation: 6,
            feasibility: 9,
            price_competitiveness: 5,
          },
          win_factors: ['__E2E_WIN__ 강력한 레퍼런스', '__E2E_WIN__ 빠른 납기'],
          risk_factors: ['__E2E_RISK__ 가격 경쟁력', '__E2E_RISK__ 인증 부족'],
          generated_at: '2026-05-22T10:00:00',
        },
      }),
    });
  });

  // confirm 자동 OK
  page.on('dialog', d => d.accept());

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.ProposalsPage._openModal(77007));

  // 기본 탭 렌더 완료 대기 → 자료 & 견적 탭 → [📊] 클릭 (force: true 안정성)
  await expect(page.locator('#pr-f-ai_strategy_md')).toBeVisible();
  await page.locator('.pr-tab[data-tab="content"]').click({ force: true });
  // 자료 탭 렌더 완료 대기 (파일 목록 + 평가 버튼 가시화)
  await expect(page.locator('.pr-file-evaluate[data-id="41"]')).toBeVisible();
  await page.locator('.pr-file-evaluate[data-id="41"]').click({ force: true });

  // 결과 카드 렌더 확인
  await expect(page.locator('#pr-eval-card')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.pr-eval-title')).toContainText('AI 평가 결과');
  await expect(page.locator('.pr-eval-subtitle')).toContainText('proposal_for_eval.pdf');
  await expect(page.locator('.pr-eval-subtitle')).toContainText('rfp_doc.pdf');
  // 커버율 78%
  await expect(page.locator('.pr-eval-score-num')).toContainText('78%');
  await expect(page.locator('.pr-eval-score-meta')).toContainText('충족 12');
  await expect(page.locator('.pr-eval-score-meta')).toContainText('누락 3');
  // 충족 항목 / 누락 / 개선
  await expect(page.locator('.pr-eval-covered')).toContainText('__E2E_EV__ 클라우드 인프라');
  await expect(page.locator('.pr-eval-missing')).toContainText('__E2E_EV__ 보안 인증');
  await expect(page.locator('.pr-eval-missing')).toContainText('인증 보유 현황 명시');
  await expect(page.locator('#pr-eval-card')).toContainText('__E2E_EV__ 경쟁사 비교표 추가');
  // 종합 평가 마크다운
  await expect(page.locator('.pr-eval-md .md-h2')).toContainText('종합 평가');
  // Phase 8-D: 수주확률 카드 + 정성 메트릭 + 승리/리스크 요인 검증
  await expect(page.locator('.pr-eval-winprob-num')).toContainText('72');
  await expect(page.locator('.pr-eval-winprob-label')).toContainText('수주확률');
  await expect(page.locator('.pr-eval-metric-row')).toHaveCount(5);
  await expect(page.locator('.pr-eval-metrics-card')).toContainText('명확성');
  await expect(page.locator('.pr-eval-metrics-card')).toContainText('가격경쟁력');
  await expect(page.locator('.pr-eval-factor-win')).toContainText('__E2E_WIN__ 강력한 레퍼런스');
  await expect(page.locator('.pr-eval-factor-risk')).toContainText('__E2E_RISK__ 가격 경쟁력');

  await page.unroute('**/api/proposals/77007');
  await page.unroute('**/api/proposals/77007/evaluate');
});
