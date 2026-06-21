// =============================================================
// E2E — 전사 품질관리 (Quality Inbox)
//   메뉴 진입 → KPI + 목록 + 상세 모달 (API mock 결정적)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SUMMARY = {
  success: true,
  data: {
    open_total: 11, high_open: 11, in_progress: 0, new_this_month: 11,
    overdue: 4, doc_expired: 2, doc_expiring: 3, avg_resolve_days: null,
    sla_policy: { high: 7, medium: 14, low: 30 }, doc_soon_days: 30,
  },
};
const CASES = {
  success: true,
  detail_restricted: false,
  data: [
    {
      id: 1, case_no: 'Q-TEST-1', customer_id: 1, customer_name: 'E2E품질고객',
      customer_material_id: null, material_name: null, type: 'NCR', severity: 'high',
      status: 'in_progress', priority: 'urgent', channel: 'audit',
      title: '순도 편차 NCR', opened_at: '2026-06-01', resolved_at: null,
      owner_id: null, owner_name: null, created_by: 7, created_by_name: '김접수',
      resolution: '1차 회신 완료', notes: null, due_date_set: null,
      age_days: 11, due_date: '2026-06-08', days_left: -13, overdue: 1,
    },
  ],
};
const DOCS = {
  success: true,
  soon_days: 30,
  data: [
    {
      id: 10, customer_id: 1, customer_name: 'E2E품질고객', customer_material_id: null,
      material_name: '식각가스 C4F6', doc_type: 'MSDS', doc_no: 'MSDS-E2E-1',
      issued_at: '2024-05-01', valid_until: '2026-05-01', file_url: null, note: null, days_left: -51,
    },
    {
      id: 11, customer_id: 1, customer_name: 'E2E품질고객', customer_material_id: null,
      material_name: '고선택비 인산', doc_type: 'CoA', doc_no: 'CoA-E2E-1',
      issued_at: '2025-07-01', valid_until: '2026-07-05', file_url: null, note: null, days_left: 14,
    },
  ],
};
const CUSTOMERS = { success: true, data: [{ id: 1, name: 'E2E품질고객' }] };

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  // AI 사용량 위젯 등 init AI 호출 → 환경(토큰 한도) 토스트 방지 (결정적)
  await page.route('**/api/ai/**', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { total: 0, prompt: 0, completion: 0, calls: 0 } }),
    })
  );
  await page.route('**/api/customer360/customers', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CUSTOMERS) })
  );
  await page.route('**/api/quality/summary', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY) })
  );
  await page.route('**/api/quality/documents**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DOCS) })
  );
  await page.route('**/api/quality/cases**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CASES) })
  );
  // 상세 모달의 첨부·이력 (cases** 보다 뒤에 등록 → 우선 매칭)
  await page.route('**/api/quality/cases/*/files', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
  );
  await page.route('**/api/quality/cases/*/history', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ id: 1, field: 'created', from_value: null, to_value: 'Q-TEST-1', note: '접수', changed_by_name: '김접수', changed_at: '2026-06-01 09:00' }],
      }),
    })
  );
});

test('전사 품질관리 — KPI + 목록 + 상세 모달', async ({ page }) => {
  await page.goto('/#quality');
  await page.waitForSelector('#ql-list .data-table', { timeout: 15000 });

  // KPI
  await expect(page.locator('.ql-kpis')).toContainText('미해결');
  await expect(page.locator('.ql-kpis')).toContainText('High 심각도');

  // 목록
  await expect(page.locator('#ql-list')).toContainText('E2E품질고객');
  await expect(page.locator('#ql-list')).toContainText('순도 편차 NCR');

  // SLA 컬럼 + 초과 배지
  await expect(page.locator('#ql-list thead')).toContainText('SLA');
  await expect(page.locator('#ql-list tbody tr').first()).toContainText('초과');

  // 행 클릭 → 상세 모달 (워크플로우 필드 + 이관 + 처리내용 + 이력)
  await page.locator('#ql-list tbody tr').first().click();
  await expect(page.locator('#modal-overlay')).toContainText('품질 케이스');
  await expect(page.locator('#qd-status')).toBeVisible();
  // 상태 옵션 = A/S 동일 워크플로우 (접수→…→드롭)
  await expect(page.locator('#qd-status')).toContainText('접수');
  await expect(page.locator('#qd-status')).toContainText('조치완료');
  // 처리우선순위·접수처리내용·이관 버튼
  await expect(page.locator('#qd-prio')).toBeVisible();
  await expect(page.locator('#qd-resolution')).toHaveValue('1차 회신 완료');
  await expect(page.locator('#qd-transfer')).toBeVisible();
  // 접수자 표시
  await expect(page.locator('#modal-overlay')).toContainText('김접수');
  // 처리 이력 타임라인 로드
  await expect(page.locator('#qd-history')).toContainText('접수', { timeout: 5000 });
  // 이관 모달 진입
  await page.locator('#qd-transfer').click();
  await expect(page.locator('#modal-overlay')).toContainText('이관 (담당 변경)');
  await expect(page.locator('#qt-owner')).toBeVisible();
});

test('전사 품질관리 — 문서 만료 뷰 전환 + 만료 상태 표시', async ({ page }) => {
  await page.goto('/#quality');
  await page.waitForSelector('#ql-list .data-table', { timeout: 15000 });

  // 문서 만료 뷰로 전환
  await page.locator('#ql-seg button[data-view="docs"]').click();
  await page.waitForSelector('#ql-list thead:has-text("유효기한")', { timeout: 5000 });

  // 케이스 전용 버튼은 숨겨짐
  await expect(page.locator('#ql-new')).toBeHidden();

  // 문서 행 + 만료/임박 상태
  await expect(page.locator('#ql-list')).toContainText('MSDS-E2E-1');
  await expect(page.locator('#ql-list')).toContainText('2026-05-01');
  await expect(page.locator('#ql-list tbody')).toContainText('만료');
  await expect(page.locator('#ql-list .ql-d-expired')).toHaveCount(1);

  // 문서 필터(상태) 노출
  await expect(page.locator('#df-status')).toBeVisible();

  // 문서 행 클릭 → 그 문서가 있는 화면(고객360 공급 자격 탭)으로 직행
  await page.locator('#ql-list tbody tr[data-cust]').first().click();
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 5000 }).toBe(
    '#customer360/1/qualification'
  );
});

test('전사 품질관리 — KPI 에 SLA 초과·문서 만료 카드 노출', async ({ page }) => {
  await page.goto('/#quality');
  await page.waitForSelector('#ql-kpis .ql-kpi', { timeout: 15000 });
  await expect(page.locator('.ql-kpis')).toContainText('SLA 초과');
  await expect(page.locator('.ql-kpis')).toContainText('문서 만료');
  await expect(page.locator('.ql-kpis')).toContainText('만료 임박');
});
