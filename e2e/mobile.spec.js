// =============================================================
// E2E — 모바일 뷰포트 (iPhone SE 375×667) 회귀
//
// 검증 시나리오:
//   1. 사이드바 햄버거 동작 (overflow 없음, 오버레이 토글)
//   2. 대시보드 — 메트릭/카드 표시, 가로 스크롤 없음
//   3. 영업 리드 — 필터바 wrap + 테이블 가로 스크롤 wrapper
//   4. 고객사 — 검색/등록 버튼 가시
//   5. 프로젝트 — 카드 제목 + 등록 버튼 가시
//   6. 회의록 AI — 1열 레이아웃
//   7. 모달 — 95vw 폭, 화면 안에 들어옴
//   8. 페이지 타이틀 — 햄버거 옆 표시 (breadcrumb 숨김)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const VP = { width: 375, height: 667 }; // iPhone SE 2020 (가장 좁은 주류 뷰포트)

test.use({ viewport: VP });

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  // 온보딩 모달 차단
  await page.evaluate(() => localStorage.setItem('oci_onboarding_done', '1'));
});

// 공통: 가로 스크롤 없음 헬퍼
async function expectNoHorizontalScroll(page) {
  const result = await page.evaluate(() => {
    const docEl = document.documentElement;
    return {
      scrollWidth: docEl.scrollWidth,
      clientWidth: docEl.clientWidth,
      overflowX: window.getComputedStyle(document.body).overflowX,
    };
  });
  // 1~2px 오차 허용 (rounding)
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 2);
}

// 페이지 이동 헬퍼 (hashchange race 회피)
async function gotoPage(page, pageId, waitSelector) {
  await page.evaluate(id => {
    location.hash = '#' + id;
  }, pageId);
  if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 10000 });
}

test('시나리오 1 — 햄버거 메뉴 동작 + 사이드바 오버레이', async ({ page }) => {
  await gotoPage(page, 'dashboard', '#page-title');

  // 햄버거 버튼 가시
  const hamburger = page.locator('#mobile-menu-btn');
  await expect(hamburger).toBeVisible();

  // 사이드바는 초기에 숨김 (transform: translateX(-100%))
  const sidebarTransform = await page.evaluate(
    () => window.getComputedStyle(document.querySelector('.sidebar')).transform
  );
  expect(sidebarTransform).not.toBe('none');

  // 햄버거 클릭 → 사이드바 mobile-open + 오버레이 active
  await hamburger.click();
  await expect(page.locator('.sidebar.mobile-open')).toBeVisible();
  await expect(page.locator('.sidebar-overlay.active')).toBeVisible();

  // 오버레이 클릭 → 사이드바 닫힘
  await page.locator('.sidebar-overlay.active').click({ force: true });
  await expect(page.locator('.sidebar.mobile-open')).toHaveCount(0);
});

test('시나리오 2 — 대시보드: 메트릭/카드 + 가로 스크롤 없음', async ({ page }) => {
  await gotoPage(page, 'dashboard', '#page-title');
  // 페이지 타이틀 가시
  await expect(page.locator('#page-title')).toBeVisible();
  // breadcrumb 은 모바일에서 숨김
  await expect(page.locator('#page-breadcrumb')).toBeHidden();
  // 메트릭 그리드 존재
  await expect(page.locator('#dashboard-metrics')).toBeVisible({ timeout: 10000 });
  await expectNoHorizontalScroll(page);
});

test('시나리오 3 — 영업 리드: 필터 wrap + 등록 버튼 가시', async ({ page }) => {
  await gotoPage(page, 'leads', '#leads-open-form-btn');
  await expect(page.locator('#leads-open-form-btn')).toBeVisible();
  // 검색 input 가시
  await expect(page.locator('#leads-search')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('시나리오 4 — 고객사: 검색/등록 버튼 가시', async ({ page }) => {
  await gotoPage(page, 'customers', '#cust-search');
  await expect(page.locator('#cust-search')).toBeVisible();
  await expect(page.locator('#cust-register-btn')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('시나리오 5 — 프로젝트: 등록 버튼 가시', async ({ page }) => {
  await gotoPage(page, 'projects', '#proj-search');
  await expect(page.locator('#proj-search')).toBeVisible();
  await expect(page.locator('#proj-open-form-btn')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('시나리오 6 — 회의록 AI: 단일 컬럼 레이아웃', async ({ page }) => {
  await gotoPage(page, 'meeting');
  // 회의록 페이지 핵심 요소 (녹음 시작 버튼 또는 폼)
  await page.waitForSelector('#meeting-customer, #rec-start-btn, .meeting-layout', {
    timeout: 10000,
  });
  await expectNoHorizontalScroll(page);
});

test('시나리오 7 — 영업 리드 폼 모달: 95vw 폭 + 가시성', async ({ page }) => {
  await gotoPage(page, 'leads', '#leads-open-form-btn');
  await page.click('#leads-open-form-btn');
  // 모달 표시
  const overlay = page.locator('.modal-overlay.active');
  await expect(overlay).toBeVisible({ timeout: 5000 });

  // 모달 박스가 화면 안에 들어옴
  const box = await page.locator('#modal-box').boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(VP.width + 1);

  // 폼 내 필수 입력 가시
  await expect(page.locator('input[name="customer_name"]')).toBeVisible();
  await expect(page.locator('input[name="project_name"]')).toBeVisible();
});

test('시나리오 8 — AI 어시스턴트 패널: 슬라이드업 (하단)', async ({ page }) => {
  await gotoPage(page, 'dashboard', '#page-title');
  // AI 토글 버튼
  await page.locator('#btn-ai-toggle').click();
  const aiPanel = page.locator('.ai-panel');
  await expect(aiPanel).toBeVisible({ timeout: 5000 });

  // 모바일에서는 하단 고정 + 100% 폭
  const panelBox = await aiPanel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox.width).toBeGreaterThanOrEqual(VP.width - 20); // 거의 100%
  // 패널 하단이 화면 하단에 닿아 있음
  expect(panelBox.y + panelBox.height).toBeGreaterThanOrEqual(VP.height - 5);
});

test('시나리오 9 — 모든 페이지: 가로 스크롤 없음 (회귀)', async ({ page }) => {
  const pages = [
    { id: 'dashboard', wait: '#page-title' },
    { id: 'leads', wait: '#leads-search' },
    { id: 'customers', wait: '#cust-search' },
    { id: 'projects', wait: '#proj-search' },
    { id: 'team', wait: '#page-title' },
    { id: 'pipeline', wait: '#page-title' },
    { id: 'meeting-list', wait: '#page-title' },
    { id: 'settings', wait: '#page-title' },
    { id: 'admin', wait: '#admin-tab-bar' },
  ];
  for (const p of pages) {
    await gotoPage(page, p.id, p.wait);
    await page.waitForTimeout(300); // 차트/테이블 렌더 안정화
    await expectNoHorizontalScroll(page);
  }
});
