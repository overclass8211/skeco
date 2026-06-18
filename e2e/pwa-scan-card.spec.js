// =============================================================
// E2E — PWA Shortcut: ?action=scan-card → 명함 촬영 라이브 카메라 모달
//
// 검증 시나리오:
//   1. URL ?action=scan-card 로 진입 → 고객사 페이지로 이동
//   2. 라이브 카메라 모달 자동 오픈 (title "📷 명함 촬영")
//   3. 셔터/완료/취소/파일선택 버튼이 모두 존재
//   4. (Phase 2A) getUserMedia 거부 시 — 폴백 버튼으로 HTML5 file input 모달 전환
//   5. (Phase 2A) "📁 파일에서 선택" 버튼으로 폴백 모달 전환 가능
//   6. URL 파라미터 자동 정리됨 (?action 제거)
//   7. manifest.json shortcuts 정의 + 아이콘 검증
//
// 배경:
//   PWA manifest.json shortcuts 에 "명함 촬영" 등록 → Android 홈화면 long-press
//   → /?action=scan-card → 라이브 카메라 뷰파인더 (최대 20장 연속 촬영)
//   getUserMedia 가 헤드리스 환경에서는 권한 거부됨 → 폴백 경로 테스트.
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('PWA shortcut — ?action=scan-card 진입 → 라이브 카메라 모달 자동 오픈', async ({ page }) => {
  // 명함 촬영 쇼트컷 URL 로 진입
  await page.goto('/?action=scan-card', { waitUntil: 'domcontentloaded' });

  // 1) 고객사 페이지로 라우팅
  await page.waitForFunction(() => location.hash === '#customers', { timeout: 8000 });

  // 2) 라이브 카메라 모달이 자동으로 열림
  const modalTitle = page.locator('.modal-header').filter({ hasText: '명함 촬영' });
  await expect(modalTitle).toBeVisible({ timeout: 5000 });

  // 3) 카메라 뷰파인더 + 셔터 + 카운터 존재
  await expect(page.locator('#lc-video')).toBeAttached();
  await expect(page.locator('#lc-shutter')).toBeVisible();
  await expect(page.locator('#lc-counter')).toHaveText(/0 \/ 20/);

  // 4) Footer 버튼 3개 (파일선택 / 취소 / 완료)
  await expect(page.locator('#lc-fallback-btn')).toBeVisible();
  await expect(page.locator('#lc-close-btn')).toBeVisible();
  await expect(page.locator('#lc-done-btn')).toBeVisible();
  // 완료 버튼은 촬영 전이라 disabled
  await expect(page.locator('#lc-done-btn')).toBeDisabled();

  // 5) URL 의 ?action 파라미터가 정리됨
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('action'), {
    timeout: 3000,
  });
});

test('PWA shortcut — 폴백 버튼 클릭 → HTML5 파일 입력 모달 전환', async ({ page }) => {
  await page.goto('/?action=scan-card', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.hash === '#customers', { timeout: 8000 });
  await expect(page.locator('#lc-fallback-btn')).toBeVisible({ timeout: 5000 });

  // 폴백 버튼 클릭
  await page.locator('#lc-fallback-btn').click();

  // 기존 OCR 탭 모달로 전환 — 명함 업로드 헤더 확인
  // (라이브 카메라 모달은 닫히고, 통합 등록 모달이 OCR 탭으로 열림)
  await expect(page.locator('#rtab-content-ocr')).toBeVisible({ timeout: 4000 });
  // 파일 입력에 capture 속성이 동적으로 추가됨 (모바일 카메라 호출 보장)
  const fileInput = page.locator('#card-file-input');
  await expect(fileInput).toHaveAttribute('capture', 'environment');
});

test('PWA shortcut — manifest.json 에 shortcuts 정의가 존재함', async ({ page }) => {
  const resp = await page.request.get('/manifest.json');
  expect(resp.ok()).toBeTruthy();
  const manifest = await resp.json();
  expect(Array.isArray(manifest.shortcuts)).toBeTruthy();
  expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(1);

  const scanShortcut = manifest.shortcuts.find(s => s.url && s.url.includes('action=scan-card'));
  expect(scanShortcut).toBeTruthy();
  expect(scanShortcut.name).toBe('명함 촬영');
  expect(scanShortcut.icons?.[0]?.src).toBe('/assets/shortcut-scan.svg');
});
