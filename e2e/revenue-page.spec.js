// =============================================================
// E2E — 매출관리 페이지 [P2-B]
//
// 검증: 신규 매출관리 메뉴 진입 → KPI(예정/확정/확정률) + 청구차수 목록
//        + 매출 추이 탭(차트) 렌더
//   - /api/revenue/summary, /api/revenue/schedules 는 mock (결정적)
//   - 로그인은 실서버, 프론트 정적파일은 디스크에서 신규 서빙
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SUMMARY = {
  kpi: {
    예정: { cnt: 3, amount: 33000000, supply: 30000000, tax: 3000000 },
    확정: { cnt: 2, amount: 22000000, supply: 20000000, tax: 2000000 },
    취소: { cnt: 1, amount: 1100000, supply: 1000000, tax: 100000 },
  },
  monthly: {
    planned: [{ ym: '2026-07', amount: 11000000 }, { ym: '2026-08', amount: 22000000 }],
    confirmed: [{ ym: '2026-07', amount: 22000000 }],
  },
};
const SCHEDULES = [
  {
    id: 1, customer_name: 'E2E매출고객', contract_name: 'E2E계약', stage_name: '일시불',
    supply_amount: 30000000, tax_amount: 3000000, scheduled_amount: 33000000, currency: 'KRW',
    due_date: '2026-07-01', revenue_status: '예정', issued_cnt: 0,
  },
  {
    id: 2, customer_name: 'E2E매출고객', contract_name: 'E2E계약2', stage_name: '일시불',
    supply_amount: 20000000, tax_amount: 2000000, scheduled_amount: 22000000, currency: 'KRW',
    due_date: '2026-07-15', revenue_status: '확정', issued_cnt: 1,
  },
];

const DETAIL = {
  schedule: { ...SCHEDULES[0], status: 'scheduled', contract_id: 70 },
  customer: {
    id: 1, name: 'E2E매출고객', business_no: '123-45-67890', address: '서울시 강남구',
    contact_person: '홍길동', phone: '02-1234-5678', email: 'cust@corp.com',
    tax_recipient_name: '', tax_recipient_dept: '', tax_recipient_email: '',
  },
  supplier: { company_name: '우리회사', business_no: '999-88-77777', address: '경기도 성남시', ceo: '대표자' },
};

const FLOW = {
  contract: { id: 70, contract_no: 'C-2026-0070', title: 'E2E흐름계약', status: 'completed', contract_amount: 10000000, currency: 'KRW', customer_name: 'E2E매출고객' },
  project: { id: 700, project_code: 'PRJ-2026-0700', name: 'E2E흐름계약', status: '진행중' },
  schedules: [
    { id: 1, stage_name: '착수금', scheduled_amount: 6000000, paid_amount: 2000000, due_date: '2026-08-01', collect_status: 'partial', revenue_status: '확정', issued_cnt: 1, currency: 'KRW' },
    { id: 2, stage_name: '잔금', scheduled_amount: 4000000, paid_amount: 0, due_date: '2026-09-01', collect_status: 'scheduled', revenue_status: '예정', issued_cnt: 0, currency: 'KRW' },
  ],
  totals: { scheduled: 10000000, collected: 2000000, outstanding: 8000000, revenue_confirmed: 6000000 },
};

test.beforeEach(async ({ page }) => {
  // 온보딩 환영 모달 억제 (표준 패턴) — 모달이 #modal-box 를 점유해 검증을 가로채는 것 방지
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* 무시 */
    }
  });
  await loginAsAdmin(page);
  await page.route('**/api/revenue/**', async (route, req) => {
    const url = req.url();
    if (/\/api\/revenue\/summary/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: SUMMARY }),
      });
    }
    // 상세 하위 경로는 목록보다 먼저 매칭
    if (/\/api\/revenue\/schedules\/\d+\/tax-recipient/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { customer_id: 1 } }),
      });
    }
    if (/\/api\/revenue\/schedules\/\d+$/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: DETAIL }),
      });
    }
    if (/\/api\/revenue\/schedules/.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: SCHEDULES, pagination: { total: SCHEDULES.length } }),
      });
    }
    return route.fallback();
  });
  // 드릴다운 흐름 (payments 엔드포인트 — 별도 라우트)
  await page.route('**/api/payments/flow/**', async route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: FLOW }) })
  );
});

// 온보딩 모달이 떠 있으면 닫기 (신규 세션에서 재등장 가능)
async function dismissOnboarding(page) {
  const skip = page.locator('#onb-skip');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click().catch(() => {});
  }
}

