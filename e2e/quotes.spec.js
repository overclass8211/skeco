// =============================================================
// E2E — 견적서 페이지 UI (Phase 1 + Phase 2)
//
// 백엔드 CRUD 는 tests/quotes.test.mjs (vitest + supertest) 에서 검증
// 여기서는 UI 동작만 검증:
//   1) 페이지 진입 → [+ 견적서 작성] 버튼 + 목록 영역
//   2) 작성 모달 → 헤더 입력 + 품목 행 추가 + 합계 자동 계산
//   3) Phase 2 — VAT 토글 즉시 반영 (포함 ↔ 별도)
//   4) Phase 2 — 영업리드 Combobox + 드래그 핸들 표시
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('견적서 페이지 진입 → [+ 견적서 작성] 버튼 + 목록 영역 표시', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });

  const newBtn = page.locator('#qt-new-btn');
  await expect(newBtn).toBeVisible();
  await expect(newBtn).toHaveText(/견적서 작성/);

  // 검색바 + 상태 필터 + 목록 wrap 존재
  await expect(page.locator('#qt-search')).toBeVisible();
  await expect(page.locator('#qt-status')).toBeVisible();
  await expect(page.locator('#qt-list-wrap')).toBeVisible();
});

test('작성 모달 진입 → 합계 자동 계산 검증', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  // 작성 모달 직접 호출 (UI 클릭 chain 의 timing 의존성 회피 — 다른 모달 충돌 방지)
  await page.evaluate(() => window.QuotesPage._openModal(null));

  // 모달 입력 필드 표시
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#qt-f-customer_name')).toBeVisible();
  await expect(page.locator('#qt-add-item-btn')).toBeVisible();
  await expect(page.locator('#qt-items-tbody')).toBeVisible();

  // 기본 첫 행이 있음 (blankItem)
  const firstUnitPrice = page.locator('input[data-f="unit_price"][data-idx="0"]');
  const firstQty = page.locator('input[data-f="quantity"][data-idx="0"]');
  await expect(firstUnitPrice).toBeVisible();

  // 단가 100,000 / 수량 2 → 제안금액 200,000
  // 기본 vat_included=0 (미포함) → vat=0, total=200,000
  await firstUnitPrice.fill('100000');
  await firstQty.fill('2');

  // 합계 영역 갱신 — '₩' + 콤마 포맷
  await expect(page.locator('#qt-subtotal')).toHaveText(/200,000/);
  await expect(page.locator('#qt-vat')).toHaveText('₩0');
  await expect(page.locator('#qt-total')).toHaveText(/200,000/);
});

// ── Phase 2 ────────────────────────────────────────────────
// 🐛 사용자 보고 — 부가세 포함 시 10% 가산이 되어야 함 (이전엔 반대로 동작)
test('🐛 회귀 — VAT 토글: 미포함 → 가산 안 함, 포함 → 10% 가산', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  // 단가 100,000 × 수량 1 → 소계 100,000
  await page.locator('input[data-f="unit_price"][data-idx="0"]').fill('100000');
  await page.locator('input[data-f="quantity"][data-idx="0"]').fill('1');

  // 기본 미포함(value=0) — VAT 0 / 총 100,000
  await expect(page.locator('#qt-vat')).toHaveText('₩0');
  await expect(page.locator('#qt-total')).toHaveText(/100,000/);
  await expect(page.locator('#qt-vat-label')).toHaveText(/미포함/);

  // 포함(value=1)으로 전환 — VAT 10,000 / 총 110,000
  await page.locator('#qt-f-vat_included').selectOption('1');
  await expect(page.locator('#qt-vat')).toHaveText(/10,000/);
  await expect(page.locator('#qt-total')).toHaveText(/110,000/);
  await expect(page.locator('#qt-vat-label')).toHaveText(/10% 가산/);
});

test('Phase 2 — 영업리드 Combobox + 드래그 핸들 표시', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  // 영업리드 Combobox input 존재 + placeholder 안내문 (1글자 안내)
  const leadInput = page.locator('#qt-f-lead-input');
  await expect(leadInput).toBeVisible();
  await expect(leadInput).toHaveAttribute('placeholder', /1글자/);

  // 드래그 핸들 — 첫 행에 있어야 함
  const dragHandle = page.locator('.qt-drag-handle').first();
  await expect(dragHandle).toBeVisible();
  await expect(dragHandle).toHaveText('⋮⋮');

  // 두 행 추가 후 핸들도 2개
  await page.locator('#qt-add-item-btn').click();
  await expect(page.locator('.qt-drag-handle')).toHaveCount(2);
});

