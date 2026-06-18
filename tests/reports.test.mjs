/**
 * Reports Widgets API 통합 테스트
 *
 * 검증 대상: /api/reports/widgets CRUD (사용자 정의 위젯)
 *   GET    /widgets       — 본인 위젯 목록 + report config_json 포함
 *   POST   /widgets       — 단일/다중 추가 (report_id or report_ids)
 *   PUT    /widgets/order — 재배치 (ids 배열 순서)
 *   DELETE /widgets/:id   — 위젯 제거 (본인 위젯만)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

// 테스트용 사용자/리포트 시드
let testUserId;
let testReportId;
let createdWidgetIds = [];

beforeAll(async () => {
  // 테스트 사용자 (X-User-Id 헤더로 인증 우회 — test 환경)
  // 실제 user_id 가 team_members 에 존재해야 외래키 안 깨짐 — 1 사용
  testUserId = 1;
  // 테스트 리포트 — report_definitions 에 직접 삽입
  const [r] = await pool.query(
    `INSERT INTO report_definitions (user_id, name, description, config_json, is_shared)
     VALUES (?, ?, ?, ?, 0)`,
    [
      testUserId,
      '__TEST__위젯_테스트_리포트',
      '위젯 테스트용',
      JSON.stringify({
        datasource: 'leads',
        rows: ['stage'],
        columns: [],
        filters: [],
        measures: ['count'],
        chartType: 'auto',
      }),
    ]
  );
  testReportId = r.insertId;
});

afterAll(async () => {
  // 정리 — 외래키 CASCADE 로 위젯도 자동 삭제됨
  if (testReportId) {
    await pool.query('DELETE FROM report_definitions WHERE id = ?', [testReportId]);
  }
  // 혹시 cascade 안 된 위젯 제거
  if (createdWidgetIds.length > 0) {
    await pool.query('DELETE FROM user_report_widgets WHERE id IN (?)', [createdWidgetIds]);
  }
});

describe('Reports Widgets API', () => {
  it('GET /api/reports/widgets — 빈 목록 (초기)', async () => {
    const res = await api().get('/api/reports/widgets').set('X-User-Id', String(testUserId));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — 단일 위젯 추가', async () => {
    const res = await api()
      .post('/api/reports/widgets')
      .set('X-User-Id', String(testUserId))
      .send({ report_id: testReportId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].report_id).toBe(testReportId);
    createdWidgetIds.push(res.body.data[0].id);
  });

  it('POST — 중복 추가 시 silent skip (UNIQUE)', async () => {
    const res = await api()
      .post('/api/reports/widgets')
      .set('X-User-Id', String(testUserId))
      .send({ report_id: testReportId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(0); // 추가 안 됨
    expect(res.body.skipped).toBeGreaterThan(0);
  });

  it('POST — report_id/report_ids 누락 시 400', async () => {
    const res = await api()
      .post('/api/reports/widgets')
      .set('X-User-Id', String(testUserId))
      .send({});
    expect(res.status).toBe(400);
  });

  it('GET — 위젯 + report config_json 함께 반환', async () => {
    const res = await api().get('/api/reports/widgets').set('X-User-Id', String(testUserId));
    expect(res.status).toBe(200);
    const widget = res.body.data.find(w => w.report_id === testReportId);
    expect(widget).toBeDefined();
    expect(widget.name).toContain('__TEST__');
    expect(widget.config_json).toBeDefined();
  });

  it('PUT /order — 재배치', async () => {
    const res = await api()
      .put('/api/reports/widgets/order')
      .set('X-User-Id', String(testUserId))
      .send({ ids: createdWidgetIds });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PUT /order — 빈 ids 400', async () => {
    const res = await api()
      .put('/api/reports/widgets/order')
      .set('X-User-Id', String(testUserId))
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('DELETE — 위젯 제거', async () => {
    const widgetId = createdWidgetIds[0];
    const res = await api()
      .delete(`/api/reports/widgets/${widgetId}`)
      .set('X-User-Id', String(testUserId));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    createdWidgetIds = createdWidgetIds.filter(id => id !== widgetId);
  });

  it('DELETE — 존재하지 않는 ID 404', async () => {
    const res = await api()
      .delete('/api/reports/widgets/999999')
      .set('X-User-Id', String(testUserId));
    expect(res.status).toBe(404);
  });
});