test('매출관리 — KPI + 청구차수 목록 + 매출 추이 탭 렌더', async ({ page }) => {
  await page.goto('/#revenue', { waitUntil: 'domcontentloaded' });
  await dismissOnboarding(page);

  // 페이지 직접 렌더 (메뉴 클릭보다 안정적 — 라우팅 검증은 별도)
  await page.waitForFunction(() => typeof RevenuePage !== 'undefined', { timeout: 10000 });
  await page.evaluate(() => App.navigate('revenue'));

  // 관점 안내 배지 (수금현황과 구분)
  await expect(page.getByText('매출 인식 관점', { exact: false })).toBeVisible({ timeout: 8000 });

  // KPI 영역 — 매출 예정/확정 금액 표시
  const kpi = page.locator('#rev-kpi');
  await expect(kpi).toBeVisible({ timeout: 8000 });
  await expect(kpi).toContainText('매출 예정');
  await expect(kpi).toContainText('매출 확정');
  await expect(kpi).toContainText('33,000,000'); // 예정 합계
  await expect(kpi).toContainText('22,000,000'); // 확정 합계
  await expect(kpi).toContainText('확정률');

  // 청구차수 탭(기본) — 목록 렌더
  const tab = page.locator('#rev-tab-content');
  await expect(tab).toContainText('E2E매출고객', { timeout: 8000 });
  await expect(tab).toContainText('일시불');
  await expect(tab).toContainText('발행'); // 확정행 세금계산서 발행 배지
  await expect(tab).toContainText('미발행'); // 예정행

  // 매출 추이 탭 전환 → 차트 캔버스
  await page.evaluate(() => document.querySelector('.rev-tab[data-tab="trend"]').click());
  await expect(page.locator('#rev-trend-chart')).toBeVisible({ timeout: 8000 });
});

async function gotoRevenue(page) {
  await page.goto('/#revenue', { waitUntil: 'domcontentloaded' });
  await dismissOnboarding(page);
  await page.waitForFunction(() => typeof RevenuePage !== 'undefined', { timeout: 10000 });
  await page.evaluate(() => App.navigate('revenue'));
  await expect(page.locator('#rev-tab-content')).toContainText('E2E매출고객', { timeout: 8000 });
}

test('청구차수 상세 모달 — 확장 항목 + 세금계산서 수신 담당자 저장', async ({ page }) => {
  await gotoRevenue(page);
  await page.locator('.rev-row[data-id="1"]').click();
  await expect(page.locator('text=청구차수 상세')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('123-45-67890')).toBeVisible(); // 고객사 사업자번호
  await expect(page.getByText('999-88-77777')).toBeVisible(); // 공급자 사업자번호
  await page.fill('#rev-tax-name', '김세금');
  await page.fill('#rev-tax-dept', '재무팀');
  await page.fill('#rev-tax-email', 'tax@corp.com');
  await page.click('#rev-tax-save');
  await expect(page.getByText('세금계산서 수신 담당자가 저장')).toBeVisible({ timeout: 5000 });
});

test('청구차수 — 컬럼 설정으로 상세 항목 표시 토글', async ({ page }) => {
  await gotoRevenue(page);
  // 설정 모달(단독) — 고객사 사업자번호 OFF → 저장
  await page.click('#rev-col-settings');
  await expect(page.locator('text=상세 컬럼 설정')).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => {
    const cb = document.querySelector('.rev-col-opt[data-key="cust_biz"]');
    if (cb) cb.checked = false;
  });
  await page.click('#rev-col-save');
  await expect(page.locator('text=상세 컬럼 설정')).toBeHidden({ timeout: 5000 });

  // 상세 모달 — 고객사 사업자번호 미표시, 공급자 사업자번호는 표시
  await page.locator('.rev-row[data-id="1"]').click();
  await expect(page.locator('text=청구차수 상세')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('999-88-77777')).toBeVisible();
  await expect(page.getByText('123-45-67890')).toBeHidden();
});

test('청구차수 상세 → 계약 흐름 드릴다운 (계약→프로젝트→매출→수금)', async ({ page }) => {
  await gotoRevenue(page);
  await page.locator('.rev-row[data-id="1"]').click();
  await expect(page.locator('text=청구차수 상세')).toBeVisible({ timeout: 8000 });

  // [💧 계약 흐름] → 흐름 모달 (Modal 내용 교체)
  await page.click('#rev-flow-btn');
  await expect(page.locator('text=수금 흐름')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('E2E흐름계약').first()).toBeVisible(); // 계약
  await expect(page.getByText('PRJ-2026-0700')).toBeVisible(); // 프로젝트
  await expect(page.locator('#modal-box')).toContainText('착수금'); // 청구차수 행
  await expect(page.locator('#modal-box')).toContainText('8,000,000'); // 미수 합계
});