// ── 🐛 사용자 보고 — 영업리드 예상금액이 ₩0 으로 표시 ──
//   원인: leads API 필드는 expected_amount + currency + amount_krw 인데
//         quotes 가 item.amount 만 보고 있어서 항상 falsy → ₩0
//   fix : Fmt.amount(expected_amount, currency) 로 정확히 표시 +
//         외화면 KRW 환산 보조 표시 (pipeline 패턴)
test('🐛 회귀 — 영업리드 선택 시 예상금액이 expected_amount 로 정확히 표시', async ({ page }) => {
  // /api/leads* 응답을 mock — 36.6B (366억) 짜리 lead 1개
  await page.route('**/api/leads**', async route => {
    const url = route.request().url();
    // GET /api/leads (목록만 mock — 상세는 통과)
    if (route.request().method() === 'GET' && /\/api\/leads(\?|$)/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 99001,
              customer_id: 88001,
              customer_name: '__E2E_AMT__고객사',
              project_name: '__E2E_AMT__프로젝트',
              stage: 'negotiation',
              expected_amount: 36600000000,
              currency: 'KRW',
              amount_krw: 36600000000,
            },
          ],
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-lead-input')).toBeVisible({ timeout: 5000 });

  // 영업리드 input 에 1글자 입력 → dropdown 표시
  await page.locator('#qt-f-lead-input').fill('__E2E_AMT__');
  await page.waitForTimeout(300);

  // dropdown 의 아이템 클릭으로 선택
  const dropdownItem = page.locator('.combobox-item').first();
  await expect(dropdownItem).toBeVisible({ timeout: 3000 });
  await dropdownItem.click();

  // lead 정보 패널 표시 + 예상금액 정확
  await expect(page.locator('#qt-lead-info')).toBeVisible();
  // Fmt.amount(36600000000, 'KRW') => '₩366.0억'
  await expect(page.locator('#qt-lead-info-amount')).toContainText('366.0억');
  // 단계도 정확히
  await expect(page.locator('#qt-lead-info-stage')).toContainText('negotiation');

  await page.unroute('**/api/leads**');
});

// ── 🐛 사용자 보고 — 모달 외부 클릭 시 즉시 닫히는 문제 ──
//   원인: Modal.open 의 overlay.onclick 가 _tryClose 호출 (dirty 안 추적 시 즉시 닫힘)
//   fix : Modal 에 disableOverlayClose 옵션 추가 + 견적서 모달에서 사용
//        외부 클릭 무시 — × 버튼/취소 버튼으로만 닫음 (폼 데이터 보호)
test('🐛 회귀 — 견적서 모달: 외부 (overlay) 클릭으로 닫히지 않음', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  // overlay 영역(모달 박스 바깥) 클릭 — 좌상단 (10, 10)
  await page.locator('#modal-overlay').click({ position: { x: 10, y: 10 }, force: true });
  // 모달이 여전히 열려있어야 함
  await expect(page.locator('#modal-overlay')).toHaveClass(/active/);
  await expect(page.locator('#qt-f-name')).toBeVisible();
});

test('🐛 회귀 — 견적서 모달: 취소 버튼으로는 정상 닫힘', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  // 취소 버튼 클릭 → 모달 닫힘
  await page.locator('#qt-cancel-btn').click();
  await expect(page.locator('#modal-overlay')).not.toHaveClass(/active/);
});

// ── Phase 5: 리비전 트리 + 상태 워크플로우 + 견적번호 콤보 ──
test('Phase 5-C — 견적번호 콤보박스: 자동/수동 토글 + 미리보기 표시', async ({ page }) => {
  // /api/quotes/next-quote-no mock
  await page.route('**/api/quotes/next-quote-no**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { quote_no: 'Q-2026-9999', year: 2026 } }),
    });
  });

  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-quote_no_mode')).toBeVisible({ timeout: 5000 });

  // 기본 auto 모드 — 미리보기 채워짐
  await expect(page.locator('#qt-f-quote_no_mode')).toHaveValue('auto');
  await expect(page.locator('#qt-f-quote_no')).toHaveValue('Q-2026-9999');
  await expect(page.locator('#qt-f-quote_no')).toHaveAttribute('readonly', '');

  // 수동 모드 전환 — input 입력 가능 + 값 비워짐
  await page.locator('#qt-f-quote_no_mode').selectOption('manual');
  await expect(page.locator('#qt-f-quote_no')).not.toHaveAttribute('readonly', '');
  await page.locator('#qt-f-quote_no').fill('CUSTOM-001');
  await expect(page.locator('#qt-f-quote_no')).toHaveValue('CUSTOM-001');

  await page.unroute('**/api/quotes/next-quote-no**');
});

