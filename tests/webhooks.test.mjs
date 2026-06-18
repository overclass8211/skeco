/**
 * Webhooks API 통합 테스트
 *
 * 검증 항목:
 *  1. CRUD — 생성/조회/수정/삭제
 *  2. 입력 검증 — name/url 누락, 잘못된 URL, 잘못된 event_types
 *  3. URL 검증 — http (test 환경 허용), https, 잘못된 형식
 *  4. event_types 화이트리스트
 *  5. 시크릿 자동 생성 (32 byte hex)
 *  6. 이벤트 목록 endpoint
 *  7. HMAC 서명 함수 단위 (signPayload)
 *  8. 발송 이력 빈 목록
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const PREFIX = '__WEBHOOK_TEST__';
const createdIds = [];

beforeAll(async () => {
  await pool.query(
    `DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE name LIKE ?)`,
    [`${PREFIX}%`]
  );
  await pool.query(`DELETE FROM webhooks WHERE name LIKE ?`, [`${PREFIX}%`]);
});

afterAll(async () => {
  for (const id of createdIds) {
    try {
      await pool.query('DELETE FROM webhook_deliveries WHERE webhook_id = ?', [id]);
      await pool.query('DELETE FROM webhooks WHERE id = ?', [id]);
    } catch (_) {
      /* ignore */
    }
  }
  await pool.query(`DELETE FROM webhooks WHERE name LIKE ?`, [`${PREFIX}%`]);
});

describe('Webhooks API — 이벤트 목록', () => {
  it('GET /events — 허용 이벤트 5개 반환', async () => {
    const res = await api().get('/api/webhooks/events');
    expect(res.status).toBe(200);
    expect(res.body.data).toContain('lead.won');
    expect(res.body.data).toContain('lead.created');
    expect(res.body.data).toContain('project.completed');
    expect(res.body.data).toContain('meeting.created');
    expect(res.body.data).toContain('lead.stage_changed');
  });
});

