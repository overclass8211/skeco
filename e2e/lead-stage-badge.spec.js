// =============================================================
// E2E — 영업딜 상세 헤더 단계 배지 UX (회귀)
//
// 개선: 알록달록 색 배지 5종 → 단계 dot 칩(상태) + 무채색 속성 + 단일 다음단계 버튼.
//   옛 .detail-stage .badge 가 사라지고 .ld-stage-chip / .ld-next-main 으로 대체됨.
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('영업딜 헤더 — 단계 칩 + 무채색 속성 + 단일 다음단계(색 배지 제거)', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: 'admin1234!' },
  });
  const token = (await login.json()).token;
  const lr = await page.request.get('/api/leads?stage=bidding', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const arr = (await lr.json()).data?.items || (await lr.json()).data || [];
  const lead = arr[0];
  expect(lead).toBeTruthy();

  await page.goto('/#leads/' + lead.id);
  await page.reload();

  // 상태(단계) 칩 — 유일한 색 신호
  await expect(page.locator('.ld-stage-chip')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.ld-stage-chip .ld-stage-dot')).toBeVisible();
  // 속성은 무채색 텍스트
  await expect(page.locator('.ld-meta-attr')).toBeVisible();
  // 옛 알록달록 색 배지(.detail-stage .badge) 는 0개여야 함
  await expect(page.locator('.detail-stage .badge')).toHaveCount(0);
  // 다음 단계: 전진 메인 버튼 1개 + 이탈(실주/드롭) 무채색
  await expect(page.locator('.ld-next-main')).toHaveCount(1);
  await expect(page.locator('.ld-next-exit').first()).toBeVisible();
});