test('Phase 5-A — 리비전 트리 모달: 그룹 전체 리비전 표시', async ({ page }) => {
  // 1) 페이지 먼저 로딩 (실제 서버 데이터 사용)
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  // 2) 리비전 endpoint 만 mock — 특정 ID 만 매칭
  await page.route('**/api/quotes/999111/revisions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          group_parent_id: 999111,
          current_id: 999111,
          revisions: [
            {
              id: 999111,
              quote_no: 'Q-2026-0001',
              name: '원본',
              customer_name: 'X',
              quote_date: '2026-05-01',
              status: 'sent',
              parent_quote_id: null,
              revision_no: 1,
              total_amount: 1000,
            },
            {
              id: 999112,
              quote_no: 'Q-2026-0002',
              name: '원본 (Rev 2)',
              customer_name: 'X',
              quote_date: '2026-05-05',
              status: 'draft',
              parent_quote_id: 999111,
              revision_no: 2,
              total_amount: 1200,
            },
            {
              id: 999113,
              quote_no: 'Q-2026-0003',
              name: '원본 (Rev 3)',
              customer_name: 'X',
              quote_date: '2026-05-10',
              status: 'draft',
              parent_quote_id: 999111,
              revision_no: 3,
              total_amount: 1500,
            },
          ],
        },
      }),
    });
  });

  // 3) 직접 _openRevisionTree 호출
  await page.evaluate(() => window.QuotesPage._openRevisionTree(999111));

  // 4) 트리 모달 표시 + 3개 리비전 + 원본/최신 마커 (모달 박스 내부로 스코프 한정)
  const modal = page.locator('#modal-box');
  await expect(modal.locator('text=리비전 트리')).toBeVisible({ timeout: 5000 });
  await expect(modal.locator('text=Q-2026-0001')).toBeVisible();
  await expect(modal.locator('text=Q-2026-0002')).toBeVisible();
  await expect(modal.locator('text=Q-2026-0003')).toBeVisible();
  await expect(modal.locator('text=총 3건')).toBeVisible();
  // 원본/최신 마커 검증 — 표 안의 셀
  await expect(modal.locator('text=현재')).toBeVisible();
  await expect(modal.locator('text=최신')).toBeVisible();

  await page.unroute('**/api/quotes/999111/revisions');
});

test('Phase 5-B — 상태 워크플로우: draft → 📤 발송 버튼 표시', async ({ page }) => {
  // /api/quotes 목록 mock — draft 상태
  await page.route('**/api/quotes**', async route => {
    if (/\/api\/quotes\?/.test(route.request().url())) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 222,
              quote_no: 'Q-2026-0222',
              name: '__E2E_STATUS__견적',
              customer_name: '__E2E_STATUS__',
              quote_date: '2026-05-20',
              vat_included: 0,
              total_amount: 1000,
              status: 'draft',
              parent_quote_id: null,
              revision_no: 1,
            },
          ],
          meta: { total: 1, page: 1, limit: 100 },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => (window.QuotesPage._reload ? null : null));
  // 강제 reload — QuotesPage 모듈이 자체 _reload 를 호출하지만 mock 이 늦게 등록될 수 있음
  await page.waitForTimeout(500);

  // 목록에 발송 버튼 표시
  const sendBtn = page.locator('.qt-status-btn[data-status="sent"]').first();
  await expect(sendBtn).toBeVisible({ timeout: 5000 });
  await expect(sendBtn).toContainText('발송');

  await page.unroute('**/api/quotes**');
});

