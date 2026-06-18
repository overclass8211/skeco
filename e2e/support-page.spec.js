// =============================================================
// E2E — 고객지원(A/S) P1-C: 메뉴→페이지→접수→상세 (API 모킹)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const SETTINGS = {
  status: [
    { id: 1, kind: 'status', item_key: 'received', label: '접수', color: 'blue', category: 'open', is_initial: 1, is_active: 1 },
    { id: 4, kind: 'status', item_key: 'in_progress', label: '처리중', color: 'blue', category: 'open', is_active: 1 },
    { id: 6, kind: 'status', item_key: 'resolved', label: '조치완료', color: 'green', category: 'closed', is_final: 1, is_active: 1 },
  ],
  type: [{ id: 10, kind: 'type', item_key: 'issue', label: '이슈', color: 'gray', is_active: 1 }],
  priority: [
    { id: 20, kind: 'priority', item_key: 'normal', label: '보통', color: 'blue', is_active: 1 },
    { id: 21, kind: 'priority', item_key: 'high', label: '높음', color: 'amber', is_active: 1 },
  ],
  channel: [{ id: 30, kind: 'channel', item_key: 'phone', label: '전화', color: 'gray', is_active: 1 }],
};

async function mock(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('oci_onboarding_done', '1'); } catch (_) { /* */ }
  });
  const state = {
    tickets: [
      { id: 9, ticket_no: 'CS-2026-0001', title: '기존 티켓', customer_id: 5, customer_name: 'LG에너지', lead_id: 42, lead_name: '테스트딜', type: 'issue', priority: 'high', status: 'received', channel: 'phone', requester_name: '김고객', requester_phone: '010-1111-2222', assigned_name: null, resolution: '', watchers: '[{"id":2,"name":"김참조"}]', description: '증상 설명', created_at: '2026-06-12T09:00:00' },
      { id: 10, ticket_no: 'CS-2026-0010', title: '처리중건', customer_name: '현대오토에버', lead_name: null, type: 'issue', priority: 'normal', status: 'in_progress', channel: 'phone', requester_name: '박담당', requester_phone: '010-3333-4444', assigned_name: '홍길동', resolution: '', due_at: '2026-06-10T00:00:00', description: '진행 중', created_at: '2026-06-11T09:00:00' },
    ],
    seq: 1,
    settings: JSON.parse(JSON.stringify(SETTINGS)),
    setSeq: 100,
  };
  // 기능 플래그 — 빈 객체 → 모두 활성 (crm.support 게이트 통과)
  await page.route('**/api/admin/dev/features/public**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) })
  );
  await page.route('**/api/customers**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [{ id: 88, name: 'LG에너지' }] }) })
  );
  await page.route('**/api/support**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/support\/dashboard/.test(url)) {
      return json({
        success: true,
        data: { total: 2, open: 2, due_today: 0, overdue: 1, mine_open: 0, unassigned: 1 },
      });
    }
    if (/\/support\/check-due/.test(url)) {
      return json({ success: true, created: false, count: 0 });
    }
    if (/\/support\/notifications/.test(url)) {
      if (/\/read/.test(url)) return json({ success: true });
      return json({
        success: true,
        unread: 1,
        data: [
          { id: 1, ticket_id: 9, ticket_no: 'CS-2026-0001', title: '기존 티켓', event_type: 'assigned', message: 'CS-2026-0001 티켓이 회원님께 할당되었습니다', is_read: 0, created_at: '2026-06-15T09:00:00' },
        ],
      });
    }
    if (/\/support\/settings/.test(url)) {
      if (/\/reorder/.test(url)) return json({ success: true, updated: 1 });
      const ck = url.match(/\/settings\/(status|type|priority|channel)(?:\?|$)/);
      if (method === 'POST' && ck) {
        const kind = ck[1];
        const b = JSON.parse(request.postData() || '{}');
        state.setSeq += 1;
        state.settings[kind].push({ id: state.setSeq, kind, item_key: 'k' + state.setSeq, label: b.label, color: b.color || 'gray', is_active: 1 });
        return json({ success: true, id: state.setSeq, item_key: 'k' + state.setSeq });
      }
      const sidm = url.match(/\/settings\/(\d+)/);
      if (sidm && method === 'PUT') return json({ success: true });
      if (sidm && method === 'DELETE') return json({ success: true });
      if (ck && method === 'GET') return json({ success: true, data: state.settings[ck[1]] });
      return json({ success: true, data: state.settings });
    }
    const idm = url.match(/\/support\/(\d+)/);
    if (idm) {
      const id = parseInt(idm[1], 10);
      if (/\/comments/.test(url)) return json({ success: true, data: [] });
      if (/\/files/.test(url)) {
        if (method === 'POST') return json({ success: true, count: 1 });
        if (method === 'DELETE') return json({ success: true });
        return json({
          success: true,
          data: [
            { id: 5, file_name: '증상_캡처.png', file_size: 20480, created_at: '2026-06-12T09:30:00', uploaded_by_name: '오지현' },
          ],
        });
      }
      if (/\/history/.test(url)) {
        return json({
          success: true,
          data: [
            { id: 1, field: 'created', from_value: null, to_value: 'CS-2026-0001', note: '접수', changed_by_name: '오지현', changed_at: '2026-06-12T09:00:00' },
            { id: 2, field: 'status', from_value: 'received', to_value: 'in_progress', note: null, changed_by_name: '오지현', changed_at: '2026-06-12T09:20:00' },
          ],
        });
      }
      if (method === 'PUT') {
        const t = state.tickets.find(x => x.id === id);
        if (t) Object.assign(t, JSON.parse(request.postData() || '{}'));
        return json({ success: true });
      }
      return json({ success: true, data: state.tickets.find(x => x.id === id) });
    }
    if (method === 'POST') {
      const b = JSON.parse(request.postData() || '{}');
      state.seq += 1;
      const t = { id: 100 + state.seq, ticket_no: 'CS-2026-' + String(state.seq).padStart(4, '0'), customer_name: 'LG에너지', assigned_name: null, status: 'received', created_at: '2026-06-12T10:00:00', ...b };
      state.tickets.unshift(t);
      return json({ success: true, id: t.id, ticket_no: t.ticket_no });
    }
    // 목록
    return json({ success: true, data: state.tickets, total: state.tickets.length, page: 1, limit: 100 });
  });
}

