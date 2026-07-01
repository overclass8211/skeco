// =============================================================
// E2E — 회의록 AI > 수기 작성 (③) + 회의록 템플릿
//
// 검증(기획서):
//   1) [수기 작성 시작] → 진입 카드 숨김 + 수기 폼 표시
//   2) 회의록 템플릿 드롭박스 6종 + 선택 시 본문 삽입
//   3) 시간 30분 단위 + 종료<시작 저장 차단
//   4) 저장 → 회의록 목록으로 이동
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

test('회의록 AI — 3모드 카드 일관화(라인 아이콘) + Google Meet/Gmail 제거', async ({ page }) => {
  await page.evaluate(() => App.navigate('meeting'));
  await page.waitForSelector('#meeting-entry', { timeout: 15000 });

  // 3개 카드 + 라인 아이콘 칩(이모지 아님) 3개
  expect(await page.locator('#meeting-entry > .card').count()).toBe(3);
  expect(await page.locator('#meeting-entry .meet-ico svg').count()).toBe(3);
  // 3가지 CTA + 카드별 톤(레드/블루/틸)
  await expect(page.locator('#rec-start-btn')).toBeVisible();
  await expect(page.locator('#audio-pick-btn')).toBeVisible();
  await expect(page.locator('#meeting-manual-btn')).toBeVisible();
  const bg = sel => page.locator(sel).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(await bg('#rec-start-btn')).toBe('rgb(234, 0, 44)'); // SK 레드
  expect(await bg('#audio-pick-btn')).toBe('rgb(26, 115, 232)'); // 블루
  expect(await bg('#meeting-manual-btn')).toBe('rgb(14, 165, 160)'); // 틸/민트
  // 3버튼 하단 정렬(오와열) — 세로 위치 동일
  const tops = await page.$$eval('#meeting-entry .meet-cta:visible', els =>
    els.map(e => Math.round(e.getBoundingClientRect().top))
  );
  expect(new Set(tops).size).toBe(1);
  // Google Meet / Gmail 동기화 제거
  await expect(page.locator('#gmeet-card')).toHaveCount(0);
  await expect(page.locator('#gmail-sync-toggle')).toHaveCount(0);
});

test('회의록 AI — 수기 폼: 리치 에디터(Quill) + HTML 소스탭 + 고객 자동완성', async ({ page }) => {
  await page.evaluate(() => App.navigate('meeting'));
  await page.waitForSelector('#meeting-manual-btn', { timeout: 15000 });
  await page.locator('#meeting-manual-btn').click();
  await expect(page.locator('#meeting-manual')).toBeVisible();

  // Quill 리치 에디터 + 툴바 렌더
  await expect(page.locator('.mm-editor-wrap .ql-toolbar')).toBeVisible();
  await expect(page.locator('.mm-editor-wrap .ql-editor')).toBeVisible();
  expect(await page.locator('.mm-editor-wrap .ql-toolbar .ql-bold').count()).toBe(1);
  expect(await page.locator('.mm-editor-wrap .ql-toolbar .ql-image').count()).toBe(1);

  // 템플릿 드롭다운 겹침 방지 — 고정 폭
  const selW = await page
    .locator('#mm-template')
    .evaluate(el => parseInt(getComputedStyle(el).minWidth, 10));
  expect(selW).toBeGreaterThanOrEqual(160);

  // HTML 소스탭 → textarea 노출 + 툴바 숨김, Editor 복귀
  await page.locator('.mm-src-tab[data-mode="html"]').click();
  await expect(page.locator('#mm-html')).toBeVisible();
  await expect(page.locator('.mm-editor-wrap .ql-toolbar')).toBeHidden();
  await page.locator('.mm-src-tab[data-mode="editor"]').click();
  await expect(page.locator('#mm-html')).toBeHidden();
  await expect(page.locator('.mm-editor-wrap .ql-toolbar')).toBeVisible();

  // 고객사 2글자 → 추천 + 선택 시 담당자 자동입력
  await page.locator('#mm-att-cust').fill('');
  await page.locator('#mm-customer').click();
  await page.locator('#mm-customer').fill('BO');
  const item = page.locator('.combobox-dropdown .combobox-item').first();
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click();
  await expect(page.locator('#mm-customer')).toHaveValue('BOE');
  await expect(page.locator('#mm-att-cust')).not.toHaveValue('');
});

test('회의록 AI — 템플릿(노션풍 HTML) 삽입 + 저장 → 상세 HTML 렌더', async ({ page }) => {
  await page.evaluate(() => App.navigate('meeting'));
  await page.waitForSelector('#meeting-manual-btn', { timeout: 15000 });
  await page.locator('#meeting-manual-btn').click();
  await expect(page.locator('#meeting-manual')).toBeVisible();
  await expect(page.locator('#meeting-entry')).toBeHidden();

  // 템플릿 6종 + 시간 30분(48개)
  expect(await page.locator('#mm-template option').count()).toBe(7); // 안내 1 + 6종
  expect(await page.locator('#mm-start option').count()).toBe(48);

  // 템플릿 선택 → 에디터에 리치 HTML 삽입 (h2 + blockquote)
  await page.locator('#mm-template').selectOption('제안/견적 미팅');
  await expect(page.locator('.mm-editor-wrap .ql-editor h2').first()).toBeVisible();
  await expect(page.locator('.mm-editor-wrap .ql-editor')).toContainText('제안 개요');

  // 종료<시작 저장 차단
  const title = '__E2E_MM__ ' + Date.now();
  await page.locator('#mm-title').fill(title);
  await page.locator('#mm-start').selectOption('14:00');
  await page.locator('#mm-end').selectOption('13:00');
  await page.locator('#mm-save-btn').click();
  await expect(page.locator('.toast', { hasText: '종료 시간이 시작 시간보다' })).toBeVisible({
    timeout: 5000,
  });

  // 정상 시간으로 저장 → 목록 이동
  await page.locator('#mm-end').selectOption('15:00');
  await page.locator('#mm-save-btn').click();
  await expect(page).toHaveURL(/#meeting-list/, { timeout: 8000 });

  // 상세: HTML 이 실제 요소로 렌더 (이스케이프 아님)
  await page.locator('.ml-item', { hasText: title }).first().click();
  await expect(page.locator('#ml-detail .ql-editor h2').first()).toBeVisible({ timeout: 8000 });
});
