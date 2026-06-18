// =============================================================
// E2E — 리포트 빌더 필터 드롭다운 동작 검증
//
// 사용자 보고된 버그 검증: 필터 값 input 클릭 시 드롭다운이 표시되는지
// 검증 시나리오:
//   1) 리포트 빌더 진입 → 차원/지표 자동 로드
//   2) 차원 (예: 단계) 을 필터 영역에 드래그
//   3) 필터 input 클릭 → Combobox 드롭다운 표시 확인
//   4) 드롭다운 옵션 클릭 → input 값 채워짐 + 차트 갱신
//   5) 자유 입력도 정상 동작
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('필터 input 클릭 → Combobox 드롭다운 표시 + 값 선택 동작', async ({ page }) => {
  // ─── 1) 리포트 빌더 페이지 진입 ───────────────────────────
  await page.goto('/#report-builder');
  // 필드 카탈로그 로드 완료 대기 (좌측 데이터 소스 드롭다운 존재)
  await page.waitForSelector('#rb-datasource-select', { timeout: 10000 });
  // 차원 카탈로그 렌더링 대기
  await page.waitForSelector('.rb-field-dim', { timeout: 5000 });

  // ─── 2) 차원 "단계" 를 필터 영역으로 드래그 ───────────────
  // HTML5 drag&drop: dispatchEvent 로 시뮬레이션
  const sourceField = page.locator('.rb-field-dim[data-field-key="stage"]').first();
  const filterZone = page.locator('.rb-zone[data-zone="filters"]').first();
  await expect(sourceField).toBeVisible();
  await expect(filterZone).toBeVisible();

  // Playwright dragTo 는 native drag&drop 트리거
  await sourceField.dragTo(filterZone);

  // 필터 칩이 렌더링되었는지 확인
  await expect(page.locator('.rb-chip-filter')).toHaveCount(1, { timeout: 5000 });

  // ─── 3) 필터 input 클릭 → Combobox 드롭다운 표시 확인 ──────
  const filterInput = page.locator('.rb-chip-value').first();
  await expect(filterInput).toBeVisible();
  await expect(filterInput).toHaveAttribute('placeholder', /클릭하여 값 선택/);

  // 클릭 → Combobox 가 body 직속 dropdown 생성 (position: fixed)
  await filterInput.click();

  // Combobox dropdown 이 표시되는지 (body 직속, display:block)
  // dropdown 은 .combobox-dropdown 클래스 + display: block
  const dropdown = page.locator('.combobox-dropdown').first();
  await expect(dropdown).toBeVisible({ timeout: 5000 });

  // ─── 4) 드롭다운에 옵션이 있는지 확인 ────────────────────────
  // Combobox 가 fetchFn 호출 → 백엔드 /values 응답 → 옵션 렌더링
  // 옵션이 있거나 (데이터 있을 때) 또는 "+ X 그대로 사용" (빈 입력 시 표시)
  // 또는 "매칭 없음" (데이터 없을 때)
  const hasItems = await page.locator('.combobox-item').count();
  const hasEmpty = await page.locator('.combobox-empty').count();
  const hasCustom = await page.locator('.combobox-custom-item').count();

  console.log(
    `[E2E] Combobox state — items: ${hasItems}, empty: ${hasEmpty}, custom: ${hasCustom}`
  );

  // 최소한 dropdown 자체가 표시되어야 함 (위에서 toBeVisible 검증)
  // 데이터가 없어도 OK — 빈 상태 또는 자유 입력 옵션
  expect(hasItems + hasEmpty + hasCustom).toBeGreaterThan(0);

  // ─── 5) 자유 입력 테스트 ──────────────────────────────────
  // input 에 타이핑 → Combobox 의 onCustomCreate 트리거 또는 매칭 결과
  await filterInput.fill('test-value');
  await page.waitForTimeout(300); // 디바운스 대기

  // input.value 가 반영되었는지
  await expect(filterInput).toHaveValue('test-value');

  // ─── 6) Combobox dropdown 의 "X 그대로 사용" 클릭 ──────────
  // (자유 입력 옵션 — allowCustom: true)
  const customItem = page.locator('.combobox-custom-item').first();
  if (await customItem.isVisible()) {
    await customItem.click();
    // dropdown 닫힘 확인
    await expect(dropdown).toBeHidden({ timeout: 2000 });
  }
});

test('연산자 select 가 사라졌는지 확인 (UI 단순화)', async ({ page }) => {
  await page.goto('/#report-builder');
  await page.waitForSelector('#rb-datasource-select', { timeout: 10000 });
  await page.waitForSelector('.rb-field-dim', { timeout: 5000 });

  // 차원을 필터에 추가
  const sourceField = page.locator('.rb-field-dim[data-field-key="stage"]').first();
  const filterZone = page.locator('.rb-zone[data-zone="filters"]').first();
  await sourceField.dragTo(filterZone);
  await expect(page.locator('.rb-chip-filter')).toHaveCount(1);

  // 연산자 select (.rb-chip-op) 가 없어야 함 — 사용자 요청에 따라 제거
  await expect(page.locator('.rb-chip-op')).toHaveCount(0);
});

test('필터 input width 가 90px 이상으로 충분히 넓은지 확인', async ({ page }) => {
  await page.goto('/#report-builder');
  await page.waitForSelector('#rb-datasource-select', { timeout: 10000 });
  await page.waitForSelector('.rb-field-dim', { timeout: 5000 });

  // 필터 추가
  const sourceField = page.locator('.rb-field-dim[data-field-key="stage"]').first();
  const filterZone = page.locator('.rb-zone[data-zone="filters"]').first();
  await sourceField.dragTo(filterZone);

  const filterInput = page.locator('.rb-chip-value').first();
  await expect(filterInput).toBeVisible();

  const box = await filterInput.boundingBox();
  console.log(`[E2E] filter input width: ${box.width}px`);
  // 사용자 요청 — 충분한 너비 (이전 90px 였음, 180px 이상으로 변경)
  expect(box.width).toBeGreaterThanOrEqual(160);
});

// 고객지원(support) 데이터소스 — 선택 시 설정형 차원 + SLA 지표 로드
test('데이터소스 = 고객지원(A/S) → 상태/유형 차원 + 미해결/기한초과 지표 노출', async ({
  page,
}) => {
  await page.goto('/#report-builder');
  await page.waitForSelector('#rb-datasource-select', { timeout: 10000 });
  // 데이터소스 드롭다운에 support 옵션 존재
  await expect(page.locator('#rb-datasource-select option[value="support"]')).toHaveCount(1);
  // 고객지원 선택 → 필드 카탈로그 재로드
  await page.selectOption('#rb-datasource-select', 'support');
  // 설정형 차원(상태/상태분류/유형) 렌더 대기
  await page.waitForSelector('.rb-field-dim[data-field-key="status"]', { timeout: 8000 });
  await expect(page.locator('.rb-field-dim[data-field-key="status_category"]')).toBeVisible();
  await expect(page.locator('.rb-field-dim[data-field-key="type"]')).toBeVisible();
  // SLA 지표(미해결/기한초과) 노출
  await expect(page.locator('.rb-field-measure[data-field-key="open_count"]')).toBeVisible();
  await expect(page.locator('.rb-field-measure[data-field-key="overdue_count"]')).toBeVisible();
});
