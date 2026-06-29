// =============================================================
// E2E — 임원 360 요약 (전사 대시보드)
//
// 검증: 메뉴 진입 → KPI + 단계 분포 + Top 계정 + 리스크 + 드릴다운
//   - /api/customer360/exec-summary 는 mock (결정적)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SUMMARY = {
  success: true,
  data: {
    kpis: { weighted_expected: 48700000000, active_deals: 36, win_rate: 28, avg_health: 'B+', open_quality: 11, capa_short_accounts: 4, gate_delay_count: 7 },
    // 전면 교체: 단계 분포 = PLM 게이트 기준
    stage_distribution: [
      { stage: 'MRD', label: 'Market Requirement', count: 5 },
      { stage: 'CRP', label: 'Customer Requirement', count: 2 },
      { stage: 'DOE', label: 'Design of Experiments', count: 14 },
      { stage: 'PROTO', label: 'Prototype', count: 3 },
      { stage: 'SMALL', label: 'Small-lot', count: 2 },
      { stage: 'GALLON', label: 'Gallon-scale', count: 1 },
      { stage: 'MRP', label: 'Mass-prod Readiness', count: 4 },
      { stage: 'MP', label: 'Mass Production', count: 3 },
    ],
    top_accounts: [
      { id: 990777, name: 'E2E임원고객', weighted: 12800000000, active: 5, won: 1, health_grade: 'A-', risks: [{ level: 'high', label: '품질 1' }] },
    ],
    risks: {
      capa_short: [{ customer_id: 501, name: 'SK하이닉스', gap: 6000 }],
      quality: [{ customer_id: 502, name: '삼성전자', title: '순도 편차', severity: 'high', type: 'VOC' }],
      eval_delay: [{ customer_id: 503, name: 'Intel', material: 'SOC 하드마스크 · PoC' }],
      gate_delay: [{ customer_id: 505, name: 'SK하이닉스', material: '프리커서 Hf 전구체 · M16', gate: 'Design of Experiments', days: 42 }],
      misalign: [{ customer_id: 504, name: 'UMC', level: 'medium', label: '수주됐으나 소재 인증이 평가 이하 — 양산·납품 지연 리스크', count: 1 }],
    },
  },
};

// KPI 카드 클릭 시 lazy-load 되는 /exec-kpi/:kpi 별 결정적 fixture
const KPI_LISTS = {
  weighted: { kpi: 'weighted', total: 1, items: [{ customer_id: 777, name: 'E2E임원고객', weighted: 12800000000, active: 5 }] },
  quality: { kpi: 'quality', total: 1, items: [{ customer_id: 777, name: '삼성전자', title: '순도 편차', severity: 'high', type: 'VOC' }] },
  gatedelay: { kpi: 'gatedelay', total: 1, items: [{ customer_id: 909, name: 'E2E지연고객', material: '식각가스 C4F6 · 평택', gate: 'Design of Experiments', days: 41 }] },
};

