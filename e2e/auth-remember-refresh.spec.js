// =============================================================
// E2E — "로그인 유지" 만료 토큰 자동 복구 (회귀 방지)
//
// 🐛 보고: 모바일 앱에서 [로그인 유지] 체크해도 (앱 재실행 시) 로그아웃.
//   원인: App.checkAuth() 가 만료 access token 으로 /auth/me 호출 → 401 이면
//        곧장 logout()(= refresh 토큰까지 폐기). refresh 복구를 시도하지 않음.
//   수정: 만료 시 "로그인 유지" 였다면 refresh 토큰(쿠키)으로 1회 복구 후 재검증.
//
// 검증(API 모킹):
//   1) remember ON + 만료 토큰 부팅 → /auth/refresh 자동 호출 → 새 토큰으로 세션 유지
//   2) remember OFF + 무토큰 부팅 → 자동복구 없이 로그인 화면 (체크박스 의미 보존)
// =============================================================
const { test, expect } = require('@playwright/test');

async function mockAuth(page) {
  await page.route('**/api/**', async (route, req) => {
    const url = req.url();
    const auth = req.headers()['authorization'] || '';
    const json = (obj, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

    // /auth/me — 새(FRESH) 토큰만 통과, 그 외(EXPIRED)는 401 만료
    if (/\/api\/auth\/me/.test(url)) {
      if (/Bearer FRESH/.test(auth))
        return json({ success: true, data: { id: 1, username: 'admin', full_name: '관리자', role: 'admin' } });
      return json({ success: false, expired: true, error: 'expired' }, 401);
    }
    // /auth/refresh — refresh 쿠키 기반 새 access token 발급 (성공)
    if (/\/api\/auth\/refresh/.test(url)) return json({ success: true, token: 'FRESH' });
    // 부팅 기타 호출 — 빈 성공 (기능 플래그/대시보드 등)
    if (/\/api\/auth\/features/.test(url)) return json({ success: true, data: {} });
    return json({ success: true, data: [] });
  });
}

test('로그인 유지 ON — 만료 access token 부팅 시 refresh 로 세션 유지', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_token', 'EXPIRED'); // 만료된(=무효) access token
      localStorage.setItem('oci_remember', '1'); // 로그인 유지 ON
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* 무시 */
    }
  });
  await mockAuth(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // refresh 자동복구 → 새 토큰 'FRESH' 저장 (logout 으로 폐기되지 않음)
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('oci_token')), { timeout: 10000 })
    .toBe('FRESH');
  // 로그인 화면으로 튕기지 않음
  expect(page.url()).not.toContain('/login');
});

test('로그인 유지 OFF — 만료/무토큰 부팅 시 자동복구 없이 로그인 화면', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('oci_token'); // 세션 종료 후 access token 없음
      sessionStorage.clear();
      localStorage.setItem('oci_remember', '0'); // 로그인 유지 OFF
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* 무시 */
    }
  });
  await mockAuth(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // 자동복구 없이 로그인 화면 유지 (refresh 미시도)
  await page.waitForURL('**/login', { timeout: 10000 });
  expect(page.url()).toContain('/login');
});
