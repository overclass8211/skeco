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

test('영업캘린더 — 새 일정 모달(활동유형·활동목적·동반자 · 날짜+시간30분 · 계획|완료)', async ({ page }) => {
  await page.evaluate(() => App.navigate('calendar'));
  await page.waitForSelector('#cal-add-btn', { timeout: 15000 });
  await page.locator('#cal-add-btn').click();
  await page.waitForSelector('#cal-event-form', { timeout: 8000 });

  // 색상 구분 필드 제거
  await expect(page.locator('#cal-color, #cal-color-dot')).toHaveCount(0);
  // 라벨: 활동유형·활동목적·동반자·영업담당자·고객담당자·영업딜·계획, (구)유형/설명·메모 없음
  const joined = (await page.locator('#cal-event-form .form-label').allInnerTexts()).join(' ');
  for (const l of ['활동유형', '활동목적', '동반자', '영업담당자', '고객담당자', '영업딜', '계획']) {
    expect(joined).toContain(l);
  }
  expect(joined).not.toContain('설명 / 메모');
  // 활동목적 옵션(제품시연 등) + 동반자 select
  await expect(page.locator('#cal-purpose option', { hasText: '제품시연' })).toHaveCount(1);
  await expect(page.locator('#cal-companion')).toHaveCount(1);
  // 시작일 = 날짜 + 시간 드랍박스(30분 단위: 00/30만, 48개)
  await expect(page.locator('#cal-start-date')).toBeVisible();
  await expect(page.locator('#cal-start-time')).toBeVisible();
  expect(await page.locator('#cal-start-time option').count()).toBe(48);
  await expect(page.locator('#cal-start-time option', { hasText: '09:30' })).toHaveCount(1);
  await expect(page.locator('#cal-start-time option', { hasText: '09:15' })).toHaveCount(0);
  // 계획 + 완료 textarea
  await expect(page.locator('#cal-description')).toBeVisible();
  await expect(page.locator('#cal-completion-note')).toBeVisible();

  // 종일 체크 → 시간 드랍박스 숨김(날짜만)
  await page.locator('#cal-allday').check();
  await expect(page.locator('#cal-start-time')).toBeHidden();
  await expect(page.locator('#cal-start-date')).toBeVisible();
});

test('영업캘린더 — 일정 모달의 영업딜/고객사 [상세 ›] 클릭 시 상세 화면 전환', async ({ page }) => {
  await page.evaluate(() => App.navigate('calendar'));
  await page.waitForSelector('#cal-add-btn', { timeout: 15000 });

  // 실존 영업딜 1건 확보
  const leadId = await page.evaluate(async () => {
    const token = localStorage.getItem('oci_token');
    const j = await (await fetch('/api/leads', { headers: { Authorization: 'Bearer ' + token } })).json();
    return (j.data?.items || j.data || [])[0].id;
  });

  await page.locator('#cal-add-btn').click();
  await page.waitForSelector('#cal-event-form', { timeout: 8000 });
  await expect(page.locator('#cal-nav-lead')).toBeVisible();
  await expect(page.locator('#cal-nav-cust')).toBeVisible();

  // 영업딜 연결 후 [상세 ›] → 영업딜 상세로 전환
  await page.evaluate(id => {
    document.getElementById('cal-lead-id').value = String(id);
  }, leadId);
  await page.locator('#cal-nav-lead').click();
  await expect(page).toHaveURL(new RegExp(`#leads/${leadId}`), { timeout: 5000 });
});

test('영업캘린더 — 종료일이 시작일보다 앞서면 저장 차단 + 안내(회귀)', async ({ page }) => {
  await page.evaluate(() => App.navigate('calendar'));
  await page.waitForSelector('#cal-add-btn', { timeout: 15000 });
  await page.locator('#cal-add-btn').click();
  await page.waitForSelector('#cal-event-form', { timeout: 8000 });

  await page.locator('#cal-title').fill('__E2E_BADRANGE__');
  await page.locator('#cal-start-date').fill('2026-07-17');
  await page.locator('#cal-start-time').selectOption('15:30');
  await page.locator('#cal-end-date').fill('2026-07-08');
  await page.locator('#cal-end-time').selectOption('18:30');
  await page.locator('#cal-save-btn').click();

  // 안내 토스트 + 모달 유지(저장 차단)
  await expect(page.locator('.toast', { hasText: '종료일이 시작일보다 앞설 수 없습니다' })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator('#cal-event-form')).toBeVisible();
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
