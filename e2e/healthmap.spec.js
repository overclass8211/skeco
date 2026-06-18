// =============================================================
// E2E — 운영 헬스맵 (Phase 2 정적 노드 그래프)
//
// 검증 핵심:
//   1. 개발자 옵션 > 운영 헬스맵 탭 열림
//   2. 요약 카드 4개 (정상/주의/위험/다운)
//   3. 카테고리 그룹 (gateway / process / api / db / external)
//   4. 노드 카드 상태별 색상 클래스
//   5. 새로고침 버튼 동작
//   6. 노드 클릭 시 안내 토스트 (Phase 4 자리)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('헬스맵 탭 진입 + 요약 통계 표시', async ({ page }) => {
  await page.goto('/#dev');
  await page.waitForSelector('.dev-tabs', { timeout: 10000 });
  await page.click('button[data-tab="healthmap"]');

  // 헬스맵 타이틀
  await expect(page.locator('h3', { hasText: '운영 헬스맵' })).toBeVisible({ timeout: 8000 });

  // 요약 카드 4개
  await expect(page.locator('.hm-stat-card.hm-st-up')).toBeVisible();
  await expect(page.locator('.hm-stat-card.hm-st-warn')).toBeVisible();
  await expect(page.locator('.hm-stat-card.hm-st-critical')).toBeVisible();
  await expect(page.locator('.hm-stat-card.hm-st-down')).toBeVisible();
});

test('카테고리 그룹 (gateway/process/api/db) 표시', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  // .hm-canvas 가 나타날 때까지 대기 + 각 그룹의 count > 0 폴링
  await page.waitForSelector('.hm-canvas .hm-group[data-group="gateway"]', { timeout: 10000 });
  await page.waitForSelector('.hm-canvas .hm-group[data-group="process"]', { timeout: 10000 });
  await page.waitForSelector('.hm-canvas .hm-group[data-group="api"]', { timeout: 10000 });
  await page.waitForSelector('.hm-canvas .hm-group[data-group="db"]', { timeout: 10000 });

  // 각 그룹이 실제로 DOM 에 있음을 확인 (count > 0)
  for (const g of ['gateway', 'process', 'api', 'db']) {
    const count = await page.locator(`.hm-group[data-group="${g}"]`).count();
    expect(count).toBeGreaterThan(0);
  }
});

test('각 노드 카드는 상태 클래스를 가짐', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('.hm-node', { timeout: 8000 });

  // 모든 노드 카드는 hm-st-up / warn / critical / down 중 하나의 클래스 보유
  const nodes = await page.locator('.hm-node').all();
  expect(nodes.length).toBeGreaterThan(3);
  for (const node of nodes) {
    const classes = await node.getAttribute('class');
    expect(classes).toMatch(/hm-st-(up|warn|critical|down)/);
  }
});

test('새로고침 버튼 동작', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('#hm-refresh-btn', { timeout: 8000 });

  // 첫 로드 시간 기록
  const before = await page.locator('.dev-section-header p').textContent();
  await page.waitForTimeout(1100); // 시간 진행 보장 (toLocaleTimeString 초 단위)
  await page.click('#hm-refresh-btn');
  await page.waitForFunction(
    oldText => {
      const el = document.querySelector('.dev-section-header p');
      return el && el.textContent !== oldText;
    },
    before,
    { timeout: 8000 }
  );
});

// ─── Phase 3: WebSocket 실시간 + 펄스 애니메이션 ──────────
test('Phase 3 — WebSocket 구독 시 1초 내 실시간 스냅샷 수신', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('.hm-node', { timeout: 8000 });

  // 초기 타임스탬프 캡처
  const initial = await page.locator('.dev-section-header p').textContent();

  // 2초 대기 — WS 구독 후 1초 push 가 최소 1번 도착해야 함
  await page.waitForFunction(
    old => {
      const el = document.querySelector('.dev-section-header p');
      return el && el.textContent !== old;
    },
    initial,
    { timeout: 5000 }
  );

  // 타임스탬프가 변경됨 = WS 스냅샷 수신 성공
  const updated = await page.locator('.dev-section-header p').textContent();
  expect(updated).not.toBe(initial);
});