test.beforeEach(async ({ page }) => {
  await mock(page);
  await loginAsAdmin(page);
});

test('메뉴/페이지 — 사이드바 고객지원 + 목록 렌더 + 배지', async ({ page }) => {
  await page.goto('/#support');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sup-list table', { timeout: 20000 });
  await expect(page.locator('#content')).toContainText('고객지원');
  const row = page.locator('tr[data-sup-id="9"]');
  await expect(row).toContainText('CS-2026-0001');
  await expect(row).toContainText('기존 티켓');
  await expect(row).toContainText('접수'); // status badge label
  await expect(row).toContainText('높음'); // priority badge
  // 사이드바 메뉴 노출
  await expect(page.locator('.nav-item[data-page="support"]')).toBeVisible();
  // W2: 내 담당 필터 노출
  await expect(page.locator('#sup-fl-mine')).toBeVisible();
});

test('접수 — 신규 티켓 등록 → 목록 반영', async ({ page }) => {
  await page.goto('/#support');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sup-new', { timeout: 20000 });
  await page.click('#sup-new');
  await page.waitForSelector('#sup-f-title', { timeout: 5000 });
  // W1: 신규 폼 항목 존재 + 처리요청일 기본=오늘 자동
  await expect(page.locator('#sup-f-lead')).toBeVisible();
  await expect(page.locator('#sup-f-creator')).toBeVisible();
  await expect(page.locator('#sup-f-assignee')).toBeVisible();
  await expect(page.locator('#sup-f-watchers')).toBeVisible(); // F3 관련담당자 멀티셀렉트
  await expect(page.locator('#sup-f-reqdate')).not.toHaveValue('');
  await page.fill('#sup-f-title', '__신규 접수건');
  await page.selectOption('#sup-f-priority', 'high');
  await page.fill('#sup-f-due', '2026-06-30');
  await page.click('#sup-f-save');
  await expect(page.locator('#sup-list')).toContainText('__신규 접수건', { timeout: 5000 });
});

