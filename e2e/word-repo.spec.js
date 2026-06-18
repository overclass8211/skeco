// =============================================================
// E2E — 워드 사전(Word Repository)
//
// 검증 시나리오:
//   1. 어드민이 관리자 페이지 진입 → "🗂 워드 사전" 탭 표시
//   2. 라벨 편집 → 저장 → 즉시 영업리드 페이지 헤더에 반영
//   3. 도메인별 초기화 → 기본값 복원
//   4. 변경 이력 모달 표시
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  // 온보딩 환영 모달이 클릭을 가리지 않도록 미리 done 플래그 설정
  await page.evaluate(() => localStorage.setItem('oci_onboarding_done', '1'));
});

// admin 페이지 직접 진입 헬퍼 — hashchange race 회피
async function gotoAdminPage(page) {
  await page.evaluate(() => {
    location.hash = '#admin';
  });
  await page.waitForSelector('#admin-tab-bar', { timeout: 10000 });
}

// API 직접 호출 — 깨끗한 상태 보장
async function resetLeads(page) {
  const token = (await page.evaluate(() => localStorage.getItem('oci_token'))) || '';
  await page.request.post('/api/admin/labels/reset', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { scope: 'leads' },
  });
}

test('시나리오 1 — 어드민 페이지에 워드 사전 탭 표시', async ({ page }) => {
  await gotoAdminPage(page);
  await expect(page.locator('.tab-btn[data-tab="word-repo"]')).toBeVisible({ timeout: 10000 });
});

test('시나리오 2 — 라벨 편집 → 저장 → 영업리드 헤더 즉시 반영', async ({ page }) => {
  await resetLeads(page);

  await gotoAdminPage(page);
  await page.click('.tab-btn[data-tab="word-repo"]');
  // 패널 로드 대기
  await page.waitForSelector('.wr-input', { timeout: 8000 });

  // 'leads.customer_name' 행 인풋 찾기
  const input = page.locator('tr[data-scope="leads"][data-key="customer_name"] .wr-input');
  await expect(input).toBeVisible();
  await input.fill('거래처');

  // 저장 버튼 표시 + 클릭
  await expect(page.locator('#wr-save')).toBeVisible();
  await page.click('#wr-save');

  // 저장 후 영업리드 페이지로 이동 — 헤더가 '거래처' 로 치환되어야 함
  await page.goto('/#leads');
  // 컬럼 헤더 [data-label="leads.customer_name"]
  const th = page.locator('th[data-label="leads.customer_name"]');
  await expect(th).toBeVisible({ timeout: 10000 });
  await expect(th).toHaveText('거래처', { timeout: 8000 });

  // cleanup
  await resetLeads(page);
});

test('시나리오 3 — 도메인별 초기화 → 기본값 복원', async ({ page }) => {
  // 사전 조건: 라벨 1개 변경
  const token = (await page.evaluate(() => localStorage.getItem('oci_token'))) || '';
  await page.request.put('/api/admin/labels/leads/customer_name', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { label: 'TestClient' },
  });

  await gotoAdminPage(page);
  await page.click('.tab-btn[data-tab="word-repo"]');
  await page.waitForSelector('.wr-input', { timeout: 8000 });

  // 변경된 값 표시 확인
  await expect(
    page.locator('tr[data-scope="leads"][data-key="customer_name"] .wr-input')
  ).toHaveValue('TestClient');

  // 초기화 버튼 클릭 + Modal 확인
  await page.click('#wr-reset-scope-btn');
  // Modal.confirm — '#modal-cfm-ok'
  await page.click('#modal-cfm-ok');

  // 토스트 또는 reload 후 input 이 기본값(고객사) 으로
  await page.waitForTimeout(800);
  await expect(
    page.locator('tr[data-scope="leads"][data-key="customer_name"] .wr-input')
  ).toHaveValue('고객사', { timeout: 5000 });
});

test('시나리오 4 — 변경 이력 모달 표시', async ({ page }) => {
  // 사전 조건: 변경 1건 만들기
  const token = (await page.evaluate(() => localStorage.getItem('oci_token'))) || '';
  await page.request.put('/api/admin/labels/leads/project_name', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { label: 'E2E_AUDIT' },
  });

  await gotoAdminPage(page);
  await page.click('.tab-btn[data-tab="word-repo"]');
  await page.waitForSelector('#wr-audit-btn', { timeout: 8000 });
  await page.click('#wr-audit-btn');

  // 모달 표시 + 'E2E_AUDIT' 라벨 행 존재
  await expect(page.locator('.modal-overlay.active')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.modal-overlay.active')).toContainText('E2E_AUDIT', { timeout: 5000 });

  await resetLeads(page);
});

