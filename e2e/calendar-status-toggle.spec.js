// =============================================================
// E2E — 영업캘린더 일정 상세 > 상태 토글 + 완료 메모 인라인
//
// 목적(사용자 보고 UX 개선 회귀): 수정 모달 없이 상태를 토글로 즉시 변경,
//   완료 시 완료 내용을 인라인 입력(포커스 해제 시 저장). 수정 버튼은 유지.
//
// 시나리오:
//   1. loginAsAdmin → 캘린더 진입
//   2. 임의 일정 클릭 → 상세 모달
//   3. 상태 토글 클릭 → status PUT 반영(텍스트 계획↔완료)
//   4. 완료 시 완료 내용 textarea 노출 + 입력 후 blur 저장(PUT)
//   5. 수정 버튼 유지 확인
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('영업캘린더 — 상태 토글 즉시저장 + 완료 메모 인라인', async ({ page }) => {
  await page.evaluate(() => App.navigate('calendar'));
  await page.waitForSelector('.fc-event', { timeout: 15000 });
  await page.locator('.fc-event').first().click();

  // 상세 모달 — 상태 토글 + 수정 버튼(유지) 노출
  const toggle = page.locator('#cal-status-toggle');
  await expect(toggle).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#cal-edit-btn')).toBeVisible();

  // 완료 상태로 맞춤 (이미 완료면 그대로) — 완료 내용 textarea 노출
  const isOn = await toggle.evaluate(el => el.classList.contains('on'));
  if (!isOn) {
    await toggle.click();
    await expect(page.locator('.cal-toggle-text')).toHaveText('완료', { timeout: 5000 });
  }
  const note = page.locator('#cal-completion-note');
  await expect(note).toBeVisible();

  // 완료 내용 입력 → blur 저장(PUT 성공 토스트)
  const txt = 'E2E 완료 메모 ' + Date.now();
  await note.fill(txt);
  await note.blur();
  await expect(page.locator('.toast', { hasText: '저장' })).toBeVisible({ timeout: 5000 });

  // 토글로 계획 전환 → 완료 내용 숨김
  await toggle.click();
  await expect(page.locator('.cal-toggle-text')).toHaveText('계획', { timeout: 5000 });
  await expect(page.locator('#cal-completion-block')).toBeHidden();
});