test('상세 — 행 클릭 → 상태 select + 댓글 영역', async ({ page }) => {
  await page.goto('/#support');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('tr[data-sup-id="9"]', { timeout: 20000 });
  await page.locator('tr[data-sup-id="9"]').click();
  await page.waitForSelector('#sup-d-status', { timeout: 5000 });
  await expect(page.locator('#modal-box')).toContainText('CS-2026-0001');
  await expect(page.locator('#modal-box')).toContainText('김고객'); // 요청자
  await expect(page.locator('#modal-box')).toContainText('접수자'); // W1 메타
  await expect(page.locator('#modal-box')).toContainText('처리요청일'); // W1 메타
  await expect(page.locator('#sup-d-status')).toBeVisible();
  await expect(page.locator('#sup-d-assignee')).toBeVisible(); // W2 재할당 컨트롤
  // F1: 고객사·영업리드 클릭 이동 링크
  await expect(page.locator('#modal-box [data-go-customer]')).toBeVisible();
  await expect(page.locator('#modal-box [data-go-lead]')).toBeVisible();
  // F3: 관련담당자(watchers) 표시 + 편집 멀티셀렉트
  await expect(page.locator('#modal-box')).toContainText('관련담당자');
  await expect(page.locator('#modal-box')).toContainText('김참조');
  await expect(page.locator('#sup-d-watchers')).toBeVisible();
  await expect(page.locator('#modal-box')).toContainText('댓글');
  // 상태 변경(처리중) → PUT 모킹 성공 토스트
  await page.selectOption('#sup-d-status', 'in_progress');
  await expect(page.locator('#sup-d-status-badge')).toContainText('처리중');
});

test('상세 탭 — 첨부/이력 (P1-D)', async ({ page }) => {
  await page.goto('/#support');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('tr[data-sup-id="9"]', { timeout: 20000 });
  await page.locator('tr[data-sup-id="9"]').click();
  await page.waitForSelector('.sup-tab[data-tab="files"]', { timeout: 5000 });
  // 첨부 개수 배지 (열릴 때 미리 로드)
  await expect(page.locator('.sup-tab[data-tab="files"]')).toContainText('(1)');
  // 첨부 탭 → 파일 노출
  await page.locator('.sup-tab[data-tab="files"]').click();
  const files = page.locator('[data-panel="files"]');
  await expect(files).toBeVisible();
  await expect(files).toContainText('증상_캡처.png');
  // 이력 탭 → 타임라인 노출 (지연 로드)
  await page.locator('.sup-tab[data-tab="history"]').click();
  const hist = page.locator('[data-panel="history"]');
  await expect(hist).toBeVisible();
  await expect(hist).toContainText('접수 생성');
  await expect(hist).toContainText('상태 변경');
});

test('설정 — ⚙️ 모달: 상태 항목 + 유형 추가 (admin)', async ({ page }) => {
  await page.goto('/#support');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sup-settings', { timeout: 20000 }); // admin → 버튼 노출
  await page.click('#sup-settings');
  await page.waitForSelector('.set-tab[data-set-tab="type"]', { timeout: 5000 });
  // 상태 탭 기본 — 첫 항목 = 접수
  await expect(page.locator('#sup-set-list .set-label').first()).toHaveValue('접수');
  // [W3] 상태 항목에 워크플로우 컨트롤(허용 다음 상태 / 기본 담당자) 노출
  await expect(page.locator('#sup-set-list .set-allowed').first()).toBeVisible();
  await expect(page.locator('#sup-set-list .set-defassignee').first()).toBeVisible();
  // 유형 탭 → 신규 추가 → 목록 반영 (stateful mock)
  await page.click('.set-tab[data-set-tab="type"]');
  await page.fill('#sup-set-new', '__신규유형');
  await page.click('#sup-set-add');
  await expect(page.locator('#sup-set-list .set-label').last()).toHaveValue('__신규유형');
});

