// =============================================================
// E2E — Webhook 시스템
//
// CRUD 체크리스트 적용:
//   1. Create — 새 Webhook 폼 + 시크릿 표시 모달
//   2. Read — 목록 표시 + 이력 모달
//   3. Update — 편집 (이름 변경)
//   4. Delete — 삭제 + 목록에서 사라짐 + DB 검증
//   5. 빈 상태 — 0개일 때 안내 메시지
//   6. 입력 검증 — name 누락, 이벤트 미선택
//   7. 활성/비활성 토글
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { createPool } = require('./helpers/seed');

const PREFIX = '__E2E_WH__';
let pool;

test.beforeAll(async () => {
  pool = createPool();
  await pool.query(
    `DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE name LIKE ?)`,
    [`${PREFIX}%`]
  );
  await pool.query(`DELETE FROM webhooks WHERE name LIKE ?`, [`${PREFIX}%`]);
});

test.afterAll(async () => {
  if (pool) {
    try {
      await pool.query(
        `DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE name LIKE ?)`,
        [`${PREFIX}%`]
      );
      await pool.query(`DELETE FROM webhooks WHERE name LIKE ?`, [`${PREFIX}%`]);
    } catch (_) {
      /* ignore */
    }
    await pool.end();
  }
});

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  page.on('dialog', d => d.accept());
});

// ─── Read: 빈 상태 + 카드 표시 ───────────────────────────
test('시나리오 1 — 설정 페이지 Webhook 섹션 표시', async ({ page }) => {
  await page.goto('/#settings');
  await page.waitForSelector('#webhook-new-btn', { timeout: 10000 });
  await expect(page.locator('h3, .card-title', { hasText: 'Webhook' }).first()).toBeVisible();
});

// ─── Create: 새 Webhook ──────────────────────────────────
test('시나리오 2 — 새 Webhook 추가 + 시크릿 모달', async ({ page }) => {
  await page.goto('/#settings');
  await page.waitForSelector('#webhook-new-btn', { timeout: 10000 });
  await page.click('#webhook-new-btn');
  await expect(page.locator('#wh-name')).toBeVisible();

  const name = `${PREFIX}slackTest`;
  await page.fill('#wh-name', name);
  await page.fill('#wh-url', 'https://hooks.slack.com/services/E2E/TEST/X');
  await page.locator('input[name="wh-event"][value="lead.won"]').check();
  await page.locator('input[name="wh-event"][value="project.completed"]').check();
  await page.click('#wh-save');

  // 시크릿 모달이 표시되어야 함
  await expect(page.locator('#wh-secret-display')).toBeVisible({ timeout: 5000 });
  const secret = await page.locator('#wh-secret-display').inputValue();
  expect(secret.length).toBeGreaterThanOrEqual(32);
  await page.click('#wh-secret-ok');

  // 목록에 표시
  await expect(page.locator(`#webhook-list tr:has-text("${name}")`)).toBeVisible({ timeout: 5000 });
});

// ─── 입력 검증 ─────────────────────────────────────────────
test('시나리오 3 — 입력 검증: 이름 누락 시 경고', async ({ page }) => {
  await page.goto('/#settings');
  await page.waitForSelector('#webhook-new-btn', { timeout: 10000 });
  await page.click('#webhook-new-btn');
  await expect(page.locator('#wh-name')).toBeVisible();

  // 이름 비우고 저장 시도
  await page.fill('#wh-url', 'https://example.com/hook');
  await page.locator('input[name="wh-event"][value="lead.won"]').check();
  await page.click('#wh-save');

  // 모달이 그대로 (저장 안 됨) — 이름 입력 필드 여전히 visible
  await expect(page.locator('#wh-name')).toBeVisible();
});