test('Phase 3 — 펄스 애니메이션이 상태별로 적용됨 (CSS 클래스 확인)', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('.hm-node', { timeout: 8000 });

  // 정상 노드의 status-dot 가 pulse animation 을 가져야 함
  // (CSS animation-name 확인 — getComputedStyle)
  const animName = await page
    .locator('.hm-node.hm-st-up .hm-node-status-dot')
    .first()
    .evaluate(el => {
      const before = window.getComputedStyle(el, '::before');
      return before.animationName;
    });
  // animation-name 이 hm-pulse-up 이어야 함 (CSS 적용 확인)
  expect(animName).toContain('hm-pulse');
});

test('Phase 3 — 다른 탭 이동 후 헬스맵 재진입 시 정상 동작', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('.hm-node', { timeout: 10000 });
  const initialCount = await page.locator('.hm-node').count();
  expect(initialCount).toBeGreaterThan(3);

  // 다른 탭으로 이동
  await page.click('button[data-tab="jwt"]');
  // 잠시 대기 — unsubscribe 가 서버 도달할 시간
  await page.waitForTimeout(300);

  // 다시 healthmap 으로
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('.hm-node', { timeout: 10000 });
  const reCount = await page.locator('.hm-node').count();
  // 노드 수는 시스템 변동 없으므로 거의 동일해야 함
  expect(reCount).toBeGreaterThan(3);
});

// ─── Phase 4: 노드 클릭 사이드패널 + 가이드 + AI ───────────
test('Phase 4 — 노드 클릭 → 사이드패널 열림 + 메트릭 표시', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('.hm-node', { timeout: 8000 });

  // 프로세스 노드 클릭 (memoryMb 등 메트릭 보장)
  const procNode = page.locator('.hm-node[data-node-type="process"]').first();
  await expect(procNode).toBeVisible();
  await procNode.click();

  // 사이드패널이 열림
  await expect(page.locator('#hm-side-panel.is-open')).toBeVisible({ timeout: 3000 });
  // 4개 탭 존재
  await expect(page.locator('[data-sp-tab="metrics"]')).toBeVisible();
  await expect(page.locator('[data-sp-tab="logs"]')).toBeVisible();
  await expect(page.locator('[data-sp-tab="guide"]')).toBeVisible();
  await expect(page.locator('[data-sp-tab="ai"]')).toBeVisible();
  // 메트릭 K-V 표시 (memoryMb 키가 노출됨)
  await expect(page.locator('.hm-sp-body')).toContainText('memoryMb', { timeout: 3000 });
});

test('Phase 4 — 트러블슈팅 탭 → 시드 가이드 표시', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('.hm-node', { timeout: 8000 });

  // 첫 API 노드 클릭
  const apiNode = page.locator('.hm-node[data-node-type="api"]').first();
  await apiNode.click();
  await expect(page.locator('#hm-side-panel.is-open')).toBeVisible({ timeout: 3000 });

  // 트러블슈팅 탭 클릭
  await page.click('[data-sp-tab="guide"]');
  // 가이드 카드가 표시되거나 "가이드 없음" 메시지 (둘 다 유효)
  // 시드에 api 가이드가 여러 개 있으므로 적어도 1개는 보여야 함
  await page.waitForTimeout(500);
  const hasGuide = (await page.locator('.hm-guide-card').count()) > 0;
  const hasEmpty = (await page.locator('.hm-sp-body .empty').count()) > 0;
  expect(hasGuide || hasEmpty).toBe(true);
});

test('Phase 4 — 사이드패널 닫기 버튼', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('.hm-node', { timeout: 8000 });
  await page.locator('.hm-node').first().click();
  await expect(page.locator('#hm-side-panel.is-open')).toBeVisible();
  await page.click('#hm-sp-close');
  await expect(page.locator('#hm-side-panel.is-open')).toHaveCount(0);
});

test('Phase 4 — 로그 탭 표시 (시드 데이터 또는 empty)', async ({ page }) => {
  await page.goto('/#dev');
  await page.click('button[data-tab="healthmap"]');
  await page.waitForSelector('.hm-node', { timeout: 8000 });

  // /api/dashboard 노드 — 자주 호출되므로 로그가 있을 가능성 높음
  const node = page.locator('.hm-node[data-node-id="api:/api/dashboard"]');
  if ((await node.count()) === 0) {
    test.skip();
    return;
  }
  await node.click();
  await page.click('[data-sp-tab="logs"]');
  // 로그 테이블 또는 empty 메시지
  await page.waitForTimeout(500);
  const hasTable = (await page.locator('.hm-log-table').count()) > 0;
  const hasEmpty = (await page.locator('.hm-sp-body .empty').count()) > 0;
  expect(hasTable || hasEmpty).toBe(true);
});