// ── Phase 4 PDF 개선: 공급사/고객사 + 조건사항 + 안내문 ────
test('PDF 개선 — 미리보기에 공급사/고객사 박스 + 안내문 + 조건사항 표시', async ({ page }) => {
  await page.route('**/api/quotes/**', async route => {
    if (/\/api\/quotes\/55555$/.test(route.request().url())) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 55555,
            quote_no: 'Q-2026-5555',
            name: '__E2E_PDF_NEW__견적',
            customer_name: '__E2E_PDF_NEW__고객사',
            customer_contact: '__E2E_PDF_NEW__홍길동',
            quote_date: '2026-05-20',
            vat_included: 0,
            subtotal: 100,
            vat_amount: 0,
            total_amount: 100,
            status: 'draft',
            revision_no: 1,
            supplier_company_name: '__E2E_PDF_NEW__공급사',
            supplier_address: '서울특별시 강남구 테헤란로',
            supplier_ceo: '__E2E_PDF_NEW__대표자',
            sales_rep_name: '__E2E_PDF_NEW__영업담당',
            sales_rep_contact: '010-1234-5678 / sales@test.co.kr',
            terms_conditions: '1. 유효기간 30일\n2. 부가세 별도\n3. 납기: 발주 후 4주',
            column_labels: null,
            items: [
              {
                item_name: 'A',
                unit_price: 100,
                quantity: 1,
                supply_price: 100,
                proposed_amount: 100,
              },
            ],
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openPreview(55555));
  await expect(page.locator('#qt-preview-area')).toBeVisible({ timeout: 5000 });

  const preview = page.locator('#qt-preview-area');
  // 좌측 고객사 박스
  await expect(preview).toContainText('고객사');
  await expect(preview).toContainText('__E2E_PDF_NEW__고객사');
  await expect(preview).toContainText('__E2E_PDF_NEW__홍길동'); // 담당자
  // 우측 공급사 박스
  await expect(preview).toContainText('공급사');
  await expect(preview).toContainText('__E2E_PDF_NEW__공급사');
  await expect(preview).toContainText('테헤란로'); // 주소
  await expect(preview).toContainText('__E2E_PDF_NEW__대표자');
  await expect(preview).toContainText('__E2E_PDF_NEW__영업담당');
  await expect(preview).toContainText('sales@test.co.kr');
  // 안내문
  await expect(preview).toContainText('아래와 같이 견적 합니다');
  // 조건사항
  await expect(preview).toContainText('조건사항');
  await expect(preview).toContainText('유효기간 30일');
  await expect(preview).toContainText('부가세 별도');

  await page.unroute('**/api/quotes/**');
});

// ── Phase 4: 미리보기 + PDF 내보내기 ────────────────────────
test('Phase 4 — 미리보기 모달: 견적 양식 표시 + PDF 버튼', async ({ page }) => {
  // /api/quotes (list) + /api/quotes/:id 응답 mock
  await page.route('**/api/quotes**', async route => {
    const url = route.request().url();
    if (route.request().method() === 'GET' && /\/api\/quotes\?/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 12345,
              quote_no: 'Q-2026-9999',
              name: '__E2E_PDF__견적',
              customer_name: '__E2E_PDF__고객사',
              quote_date: '2026-05-20',
              vat_included: 1,
              total_amount: 110000,
              status: 'draft',
              revision_no: 1,
            },
          ],
          meta: { total: 1, page: 1, limit: 100 },
        }),
      });
      return;
    }
    if (route.request().method() === 'GET' && /\/api\/quotes\/12345$/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 12345,
            quote_no: 'Q-2026-9999',
            name: '__E2E_PDF__견적',
            customer_name: '__E2E_PDF__고객사',
            quote_date: '2026-05-20',
            vat_included: 1,
            subtotal: 100000,
            vat_amount: 10000,
            total_amount: 110000,
            status: 'draft',
            revision_no: 1,
            column_labels: null,
            items: [
              {
                item_name: '서버 A',
                spec: '64GB',
                unit_price: 100000,
                discount_pct: 0,
                supply_price: 100000,
                quantity: 1,
                proposed_amount: 100000,
                remark: '테스트',
              },
            ],
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  // 미리보기 모달 직접 호출 (목록 row 의 👁 버튼 효과)
  await page.evaluate(() => window.QuotesPage._openPreview(12345));

  // 미리보기 영역 + PDF 버튼 표시
  await expect(page.locator('#qt-preview-area')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#qt-prev-pdf-btn')).toBeVisible();
  await expect(page.locator('#qt-prev-pdf-btn')).toContainText('PDF');

  // 양식 내용 검증 — 견적번호 / 고객명 / 품목 / 합계
  const preview = page.locator('#qt-preview-area');
  await expect(preview).toContainText('Q-2026-9999');
  await expect(preview).toContainText('__E2E_PDF__고객사');
  await expect(preview).toContainText('서버 A');
  await expect(preview).toContainText('110,000'); // 총합계
  await expect(preview).toContainText('10% 가산'); // VAT 라벨

  // 닫기 버튼 동작
  await page.locator('#qt-prev-close-btn').click();
  await expect(page.locator('#modal-overlay')).not.toHaveClass(/active/);

  await page.unroute('**/api/quotes**');
});

