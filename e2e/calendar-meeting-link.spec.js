// =============================================================
// E2E — 영업캘린더 > 회의록 연동 링크
//
// 검증:
//   1) 회의록 → 캘린더 등록 시, 일정 수정 모달에 [회의록 상세보기 ›] 링크 노출
//   2) 계획(설명) 필드에는 raw "meeting:N" 이 보이지 않음
//   3) 링크 클릭 → 회의록 상세 화면으로 전환
//   4) 일정 저장 후에도 회의록 참조(meeting:N) 보존
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* noop */
    }
  });
  await loginAsAdmin(page);
});

test('영업캘린더 — 회의록 연동 링크 + 계획 정리 + 참조 보존', async ({ page }) => {
  const cust = '__E2ECAL__' + Date.now();

  // 1) 오늘 날짜 수기 회의록 생성 + 캘린더 등록 (API)
  const setup = await page.evaluate(async c => {
    const today = new Date().toISOString().slice(0, 10);
    const html =
      '<blockquote>핵심 요약 E2E</blockquote><h2>1. 회의 개요</h2><ul><li>목적: 링크검증</li></ul>';
    const created = await API.meetings.create({
      title: 'E2E 회의록 ' + c,
      meeting_date: today,
      summary_md: html,
      customer_name: c,
      source: 'manual',
    });
    const reg = await API.meetings.registerCalendar(created.id, { customer_name: c });
    const det = await API.meetings.get(created.id);
    return { meetingId: created.id, ok: reg.success, calEventId: det.data.calendar_event_id };
  }, cust);
  expect(setup.ok).toBe(true);

  // 2) 캘린더에서 해당 이벤트 열기
  await page.evaluate(() => App.navigate('calendar'));
  await page.waitForSelector('.fc-event', { timeout: 15000 });
  const ev = page.locator('.fc-event', { hasText: `[미팅] ${cust}` }).first();
  await expect(ev).toBeVisible({ timeout: 10000 });
  await ev.click();

  // 3) 일정 수정 모달: 회의록 링크 노출 + 계획에 raw meeting:N 없음
  const link = page.locator('#cal-nav-meeting');
  await expect(link).toBeVisible({ timeout: 5000 });
  await expect(link).toHaveText(/회의록 상세보기/);
  await expect(link).toHaveAttribute('data-meeting-id', String(setup.meetingId));
  const plan = await page.locator('#cal-description').inputValue();
  expect(plan).not.toMatch(/meeting:\d+/);

  // 4) 저장 → 참조 보존 확인 (API 재조회)
  await page.locator('#cal-update-btn').click();
  await page.waitForTimeout(600);
  const desc = await page.evaluate(async id => {
    const r = await API.get(`/calendar/events/${id}`);
    return (r.data || r).description || '';
  }, setup.calEventId);
  expect(desc).toMatch(new RegExp(`meeting:${setup.meetingId}\\b`));

  // 5) 링크 클릭 → 회의록 상세로 전환
  await page.evaluate(() => App.navigate('calendar'));
  await page.waitForSelector('.fc-event', { timeout: 15000 });
  await page.locator('.fc-event', { hasText: `[미팅] ${cust}` }).first().click();
  await expect(page.locator('#cal-nav-meeting')).toBeVisible({ timeout: 5000 });
  await page.locator('#cal-nav-meeting').click();
  await expect(page).toHaveURL(/#meeting-list/, { timeout: 8000 });
  await expect(page.locator('#ml-detail')).toBeVisible({ timeout: 8000 });

  // 정리
  await page.evaluate(
    async s => {
      try {
        await API.del(`/calendar/events/${s.calEventId}`);
      } catch (_) {
        /* noop */
      }
      try {
        await API.meetings.delete(s.meetingId);
      } catch (_) {
        /* noop */
      }
    },
    { calEventId: setup.calEventId, meetingId: setup.meetingId }
  );
});
