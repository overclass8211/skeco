// =============================================================
// E2E — 영업딜 활동 추가 모달이 캘린더 일정 모달과 동일 폼 구조
//
// 목적(사용자 보고): 두 영업활동 모달 화면 일치
//   - 제목(최상단) → 활동 유형·활동 구분·담당자(분류 행) → 일시(30분 step)+영업 캘린더 등록 → 내용
//   - 캘린더 모달과 동일한 레이아웃 언어 + datetime 30분 단위
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

test('영업딜 활동 추가 모달 — 캘린더 폼과 동일 구조(제목 top · 분류행 · 일시 30분 · 내용)', async ({ page }) => {
  await page.evaluate(() => App.navigate('leads'));
  await page.waitForSelector('[data-lead-id]', { timeout: 15000 });

  // 활동 모달 직접 오픈 (팀 미로드 대비 폴백)
  await page.evaluate(async () => {
    const token = localStorage.getItem('oci_token');
    const r = await fetch('/api/leads', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json();
    const arr = j.data?.items || j.data || [];
    if (!App.team || !App.team.length) App.team = [{ id: 1, name: '관리자' }];
    App.openActivityForm(arr[0].id, arr[0].customer_name || '');
  });

  const form = page.locator('#activity-form');
  await expect(form).toBeVisible({ timeout: 8000 });

  // 1) 제목이 최상단 첫 필드
  await expect(form.locator('.form-label').first()).toContainText('제목');
  // 2) 분류 행: 활동 유형 · 활동 구분 · 담당자
  await expect(form.locator('[name="activity_type"]')).toBeVisible();
  await expect(form.locator('[name="status"]')).toBeVisible();
  await expect(form.locator('[name="performed_by"]')).toBeVisible();
  // 3) 일시 datetime 30분 단위(step=1800) + 영업 캘린더 등록 인라인
  await expect(form.locator('[name="activity_datetime"]')).toHaveAttribute('step', '1800');
  // 비정렬 입력(:11) → 30분 스냅(:00)
  await form.locator('[name="activity_datetime"]').fill('2026-07-01T14:11');
  await form.locator('[name="activity_datetime"]').dispatchEvent('change');
  await expect(form.locator('[name="activity_datetime"]')).toHaveValue('2026-07-01T14:00');
  await expect(form.locator('#calendar-sync-row #sync-calendar-cb')).toHaveCount(1);
  // 4) 내용
  await expect(form.locator('[name="content"]')).toBeVisible();
});
