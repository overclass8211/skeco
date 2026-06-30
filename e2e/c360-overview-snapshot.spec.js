// =============================================================
// E2E — 고객·제품 360 > 현황 > 수급·매출 스냅샷
//
// 검증: 공정 라이프사이클 아래 포캐스트 미니 요약(다음 3개월) 노출 +
//       '상세 ›' 클릭 시 영업·매출 탭으로 이동 (탭은 유지)
//   - 포캐스트 시드가 있는 고객(id=1) 사용, 백그라운드 로드 대기
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('360 현황 — 수급·매출 스냅샷 노출 + 상세→영업·매출 탭', async ({ page }) => {
  await page.goto('/#customer360/1');
  await page.reload();
  await expect(page.locator('.lc-card').first()).toBeVisible({ timeout: 15000 });

  // 영업·매출 탭은 유지(삭제 아님)
  await expect(page.locator('.c360-tab[data-tab="commercial"]')).toHaveCount(1);

  // ── KPI 재설계: 공정·매출·품질 균형 4종 + 월/분기/연간 박스 제거 ──
  const kpiText = await page.locator('.c360-kpis').innerText();
  expect(kpiText).toContain('가중 예상수주매출');
  expect(kpiText).toContain('공급 충족');
  expect(kpiText).toContain('품질 미해결');
  // 분기 공급 리스크 블록은 제거됨(공급 충족은 KPI로 이관)
  await expect(page.locator('.c360-sec', { hasText: '분기 공급 리스크' })).toHaveCount(0);
  // KPI 아이콘 칩 노출(시인성 강화)
  expect(await page.locator('.c360-kpi .c360-kpi-ic').count()).toBe(4);
  // 포캐스트 기반 월/분기/연간 예상매출 박스는 삭제됨
  await expect(page.locator('.flow-box', { hasText: '예상매출 · 월' })).toHaveCount(0);
  await expect(page.locator('.flow-box', { hasText: '연간' })).toHaveCount(0);

  // 스냅샷 컨테이너 — 백그라운드 포캐스트 로드 완료 대기
  const snap = page.locator('#c360-fc-snap');
  await expect(snap).toBeVisible({ timeout: 10000 });
  await expect(snap.locator('thead')).toContainText('수급 Gap', { timeout: 10000 });
  await expect(snap.locator('thead')).toContainText('예상매출');
  // 합계(tfoot) 행 존재
  await expect(snap.locator('tfoot')).toContainText('합계');

  // 상세 › → 영업·매출(commercial) 탭 활성, 탭은 그대로 존재
  await page.locator('#c360-fc-snap-more').click();
  await expect(page.locator('.c360-tab.active')).toHaveAttribute('data-tab', 'commercial');
});
