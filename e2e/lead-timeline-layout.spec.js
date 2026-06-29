// =============================================================
// E2E — 영업리드 모달 통합 타임라인 row 레이아웃 검증
//
// 목적: 사용자가 직접 보고하는 "활동이력 줄맞춤 깨짐" 회귀 방지
//   - row 가 일관된 구조 (display:flex)
//   - 좌측 메타 영역 = 96px 고정
//   - 점/배지/제목/날짜 모두 한 줄 (wrap 없음)
//   - row 배경색 = transparent (caches 잘못된 background 차단)
//
// 시나리오:
//   1. loginAsAdmin
//   2. 영업리드 페이지 → 첫 번째 리드 클릭 (모달 열림)
//   3. .ld-tl-row 가 최소 1개 렌더링 확인
//   4. 모든 row 의 computed style 검증 (5가지)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('영업리드 모달 — 통합 타임라인 row 레이아웃 일관성', async ({ page }) => {
  // 1) 영업리드 페이지 이동
  await page.goto('/#leads', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#leads-table-body tr, .lead-row, [data-lead-id]', {
    timeout: 8000,
  });

  // 2) 첫 번째 리드 클릭 (모달 오픈)
  const firstRow = page
    .locator('[data-lead-id], #leads-table-body tr.lead-row, #leads-table-body tr')
    .first();
  await firstRow.click();

  // 3) 모달 + 타임라인 로딩 대기
  await page.waitForSelector('#ld-timeline-card', { timeout: 8000 });
  // _loadTimeline 완료 대기 (활동/회의/견적 등 fetch)
  await page.waitForFunction(
    () => {
      const cnt = document.getElementById('ld-timeline-count');
      return cnt && !cnt.textContent.includes('로딩');
    },
    { timeout: 15000 }
  );

  // 4) row 개수 확인 (최소 1개)
  const rows = page.locator('.ld-tl-row');
  const count = await rows.count();
  // row 가 없으면 (신규 리드) 검증 skip — 그래도 모달은 열림
  if (count === 0) {
    console.log('[e2e] 타임라인 row 없음 — skip (정상)');
    return;
  }

  // 5) 모든 row computed style 검증
  for (let i = 0; i < Math.min(count, 10); i++) {
    const row = rows.nth(i);
    const styles = await row.evaluate(el => {
      const cs = getComputedStyle(el);
      const meta = el.querySelector('.ld-tl-meta');
      const metaCs = meta ? getComputedStyle(meta) : null;
      const body = el.querySelector('.ld-tl-body');
      return {
        rowDisplay: cs.display,
        rowBackground: cs.backgroundColor,
        rowFlexDirection: cs.flexDirection,
        metaWidth: meta ? meta.getBoundingClientRect().width : 0,
        metaDisplay: metaCs ? metaCs.display : null,
        hasBody: !!body,
      };
    });

    // a) row 는 display:flex
    expect(styles.rowDisplay, `row[${i}] display`).toBe('flex');
    // b) row 배경 = transparent (rgba(0,0,0,0) 또는 rgb(255,255,255))
    expect(
      ['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)', 'transparent'],
      `row[${i}] background`
    ).toContain(styles.rowBackground);
    // c) 좌측 메타 영역 = 96px (±2px 허용)
    expect(styles.metaWidth, `row[${i}] meta width`).toBeGreaterThanOrEqual(94);
    expect(styles.metaWidth, `row[${i}] meta width`).toBeLessThanOrEqual(98);
    // d) 메타 영역도 display:flex
    expect(styles.metaDisplay, `row[${i}] meta display`).toBe('flex');
    // e) body 영역 존재
    expect(styles.hasBody, `row[${i}] has body`).toBe(true);
  }

  console.log(`[e2e] 타임라인 row 레이아웃 검증 완료 — ${count}개 row 일관성 확인`);
});

test('영업리드 모달 — 타임라인 row 높이 일관성 (max 2줄)', async ({ page }) => {
  await page.goto('/#leads', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#leads-table-body tr, .lead-row, [data-lead-id]', {
    timeout: 8000,
  });
  const firstRow = page
    .locator('[data-lead-id], #leads-table-body tr.lead-row, #leads-table-body tr')
    .first();
  await firstRow.click();
  await page.waitForSelector('#ld-timeline-card', { timeout: 8000 });
  await page.waitForFunction(
    () => {
      const cnt = document.getElementById('ld-timeline-count');
      return cnt && !cnt.textContent.includes('로딩');
    },
    { timeout: 15000 }
  );

  const rows = page.locator('.ld-tl-row');
  const count = await rows.count();
  if (count === 0) return;

  // 단일 DOM 패스로 높이 수집 — count()↔per-row 접근 사이 타임라인 재렌더 레이스 방지 (flaky fix)
  const heights = await rows.evaluateAll(els =>
    els.slice(0, 10).map(el => el.getBoundingClientRect().height)
  );
  // 모든 row 가 90px 이내 (2줄 + padding 한계)
  heights.forEach((h, idx) => {
    expect(h, `row[${idx}] height ${h}px (90px 이내여야 함)`).toBeLessThanOrEqual(90);
  });
  console.log(`[e2e] row heights:`, heights.map(h => Math.round(h)));
});

// 영업리드 모달 — 연결된 고객지원 카드 제거(전체 이력 통합 타임라인에 포함) 회귀
test('영업리드 모달 — 연결된 고객지원 카드 제거 + 타임라인에 고객지원 칩 포함', async ({ page }) => {
  // 딥링크로 결정적 진입(리스트 클릭 타이밍 flake 회피)
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: 'admin1234!' },
  });
  const token = (await login.json()).token;
  const lr = await page.request.get('/api/leads', { headers: { Authorization: 'Bearer ' + token } });
  const arr = (await lr.json()).data?.items || (await lr.json()).data || [];
  expect(arr.length).toBeGreaterThan(0);
  await page.goto('/#leads/' + arr[0].id);
  await page.reload();

  // 타임라인 카드(전체 이력)는 존재
  await page.waitForSelector('#ld-timeline-card', { timeout: 8000 });
  // 별도 연결된 고객지원 카드는 제거됨
  await expect(page.locator('#ld-support-card')).toHaveCount(0);
  await expect(page.locator('#ld-linked-support')).toHaveCount(0);
  // 고객지원은 통합 타임라인의 '고객지원' 필터 칩으로 제공
  await expect(page.locator('#ld-timeline-card')).toContainText('고객지원');
});
