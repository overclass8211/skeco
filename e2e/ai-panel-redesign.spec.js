// =============================================================
// E2E — AI 어시스턴트 패널 리디자인 회귀 방지
//
// 검증 항목 (풀 개선 1~4):
//  1) 라이트 테마: 패널/콘텐츠 배경이 밝은 색 (다크+네온 제거)
//  2) 폭: 드로어 기본 폭이 충분히 넓음 (>= 380px)
//  3) 넓게 보기(확장): 토글 시 중앙 워크스페이스 + 오버레이 딤
//  4) 리사이즈 핸들 존재
// =============================================================
'use strict';

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.describe('AI 어시스턴트 패널 리디자인', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/#dashboard');
    await page.waitForFunction(() => typeof AI !== 'undefined' && typeof App !== 'undefined');
  });

  test('라이트 테마 + 충분한 폭으로 열린다', async ({ page }) => {
    await page.evaluate(() => AI.open());
    const panel = page.locator('#ai-panel');
    await expect(panel).toHaveClass(/open/);

    // 라이트 테마: 배경이 어둡지 않아야 함 (다크 #0d0d1a 회귀 방지)
    const bg = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
    const rgb = bg.match(/\d+/g).map(Number);
    expect(rgb[0] + rgb[1] + rgb[2]).toBeGreaterThan(600); // 밝은 배경 (합 ~765 = 흰색)

    // 폭: 드로어가 충분히 넓다
    const width = await panel.evaluate(el => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(380);

    // 리사이즈 핸들 + 확장 버튼 존재
    await expect(page.locator('#ai-resize-handle')).toHaveCount(1);
    await expect(page.locator('#ai-btn-expand')).toHaveCount(1);
  });

  test('넓게 보기 토글 — 중앙 워크스페이스 + 딤', async ({ page }) => {
    await page.evaluate(() => AI.open());
    await page.locator('#ai-btn-expand').click();

    const panel = page.locator('#ai-panel');
    await expect(panel).toHaveClass(/ai-expanded/);
    await expect(page.locator('#ai-overlay')).toHaveClass(/ai-expanded-dim/);

    // 중앙 정렬: 좌우 여백이 비슷해야 함
    const box = await panel.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: window.innerWidth - r.right };
    });
    expect(Math.abs(box.left - box.right)).toBeLessThan(20);

    // 다시 토글하면 드로어로 복귀
    await page.locator('#ai-btn-expand').click();
    await expect(panel).not.toHaveClass(/ai-expanded/);
    await expect(page.locator('#ai-overlay')).not.toHaveClass(/ai-expanded-dim/);
  });
});