test('시나리오 5 — 다국어: 언어 탭 표시 + 영문으로 전환', async ({ page }) => {
  await resetLeads(page);
  await gotoAdminPage(page);
  await page.click('.tab-btn[data-tab="word-repo"]');
  await page.waitForSelector('.wr-locale-btn', { timeout: 8000 });

  // 4개 언어 버튼 표시
  await expect(page.locator('.wr-locale-btn')).toHaveCount(4);
  await expect(page.locator('.wr-locale-btn[data-locale="ko"]')).toHaveClass(/active/);

  // 영문 탭 클릭
  await page.locator('.wr-locale-btn[data-locale="en"]').click();
  await page.waitForSelector('.wr-locale-btn[data-locale="en"].active', { timeout: 5000 });

  // customer_name 행의 default = 'Customer'
  const defaultCell = page.locator(
    'tr[data-scope="leads"][data-key="customer_name"] td:nth-child(2)'
  );
  await expect(defaultCell).toHaveText('Customer', { timeout: 5000 });
});

test('시나리오 6 — 프로젝트 페이지 마커 반영', async ({ page }) => {
  // 프로젝트 컬럼 라벨 변경
  const token = (await page.evaluate(() => localStorage.getItem('oci_token'))) || '';
  await page.request.put('/api/admin/labels/projects/name', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { label: '영업기회', locale: 'ko' },
  });

  // API 직접 변경 후 브라우저 캐시 + 인메모리 _dict 무효화
  await page.evaluate(() => {
    Object.keys(sessionStorage).forEach(
      k => k.startsWith('oci_labels_cache') && sessionStorage.removeItem(k)
    );
    if (window.Labels) window.Labels.invalidate();
  });

  await page.goto('/#projects');
  const th = page.locator('th[data-label="projects.name"]');
  await expect(th).toBeVisible({ timeout: 10000 });
  await expect(th).toHaveText('영업기회', { timeout: 8000 });

  // cleanup
  await page.request.post('/api/admin/labels/reset', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { scope: 'projects' },
  });
});

test('시나리오 8 — 다국어 전환 시 화면 내 라벨 종합 적용', async ({ page }) => {
  // 시스템 locale 을 일본어로 변경 → 사용자 override 없는 상태로 전체 화면 검증
  const token = (await page.evaluate(() => localStorage.getItem('oci_token'))) || '';
  await page.request.put('/api/admin/labels/system-locale', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { locale: 'ja' },
  });
  await page.evaluate(() => {
    Object.keys(sessionStorage).forEach(
      k => k.startsWith('oci_labels_cache') && sessionStorage.removeItem(k)
    );
    localStorage.removeItem('oci_user_locale');
  });

  // 대시보드 — 페이지 타이틀 + 카드 제목 + 사이드바 섹션
  await page.reload();
  await page.waitForLoadState('networkidle');
  // 대시보드 타이틀 (topbar)
  await expect(page.locator('#page-title')).toHaveText('ダッシュボード', { timeout: 8000 });
  // 사이드바 섹션
  await expect(page.locator('.nav-section[data-section-key="main"] .nav-section-title')).toHaveText(
    'メイン'
  );
  await expect(
    page.locator('.nav-section[data-section-key="sales"] .nav-section-title')
  ).toHaveText('営業管理');
  // 대시보드 카드 제목
  await expect(page.locator('[data-label="dashboard.recent_activities"]').first()).toHaveText(
    '最近の営業活動'
  );
  await expect(page.locator('[data-label="dashboard.ai_insights"]').first()).toHaveText(
    '🤖 AIインサイト'
  );
  // 알림 패널 헤더
  await expect(page.locator('[data-label="topbar.notifications"]').first()).toHaveText('通知');

  // 영업 리드 페이지로 이동 → 필터 + 버튼 + 컬럼 헤더
  await page.evaluate(() => {
    location.hash = '#leads';
  });
  await page.waitForSelector('th[data-label="leads.customer_name"]', { timeout: 8000 });
  await expect(page.locator('th[data-label="leads.customer_name"]')).toHaveText('顧客');
  await expect(page.locator('#leads-open-form-btn')).toHaveText('+ リード追加');
  // stages option text
  const stageOpt = page.locator('#leads-stage option[value="bidding"]');
  await expect(stageOpt).toHaveText('入札');

  // 복원
  await page.request.put('/api/admin/labels/system-locale', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { locale: 'ko' },
  });
});

test('시나리오 7 — 사이드바 메뉴 라벨 반영', async ({ page }) => {
  const token = (await page.evaluate(() => localStorage.getItem('oci_token'))) || '';
  // 시스템 locale 을 ja 로 변경 → 사이드바 라벨이 일본어로
  await page.request.put('/api/admin/labels/system-locale', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { locale: 'ja' },
  });

  // 사용자 override 없는 상태 시뮬레이션 — 캐시 무효화 후 reload
  await page.evaluate(() => {
    Object.keys(sessionStorage).forEach(
      k => k.startsWith('oci_labels_cache') && sessionStorage.removeItem(k)
    );
    localStorage.removeItem('oci_user_locale');
  });
  await page.reload();
  // 사이드바 dashboard menu = 'ダッシュボード'
  const dashSpan = page.locator(
    '.nav-item[data-page="dashboard"] span[data-label="menu.dashboard"]'
  );
  await expect(dashSpan).toHaveText('ダッシュボード', { timeout: 8000 });

  // 복원
  await page.request.put('/api/admin/labels/system-locale', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { locale: 'ko' },
  });
});