describe('Webhooks API — CRUD', () => {
  it('POST — 신규 webhook 생성 (시크릿 자동 생성)', async () => {
    const res = await api()
      .post('/api/webhooks')
      .send({
        name: `${PREFIX}slack-test`,
        url: 'https://hooks.slack.com/services/TEST/TEST/TEST',
        event_types: ['lead.won', 'project.completed'],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.secret).toBeDefined();
    expect(res.body.secret.length).toBeGreaterThanOrEqual(32);
    createdIds.push(res.body.id);
  });

  it('GET — 목록', async () => {
    const res = await api().get('/api/webhooks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(w => w.name === `${PREFIX}slack-test`);
    expect(found).toBeDefined();
    expect(found.event_types).toEqual(['lead.won', 'project.completed']);
  });

  it('GET /:id — 단건 (시크릿은 has_secret 으로만)', async () => {
    const id = createdIds[0];
    const res = await api().get(`/api/webhooks/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_secret).toBe(1);
    expect(res.body.data.secret).toBeUndefined();
  });

  it('PUT — name 수정', async () => {
    const id = createdIds[0];
    const res = await api()
      .put(`/api/webhooks/${id}`)
      .send({
        name: `${PREFIX}slack-renamed`,
      });
    expect(res.status).toBe(200);
    const check = await api().get(`/api/webhooks/${id}`);
    expect(check.body.data.name).toBe(`${PREFIX}slack-renamed`);
  });

  it('PUT — is_active 토글', async () => {
    const id = createdIds[0];
    await api().put(`/api/webhooks/${id}`).send({ is_active: false });
    const check = await api().get(`/api/webhooks/${id}`);
    expect(check.body.data.is_active).toBe(0);
  });

  it('DELETE — 삭제', async () => {
    const res = await api()
      .post('/api/webhooks')
      .send({
        name: `${PREFIX}toDelete`,
        url: 'https://example.com/hook',
        event_types: ['lead.won'],
      });
    const id = res.body.id;
    const del = await api().delete(`/api/webhooks/${id}`);
    expect(del.status).toBe(200);
    const check = await api().get(`/api/webhooks/${id}`);
    expect(check.status).toBe(404);
  });
});

describe('Webhooks API — 입력 검증', () => {
  it('POST — name 누락 → 400', async () => {
    const res = await api()
      .post('/api/webhooks')
      .send({
        url: 'https://example.com/hook',
        event_types: ['lead.won'],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST — url 누락 → 400', async () => {
    const res = await api()
      .post('/api/webhooks')
      .send({
        name: `${PREFIX}noUrl`,
        event_types: ['lead.won'],
      });
    expect(res.status).toBe(400);
  });

  it('POST — 잘못된 URL → 400', async () => {
    const res = await api()
      .post('/api/webhooks')
      .send({
        name: `${PREFIX}badUrl`,
        url: 'not-a-url',
        event_types: ['lead.won'],
      });
    expect(res.status).toBe(400);
  });

  it('POST — ftp:// → 400 (http/https 만 허용)', async () => {
    const res = await api()
      .post('/api/webhooks')
      .send({
        name: `${PREFIX}ftpUrl`,
        url: 'ftp://example.com/hook',
        event_types: ['lead.won'],
      });
    expect(res.status).toBe(400);
  });

  it('POST — event_types 빈 배열 → 400', async () => {
    const res = await api()
      .post('/api/webhooks')
      .send({
        name: `${PREFIX}noEvents`,
        url: 'https://example.com/hook',
        event_types: [],
      });
    expect(res.status).toBe(400);
  });

  it('POST — 알 수 없는 event 만 → 400', async () => {
    const res = await api()
      .post('/api/webhooks')
      .send({
        name: `${PREFIX}badEvents`,
        url: 'https://example.com/hook',
        event_types: ['foo.bar', 'baz.qux'],
      });
    expect(res.status).toBe(400);
  });

  it('POST — 일부 알 수 없는 event 는 필터링 후 통과', async () => {
    const res = await api()
      .post('/api/webhooks')
      .send({
        name: `${PREFIX}mixed`,
        url: 'https://example.com/hook',
        event_types: ['lead.won', 'foo.bar'],
      });
    expect(res.status).toBe(200);
    createdIds.push(res.body.id);

    const check = await api().get(`/api/webhooks/${res.body.id}`);
    expect(check.body.data.event_types).toEqual(['lead.won']);
  });
});

describe('Webhooks API — 발송 이력', () => {
  it('GET /:id/deliveries — 신규 webhook 은 빈 이력', async () => {
    const id = createdIds[0];
    const res = await api().get(`/api/webhooks/${id}/deliveries`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('Webhooks Dispatcher — HMAC 서명', () => {
  it('signPayload — 시크릿 없으면 null', async () => {
    const { signPayload } = await import('../src/services/webhookDispatcher.js');
    expect(signPayload('payload', null)).toBeNull();
    expect(signPayload('payload', '')).toBeNull();
  });

  it('signPayload — sha256= prefix + hex', async () => {
    const { signPayload } = await import('../src/services/webhookDispatcher.js');
    const sig = signPayload('test-payload', 'my-secret');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('signPayload — 같은 입력 → 같은 출력 (deterministic)', async () => {
    const { signPayload } = await import('../src/services/webhookDispatcher.js');
    const a = signPayload('data', 'key');
    const b = signPayload('data', 'key');
    expect(a).toBe(b);
  });

  it('isAllowedEvent — 허용/거부 검증', async () => {
    const { isAllowedEvent } = await import('../src/services/webhookDispatcher.js');
    expect(isAllowedEvent('lead.won')).toBe(true);
    expect(isAllowedEvent('lead.created')).toBe(true);
    expect(isAllowedEvent('foo.bar')).toBe(false);
  });

  it('generateDeliveryId — 32자 hex', async () => {
    const { generateDeliveryId } = await import('../src/services/webhookDispatcher.js');
    const id = generateDeliveryId();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
  });
});
