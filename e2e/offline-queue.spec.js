// =============================================================
// E2E — 오프라인 회의록 녹음 큐 (IndexedDB + 동기화)
//
// 시나리오:
//   1. 회의록 페이지 진입 시 큐가 비어 있으면 카드 숨김
//   2. JS API 로 OfflineQueue.add() 후 카드 표시 + 항목 행 노출
//   3. 항목 삭제 → 카드 숨김
//   4. 큐 상태별 배지 색상/라벨 노출 (uploading/error/done)
//   5. 'done' 항목의 "결과 보기" → 화자 영역에 transcript 표시
//
// 주의: 실제 오프라인 STT 업로드는 외부 API 의존이라 E2E 에서는
// IndexedDB 큐 동작 + UI 만 검증. 업로드 자체는 통합 테스트로 분리.
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.evaluate(() => localStorage.setItem('oci_onboarding_done', '1'));
});

async function gotoMeeting(page) {
  // App.init() 의 hashchange 리스너 등록 보장 — 사이드바 menu 클릭 시 즉시 작동
  await page.waitForSelector('.nav-item[data-page="meeting"]', { timeout: 15000 });
  await page.locator('.nav-item[data-page="meeting"]').click();
  // 회의록 페이지 핵심 요소 대기 (render() 완료 시 카드 + dropzone 함께 삽입됨)
  await page.waitForSelector('#audio-dropzone', { timeout: 15000 });
  // IndexedDB 큐 비우기 — OfflineQueue 가 로드된 이 시점에 수행 (DB 핸들 충돌 없음)
  await page.evaluate(async () => {
    if (!window.OfflineQueue) return;
    const items = await window.OfflineQueue.list();
    for (const it of items) await window.OfflineQueue.remove(it.id);
  });
}

test('OQ-1 — 빈 큐: 카드 숨김', async ({ page }) => {
  await gotoMeeting(page);
  await expect(page.locator('#offline-queue-card')).toBeHidden();
});

test('OQ-2 — 항목 추가 후 카드 표시 + 메타 노출', async ({ page }) => {
  await gotoMeeting(page);
  // JS API 로 직접 추가 (실제 녹음 우회)
  await page.evaluate(async () => {
    const blob = new Blob([new Uint8Array(1024)], { type: 'audio/webm' });
    await window.OfflineQueue.add(blob, {
      filename: 'test.webm',
      customer_name: '__TEST_CUST__',
      meeting_date: '2026-05-16',
      meeting_title: 'E2E 오프라인 테스트',
    });
  });
  // 카드 표시 + 한 행
  await expect(page.locator('#offline-queue-card')).toBeVisible();
  await expect(page.locator('#offline-queue-count')).toContainText('1건');
  await expect(page.locator('#offline-queue-list')).toContainText('__TEST_CUST__');
  await expect(page.locator('#offline-queue-list')).toContainText('E2E 오프라인 테스트');
  await expect(page.locator('#offline-queue-list')).toContainText('대기 중');
});

test('OQ-3 — 항목 삭제 → 카드 숨김', async ({ page }) => {
  await gotoMeeting(page);
  await page.evaluate(async () => {
    const blob = new Blob([new Uint8Array(512)], { type: 'audio/webm' });
    await window.OfflineQueue.add(blob, { filename: 't.webm' });
  });
  await expect(page.locator('#offline-queue-card')).toBeVisible();
  // confirm 자동 수락
  page.on('dialog', d => d.accept());
  await page.locator('[data-oq-del]').click();
  await expect(page.locator('#offline-queue-card')).toBeHidden({ timeout: 5000 });
});

test('OQ-4 — done 항목: 결과 보기 → 화자 영역에 transcript 표시', async ({ page }) => {
  await gotoMeeting(page);
  // 완료 상태 항목을 직접 IndexedDB 에 주입
  await page.evaluate(async () => {
    const blob = new Blob([new Uint8Array(256)], { type: 'audio/webm' });
    const item = await window.OfflineQueue.add(blob, {
      filename: 'done.webm',
      meeting_title: 'DoneTest',
    });
    await window.OfflineQueue.update(item.id, {
      status: 'done',
      result: {
        transcript: '이것은 테스트 전사 결과입니다.',
        speakers: [{ speaker: 1, text: '이것은 테스트 전사 결과입니다.' }],
        durationSec: 10,
        sizeKB: 1,
      },
    });
  });
  await expect(page.locator('#offline-queue-card')).toBeVisible();
  await expect(page.locator('#offline-queue-list')).toContainText('완료');

  // "결과 보기" 클릭 — meeting-result 영역 표시 + 화자 텍스트 노출
  await page.locator('[data-oq-view]').click();
  await expect(page.locator('#meeting-result')).toBeVisible();
  await expect(page.locator('#speakers-list')).toContainText('이것은 테스트 전사 결과입니다.', {
    timeout: 5000,
  });
});

test('OQ-5 — error 상태: 재시도 버튼 노출', async ({ page }) => {
  await gotoMeeting(page);
  await page.evaluate(async () => {
    const blob = new Blob([new Uint8Array(256)], { type: 'audio/webm' });
    const item = await window.OfflineQueue.add(blob, { filename: 'err.webm' });
    await window.OfflineQueue.update(item.id, { status: 'error', error: '서버 오류' });
  });
  await expect(page.locator('#offline-queue-list')).toContainText('실패');
  await expect(page.locator('#offline-queue-list')).toContainText('서버 오류');
  await expect(page.locator('[data-oq-retry]')).toBeVisible();
});
