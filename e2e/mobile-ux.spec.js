// =============================================================
// E2E — 모바일 UX 미세 점검 (iOS Safari 특화 + 터치 타겟)
//
// 검증 시나리오:
//   1. input/select/textarea — font-size >= 16px (iOS 자동 줌 방지)
//   2. 주요 버튼 터치 타겟 — 최소 폭 32px 이상 (느슨한 기준)
//   3. landscape 모드 (667×375) 에서도 가로 스크롤 없음
//   4. 모달 닫기 (×) 버튼 터치 가능
//   5. 사이드바 nav-item 충분한 높이
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const VP = { width: 375, height: 667 };

test.use({ viewport: VP });

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.evaluate(() => localStorage.setItem('oci_onboarding_done', '1'));
});

async function gotoPage(page, pageId, waitSelector) {
  await page.evaluate(id => {
    location.hash = '#' + id;
  }, pageId);
  if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 10000 });
}

test('UX-1 — 영업리드 폼: input font-size >= 16px (iOS 자동 줌 방지)', async ({ page }) => {
  await gotoPage(page, 'leads', '#leads-open-form-btn');
  await page.click('#leads-open-form-btn');
  // 모달 오버레이 먼저 + 그 다음 입력 (refreshCommon API 호출 후 렌더되는 race 대응)
  await page.waitForSelector('.modal-overlay.active', { timeout: 15000 });
  await page.waitForSelector('#modal-box input[name="customer_name"]', { timeout: 15000 });

  const sizes = await page.$$eval('#modal-box input, #modal-box select, #modal-box textarea', els =>
    els.map(el => ({
      tag: el.tagName,
      name: el.name || '',
      type: el.type || '',
      fontSize: parseFloat(window.getComputedStyle(el).fontSize),
    }))
  );
  // hidden/checkbox 등은 제외
  const visible = sizes.filter(s => !['hidden', 'checkbox', 'radio'].includes(s.type));
  expect(visible.length).toBeGreaterThan(0);
  for (const s of visible) {
    expect(
      s.fontSize,
      `${s.tag}[name="${s.name}"] font-size ${s.fontSize}px (<16px → iOS 자동 줌)`
    ).toBeGreaterThanOrEqual(16);
  }
});

test('UX-2 — 필터바 input font-size >= 16px', async ({ page }) => {
  await gotoPage(page, 'leads', '#leads-search');
  const fs = await page
    .locator('#leads-search')
    .evaluate(el => parseFloat(window.getComputedStyle(el).fontSize));
  expect(fs, `검색 input font-size ${fs}px (<16px → iOS 자동 줌)`).toBeGreaterThanOrEqual(16);
});

test('UX-3 — 햄버거 버튼 터치 타겟 (최소 32px)', async ({ page }) => {
  await gotoPage(page, 'dashboard', '#mobile-menu-btn');
  const box = await page.locator('#mobile-menu-btn').boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(32);
  expect(box.height).toBeGreaterThanOrEqual(32);
});

test('UX-4 — 사이드바 메뉴 아이템 충분한 높이', async ({ page }) => {
  await gotoPage(page, 'dashboard', '#mobile-menu-btn');
  await page.click('#mobile-menu-btn');
  await page.waitForSelector('.sidebar.mobile-open');
  // dashboard nav-item 높이 확인
  const box = await page.locator('.nav-item[data-page="dashboard"]').first().boundingBox();
  expect(box).not.toBeNull();
  expect(box.height, '사이드바 메뉴 항목 높이 36px+').toBeGreaterThanOrEqual(36);
});

test('UX-5 — Landscape (667×375) 가로 스크롤 없음', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await gotoPage(page, 'dashboard', '#page-title');
  const result = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(result.sw).toBeLessThanOrEqual(result.cw + 2);
});

test('UX-7 — 페이지 타이틀: 좁은 화면에서도 한 줄 (세로 깨짐 방지)', async ({ page }) => {
  await page.evaluate(id => {
    location.hash = '#' + id;
  }, 'dashboard');
  await page.waitForSelector('#page-title');
  // 한국어 글자가 세로로 쌓이지 않는지 — height 가 폰트 행간 이상이면 깨진 것
  const m = await page.locator('#page-title').evaluate(el => {
    const s = window.getComputedStyle(el);
    return {
      whiteSpace: s.whiteSpace,
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2,
    };
  });
  expect(m.whiteSpace).toBe('nowrap');
  // 한 줄 = 대략 line-height 이내 (1.5배 여유)
  expect(
    m.height,
    `page-title 높이 ${m.height}px (한 줄 ${m.lineHeight}px 초과 → 세로 깨짐)`
  ).toBeLessThan(m.lineHeight * 1.5);
});

test('UX-8 — iPhone 14 Pro Max (430×932) 페이지 타이틀 정상', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.evaluate(id => {
    location.hash = '#' + id;
  }, 'dashboard');
  await page.waitForSelector('#page-title');
  // 사용자 보고 사례 — 대시보드 타이틀이 세로로 깨지면 안 됨
  const h = await page.locator('#page-title').evaluate(el => el.getBoundingClientRect().height);
  expect(h, `iPhone 14 Pro Max 에서 page-title 높이 ${h}px`).toBeLessThan(32);
});

test('UX-6 — 모달 × 버튼 터치 가능', async ({ page }) => {
  await gotoPage(page, 'leads', '#leads-open-form-btn');
  await page.click('#leads-open-form-btn');
  await page.waitForSelector('#__modal-x-btn');
  const box = await page.locator('#__modal-x-btn').boundingBox();
  expect(box).not.toBeNull();
  // × 버튼 클릭 영역 — 최소 28x28
  expect(box.width).toBeGreaterThanOrEqual(28);
  expect(box.height).toBeGreaterThanOrEqual(28);

  // 실제 클릭 → 모달 닫힘
  await page.locator('#__modal-x-btn').click();
  await page.waitForTimeout(300);
  // 모달이 변경사항 없이 닫힘 (form 입력 안 했음)
  await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
});
