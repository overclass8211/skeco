// =============================================================
// E2E — 고객사 목록 전량 로드 + 검색 (회귀 방지)
//
// 버그(사용자 보고): 고객사 페이지가 page1(기본 50건)만 로드하고 검색은
//   그 50건만 클라이언트 필터 → 이름 정렬상 뒤쪽 고객사(예: 두산에너빌리티)가
//   목록·검색에 안 잡혀 "고객사가 사라졌다"는 착시. (데이터는 정상)
// 조치: loadData 가 limit=9999 로 전량 로드 → 검색이 전체 대상.
//
// 검증:
//   1) /api/customers 요청에 limit=9999 (전량 로드 fix)
//   2) 이름 정렬상 뒤쪽 고객(두산에너빌리티)이 검색으로 표시됨
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('고객사 — 전량 로드(limit=9999) + 이름 뒤쪽 고객(두산에너빌리티) 검색', async ({ page }) => {
  // (1) 전량 로드 요청 확인 — 네비게이션 전에 리스너 설치
  const reqP = page.waitForRequest(/\/api\/customers\?.*\blimit=9999\b/, { timeout: 15000 });
  await page.goto('/#customers');
  await reqP;

  // 목록 렌더 대기 (검색 전 실고객 표시 — '에너지' 포함 고객 다수)
  await page.waitForSelector('#cust-search', { timeout: 10000 });
  await expect(page.locator('#content')).toContainText('에너지', { timeout: 10000 });

  // (2) 이름 정렬상 뒤쪽 고객 검색 → 표시되어야 함
  await page.fill('#cust-search', '두산에너빌리티');
  await expect(page.locator('#content')).toContainText('두산에너빌리티', { timeout: 5000 });
});
