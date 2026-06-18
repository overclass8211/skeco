/**
 * 캘린더 API 통합 테스트.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, pool, teardown } from './helpers.mjs';

let createdEventId;

afterAll(async () => {
  if (createdEventId) {
    await pool.query('DELETE FROM calendar_events WHERE id = ?', [createdEventId]);
  }
});

describe('Calendar API', () => {
  it('GET /api/calendar/events — 범위 조회', async () => {
    const res = await api().get('/api/calendar/events?start=2026-01-01&end=2026-12-31');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — 신규 일정 생성', async () => {
    const res = await api().post('/api/calendar/events').send({
      title: '__TEST__ 통합 테스트 미팅',
      event_type: '미팅',
      status: 'planned',
      start_datetime: '2026-12-31 10:00:00',
      end_datetime: '2026-12-31 11:00:00',
      all_day: 0,
      color: '#1a73e8',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdEventId = res.body.id;
  });

  it('PUT /:id — 상태 변경 (planned → completed)', async () => {
    const res = await api().put(`/api/calendar/events/${createdEventId}`).send({
      status: 'completed',
    });
    expect(res.status).toBe(200);
    const [[row]] = await pool.query('SELECT status FROM calendar_events WHERE id = ?', [
      createdEventId,
    ]);
    expect(row.status).toBe('completed');
  });

  it('DELETE /:id — 일정 삭제', async () => {
    const res = await api().delete(`/api/calendar/events/${createdEventId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    createdEventId = null;
  });
});
