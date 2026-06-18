// =============================================================
// E2E — 공통 BulkPaste 컴포넌트 (v6.0.0)
//
// 시나리오:
//   1. 고객사 페이지에서 [📥 붙여넣기 등록] 버튼 클릭 → BulkPaste 모달 오픈
//   2. 정상 데이터 붙여넣기 → 미리보기 ✓ 표시 + [등록하기] 노출
//   3. 필수값 누락 (고객사명 빈 행) → 미리보기 ✗ 표시 + 사유 안내
//   4. XSS 패턴 (<script>) → 보안 감지 + invalid 처리
//   5. 백엔드 200행 초과 → 400 차단
//   6. bulkPaste.js 파일이 실제로 서빙됨
//
// 검증 핵심:
//   - 6대 제약 (행수/중복/필수값/실패사유/보안/부분성공) 의 클라이언트 표면
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  // 온보딩 overlay 가 click 차단 — 비활성화
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* ignore */
    }
  });
  await loginAsAdmin(page);
});

async function _openPasteModal(page) {
  await page.goto('/#customers', { waitUntil: 'domcontentloaded' });
  // SPA 라우트 + 데이터 로드 대기
  await page.waitForSelector('#cp-paste-btn-cust', { timeout: 10000 });
  // 혹시 남아 있는 onboarding overlay 강제 닫기
  await page.evaluate(() => {
    const ov = document.getElementById('onboarding-overlay');
    if (ov) ov.remove();
    // 모든 active 모달 제거 (이전 테스트 잔여)
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  });
  await page.locator('#cp-paste-btn-cust').click();
  await expect(page.locator('#bp-textarea')).toBeVisible({ timeout: 5000 });
}

test('BulkPaste — 고객사 페이지 정상 데이터 미리보기', async ({ page }) => {
  await _openPasteModal(page);
  const data = `고객사명\t지역\t국가\t산업군\nAcme Corp\t국내\t한국\tIT\nBeta Ltd\t해외\t미국\tManufacturing`;
  await page.locator('#bp-textarea').fill(data);

  // 미리보기 — 정상 2건
  await expect(page.locator('text=2건 정상')).toBeVisible({ timeout: 3000 });
  // [등록하기] 버튼 노출
  await expect(page.locator('#bp-submit-btn')).toBeVisible();
});

test('BulkPaste — 필수값 누락 (고객사명 빈 행) → 실패 표시', async ({ page }) => {
  await _openPasteModal(page);
  // 첫 행 OK, 둘째 행 고객사명 비어 있음
  const data = `고객사명\t지역\nValid Corp\t국내\n\t해외`;
  await page.locator('#bp-textarea').fill(data);

  await expect(page.locator('text=1건 정상')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('text=1건 실패')).toBeVisible();
});

test('BulkPaste — XSS 패턴 (<script>) → 보안 감지', async ({ page }) => {
  await _openPasteModal(page);
  // <script> 패턴 — sanitizeCell 에서 throw → 행이 invalid 처리
  const data = `고객사명\t주소\nEvil Inc\t<script>alert('xss')</script>`;
  await page.locator('#bp-textarea').fill(data);

  await expect(page.locator('text=1건 실패')).toBeVisible({ timeout: 3000 });
  // BulkPaste 모달 안의 사유 셀에서만 검색 (모달 외부 industry 옵션 충돌 회피)
  await expect(
    page.locator('#bp-preview-wrap td').filter({ hasText: /보안|스크립트/ }).first()
  ).toBeVisible();
});

test('BulkPaste — bulkPaste.js 파일 정상 서빙', async ({ page }) => {
  const resp = await page.request.get('/js/components/bulkPaste.js');
  expect(resp.ok()).toBeTruthy();
  const text = await resp.text();
  expect(text).toContain('BulkPaste');
  expect(text).toContain('sanitizeCell');
});

test('BulkPaste — 백엔드 200행 초과 → 400 차단', async ({ page }) => {
  // 토큰을 헤더에 명시적으로 첨부 (page.request 는 별개 context)
  const token = await page.evaluate(() => localStorage.getItem('oci_token'));
  const userId = await page.evaluate(() => localStorage.getItem('current_user_id'));
  const rows = Array.from({ length: 201 }, (_, i) => ({ name: `Bulk__TEST__${i}` }));
  const resp = await page.request.post('/api/customers/bulk', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-User-Id': userId || '1',
      'Content-Type': 'application/json',
    },
    data: { customers: rows },
  });
  expect(resp.status()).toBe(400);
  const body = await resp.json();
  expect(body.success).toBe(false);
  expect(body.code).toBe('TOO_MANY');
  expect(body.message).toContain('200');
});