test.beforeEach(async ({ page }) => {
  // ⚠️ mock 라우트는 loginAsAdmin(goto '/') 보다 먼저 등록 —
  //   기본 랜딩이 exec360 라 부팅 시 exec-summary 가 먼저 fetch 되어 mock 우회되던 문제 방지.
  await page.route('**/api/customer360/exec-summary', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY) })
  );
  await page.route('**/api/customer360/exec-kpi/**', route => {
    const kpi = route.request().url().split('/exec-kpi/')[1].split(/[?#]/)[0];
    const data = KPI_LISTS[kpi] || { kpi, total: 0, items: [] };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  // 게이트 단계 AI 진단 (전면 교체: 게이트 키 허용) — 결정적 fixture
  await page.route('**/api/customer360/exec-stage/**', route => {
    const gate = route.request().url().split('/exec-stage/')[1].split(/[?#]/)[0];
    const LBL = { MRD: 'Market Requirement', CRP: 'Customer Requirement', DOE: 'Design of Experiments', PROTO: 'Prototype', SMALL: 'Small-lot', GALLON: 'Gallon-scale', MRP: 'Mass-prod Readiness', MP: 'Mass Production' };
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { stage: gate, label: LBL[gate] || gate, stats: { count: 14, capa_short: 3, open_quality: 2, expected_order: 11830000000 }, materials: [{ customer_id: 909, customer_name: 'E2E단계고객', material_name: '식각가스 C4F6 · 평택', business_type: '식각가스', expected_order: 1950000000, capa_short: true, open_quality: 1 }], ai: { diagnosis: '게이트 진단 결과', actions: ['액션1'] } },
      }),
    });
  });
  await page.route('**/api/customer360/health-config', route => {
    const config = {
      version: 2,
      dimensions: {
        commercial: { label: '거래 성장', desc: '우리와 거래를 키우는가', base: 40, perWon: 15, perActive: 8, contractBonus: 20, weight: 30 },
        collection: { label: '대금 회수', desc: '대금이 제때 회수되는가', perOverdue: 25, weight: 20 },
        quality: { label: '품질·서비스', desc: '문제 없이 공급되는가', perQuality: 20, perSupport: 15, weight: 25 },
        supply: { label: '공급 역량', desc: '수요를 감당할 수 있는가', shortScore: 50, weight: 10 },
        satisfaction: { label: '관계·만족도', desc: '고객이 만족하는가 (NPS/CSAT)', weight: 15 },
      },
      thresholds: { 'A+': 90, A: 80, 'B+': 70, B: 60, C: 45 },
    };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { config, defaults: config } }) });
  });
  // 모든 mock 등록 후 로그인(부팅 goto '/') — 부팅 시 exec-summary 도 mock 으로 응답
  await loginAsAdmin(page);
});

