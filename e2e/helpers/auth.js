// =============================================================
// E2E Auth Helper — API 로 로그인 → localStorage 토큰 주입
//
// 이유: GUI 로그인을 매번 거치지 않아 빠르고 안정적
// 사용:
//   const { loginAsAdmin } = require('./helpers/auth');
//   await loginAsAdmin(page);
// =============================================================
'use strict';

const DEFAULT_CREDENTIALS = {
  username: process.env.E2E_USERNAME || 'admin',
  password: process.env.E2E_PASSWORD || 'admin1234!',
};

/**
 * API 로 로그인 후 토큰을 localStorage 에 주입하고 / 로 이동.
 * @param {import('@playwright/test').Page} page
 * @param {{ username?: string, password?: string }} [credentials]
 */
async function loginAsAdmin(page, credentials = {}) {
  const { username, password } = { ...DEFAULT_CREDENTIALS, ...credentials };

  // baseURL 은 playwright.config.js 에서 자동 적용됨
  const resp = await page.request.post('/api/auth/login', {
    data: { username, password },
  });
  if (!resp.ok()) {
    throw new Error(`로그인 실패 (${resp.status()}): ${await resp.text()}`);
  }
  const body = await resp.json();
  if (!body.token) throw new Error('응답에 token 없음: ' + JSON.stringify(body));

  // 🐛 flaky fix: addInitScript 로 navigation 전에 토큰 주입.
  //   기존 방식 (page.goto → evaluate → page.goto) 의 문제:
  //     1) 첫 page.goto 후 checkAuth() 가 token 없음 → /login 으로 redirect
  //     2) evaluate 가 token 주입 시도 중 execution context 파괴
  //        → "Execution context was destroyed" 에러 + flaky
  //     3) 두 번째 page.goto + 외부 CDN 로드 대기로 15s timeout 빈번
  //   해결: addInitScript 가 매 navigation 전에 localStorage 채움
  //         → checkAuth 가 즉시 통과 → redirect 없음 → 단일 page.goto 로 충분
  await page.addInitScript(b => {
    try {
      localStorage.setItem('oci_token', b.token);
      localStorage.setItem('oci_user', JSON.stringify(b.user));
      if (b.user && b.user.id) localStorage.setItem('current_user_id', String(b.user.id));
    } catch (_) {
      /* 일부 컨텍스트에서 localStorage 접근 제한 — 무시 */
    }
  }, body);

  // 인증된 상태로 페이지 로드 — 단 1회 navigation
  //   waitUntil:'domcontentloaded' → 외부 CDN (jsPDF/FullCalendar/Chart.js)
  //   로드 대기 회피. waitForSelector 가 실제 부트스트랩 완료 검증.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // 메인 페이지 부트스트랩 완료 대기 (사이드바 검색 버튼)
  await page.waitForSelector('#global-search-btn', { timeout: 15000 });
}

module.exports = { loginAsAdmin, DEFAULT_CREDENTIALS };
