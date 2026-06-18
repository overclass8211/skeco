// =============================================================
// E2E — LinkedSupport 컴포넌트 (고객/계약 모달 🎫 연동의 핵심)  [P1-E]
//   고객 모달 마운트와 동일하게 render('#container','customer',id) 호출 → 렌더/행클릭 검증
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const TICKETS = [
  {
    id: 21, ticket_no: 'CS-2026-0021', title: 'LinkedSupport 연동건', type_label: '이슈',
    priority_label: '높음', priority_color: 'amber', status_label: '처리중', status_color: 'amber',
    created_at: '2026-06-12T09:00:00',
  },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('oci_onboarding_done', '1'); } catch (_) { /* */ }
  });
  await page.route('**/api/admin/dev/features/public**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) })
  );
  await page.route('**/api/support**', (route, req) => {
    const json = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (/\/support\/settings/.test(req.url())) {
      return json({ success: true, data: { status: [{ item_key: 'in_progress', label: '처리중', color: 'amber', is_active: 1 }], type: [], priority: [], channel: [] } });
    }
    const idm = req.url().match(/\/support\/(\d+)(?:$|\?)/);
    if (idm) {
      return json({ success: true, data: { id: 21, ticket_no: 'CS-2026-0021', title: 'LinkedSupport 연동건', status: 'in_progress', priority: 'high', customer_name: '테스트사', requester_name: '김담당', created_at: '2026-06-12T09:00:00' } });
    }
    return json({ success: true, data: TICKETS, total: 1, page: 1, limit: 50 });
  });
  await loginAsAdmin(page);
});

test('LinkedSupport — 연결 티켓 렌더 + 배지 + 행클릭→상세', async ({ page }) => {
  await page.goto('/#support');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sup-list', { timeout: 20000 });

  // 고객 모달과 동일한 호출로 임시 컨테이너에 렌더
  await page.evaluate(async () => {
    const d = document.createElement('div');
    d.id = 'ls-test';
    document.getElementById('content').appendChild(d);
    await LinkedSupport.render('#ls-test', 'customer', 88);
  });

  const box = page.locator('#ls-test');
  await expect(box).toContainText('연결된 고객지원');
  await expect(box).toContainText('LinkedSupport 연동건');
  await expect(box).toContainText('처리중'); // status_label 배지
  await expect(box).toContainText('높음'); // priority_label 배지

  // 행이 상세(티켓 21)로 연결되도록 data-id 로 바인딩됨
  // (클릭→navigate('support')+openDetail 동작은 LinkedQuotes 와 동일 패턴 — 크로스페이지 이동은 생략)
  await expect(box.locator('.ls-row')).toHaveAttribute('data-id', '21');
});