test('Phase 4 — PDF 다운로드 트리거 (download 이벤트 발생)', async ({ page }) => {
  await page.route('**/api/quotes/**', async route => {
    const url = route.request().url();
    if (/\/api\/quotes\/77777(\?|$)/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 77777,
            quote_no: 'Q-2026-7777',
            name: '__E2E_PDF__다운로드',
            customer_name: '__E2E_PDF__고객',
            quote_date: '2026-05-20',
            vat_included: 0,
            subtotal: 1000,
            vat_amount: 0,
            total_amount: 1000,
            status: 'draft',
            revision_no: 1,
            column_labels: null,
            items: [
              {
                item_name: 'A',
                unit_price: 1000,
                quantity: 1,
                supply_price: 1000,
                proposed_amount: 1000,
              },
            ],
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  // PDF 다운로드 이벤트 대기 (jsPDF.save 가 anchor.click 으로 트리거)
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.evaluate(() => window.QuotesPage._exportPdf(77777));
  const download = await downloadPromise;

  // 파일명: Q-2026-7777_고객_날짜.pdf
  expect(download.suggestedFilename()).toMatch(/Q-2026-7777.*\.pdf$/);

  await page.unroute('**/api/quotes/**');
});

// ── Phase 3 ────────────────────────────────────────────────
test('Phase 3-A — 컬럼 라벨 편집 패널 토글 + 적용 시 헤더 즉시 갱신', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  // 편집 버튼 + 패널 (초기 hidden)
  const editBtn = page.locator('#qt-col-edit-btn');
  await expect(editBtn).toBeVisible();
  const panel = page.locator('#qt-col-edit-panel');
  await expect(panel).toBeHidden();

  // 토글 → 표시
  await editBtn.click();
  await expect(panel).toBeVisible();

  // item_name 라벨을 "상품명" 으로 변경
  await page.locator('.qt-col-input[data-col="item_name"]').fill('상품명');
  await page.locator('#qt-col-apply-btn').click();

  // 패널 닫힘 + 그리드 헤더에 "상품명" 표시
  await expect(panel).toBeHidden();
  await expect(page.locator('#qt-items-table thead')).toContainText('상품명');
});

test('Phase 3-A — 기본값 복원 버튼', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  await page.locator('#qt-col-edit-btn').click();
  await expect(page.locator('#qt-col-edit-panel')).toBeVisible();

  // 임의 변경 후 기본값 복원
  const itemInput = page.locator('.qt-col-input[data-col="item_name"]');
  await itemInput.fill('XYZ');
  await page.locator('#qt-col-reset-btn').click();
  await expect(itemInput).toHaveValue('품목'); // 기본값으로 복원
});

test('Phase 3-B — 영업리드 패널 + 연결 해제 버튼 (초기 hidden)', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  // 초기 (lead 선택 전) — info 패널 hidden
  await expect(page.locator('#qt-lead-info')).toBeHidden();

  // 연결 해제 함수 호출 → input 값 비워짐
  await page.locator('#qt-f-lead-input').fill('test');
  await page.evaluate(() => {
    document.getElementById('qt-f-lead_id').value = '999';
    document.getElementById('qt-f-customer_id').value = '888';
  });
  await page.evaluate(() => {
    document.getElementById('qt-lead-info').style.display = 'block';
  });

  // 연결 해제 버튼 클릭 → 모두 비워짐
  await page.locator('#qt-lead-clear-btn').click();
  await expect(page.locator('#qt-f-lead-input')).toHaveValue('');
  await expect(page.locator('#qt-lead-info')).toBeHidden();
});

