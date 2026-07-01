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
  // 온보딩 투어 자동실행 차단(모달 가림 방지)
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* noop */
    }
  });
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
  // 시작/종료 일시는 30분 단위(step=1800) + 비정렬 입력 시 30분 스냅
  await expect(page.locator('#cal-start')).toHaveAttribute('step', '1800');
  await expect(page.locator('#cal-end')).toHaveAttribute('step', '1800');
  await page.locator('#cal-start').fill('2026-07-01T10:17');
  await page.locator('#cal-start').dispatchEvent('change');
  await expect(page.locator('#cal-start')).toHaveValue('2026-07-01T10:30');
  // 4·5) 계획 + 완료 내용 textarea 좌우 동시 노출
  await expect(page.locator('#cal-description')).toBeVisible();
  await expect(page.locator('#cal-completion-note')).toBeVisible();

  // 종일 토글 → date 입력 전환
  await page.locator('#cal-allday').check();
  await expect(page.locator('#cal-start-date')).toBeVisible();
  await expect(page.locator('#cal-start')).toBeHidden();
});

test('영업캘린더 — 이벤트 클릭 시 편집 모달 직행 + 상태 토글 + 완료내용 저장 유지(회귀)', async ({ page }) => {
  await page.evaluate(() => App.navigate('calendar'));
  await page.waitForSelector('.fc-event', { timeout: 15000 });
  await page.locator('.fc-event').first().click();

  // 클릭 → 편집 모달 직행(상세→수정 2단계 제거): 저장 버튼 + 상태 토글 + 삭제 노출
  await expect(page.locator('#cal-event-form')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#cal-update-btn')).toBeVisible();
  const toggle = page.locator('#cal-status-toggle');
  await expect(toggle).toBeVisible();
  await expect(page.locator('#cal-edit-del-btn')).toBeVisible();

  // 라벨: 영업담당자 / 영업딜 / 고객담당자
  const labels = (await page.locator('#cal-event-form .form-label').allInnerTexts()).join(' ');
  expect(labels).toContain('영업담당자');
  expect(labels).toContain('영업딜');
  expect(labels).toContain('고객담당자');

  // 완료로 토글 + 완료내용 입력 후 저장
  const status = await toggle.getAttribute('data-status');
  if (status !== 'completed') {
    await toggle.click();
    await expect(page.locator('.cal-toggle-text')).toHaveText('완료');
  }
  const txt = 'E2E 완료내용 ' + Date.now();
  await page.locator('#cal-completion-note').fill(txt);
  await page.locator('#cal-update-btn').click();
  await expect(page.locator('.toast', { hasText: '수정' })).toBeVisible({ timeout: 5000 });

  // 재오픈 → 완료 상태 + 완료내용 유지(버그: 이전엔 사라짐)
  await page.locator('.fc-event').first().click();
  await expect(page.locator('#cal-event-form')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#cal-status-toggle')).toHaveAttribute('data-status', 'completed');
  await expect(page.locator('#cal-completion-note')).toHaveValue(txt);
});
