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

test('영업캘린더 — 새 일정 모달 정돈(색상 제거 · 종일 인라인 · 계획|완료 좌우)', async ({ page }) => {
  await page.evaluate(() => App.navigate('calendar'));
  await page.waitForSelector('#cal-add-btn', { timeout: 15000 });
  await page.locator('#cal-add-btn').click();
  await page.waitForSelector('#cal-event-form', { timeout: 8000 });

  // 1) 색상 구분 필드 제거
  await expect(page.locator('#cal-color, #cal-color-dot')).toHaveCount(0);
  // 2) 종일 일정이 시작/종료와 같은 그룹(행) 안
  await expect(page.locator('#cal-datetime-group #cal-allday')).toHaveCount(1);
  await expect(page.locator('#cal-datetime-group #cal-start')).toHaveCount(1);
  await expect(page.locator('#cal-datetime-group #cal-end')).toHaveCount(1);
  // 3) 라벨: 시작일·종료일·계획 / 설명·메모 제거
  const labels = await page.locator('#cal-event-form .form-label').allInnerTexts();
  const joined = labels.join(' ');
  expect(joined).toContain('시작일');
  expect(joined).toContain('종료일');
  expect(joined).toContain('계획');
  expect(joined).not.toContain('설명 / 메모');
  // 시작/종료 일시는 30분 단위(step=1800)
  await expect(page.locator('#cal-start')).toHaveAttribute('step', '1800');
  await expect(page.locator('#cal-end')).toHaveAttribute('step', '1800');
  // 4·5) 계획 + 완료 내용 textarea 좌우 동시 노출
  await expect(page.locator('#cal-description')).toBeVisible();
  await expect(page.locator('#cal-completion-note')).toBeVisible();

  // 종일 토글 → date 입력 전환
  await page.locator('#cal-allday').check();
  await expect(page.locator('#cal-start-date')).toBeVisible();
  await expect(page.locator('#cal-start')).toBeHidden();
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
