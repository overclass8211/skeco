/**
 * Report Builder — 고객지원(support) 데이터소스 연동 테스트
 *
 * 검증 대상: DATASOURCES.support (상태/유형/우선순위/채널 설정형 JOIN + 집계 지표)
 *   GET  /api/report-builder/fields?datasource=support  — 차원/지표 카탈로그
 *   POST /api/report-builder/query                       — 상태별 집계 + whitelist 방어
 *
 * 인증: X-User-Id 헤더 (test 환경 RBAC 우회), user 1 = 관리자(team_lead+)
 */
import { describe, it, expect } from 'vitest';
import { api } from './helpers.mjs';

const UID = '1';

describe('Report Builder — 고객지원(support) 데이터소스', () => {
  it('GET /fields?datasource=support — 차원/지표 카탈로그 + 소스 목록', async () => {
    const res = await api()
      .get('/api/report-builder/fields?datasource=support')
      .set('X-User-Id', UID);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const dimKeys = res.body.data.dimensions.map(d => d.key);
    const measKeys = res.body.data.measures.map(m => m.key);
    expect(dimKeys).toEqual(
      expect.arrayContaining([
        'status',
        'status_category',
        'type',
        'priority',
        'channel',
        'assigned_name',
        'creator_name',
        'customer_name',
        'month_created',
      ])
    );
    expect(measKeys).toEqual(
      expect.arrayContaining(['count', 'open_count', 'resolved_count', 'overdue_count'])
    );
    // 데이터소스 드롭다운 목록에 support 노출
    expect(res.body.data.datasources.map(d => d.key)).toContain('support');
  });

  it('POST /query — 상태별 건수 집계 (설정형 라벨 JOIN)', async () => {
    const res = await api()
      .post('/api/report-builder/query')
      .set('X-User-Id', UID)
      .send({
        datasource: 'support',
        rows: ['status'],
        measures: ['count', 'open_count'],
        chartType: 'auto',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.config.datasource).toBe('support');
    expect(Array.isArray(res.body.data.rows)).toBe(true);
    for (const r of res.body.data.rows) {
      expect(r).toHaveProperty('row_key');
      expect(r).toHaveProperty('count');
    }
  });

  it('POST /query — 담당자별 미해결/기한초과 집계', async () => {
    const res = await api()
      .post('/api/report-builder/query')
      .set('X-User-Id', UID)
      .send({
        datasource: 'support',
        rows: ['assigned_name'],
        measures: ['open_count', 'overdue_count'],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.rows)).toBe(true);
  });

  it('POST /query — 알 수 없는 필드는 whitelist 에서 자동 drop (injection 방어)', async () => {
    const res = await api()
      .post('/api/report-builder/query')
      .set('X-User-Id', UID)
      .send({ datasource: 'support', rows: ['DROP TABLE support_tickets'], measures: ['count'] });
    // rows 가 drop 되어도 measures(count) 가 남아 성공 — 임의 SQL 미반영
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
