// =============================================================
// E2E — PWA Shortcut: ?action=meeting → 회의록 AI 페이지 바로 이동
//
// 검증 시나리오:
//   1. URL ?action=meeting 로 진입 → 회의록 AI 페이지로 라우팅
//   2. 회의록 페이지의 핵심 UI (녹음 버튼, 파일 업로드, AI 요약 카드) 존재
//   3. URL 의 ?action 파라미터 자동 정리됨 (재진입 무한 트리거 방지)
//   4. manifest.json shortcuts 에 "회의록 AI" 정의 + 아이콘 검증
//
// 배경:
//   PWA manifest.json shortcuts 에 "회의록 AI" 등록 → Android 홈화면 long-press
//   → /?action=meeting → 회의록 페이지 (음성→AI 요약)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('PWA shortcut — ?action=meeting 진입 → 회의록 AI 페이지 라우팅', async ({ page }) => {
  // 회의록 AI 쇼트컷 URL 로 진입
  await page.goto('/?action=meeting', { waitUntil: 'domcontentloaded' });

  // 1) 회의록 페이지로 라우팅 (#meeting hash)
  await page.waitForFunction(() => location.hash === '#meeting', { timeout: 8000 });

  // 2) 회의록 페이지 핵심 UI 확인 — 녹음 시작 버튼
  await expect(page.locator('#rec-start-btn')).toBeVisible({ timeout: 5000 });

  // 3) 파일 업로드 드롭존 존재
  await expect(page.locator('#audio-dropzone')).toBeVisible();

  // 4) URL 의 ?action 파라미터 자동 정리됨
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('action'), {
    timeout: 3000,
  });
});

test('PWA shortcut — manifest.json 에 "회의록 AI" shortcuts 정의', async ({ page }) => {
  const resp = await page.request.get('/manifest.json');
  expect(resp.ok()).toBeTruthy();
  const manifest = await resp.json();
  expect(Array.isArray(manifest.shortcuts)).toBeTruthy();

  // 회의록 AI shortcut 찾기
  const meetingShortcut = manifest.shortcuts.find(
    s => s.url && s.url.includes('action=meeting')
  );
  expect(meetingShortcut, '회의록 AI shortcut 정의 누락').toBeTruthy();
  expect(meetingShortcut.name).toBe('회의록 AI');
  expect(meetingShortcut.short_name).toBe('회의록');
  // 아이콘 경로 검증
  expect(meetingShortcut.icons?.[0]?.src).toBe('/assets/shortcut-meeting.svg');
});

test('PWA shortcut — 명함 촬영 + 회의록 AI 두 쇼트컷 동시 정의', async ({ page }) => {
  const resp = await page.request.get('/manifest.json');
  const manifest = await resp.json();
  // 두 쇼트컷 모두 존재
  expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(2);
  const urls = manifest.shortcuts.map(s => s.url);
  expect(urls).toContain('/?action=scan-card');
  expect(urls).toContain('/?action=meeting');
});

test('PWA shortcut — 아이콘 SVG 파일이 실제 서빙됨', async ({ page }) => {
  const resp = await page.request.get('/assets/shortcut-meeting.svg');
  expect(resp.ok()).toBeTruthy();
  expect(resp.headers()['content-type']).toContain('image/svg');
});
