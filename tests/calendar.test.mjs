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

  it('PUT /:id — 완료 메모(completion_note) 부분 저장 + 상태-only PUT 시 메모 보존', async () => {
    // 완료 + 메모 동시 저장
    const r1 = await api().put(`/api/calendar/events/${createdEventId}`).send({
      status: 'completed',
      completion_note: '__TEST__ 완료 메모',
    });
    expect(r1.status).toBe(200);
    let [[row]] = await pool.query(
      'SELECT status, completion_note FROM calendar_events WHERE id = ?',
      [createdEventId]
    );
    expect(row.status).toBe('completed');
    expect(row.completion_note).toBe('__TEST__ 완료 메모');

    // 상태만 토글(계획) — 부분 업데이트라 completion_note 는 보존되어야 함
    await api().put(`/api/calendar/events/${createdEventId}`).send({ status: 'planned' });
    [[row]] = await pool.query(
      'SELECT status, completion_note FROM calendar_events WHERE id = ?',
      [createdEventId]
    );
    expect(row.status).toBe('planned');
    expect(row.completion_note).toBe('__TEST__ 완료 메모');
  });

  it('POST/PUT — 활동목적(activity_purpose) + 동반자(companion_id) 저장', async () => {
    const cr = await api().post('/api/calendar/events').send({
      title: '__TEST__ 활동목적/동반자',
      event_type: '미팅',
      activity_purpose: '제품시연',
      companion_id: 1,
      status: 'planned',
      start_datetime: '2026-12-30 14:30:00',
      end_datetime: '2026-12-30 15:00:00',
      all_day: 0,
    });
    expect(cr.status).toBe(200);
    const id = cr.body.id;
    let [[row]] = await pool.query(
      'SELECT activity_purpose, companion_id FROM calendar_events WHERE id=?',
      [id]
    );
    expect(row.activity_purpose).toBe('제품시연');
    expect(row.companion_id).toBe(1);

    const put = await api()
      .put(`/api/calendar/events/${id}`)
      .send({ activity_purpose: '견적', companion_id: null });
    expect(put.status).toBe(200);
    [[row]] = await pool.query(
      'SELECT activity_purpose, companion_id FROM calendar_events WHERE id=?',
      [id]
    );
    expect(row.activity_purpose).toBe('견적');
    expect(row.companion_id).toBeNull();

    await pool.query('DELETE FROM calendar_events WHERE id=?', [id]);
  });

  it('DELETE /:id — 일정 삭제', async () => {
    const res = await api().delete(`/api/calendar/events/${createdEventId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    createdEventId = null;
  });
});