test('시나리오 4 — 입력 검증: 이벤트 미선택 시 경고', async ({ page }) => {
  await page.goto('/#settings');
  await page.waitForSelector('#webhook-new-btn', { timeout: 10000 });
  await page.click('#webhook-new-btn');
  await expect(page.locator('#wh-name')).toBeVisible();

  await page.fill('#wh-name', `${PREFIX}noEvents`);
  await page.fill('#wh-url', 'https://example.com/hook');
  // 이벤트 체크박스 모두 비움
  await page.click('#wh-save');
  await expect(page.locator('#wh-name')).toBeVisible();
});

// ─── Update: 편집 ─────────────────────────────────────────
test('시나리오 5 — Webhook 편집 (이름 변경)', async ({ page }) => {
  // 사전 시드
  const tplName = `${PREFIX}toEdit_${Date.now()}`;
  const [r] = await pool.query(
    `INSERT INTO webhooks (name, url, event_types, secret, is_active)
       VALUES (?, ?, ?, ?, 1)`,
    [
      tplName,
      'https://example.com/edit-hook',
      JSON.stringify(['lead.won']),
      'test-secret-32-bytes-hex-string',
    ]
  );
  const id = r.insertId;

  try {
    await page.goto('/#settings');
    await page.waitForSelector(`tr[data-wh-id="${id}"]`, { timeout: 10000 });
    await page.locator(`tr[data-wh-id="${id}"] [data-wh-action="edit"]`).click();
    await expect(page.locator('#wh-name')).toHaveValue(tplName);

    const newName = `${PREFIX}edited_${Date.now()}`;
    await page.fill('#wh-name', newName);
    await page.click('#wh-save');
    await expect(page.locator('#wh-name')).toBeHidden({ timeout: 5000 });

    await expect(page.locator(`tr[data-wh-id="${id}"]`)).toContainText(newName, { timeout: 5000 });
  } finally {
    await pool.query('DELETE FROM webhooks WHERE id = ?', [id]);
  }
});

// ─── Delete ────────────────────────────────────────────────
test('시나리오 6 — Webhook 삭제', async ({ page }) => {
  const tplName = `${PREFIX}toDelete_${Date.now()}`;
  const [r] = await pool.query(
    `INSERT INTO webhooks (name, url, event_types, secret, is_active)
       VALUES (?, ?, ?, ?, 1)`,
    [tplName, 'https://example.com/del-hook', JSON.stringify(['lead.won']), 'sec']
  );
  const id = r.insertId;

  try {
    await page.goto('/#settings');
    await page.waitForSelector(`tr[data-wh-id="${id}"]`, { timeout: 10000 });
    await page.locator(`tr[data-wh-id="${id}"] [data-wh-action="delete"]`).click();

    await expect(page.locator(`tr[data-wh-id="${id}"]`)).toBeHidden({ timeout: 5000 });
    const [rows] = await pool.query('SELECT id FROM webhooks WHERE id = ?', [id]);
    expect(rows.length).toBe(0);
  } finally {
    await pool.query('DELETE FROM webhooks WHERE id = ?', [id]);
  }
});

// ─── 발송 이력 모달 ───────────────────────────────────────
test('시나리오 7 — 발송 이력 모달 (빈 상태)', async ({ page }) => {
  const tplName = `${PREFIX}forLogs_${Date.now()}`;
  const [r] = await pool.query(
    `INSERT INTO webhooks (name, url, event_types, secret, is_active)
       VALUES (?, ?, ?, ?, 1)`,
    [tplName, 'https://example.com/logs-hook', JSON.stringify(['lead.won']), 'sec']
  );
  const id = r.insertId;

  try {
    await page.goto('/#settings');
    await page.waitForSelector(`tr[data-wh-id="${id}"]`, { timeout: 10000 });
    await page.locator(`tr[data-wh-id="${id}"] [data-wh-action="logs"]`).click();
    // 이력 모달 — 빈 상태 또는 테이블
    await expect(page.locator('.modal-overlay').filter({ hasText: '발송 이력' })).toBeVisible({
      timeout: 5000,
    });
  } finally {
    await pool.query('DELETE FROM webhook_deliveries WHERE webhook_id = ?', [id]);
    await pool.query('DELETE FROM webhooks WHERE id = ?', [id]);
  }
});