test('임원 360 요약 — KPI + 단계 분포 + Top 계정 + 리스크', async ({ page }) => {
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-kpi', { timeout: 15000 });

  await expect(page.locator('#ex-body')).toContainText('가중 예상매출');
  await expect(page.locator('#ex-body')).toContainText('CAPA 부족 계정');
  await expect(page.locator('#ex-body')).toContainText('지연 게이트'); // PLM 지연 게이트 KPI
  await expect(page.locator('#ex-body .ex-kpi')).toHaveCount(7);

  // 단계 분포 (mock 8 게이트 — 스트림/퍼널 그래픽, 클릭 가능)
  await expect(page.locator('#ex-body .ex-fn-col')).toHaveCount(8);
  // 색약 안전: 단계 dot 이 단일색이 아니라 서로 구분되는 색(≥4종)으로 렌더
  const dotColors = await page
    .locator('#ex-body .ex-fn-dot')
    .evaluateAll(els => [...new Set(els.map(e => getComputedStyle(e).backgroundColor))]);
  expect(dotColors.length).toBeGreaterThanOrEqual(4);

  // Top 계정 + 리스크
  await expect(page.locator('#ex-body')).toContainText('E2E임원고객');
  await expect(page.locator('#ex-body')).toContainText('순도 편차');
  // 게이트 지연 리스크 카드 + 항목
  await expect(page.locator('#ex-body')).toContainText('게이트 지연');
  await expect(page.locator('#ex-body')).toContainText('Design of Experiments (D+42)');

  // 드릴다운: 계정 행 클릭 → 고객·제품 360뷰로 이동
  await page.locator('#ex-body tr[data-acct]').first().click();
  await expect(page).toHaveURL(/#customer360/, { timeout: 5000 });
});

test('임원 360 요약 — 게이트 분포 클릭 시 진단 모달 (게이트 키, 회귀 방지)', async ({ page }) => {
  // 🐛 전면 교체 후 퍼널 클릭이 게이트 키로 호출되어 "알 수 없는 단계" 400 나던 버그 회귀 방지
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-fn-col', { timeout: 15000 });

  // DOE(Design of Experiments) 게이트 컬럼 클릭 → 진단 모달
  await page.locator('#ex-body .ex-fn-col', { hasText: 'Design of Experiments' }).first().click();
  await expect(page.locator('#modal-overlay')).toContainText('Design of Experiments', { timeout: 5000 });
  // 실패 문구가 아니라 진단/통계가 떠야 함
  await expect(page.locator('#modal-overlay')).not.toContainText('알 수 없는');
  await expect(page.locator('#modal-overlay')).toContainText('게이트 진단 결과');

  // 소재 목록 행 드릴다운 → 고객·제품 360뷰 이동
  const matRow = page.locator('#modal-overlay .modal-body tr[data-cust="909"]');
  await expect(matRow).toBeVisible();
  await expect(matRow).toContainText('E2E단계고객');
  await matRow.click();
  await expect(page).toHaveURL(/#customer360\/909/, { timeout: 5000 });
});

test('임원 360 요약 — 지연 게이트 KPI 근거 모달 + 드릴다운', async ({ page }) => {
  // 🐛 지연 게이트 KPI 클릭 시 근거 모달이 안 뜨던 버그 회귀 방지
  await page.goto('/#exec360');
  await page.waitForSelector('.ex-kpi[data-kpi="gatedelay"]', { timeout: 15000 });
  await page.locator('.ex-kpi[data-kpi="gatedelay"]').click();
  await expect(page.locator('#modal-overlay')).toContainText('지연 게이트 — 근거', { timeout: 5000 });
  const row = page.locator('#ex-kpi-list tr[data-cust="909"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('E2E지연고객');
  await expect(row).toContainText('D+41');
  // 행 클릭 → 고객 360뷰 드릴다운
  await row.click();
  await expect(page).toHaveURL(/#customer360\/909/, { timeout: 5000 });
});

test('임원 360 요약 — KPI 카드 클릭 시 근거 모달', async ({ page }) => {
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-kpi[data-kpi]', { timeout: 15000 });

  // 가중 예상매출 카드 클릭 → 근거 모달 + 계정별 내역
  await page.locator('.ex-kpi[data-kpi="weighted"]').click();
  await expect(page.locator('#modal-overlay')).toContainText('가중 예상매출 — 근거');
  await expect(page.locator('#modal-overlay')).toContainText('E2E임원고객');
  await page.locator('#modal-overlay .modal-close, #modal-overlay [class*="close"]').first().click();

  // 품질 오픈 카드 클릭 → VOC/NCR 목록
  await page.locator('.ex-kpi[data-kpi="quality"]').click();
  await expect(page.locator('#modal-overlay')).toContainText('품질 오픈');
  await expect(page.locator('#modal-overlay')).toContainText('순도 편차');
});

test('임원 360 요약 — KPI 모달 항목 클릭 시 드릴다운(고객360)', async ({ page }) => {
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-kpi[data-kpi="weighted"]', { timeout: 15000 });

  await page.locator('.ex-kpi[data-kpi="weighted"]').click();
  // 목록 행(고객) 클릭 → 고객360 으로 이동
  await page.locator('#ex-kpi-list tr[data-cust]').first().click();
  await expect(page).toHaveURL(/#customer360/, { timeout: 5000 });
});

test('임원 360 요약 — 리스크 요약 항목 클릭 시 드릴다운', async ({ page }) => {
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-rcard', { timeout: 15000 });

  // CAPA 리스크 항목 → 고객360
  await page.locator('.ex-rcard .it[data-cust]').first().click();
  await expect(page).toHaveURL(/#customer360/, { timeout: 5000 });

  // 품질 리스크 항목 → 품질관리
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-rcard', { timeout: 15000 });
  await page.locator('.ex-rcard .it[data-qcust]').first().click();
  await expect(page).toHaveURL(/#quality/, { timeout: 5000 });
});

test('임원 360 요약 — 평균 Health 모달의 기준 패널 + 편집 진입', async ({ page }) => {
  await page.goto('/#exec360');
  await page.waitForSelector('#ex-body .ex-kpi[data-kpi="health"]', { timeout: 15000 });

  await page.locator('.ex-kpi[data-kpi="health"]').click();
  // 5대 건강 축 기준 패널 + 등급 라인 노출 (관계·만족도 축 포함)
  await expect(page.locator('#ex-health-cfg')).toContainText('5대 건강 축');
  await expect(page.locator('#ex-health-cfg')).toContainText('거래 성장');
  await expect(page.locator('#ex-health-cfg')).toContainText('관계·만족도');
  await expect(page.locator('#ex-health-cfg')).toContainText('A+ ≥90');

  // admin → '기준 설정' 편집 진입 → 비중 입력 + 임계값 노출
  await page.locator('#ex-hcfg-edit').click();
  await expect(page.locator('#ex-health-cfg [data-hf="w_commercial"]')).toBeVisible();
  await expect(page.locator('#ex-health-cfg [data-hf="t_C"]')).toBeVisible();
});