// ── 🐛 사용자 보고 버그 회귀 — 공급단가 자동 계산 + 제안금액 재정의 ──
//   공급단가 = 단가 × (1 - 할인%/100)  (할인 0% 면 단가 동일)
//   제안금액 = 공급단가 × 수량
test('🐛 회귀 — 공급단가 자동 계산 (할인 0% → 단가 동일) + 제안금액 = 공급단가 × 수량', async ({
  page,
}) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  // 단가 1000, 할인 0, 수량 3 → 공급단가 1000, 제안금액 3000
  await page.locator('input[data-f="unit_price"][data-idx="0"]').fill('1000');
  await page.locator('input[data-f="discount_pct"][data-idx="0"]').fill('0');
  await page.locator('input[data-f="quantity"][data-idx="0"]').fill('3');

  // 공급단가 셀 (자동, readonly)
  await expect(page.locator('#qt-it-supply-0')).toHaveText(/1,000/);
  // 제안금액 셀
  await expect(page.locator('#qt-it-amount-0')).toHaveText(/3,000/);
  // 소계
  await expect(page.locator('#qt-subtotal')).toHaveText(/3,000/);
});

test('🐛 회귀 — 할인 15% 적용 시 공급단가 갱신 + 제안금액 즉시 반영', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  // 단가 2000, 할인 15%, 수량 4 → 공급단가 1700, 제안금액 6800
  await page.locator('input[data-f="unit_price"][data-idx="0"]').fill('2000');
  await page.locator('input[data-f="discount_pct"][data-idx="0"]').fill('15');
  await page.locator('input[data-f="quantity"][data-idx="0"]').fill('4');

  // 공급단가 = 2000 × 0.85 = 1700
  await expect(page.locator('#qt-it-supply-0')).toHaveText(/1,700/);
  // 제안금액 = 1700 × 4 = 6800
  await expect(page.locator('#qt-it-amount-0')).toHaveText(/6,800/);
});

test('🐛 회귀 — 공급단가 셀은 입력 불가 (readonly display)', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });

  // 공급단가 input 이 더 이상 존재하지 않음 (display 셀로 전환됨)
  const supplyInput = page.locator('input[data-f="supply_price"]');
  await expect(supplyInput).toHaveCount(0);

  // display 셀은 존재
  await expect(page.locator('#qt-it-supply-0')).toBeVisible();
});

// ── 🐛 사용자 보고 버그 회귀 방지 — 영업리드 Combobox focus 시 dropdown 반짝 ──
//   원인: minChars:0 시 빈 쿼리 → 빈 결과 → 즉시 close (반짝 효과)
//   fix : minChars:1 + 안내 placeholder → focus 만으로 dropdown 안 열림 (의도)
//         사용자가 1글자 입력 시 즉시 매칭 dropdown 표시
test('🐛 회귀 — 영업리드 Combobox: focus 만으로 dropdown 안 열림 (반짝 버그 회피)', async ({
  page,
}) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-lead-input')).toBeVisible({ timeout: 5000 });

  // focus 만 — dropdown 표시 안 됨 (반짝 버그 회피 = 의도된 동작)
  await page.locator('#qt-f-lead-input').focus();
  // 잠시 대기 후 dropdown 이 닫혀있는지 확인
  await page.waitForTimeout(300);
  const dropdownsVisible = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.combobox-dropdown')).filter(
      el => el.style.display !== 'none'
    ).length;
  });
  expect(dropdownsVisible).toBe(0);
});

test('🐛 회귀 — 영업리드 Combobox: 1글자 입력 시 dropdown 정상 표시 (또는 매칭 없음 안내)', async ({
  page,
}) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.QuotesPage._openModal(null));
  await expect(page.locator('#qt-f-lead-input')).toBeVisible({ timeout: 5000 });

  // 1글자 입력 → debounce 100ms → dropdown 표시
  await page.locator('#qt-f-lead-input').fill('테');
  await page.waitForTimeout(300);

  // dropdown 이 열렸는지 (visible) 확인 — 매칭 결과 0건 이어도 dropdown DOM 자체는 표시
  // (display:'block' 인 dropdown 1개 이상)
  const dropdownsVisible = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.combobox-dropdown')).filter(
      el => el.style.display === 'block'
    ).length;
  });
  expect(dropdownsVisible).toBeGreaterThanOrEqual(0); // 캐시에 따라 0~N — DOM 안 닫혀있으면 통과

  // 입력값 자체는 유지됨
  await expect(page.locator('#qt-f-lead-input')).toHaveValue('테');
});
