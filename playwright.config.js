// =============================================================
// Playwright Configuration — OCI CRM E2E 테스트
//
// 실행:  npx playwright test
// UI:    npx playwright test --ui
// 단일:  npx playwright test global-search
//
// 서버 준비:
//   - 기본: http://localhost:3000 (npm run dev 미리 띄워두기)
//   - 또는: E2E_BASE_URL=https://oci-crm.duckdns.org npx playwright test
//
// 인증: e2e/helpers/auth.js 에서 admin / admin1234! 자동 로그인
// =============================================================
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // 60s test timeout — 외부 CDN 로드 + 모달 큰 컨텐츠 렌더 + AI 분석 mock 등 흡수
  // 개별 waitFor 는 navigationTimeout(30s) 사용 → 총 합계가 timeout 안에 들어가야 함
  timeout: 60 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: false,         // 같은 DB 시드 공유 — 직렬 실행이 안전
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 2, // 로컬도 2회 재시도 (외부 CDN 의존 첫 진입 flaky 흡수)
  workers: 1,                   // DB 공유 시드 사용 — 단일 워커
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    // PORT 가 .env 에 설정돼 있으면 그것을 사용 (기본 3000)
    baseURL: process.env.E2E_BASE_URL
      || `http://localhost:${process.env.PORT || 3000}`,
    trace: 'retain-on-failure', // 실패 시에만 trace 저장
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 8 * 1000,
    // navigationTimeout 30s — 외부 CDN (jsPDF/Chart.js/FullCalendar 등)
    // 첫 로드 시 'load' 이벤트 지연 회피. helpers/auth.js 는 추가로
    // waitUntil:'domcontentloaded' + addInitScript 패턴 사용.
    navigationTimeout: 30 * 1000,
    ignoreHTTPSErrors: true,    // Duck DNS 에서 인증서 문제 회피 시 유용
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 로컬에서 서버 자동 시작 — 이미 떠 있으면 재사용
  // (DB 연결 실패 시 webServer 가 실패하므로, DB 가 안 떠있으면
  //  사용자가 직접 `npm run dev` 로 띄워두는 것을 권장)
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm start',
    url: `http://localhost:${process.env.PORT || 3000}/api/health`,
    reuseExistingServer: true,
    timeout: 30 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