test('알림 — 🔔 미읽음 배지 + 패널 (W2)', async ({ page }) => {
  await page.goto('/#support');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sup-notif', { timeout: 20000 });
  // 미읽음 배지(1) 노출
  await expect(page.locator('#sup-notif-badge')).toBeVisible();
  await expect(page.locator('#sup-notif-badge')).toHaveText('1');
  // 패널 열기 → 알림 메시지
  await page.click('#sup-notif');
  await expect(page.locator('#sup-notif-list')).toContainText('할당되었습니다');
});

test('칸반 — 뷰 전환 + 상태별 컬럼 그룹핑', async ({ page }) => {
  await page.goto('/#support');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sup-list table', { timeout: 20000 }); // 기본 = 목록
  await page.click('.view-toggle-btn[data-view="card"]'); // 칸반 전환
  await page.waitForSelector('.sup-col', { timeout: 5000 });
  // 접수 컬럼 = received 티켓 / 처리중 컬럼 = in_progress 티켓
  await expect(page.locator('.sup-col[data-status="received"]')).toContainText('기존 티켓');
  await expect(page.locator('.sup-col[data-status="in_progress"]')).toContainText('처리중건');
  // 상태 필터는 칸반에서 숨김
  await expect(page.locator('#sup-fl-status')).toBeHidden();
});

test('필터 — 상세 필터 패널 토글 + 표준 세트 + 적용/초기화 (F4)', async ({ page }) => {
  await page.goto('/#support');
  await page.waitForSelector('#sup-list table', { timeout: 20000 });
  // 패널 토글
  await expect(page.locator('#sup-filter-panel')).toBeHidden();
  await page.click('#sup-fl-toggle');
  await expect(page.locator('#sup-filter-panel')).toBeVisible();
  // 표준 세트 필드 노출
  for (const id of [
    '#sup-fl-assignee',
    '#sup-fl-creator',
    '#sup-fl-type',
    '#sup-fl-priority',
    '#sup-fl-customer',
    '#sup-fl-from',
    '#sup-fl-to',
  ]) {
    await expect(page.locator(id)).toBeVisible();
  }
  // 유형 + 접수기간 적용 → 활성 필터 카운트 배지 = 2
  await page.selectOption('#sup-fl-type', 'issue');
  await page.fill('#sup-fl-from', '2026-06-01');
  await page.click('#sup-fl-apply');
  await expect(page.locator('#sup-fl-count')).toHaveText('2');
  // 초기화 → 배지 숨김
  await page.click('#sup-fl-reset');
  await expect(page.locator('#sup-fl-count')).toBeHidden();
});

test('SLA — KPI 대시보드 카드 + 처리예정 D-Day 컬럼 + 기한초과 클릭 필터', async ({ page }) => {
  await page.goto('/#support');
  await page.waitForSelector('#sup-list table', { timeout: 8000 });
  // KPI 카드 노출 (미해결/오늘예정/기한초과/내담당/미배정)
  await expect(page.locator('#sup-kpis')).toContainText('미해결');
  await expect(page.locator('#sup-kpis')).toContainText('기한초과');
  await expect(page.locator('#sup-kpis [data-kpi="overdue"]')).toBeVisible();
  await expect(page.locator('#sup-kpis [data-kpi="mine"]')).toBeVisible();
  // 처리예정 컬럼 + D-Day 배지 (ticket 10 due_at 과거 → D+ 표시)
  await expect(page.locator('#sup-list thead')).toContainText('처리예정');
  await expect(page.locator('#sup-list tbody')).toContainText('D+');
  // 기한초과 KPI 클릭 → 활성 강조(box-shadow) 적용
  await page.click('#sup-kpis [data-kpi="overdue"]');
  await expect(page.locator('#sup-kpis [data-kpi="overdue"]')).toHaveAttribute(
    'style',
    /box-shadow/
  );
});
